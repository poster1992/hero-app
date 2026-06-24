"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { getReceiptsInRange, type Receipt } from "@/lib/hero-api";
import { getDocumentUrl } from "@/lib/invoices";
import { getSupplierIbanMap } from "@/lib/supplier-ibans";

const HERO_HOST = "https://login.hero-software.de";

/** Ein zu prüfender Beleg (vom Client mit dem Zahlbetrag übergeben). */
export interface OcrCheckInput {
  heroId: string;
  customerId: number | null;
  name: string;
  /** Geplanter Zahlbetrag (offener Betrag bzw. Brutto). */
  amount: number;
}

export interface OcrFinding {
  heroId: string;
  name: string;
  /** Geplanter Zahlbetrag aus der Beleg-Liste. */
  plannedAmount: number;
  /** Vom OCR erkannter Rechnungs-Gesamtbetrag (brutto), null wenn nicht lesbar. */
  ocrTotal: number | null;
  /** Betrag weicht ab (OCR ≠ geplanter Zahlbetrag). */
  amountMismatch: boolean;
  /** Skonto kann gezogen werden (Frist noch offen). */
  skontoAvailable: boolean;
  /** Skontosatz in % (aus OCR oder hinterlegt). */
  skontoPercent: number | null;
  /** Letzter Tag für Skontozahlung (YYYY-MM-DD). */
  skontoDeadline: string | null;
  /** Zahlbetrag mit Skontoabzug. */
  skontoAmount: number | null;
  /** Quelle der Skonto-Werte. */
  skontoSource: "beleg" | "hinterlegt" | null;
  /** Rechnungsbetrag war nicht lesbar (z.B. leeres/weißes Dokument). */
  unreadable: boolean;
  /** Auth-Proxy-URL zum Öffnen des Belegs (PDF/Bild), null wenn kein Dokument. */
  docUrl: string | null;
  /** Menschlich lesbarer Hinweis. */
  message: string;
  /** OCR/Lade-Fehler – Beleg konnte nicht geprüft werden. */
  error?: string;
}

export interface OcrCheckResult {
  findings: OcrFinding[];
  error?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface ExtractedInvoice {
  total_gross: number | null;
  currency: string | null;
  skonto_percent: number | null;
  skonto_days: number | null;
  skonto_deadline: string | null;
  /** Auf der Rechnung ausgewiesener Skonto-Zahlbetrag (falls genannt). */
  skonto_amount: number | null;
}

/** Lädt das Beleg-Dokument von HERO und gibt Base64 + MIME zurück. */
async function fetchDocument(src: string): Promise<{ data: string; mediaType: string } | null> {
  const token = process.env.HERO_API_TOKEN;
  if (!token) return null;
  const res = await fetch(HERO_HOST + src, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const mediaType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/pdf";
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString("base64"), mediaType };
}

/** Fragt Claude nach Rechnungsbetrag und Skonto-Konditionen aus dem Beleg-Dokument. */
async function extractInvoice(
  client: Anthropic,
  doc: { data: string; mediaType: string }
): Promise<ExtractedInvoice | null> {
  const isImage = doc.mediaType.startsWith("image/");
  const block = isImage
    ? {
        type: "image" as const,
        source: { type: "base64" as const, media_type: doc.mediaType as "image/png", data: doc.data },
      }
    : {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: doc.data },
      };

  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          block,
          {
            type: "text",
            text:
              "Dies ist eine Eingangsrechnung. Lies den Rechnungs-Gesamtbetrag (brutto, der zu zahlende Betrag) " +
              "und die Skonto-Konditionen aus. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Erklärung, " +
              'in genau diesem Format: {"total_gross": number|null, "currency": "EUR"|string|null, ' +
              '"skonto_percent": number|null, "skonto_days": number|null, "skonto_deadline": "YYYY-MM-DD"|null, ' +
              '"skonto_amount": number|null}. ' +
              "total_gross ist der Bruttoendbetrag der Rechnung. skonto_percent/skonto_days/skonto_deadline/skonto_amount nur, " +
              "wenn auf der Rechnung explizit Skonto genannt ist, sonst null. skonto_amount ist der ausgewiesene Skonto-Zahlbetrag " +
              "(der reduzierte zu zahlende Betrag), falls die Rechnung ihn nennt – sonst null. " +
              "Wenn das Dokument leer/unlesbar ist, gib für alle Felder null zurück. " +
              "Zahlen ohne Tausenderpunkt, Punkt als Dezimaltrennzeichen.",
          },
        ],
      },
    ],
  });

  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  const raw = text.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(raw) as ExtractedInvoice;
    return parsed;
  } catch {
    return null;
  }
}

/** Belegdatum + Tage → ISO-Datum (YYYY-MM-DD). */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * OCR-Prüfung der markierten Belege vor dem SEPA-Export: Stimmt der Rechnungsbetrag
 * mit dem Zahlbetrag überein, und ist Skonto möglich? Nutzt OCR vom Beleg sowie die
 * je Lieferant hinterlegten Skonto-Konditionen als Gegencheck.
 */
