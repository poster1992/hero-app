"use server";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getReceiptsInRange } from "@/lib/hero-api";
import { effectiveReceiptStatus, getCustomerName } from "@/lib/invoices";
import { getSupplierIbanMap } from "@/lib/supplier-ibans";
import { getPaymentOverrideMap, setPaymentOverride } from "@/lib/receipt-payment-status";
import { findStatementImport, recordStatementImport } from "@/lib/bank-imports";

export interface BankTxn {
  /** YYYY-MM-DD oder null. */
  date: string | null;
  /** Betrag immer positiv; Richtung separat. */
  amount: number;
  /** "out" = Abgang/Belastung (zahlt einen Beleg), "in" = Eingang. */
  direction: "out" | "in";
  name: string;
  purpose: string;
}

export interface OpenBeleg {
  heroId: string;
  number: string;
  supplier: string;
  gross: number;
  iban: string | null;
}

export interface BankMatch {
  txn: BankTxn;
  /** Vorgeschlagener Beleg (HERO-ID) oder null. */
  heroId: string | null;
  /** 0 = kein Treffer, höher = sicherer. */
  score: number;
  reason: string;
  /** Diese Buchung (Betrag bzw. Betrag+Datum) wurde schon einmal eingelesen. */
  alreadyImported?: boolean;
  alreadyImportedInfo?: string;
}

export interface BankAnalysisResult {
  matches: BankMatch[];
  openBelege: OpenBeleg[];
  error?: string;
  info?: string;
  /** Datei-Hash des Auszugs (für die Doppel-Erkennung beim Bestätigen). */
  statementHash?: string;
  filename?: string;
  txCount?: number;
  total?: number;
  /** Warnung, wenn dieser Auszug bereits eingelesen wurde. */
  warning?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/g, " ")
    .replace(/\b(gmbh|ag|kg|ohg|ug|mbh|co|e\.?k|sarl|s\.?a\.?r\.?l|asbl)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface RawTxn {
  date: string | null;
  amount: number;
  direction: "out" | "in";
  name: string;
  purpose: string;
}

const INSTRUCTION =
  "Dies ist ein Kontoauszug. Extrahiere ALLE Buchungszeilen. Antworte AUSSCHLIESSLICH mit JSON in genau diesem Format: " +
  '{"transactions":[{"date":"YYYY-MM-DD"|null,"amount":number,"direction":"out"|"in","name":string,"purpose":string}]}. ' +
  "amount immer als positive Zahl (Punkt als Dezimaltrennzeichen, kein Tausenderpunkt). " +
  'direction = "out" für ABGÄNGE (Geld raus: Belastung, Soll, Lastschrift, Überweisung, negative Beträge/Minuszeichen), ' +
  '"in" für EINGÄNGE (Geld rein: Gutschrift, Haben, positive Eingänge). Bestimme die Richtung anhand von Vorzeichen bzw. Soll/Haben-Spalte. ' +
  "name = Empfänger/Auftraggeber, purpose = Verwendungszweck (inkl. Rechnungs-/Belegnummern). Keine Erklärung, nur das JSON-Objekt.";

/** Robustes Parsen – rettet auch abgeschnittene JSON-Antworten (sammelt komplette { … }). */
function parseTxnObjects(text: string): RawTxn[] {
  const raw = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const p = JSON.parse(raw) as { transactions?: RawTxn[] };
    if (Array.isArray(p.transactions)) return p.transactions;
  } catch {
    // Salvage unten
  }
  const objs: RawTxn[] = [];
  const re = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    try {
      const o = JSON.parse(m[0]);
      if (o && o.amount != null) objs.push(o as RawTxn);
    } catch {
      /* unvollständiges Objekt überspringen */
    }
  }
  return objs;
}

function mapTxns(raw: RawTxn[]): BankTxn[] {
  return raw
    .map((t) => ({
      date: t.date ?? null,
      amount: round2(Math.abs(Number(t.amount) || 0)),
      direction: t.direction === "in" ? ("in" as const) : ("out" as const),
      name: String(t.name ?? ""),
      purpose: String(t.purpose ?? ""),
    }))
    .filter((t) => t.amount > 0);
}

