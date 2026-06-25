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
import {
  findStatementImport,
  recordStatementImport,
  listStatementImports,
  deleteStatementImport,
  type StatementImport,
} from "@/lib/bank-imports";
import { addPendingTxns, listPendingTxns, markTxnsDone } from "@/lib/bank-transactions";

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
  /** Bruttobetrag abzgl. hinterlegtem Skonto (falls vorhanden), sonst null. */
  skontoAmount: number | null;
}

export interface BankMatch {
  /** DB-ID der offenen Buchung (zum Erledigt-Setzen). */
  txnId: number;
  txn: BankTxn;
  /** Vorgeschlagener Beleg (HERO-ID) oder null. */
  heroId: string | null;
  /** 0 = kein Treffer, höher = sicherer. */
  score: number;
  reason: string;
}

export interface BankAnalysisResult {
  matches: BankMatch[];
  openBelege: OpenBeleg[];
  error?: string;
  info?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// OCR-Modelle: PDF/Bild brauchen Opus (Vision); reiner Text (CSV/TXT/XLSX) reicht Haiku.
const MODEL_OPUS = "claude-opus-4-8";
const MODEL_HAIKU = "claude-haiku-4-5";
// Preise in USD pro 1 Mio. Tokens.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};
const USD_EUR = 0.92;

interface Usage {
  model: string;
  in: number;
  out: number;
}
/** Geschätzte Kosten (€) aus den gesammelten Token-Nutzungen. */
function costEur(usages: Usage[]): number {
  let usd = 0;
  for (const u of usages) {
    const p = PRICES[u.model] ?? PRICES[MODEL_OPUS];
    usd += (u.in / 1_000_000) * p.in + (u.out / 1_000_000) * p.out;
  }
  return Math.round(usd * USD_EUR * 10000) / 10000;
}

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    // Umlaute transliterieren, damit z.B. "Dächert" und "DAECHERT" gleich sind.
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(gmbh|mbh|ag|kg|ohg|ug|co|ek|sarl|asbl)\b/g, " ")
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
  maxTokens: number,
  model: string,
  usages?: Usage[]
): Promise<BankTxn[]> {
  const content =
    payload.kind === "pdf"
      ? [
          { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: payload.data } },
          { type: "text" as const, text: INSTRUCTION },
        ]
      : [{ type: "text" as const, text: `${INSTRUCTION}\n\nKontoauszug-Daten:\n${payload.text}` }];
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  });
  usages?.push({ model, in: res.usage?.input_tokens ?? 0, out: res.usage?.output_tokens ?? 0 });
  const tb = res.content.find((b) => b.type === "text");
  if (!tb || tb.type !== "text") return [];
  return mapTxns(parseTxnObjects(tb.text));
}

/** Text in Blöcke aufteilen (gegen Token-Limit bei vielen Zeilen) und je Block extrahieren. */
async function extractFromText(
  client: Anthropic,
  text: string,
  model: string,
  usages?: Usage[]
): Promise<BankTxn[]> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 6000);
  if (lines.length === 0) return [];
  const header = lines.slice(0, 2).join("\n"); // mögliche Spaltenüberschrift als Kontext mitgeben
  const CHUNK = 80;
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = lines.slice(i, i + CHUNK).join("\n");
    chunks.push(i === 0 ? part : `${header}\n${part}`);
  }
  const all = await Promise.all(chunks.map((c) => callExtract(client, { kind: "text", text: c }, 8000, model, usages)));
  return all.flat();
}

