"use server";

import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { getUserByUsername } from "@/lib/users";
import { getReceiptsInRange } from "@/lib/hero-api";
import { getInvoiceStatus, getCustomerName } from "@/lib/invoices";
import { getSupplierIbanMap } from "@/lib/supplier-ibans";
import { getPaymentOverrideMap, setPaymentOverride } from "@/lib/receipt-payment-status";

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
}

export interface BankAnalysisResult {
  matches: BankMatch[];
  openBelege: OpenBeleg[];
  error?: string;
  info?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/g, " ")
    .replace(/\b(gmbh|ag|kg|ohg|ug|mbh|co|e\.?k|sarl|s\.?a\.?r\.?l|asbl)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface Extracted {
  transactions: { date: string | null; amount: number; direction: "out" | "in"; name: string; purpose: string }[];
}

/** Schickt Kontoauszug-Inhalt an Claude und bekommt normalisierte Buchungen. */
async function extractTransactions(
  client: Anthropic,
  payload: { kind: "pdf"; data: string } | { kind: "text"; text: string }
): Promise<BankTxn[]> {
  const instruction =
    "Dies ist ein Kontoauszug. Extrahiere ALLE Buchungszeilen. Antworte AUSSCHLIESSLICH mit JSON in genau diesem Format: " +
    '{"transactions":[{"date":"YYYY-MM-DD"|null,"amount":number,"direction":"out"|"in","name":string,"purpose":string}]}. ' +
    "amount immer als positive Zahl (Punkt als Dezimaltrennzeichen, kein Tausenderpunkt). " +
    'direction = "out" für ABGÄNGE (Geld raus: Belastung, Soll, Lastschrift, Überweisung, negative Beträge/Minuszeichen), ' +
    '"in" für EINGÄNGE (Geld rein: Gutschrift, Haben, positive Eingänge). Bestimme die Richtung anhand von Vorzeichen bzw. Soll/Haben-Spalte. ' +
    "name = Empfänger/Auftraggeber, purpose = Verwendungszweck (inkl. Rechnungs-/Belegnummern). Keine Erklärung, nur das JSON-Objekt.";

  const content =
    payload.kind === "pdf"
      ? [
          { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: payload.data } },
          { type: "text" as const, text: instruction },
        ]
      : [{ type: "text" as const, text: `${instruction}\n\nKontoauszug-Daten:\n${payload.text}` }];

  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    messages: [{ role: "user", content }],
  });
  const tb = res.content.find((b) => b.type === "text");
  if (!tb || tb.type !== "text") return [];
  const raw = tb.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: Extracted;
  try {
    parsed = JSON.parse(raw) as Extracted;
  } catch {
    return [];
  }
  return (parsed.transactions ?? [])
    .map((t) => ({
      date: t.date ?? null,
      amount: round2(Math.abs(Number(t.amount) || 0)),
      direction: t.direction === "in" ? ("in" as const) : ("out" as const),
      name: String(t.name ?? ""),
      purpose: String(t.purpose ?? ""),
    }))
    .filter((t) => t.amount > 0);
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

  // 1) Buchungen extrahieren – je nach Dateityp
  let txns: BankTxn[];
  try {
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      txns = await extractTransactions(client, { kind: "pdf", data: buf.toString("base64") });
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      txns = await extractTransactions(client, { kind: "text", text: csv.slice(0, 60000) });
    } else {
      // CSV / TXT
      txns = await extractTransactions(client, { kind: "text", text: buf.toString("utf8").slice(0, 60000) });
    }
  } catch (e) {
    return { matches: [], openBelege: [], error: e instanceof Error ? e.message : "Auszug konnte nicht gelesen werden." };
  }
  if (txns.length === 0) {
    return { matches: [], openBelege: [], error: "Keine Buchungen erkannt. Bitte Format/Datei prüfen." };
  }

  // 2) Offene Belege laden (HERO offen UND nicht lokal bezahlt; bzw. lokal offen)
  let openBelege: OpenBeleg[];
  try {
    const now = new Date();
    const from = `${now.getUTCFullYear() - 3}-01-01T00:00:00Z`;
    const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
    const [receipts, ibanMap, overrides] = await Promise.all([
      getReceiptsInRange(from, to),
      getSupplierIbanMap(),
      getPaymentOverrideMap(),
    ]);
    openBelege = receipts
      .filter((r) => r.type === "output")
      .filter((r) => {
        const ov = overrides.get(r.id);
        if (ov) return ov.status === "offen"; // lokaler Override gewinnt
        return getInvoiceStatus(r).tone !== "paid"; // HERO offen/überfällig
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
      return { txn: t, heroId: best?.b.heroId ?? null, score: best?.score ?? 0, reason: best?.reason ?? "kein Treffer" };
    });

  return {
    matches,
    openBelege,
    info: `${matches.length} Abgänge erkannt, ${openBelege.length} offene Belege.`,
  };
}

export interface ConfirmAssignment {
  heroId: string;
  note: string;
}

/** Setzt die bestätigten Belege lokal auf „bezahlt" inkl. Kontoauszug-Notiz. */
export async function confirmBankMatches(assignments: ConfirmAssignment[]): Promise<{ count: number; error?: string }> {
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
  return { count };
}