/** Ein Claude-Aufruf für einen Block (PDF oder Textausschnitt). */
async function callExtract(
  client: Anthropic,
  payload: { kind: "pdf"; data: string } | { kind: "text"; text: string },
  maxTokens: number
): Promise<BankTxn[]> {
  const content =
    payload.kind === "pdf"
      ? [
          { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: payload.data } },
          { type: "text" as const, text: INSTRUCTION },
        ]
      : [{ type: "text" as const, text: `${INSTRUCTION}\n\nKontoauszug-Daten:\n${payload.text}` }];
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  });
  const tb = res.content.find((b) => b.type === "text");
  if (!tb || tb.type !== "text") return [];
  return mapTxns(parseTxnObjects(tb.text));
}

/** Text in Blöcke aufteilen (gegen Token-Limit bei vielen Zeilen) und je Block extrahieren. */
async function extractFromText(client: Anthropic, text: string): Promise<BankTxn[]> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 6000);
  if (lines.length === 0) return [];
  const header = lines.slice(0, 2).join("\n"); // mögliche Spaltenüberschrift als Kontext mitgeben
  const CHUNK = 80;
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = lines.slice(i, i + CHUNK).join("\n");
    chunks.push(i === 0 ? part : `${header}\n${part}`);
  }
  const all = await Promise.all(chunks.map((c) => callExtract(client, { kind: "text", text: c }, 8000)));
  return all.flat();
}

/** Liest den hochgeladenen Kontoauszug (PDF/CSV/TXT/XLSX) und gleicht ihn mit offenen Belegen ab. */
export async function analyzeBankStatement(formData: FormData): Promise<BankAnalysisResult> {
  if (!(await getSession())) return { matches: [], openBelege: [], error: "Kein Zugriff." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { matches: [], openBelege: [], error: "OCR ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { matches: [], openBelege: [], error: "Keine Datei hochgeladen." };
  }

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  const client = new Anthropic({ maxRetries: 2, timeout: 180_000 });

  // Doppel-Erkennung: wurde genau diese Auszugsdatei schon einmal eingelesen?
  const statementHash = createHash("sha256").update(buf).digest("hex");
  let warning: string | undefined;
  try {
    const prior = await findStatementImport(statementHash);
    if (prior) {
      const when = prior.importedAt ? prior.importedAt.slice(0, 10).split("-").reverse().join(".") : null;
      warning =
        "Dieser Kontoauszug wurde bereits eingelesen" +
        (when ? ` am ${when}` : "") +
        (prior.importedByName ? ` von ${prior.importedByName}` : "") +
        ". Bitte prüfen, damit keine Doppelzahlung markiert wird.";
    }
  } catch {
    // Doppel-Erkennung optional.
  }

  // 1) Buchungen extrahieren – je nach Dateityp
  let txns: BankTxn[];
  try {
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      txns = await callExtract(client, { kind: "pdf", data: buf.toString("base64") }, 16000);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      txns = await extractFromText(client, csv);
    } else {
      // CSV / TXT – UTF-8, bei deutschen Bank-Exports ggf. Latin-1.
      let text = buf.toString("utf8");
      if (text.includes("�")) text = buf.toString("latin1");
      txns = await extractFromText(client, text);
    }
  } catch (e) {
    return { matches: [], openBelege: [], error: e instanceof Error ? e.message : "Auszug konnte nicht gelesen werden." };
  }
  if (txns.length === 0) {
    return { matches: [], openBelege: [], error: "Keine Buchungen erkannt. Bitte Format/Datei prüfen." };
  }

  // 2) Offene Belege laden (HERO offen UND nicht lokal bezahlt; bzw. lokal offen)
  let openBelege: OpenBeleg[];
  // Bereits per Kontoauszug erfasste Buchungen (aus den gespeicherten Notizen).
  const importedAmount = new Set<string>();
  const importedAmountDate = new Set<string>();
  try {
    const now = new Date();
    const from = `${now.getUTCFullYear() - 3}-01-01T00:00:00Z`;
    const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
    const [receipts, ibanMap, overrides] = await Promise.all([
      getReceiptsInRange(from, to),
      getSupplierIbanMap(),
      getPaymentOverrideMap(),
    ]);
    for (const ov of overrides.values()) {
      const mm = (ov.note ?? "").match(/Kontoauszug\s+(\d{2}\.\d{2}\.\d{4}|—)\s+·\s+([\d.]+,\d{2})/);
      if (!mm) continue;
      const amt = Number(mm[2].replace(/\./g, "").replace(",", ".")).toFixed(2);
      importedAmount.add(amt);
      if (mm[1] !== "—") importedAmountDate.add(`${amt}|${mm[1].split(".").reverse().join("-")}`);
    }
    openBelege = receipts
      .filter((r) => r.type === "output")
      .filter((r) => {
        const ov = overrides.get(r.id);
        // Offen = effektiv nicht bezahlt (Override > [ab Cutoff lokal] > HERO).
        return effectiveReceiptStatus(r, ov?.status ?? null).tone !== "paid";
      })
      .map((r) => ({
        heroId: r.id,
        number: r.number,
        supplier: getCustomerName(r),
        gross: round2(r.value),
        iban: r.customer?.id != null ? (ibanMap.get(r.customer.id)?.iban ?? null) : null,
      }));
  } catch (e) {
    return { matches: [], openBelege: [], error: e instanceof Error ? e.message : "Belege konnten nicht geladen werden." };
  }

  // 3) Abgleich: je Abgang den besten offenen Beleg (Betrag + Nr./IBAN/Name)
  const used = new Set<string>();
  const matches: BankMatch[] = txns
    .filter((t) => t.direction === "out")
    .map((t) => {
      const hay = norm(`${t.name} ${t.purpose}`);
      let best: { b: OpenBeleg; score: number; reason: string } | null = null;
      for (const b of openBelege) {
        if (used.has(b.heroId)) continue;
        const amountMatch = Math.abs(b.gross - t.amount) <= 0.02;
        const numMatch = b.number && b.number.length >= 4 && hay.replace(/\s/g, "").includes(b.number.toLowerCase().replace(/\s/g, ""));
        const ibanMatch = b.iban && hay.replace(/\s/g, "").includes(b.iban.toLowerCase());
        const nameTokens = norm(b.supplier).split(" ").filter((w) => w.length >= 4);
        const nameMatch = nameTokens.some((w) => hay.includes(w));
        let score = 0;
        const reasons: string[] = [];
        if (amountMatch) { score += 2; reasons.push("Betrag"); }
        if (numMatch) { score += 2; reasons.push("Beleg-Nr."); }
        if (ibanMatch) { score += 1; reasons.push("IBAN"); }
        if (nameMatch) { score += 1; reasons.push("Name"); }
        if (score === 0) continue;
        if (!best || score > best.score) best = { b, score, reason: reasons.join(" + ") };
      }
      if (best) used.add(best.b.heroId);

      // Wurde diese Buchung (Betrag+Datum, sonst Betrag) schon eingelesen?
      const amtKey = t.amount.toFixed(2);
      let alreadyImported = false;
      let alreadyImportedInfo: string | undefined;
      if (t.date && importedAmountDate.has(`${amtKey}|${t.date}`)) {
        alreadyImported = true;
        alreadyImportedInfo = "Betrag und Datum bereits eingelesen";
      } else if (importedAmount.has(amtKey)) {
        alreadyImported = true;
        alreadyImportedInfo = "Betrag bereits eingelesen";
      }

      return {
        txn: t,
        heroId: best?.b.heroId ?? null,
        score: best?.score ?? 0,
        reason: best?.reason ?? "kein Treffer",
        alreadyImported,
        alreadyImportedInfo,
      };
    });

  const total = round2(matches.reduce((s, m) => s + m.txn.amount, 0));
  return {
    matches,
    openBelege,
    statementHash,
    filename: file.name,
    txCount: matches.length,
    total,
    warning,
    info: `${matches.length} Abgänge erkannt, ${openBelege.length} offene Belege.`,
  };
}