/** Liest die auf dem Dokument stehende Kontoauszugsnummer (oder null). */
async function extractStatementNumber(
  client: Anthropic,
  payload: { kind: "pdf"; data: string } | { kind: "text"; text: string },
  model: string,
  usages?: Usage[]
): Promise<string | null> {
  const ask =
    "Auf diesem Kontoauszug steht eine Auszugs-/Kontoauszugsnummer (z.B. \"Auszug Nr. 7\", " +
    '"Kontoauszug 2026/0007", "Blatt 12", "Auszug 5/2026"). Gib NUR diese Nummer zurück, ohne weiteren Text. ' +
    "Wenn keine erkennbar ist, antworte mit dem Wort: unbekannt.";
  try {
    const content =
      payload.kind === "pdf"
        ? [
            { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: payload.data } },
            { type: "text" as const, text: ask },
          ]
        : [{ type: "text" as const, text: `${ask}\n\nDokument-Anfang:\n${payload.text.slice(0, 3000)}` }];
    const res = await client.messages.create({ model, max_tokens: 40, messages: [{ role: "user", content }] });
    usages?.push({ model, in: res.usage?.input_tokens ?? 0, out: res.usage?.output_tokens ?? 0 });
    const tb = res.content.find((b) => b.type === "text");
    if (!tb || tb.type !== "text") return null;
    const val = tb.text.trim().replace(/^["']|["']$/g, "").slice(0, 64);
    if (!val || /^unbekannt$/i.test(val)) return null;
    return val;
  } catch {
    return null;
  }
}

/** Lädt offene Belege (effektiv nicht bezahlt) + Lieferanten-Häufigkeit für den Abgleich. */
async function loadOpenBelege(): Promise<{ openBelege: OpenBeleg[]; supplierCount: Map<string, number> }> {
  const now = new Date();
  const from = `${now.getUTCFullYear() - 3}-01-01T00:00:00Z`;
  const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
  const [receipts, ibanMap, overrides] = await Promise.all([
    getReceiptsInRange(from, to),
    getSupplierIbanMap(),
    getPaymentOverrideMap(),
  ]);
  const openBelege: OpenBeleg[] = receipts
    .filter((r) => r.type === "output")
    .filter((r) => effectiveReceiptStatus(r, overrides.get(r.id)?.status ?? null).tone !== "paid")
    .map((r) => {
      const sk = r.customer?.id != null ? ibanMap.get(r.customer.id) : undefined;
      const gross = round2(r.value);
      const pct = sk?.skontoPercent ?? null;
      return {
        heroId: r.id,
        number: r.number,
        supplier: getCustomerName(r),
        gross,
        iban: sk?.iban ?? null,
        skontoAmount: pct && pct > 0 ? round2(gross * (1 - pct / 100)) : null,
      };
    });
  const supplierCount = new Map<string, number>();
  for (const b of openBelege) {
    const k = norm(b.supplier);
    if (k) supplierCount.set(k, (supplierCount.get(k) ?? 0) + 1);
  }
  return { openBelege, supplierCount };
}

/** Bester passender offener Beleg für eine Buchung. Priorität: Name > Zweck > Betrag. */
function matchOne(
  t: BankTxn,
  openBelege: OpenBeleg[],
  used: Set<string>
): { heroId: string | null; score: number; reason: string } {
  const hayText = norm(`${t.name} ${t.purpose}`);
  const hay = hayText.replace(/\s/g, "");
  // numHit = Kandidat, dessen VOLLSTÄNDIGE Beleg-Nr. im Verwendungszweck steht
  //          → nur dann wird automatisch vorgeschlagen.
  // displayBest = bester Kandidat nach Score (nur als Hinweis, ohne Vorauswahl).
  let numHit: { b: OpenBeleg; score: number; reason: string } | null = null;
  let displayBest: { b: OpenBeleg; score: number; reason: string } | null = null;
  for (const b of openBelege) {
    if (used.has(b.heroId)) continue;
    const normSup = norm(b.supplier);
    const nameTokens = normSup.split(" ").filter((w) => w.length >= 4);
    const nameMatch = nameTokens.some((w) => hayText.includes(w));
    const numMatch = !!b.number && b.number.length >= 4 && hay.includes(b.number.toLowerCase().replace(/\s/g, ""));
    const ibanMatch = !!b.iban && hay.includes(b.iban.toLowerCase());
    const zweckMatch = numMatch || ibanMatch;
    const grossHit = Math.abs(b.gross - t.amount) <= 0.02;
    const skontoHit = !grossHit && b.skontoAmount != null && Math.abs(b.skontoAmount - t.amount) <= 0.02;
    const amountMatch = grossHit || skontoHit;
    let score = 0;
    let signals = 0;
    const reasons: string[] = [];
    if (nameMatch) { score += 4; signals++; reasons.push("Name"); }
    if (zweckMatch) { score += 2; signals++; reasons.push(numMatch ? "Beleg-Nr." : "IBAN"); }
    if (amountMatch) { score += 1; signals++; reasons.push(skontoHit ? "Betrag (Skonto)" : "Betrag"); }
    if (signals === 0) continue;
    const reason = reasons.join(" + ");
    if (numMatch && (!numHit || score > numHit.score)) numHit = { b, score, reason };
    if (!displayBest || score > displayBest.score) displayBest = { b, score, reason };
  }
  // Vorschlag NUR bei vollständigem Beleg-Nr.-Treffer im Verwendungszweck.
  if (numHit) {
    used.add(numHit.b.heroId);
    return { heroId: numHit.b.heroId, score: numHit.score, reason: numHit.reason };
  }
  return {
    heroId: null,
    score: displayBest?.score ?? 0,
    reason: displayBest ? `unsicher: ${displayBest.reason}` : "kein Treffer",
  };
}

/** Liest den hochgeladenen Auszug, extrahiert die Abgänge und legt sie als offene Posten an. */
export async function importBankStatement(
  formData: FormData
): Promise<{ added: number; total: number; warning?: string; error?: string; costEur?: number }> {
  const session = await getSession();
  if (!session) return { added: 0, total: 0, error: "Kein Zugriff." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { added: 0, total: 0, error: "OCR ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { added: 0, total: 0, error: "Keine Datei hochgeladen." };
  }

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
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
        " – bereits bekannte Buchungen werden nicht doppelt hinzugefügt.";
    }
  } catch {
    // optional
  }

  const client = new Anthropic({ maxRetries: 2, timeout: 180_000 });
  // Inhalt je Dateityp aufbereiten (wird für Buchungen UND Auszugsnummer genutzt).
  let payload: { kind: "pdf"; data: string } | { kind: "text"; text: string };
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    payload = { kind: "pdf", data: buf.toString("base64") };
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const wb = XLSX.read(buf, { type: "buffer" });
    payload = { kind: "text", text: XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]) };
  } else {
    let text = buf.toString("utf8");
    if (text.includes("�")) text = buf.toString("latin1");
    payload = { kind: "text", text };
  }
  // PDF → Opus (Vision), reiner Text (CSV/TXT/XLSX) → Haiku (günstiger).
  const ocrModel = payload.kind === "pdf" ? MODEL_OPUS : MODEL_HAIKU;
  const usages: Usage[] = [];
  let txns: BankTxn[];
  try {
    txns =
      payload.kind === "pdf"
        ? await callExtract(client, payload, 16000, ocrModel, usages)
        : await extractFromText(client, payload.text, ocrModel, usages);
  } catch (e) {
    return { added: 0, total: 0, error: e instanceof Error ? e.message : "Auszug konnte nicht gelesen werden." };
  }

  const out = txns.filter((t) => t.direction === "out");
  if (out.length === 0) {
    return { added: 0, total: 0, warning, error: "Keine Abgänge erkannt. Bitte Format/Datei prüfen." };
  }

  let userId: number | null = null;
  try {
    userId = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    /* ignore */
  }
  try {
    const added = await addPendingTxns(
      out.map((t) => ({ date: t.date, amount: t.amount, name: t.name, purpose: t.purpose })),
      statementHash
    );
    const statementNumber = await extractStatementNumber(client, payload, ocrModel, usages);
    const cost = costEur(usages);
    await recordStatementImport({
      fileHash: statementHash,
      filename: file.name,
      statementNumber,
      txCount: out.length,
      total: round2(out.reduce((s, t) => s + t.amount, 0)),
      userId,
      inputTokens: usages.reduce((s, u) => s + u.in, 0),
      outputTokens: usages.reduce((s, u) => s + u.out, 0),
      costEur: cost,
    });
    return { added, total: out.length, warning, costEur: cost };
  } catch (e) {
    return { added: 0, total: 0, error: e instanceof Error ? e.message : "Speichern fehlgeschlagen." };
  }
}