export async function analyzeReceiptsForExport(items: OcrCheckInput[]): Promise<OcrCheckResult> {
  if (!(await getSession())) return { findings: [], error: "Kein Zugriff." };
  if (items.length === 0) return { findings: [] };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { findings: [], error: "OCR ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt." };
  }

  const now = new Date();
  const from = `${now.getUTCFullYear() - 3}-01-01T00:00:00Z`;
  const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;

  let byId: Map<string, Receipt>;
  let ibanMap: Awaited<ReturnType<typeof getSupplierIbanMap>>;
  try {
    const [receipts, map] = await Promise.all([getReceiptsInRange(from, to), getSupplierIbanMap()]);
    byId = new Map(receipts.map((r) => [r.id, r]));
    ibanMap = map;
  } catch (e) {
    return { findings: [], error: e instanceof Error ? e.message : "Belege konnten nicht geladen werden." };
  }

  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const today = new Date().toISOString().slice(0, 10);

  const findings = await Promise.all(
    items.map(async (it): Promise<OcrFinding> => {
      const receipt = byId.get(it.heroId);
      const docUrl = receipt?.fileUpload?.src ? getDocumentUrl(receipt.fileUpload.src) : null;
      const base: OcrFinding = {
        heroId: it.heroId,
        name: it.name,
        plannedAmount: round2(it.amount),
        ocrTotal: null,
        amountMismatch: false,
        skontoAvailable: false,
        skontoPercent: null,
        skontoDeadline: null,
        skontoAmount: null,
        skontoSource: null,
        unreadable: false,
        docUrl,
        message: "",
      };

      if (!receipt?.fileUpload?.src) {
        return { ...base, error: "Kein Beleg-Dokument zum Prüfen vorhanden." };
      }

      let extracted: ExtractedInvoice | null = null;
      try {
        const doc = await fetchDocument(receipt.fileUpload.src);
        if (!doc) return { ...base, error: "Beleg-Dokument konnte nicht geladen werden." };
        extracted = await extractInvoice(client, doc);
      } catch (e) {
        return { ...base, error: e instanceof Error ? e.message : "OCR fehlgeschlagen." };
      }
      if (!extracted) return { ...base, error: "Rechnung konnte nicht ausgewertet werden." };

      // Betragsabgleich (Toleranz 1 Cent).
      const ocrTotal = typeof extracted.total_gross === "number" ? round2(extracted.total_gross) : null;
      const amountMismatch = ocrTotal != null && Math.abs(ocrTotal - base.plannedAmount) > 0.01;

      // Skonto: OCR bevorzugt, hinterlegte Konditionen als Fallback/Gegencheck.
      const stored = it.customerId != null ? ibanMap.get(it.customerId) : undefined;
      let percent: number | null = null;
      let deadline: string | null = null;
      let source: "beleg" | "hinterlegt" | null = null;

      if (extracted.skonto_percent != null && extracted.skonto_percent > 0) {
        percent = extracted.skonto_percent;
        source = "beleg";
        deadline =
          extracted.skonto_deadline ??
          (extracted.skonto_days != null && receipt.receiptDate
            ? addDays(receipt.receiptDate.slice(0, 10), extracted.skonto_days)
            : null);
      } else if (stored?.skontoPercent && stored.skontoPercent > 0) {
        percent = stored.skontoPercent;
        source = "hinterlegt";
        deadline =
          stored.skontoDays != null && receipt.receiptDate
            ? addDays(receipt.receiptDate.slice(0, 10), stored.skontoDays)
            : null;
      }

      let skontoAvailable = false;
      let skontoAmount: number | null = null;
      let skontoFromBeleg = false;
      if (percent != null) {
        // Ohne Frist sicherheitshalber als verfügbar behandeln; mit Frist nur wenn noch offen.
        skontoAvailable = deadline == null || deadline >= today;
        // Vom Beleg ausgewiesenen Skontobetrag bevorzugen, sonst aus Prozentsatz rechnen.
        if (source === "beleg" && typeof extracted.skonto_amount === "number" && extracted.skonto_amount > 0) {
          skontoAmount = round2(extracted.skonto_amount);
          skontoFromBeleg = true;
        } else {
          skontoAmount = round2(base.plannedAmount * (1 - percent / 100));
        }
      }

      const unreadable = ocrTotal == null;
      const parts: string[] = [];
      if (unreadable) {
        parts.push("Rechnungsbetrag nicht lesbar – Beleg bitte manuell prüfen");
      } else {
        parts.push(
          amountMismatch
            ? `Rechnung lt. Beleg ${ocrTotal!.toFixed(2)} € ≠ Zahlbetrag ${base.plannedAmount.toFixed(2)} €`
            : `Rechnungsbetrag bestätigt (${ocrTotal!.toFixed(2)} €)`
        );
      }
      if (percent != null && skontoAvailable && skontoAmount != null) {
        parts.push(
          `${percent.toLocaleString("de-DE")} % Skonto` +
            (deadline ? ` bis ${deadline.split("-").reverse().join(".")}` : "") +
            ` → ${skontoAmount.toFixed(2)} € (${
              skontoFromBeleg ? "Beleg" : source === "beleg" ? "Beleg, gerechnet" : "hinterlegt"
            })`
        );
      } else if (percent != null && !skontoAvailable) {
        parts.push(`Skontofrist abgelaufen${deadline ? ` (${deadline.split("-").reverse().join(".")})` : ""}`);
      }

      return {
        ...base,
        ocrTotal,
        amountMismatch,
        skontoAvailable,
        skontoPercent: percent,
        skontoDeadline: deadline,
        skontoAmount,
        skontoSource: source,
        unreadable,
        message: parts.join(" · ") || "Keine Auffälligkeiten.",
      };
    })
  );

  return { findings };
}