export interface ConfirmAssignment {
  heroId: string;
  note: string;
}

export interface BankStatementMeta {
  hash: string;
  filename: string;
  txCount: number;
  total: number;
}

/** Setzt die bestätigten Belege lokal auf „bezahlt" inkl. Kontoauszug-Notiz. */
export async function confirmBankMatches(
  assignments: ConfirmAssignment[],
  statement?: BankStatementMeta
): Promise<{ count: number; error?: string }> {
  const session = await getSession();
  if (!session) return { count: 0, error: "Kein Zugriff." };
  let userId: number | null = null;
  try {
    userId = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    /* ignore */
  }
  let count = 0;
  for (const a of assignments) {
    if (!a.heroId) continue;
    try {
      await setPaymentOverride(a.heroId, "bezahlt", userId, a.note?.slice(0, 255) || null);
      count++;
    } catch {
      /* einzelnen Beleg überspringen */
    }
  }
  // Auszug vermerken (für die Doppel-Erkennung beim nächsten Einlesen).
  if (statement?.hash) {
    try {
      await recordStatementImport({
        fileHash: statement.hash,
        filename: statement.filename,
        txCount: statement.txCount,
        total: statement.total,
        userId,
      });
    } catch {
      /* optional */
    }
  }
  return { count };
}