/** Aktuelle offene (noch nicht zugeordnete) Buchungen inkl. Beleg-Vorschlägen. */
export async function getPendingBankList(): Promise<BankAnalysisResult> {
  if (!(await getSession())) return { matches: [], openBelege: [], error: "Kein Zugriff." };
  try {
    const [pending, loaded] = await Promise.all([listPendingTxns(), loadOpenBelege()]);
    const { openBelege } = loaded;
    const used = new Set<string>();
    const matches: BankMatch[] = pending.map((p) => {
      const txn: BankTxn = { date: p.date, amount: p.amount, direction: "out", name: p.name, purpose: p.purpose };
      const m = matchOne(txn, openBelege, used);
      return { txnId: p.id, txn, heroId: m.heroId, score: m.score, reason: m.reason };
    });
    return {
      matches,
      openBelege,
      info: `${matches.length} offene Buchung(en) · ${openBelege.length} offene Belege.`,
    };
  } catch (e) {
    return { matches: [], openBelege: [], error: e instanceof Error ? e.message : "Laden fehlgeschlagen." };
  }
}

export interface ConfirmLine {
  txnId: number;
  heroIds: string[];
  note: string;
}

/** Setzt die zugeordneten Belege auf „bezahlt" und nimmt die Buchungen aus der Liste. */
export async function confirmBankMatches(lines: ConfirmLine[]): Promise<{ count: number; error?: string }> {
  const session = await getSession();
  if (!session) return { count: 0, error: "Kein Zugriff." };
  let userId: number | null = null;
  try {
    userId = (await getUserByUsername(session.username))?.id ?? null;
  } catch {
    /* ignore */
  }
  const doneTxnIds: number[] = [];
  let count = 0;
  for (const ln of lines) {
    if (!ln.heroIds || ln.heroIds.length === 0) continue;
    for (const heroId of ln.heroIds) {
      try {
        await setPaymentOverride(heroId, "bezahlt", userId, ln.note?.slice(0, 255) || null);
        count++;
      } catch {
        /* einzelnen Beleg überspringen */
      }
    }
    doneTxnIds.push(ln.txnId);
  }
  try {
    await markTxnsDone(doneTxnIds);
  } catch {
    /* optional */
  }
  return { count };
}

/** Historie der eingelesenen Kontoauszüge (neueste zuerst). */
export async function getStatementHistory(): Promise<StatementImport[]> {
  if (!(await getSession())) return [];
  try {
    return await listStatementImports();
  } catch {
    return [];
  }
}

/** Löscht einen Auszug aus der Historie und entfernt seine offenen Buchungen. */
export async function deleteStatement(fileHash: string): Promise<{ removed: number; error?: string }> {
  if (!(await getSession())) return { removed: 0, error: "Kein Zugriff." };
  if (!fileHash) return { removed: 0, error: "Kein Auszug angegeben." };
  try {
    const removed = await deleteStatementImport(fileHash);
    return { removed };
  } catch (e) {
    return { removed: 0, error: e instanceof Error ? e.message : "Löschen fehlgeschlagen." };
  }
}
