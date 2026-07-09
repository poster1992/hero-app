import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { findContactNameBySearch } from "./hero-api";

export type BelegSumKind =
  | "lohn"
  | "bgl"
  | "mixvoip"
  | "palettecad"
  | "activite"
  | "herosoftware"
  | "circle"
  | "etges";

export interface BelegSumResult {
  ok: boolean;
  /** Summe der je Seite ausgelesenen Beträge. */
  total?: number;
  /** Anzahl erkannter Werte (Seiten/Rechnungen). */
  count?: number;
  /** Einzelwerte (für die Kontrolle). */
  values?: number[];
  /** Erkannter MwSt-/TVA-Satz in %, oder undefined. */
  vatRate?: number;
  /** Belegdatum (yyyy-mm-dd), aus dem Beleg gelesen. */
  date?: string;
  /** Lieferant – bevorzugt der kanonische HERO-Name. */
  supplier?: string;
  /** Beschreibung (BGL: Matricule(n); sonst Leistungstext). */
  description?: string;
  /** true, wenn es sich (laut Matricule/Immatriculation) um Fahrzeug-Leasing handelt. */
  isVehicle?: boolean;
  /** Vorzuschlagendes Konto (Nummer), z. B. "4595" oder "4920". */
  accountNumber?: string;
  /** Fallback-Kontoname, falls die Nummer nicht in der HERO-Kontenliste ist. */
  accountName?: string;
  /** Tatsächlich verwendeter Belegtyp (v. a. bei automatischer Erkennung). */
  kind?: BelegSumKind;
  /** Anzeigename des Belegtyps. */
  kindLabel?: string;
  /** Belegnummer/Rechnungsnummer (v. a. Etges & Dächer). */
  invoiceNumber?: string;
  /** Skontobetrag in EUR. */
  skontoAmount?: number;
  /** Zu zahlender Betrag bei Skontoabzug (Skontozahlbetrag). */
  skontoPayAmount?: number;
  error?: string;
}

/** Anzeigename je Belegtyp. */
export const KIND_LABEL: Record<BelegSumKind, string> = {
  lohn: "Lohn",
  bgl: "BGL-Leasing",
  mixvoip: "Mixvoip",
  palettecad: "Palette CAD",
  activite: "Activité",
  herosoftware: "Hero-Software",
  circle: "Circle",
  etges: "Etges & Dächer",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Prompt + Konfiguration je Belegtyp. */
const SUM_CONFIG: Record<
  BelegSumKind,
  {
    label: string;
    prompt: string;
    /** Fester HERO-Suchbegriff für den Lieferanten (sonst OCR-Name). */
    supplierSearch?: string;
    /** Vorzuschlagendes Konto. */
    account?: { number: string; name: string };
    /** Konto nur setzen, wenn ein Fahrzeug erkannt wurde (Matricule). */
    accountNeedsVehicle?: boolean;
  }
> = {
  lohn: {
    label: "Total Brutto",
    prompt:
      "Dies ist ein mehrseitiges Lohnjournal (in der Regel eine Seite je Mitarbeiter). Gehe das " +
      "Dokument SEITE FÜR SEITE durch. Gib für JEDE Seite genau ein Objekt zurück: " +
      "{seite: Zahl, betrag: Zahl|null}. betrag = der exakt mit „Total Brutto\" bezeichnete Betrag " +
      "dieser Seite (NICHT Bruttogehalt, NICHT Netto, NICHT Auszahlung; wenn keiner vorhanden: null). " +
      "Lass KEINE Seite aus und erfinde keine. Antworte AUSSCHLIESSLICH mit JSON: " +
      '{"seiten": [ … ]}. Punkt als Dezimaltrennzeichen, KEINE Tausenderpunkte. Nur JSON.',
  },
  activite: {
    label: "Endbetrag",
    supplierSearch: "Activite Lensterbierg",
    // Konto wird dynamisch je Rechnungstyp gesetzt (Miete 4210 / Nebenkosten 4240).
    prompt:
      "Das PDF enthält GENAU EINE Rechnung von Activité Lensterbierg (Vermieter). Gib in seiten GENAU " +
      "EIN Objekt {betrag, steuersatz, typ} zurück. betrag = der EINE finale, zu zahlende Endbetrag der " +
      "Rechnung: bei einer MIETRECHNUNG der Wert „Gesamt\" (inkl. MwSt UND inkl. der Nebenkosten-" +
      "Vorauszahlung); bei einer NEBENKOSTENABRECHNUNG der Schluss-Saldo („Nachzahlung\" positiv; ein " +
      "Guthaben „zu Ihren Gunsten\" NEGATIV). Gib KEINE Zwischen-, Energie- oder Teilsummen aus. " +
      "typ = „miete\" oder „nebenkosten\" oder „sonstiges\". steuersatz = der Haupt-MwSt-Satz in Prozent " +
      "als Zahl. Zusätzlich auf oberster Ebene: belegdatum (YYYY-MM-DD oder null), lieferant, beschreibung " +
      '(kurze Leistungsbezeichnung inkl. Objekt/Monat). Antworte AUSSCHLIESSLICH mit JSON: {"seiten": ' +
      '[ EIN Objekt ], "belegdatum": …, "lieferant": …, "beschreibung": …}. Punkt als Dezimaltrennzeichen, ' +
      "KEINE Tausenderpunkte. Nur JSON.",
  },
  etges: {
    label: "Gesamtbetrag brutto",
    supplierSearch: "Etges",
    account: { number: "3000", name: "Wareneingang / Material" },
    prompt:
      "Dies ist eine Rechnung des Lieferanten „Etges & Dächer\" (Dachdecker-/Dachbaustoffe). Das PDF " +
      "enthält GENAU EINE Rechnung (evtl. mehrseitig). Gib in seiten GENAU EIN Objekt {betrag, steuersatz} " +
      "zurück. betrag = der zu zahlende BRUTTO-Gesamtbetrag inkl. MwSt der ganzen Rechnung (Label z. B. " +
      "„Gesamtbetrag\", „Rechnungsbetrag\", „Bruttobetrag\", „Gesamtbetrag brutto\", „Endbetrag\", „Zu " +
      "zahlender Betrag\") – NICHT der Netto-Wert, NICHT eine Zwischensumme, NICHT nur die MwSt. " +
      "steuersatz = der Haupt-MwSt-Satz in Prozent als Zahl. Gib zusätzlich auf oberster Ebene an: " +
      "belegdatum (Rechnungsdatum YYYY-MM-DD oder null – reine Zahlen-Datumsangaben als Tag/Monat/Jahr " +
      "europäisch interpretieren), lieferant (Rechnungssteller oder null), beschreibung (kurze " +
      "Leistungsbezeichnung, z. B. Material/Projekt), belegnummer (die Rechnungs-/Belegnummer als Text, " +
      "oder null), skonto_eur (der Skontobetrag in EUR als Zahl – der gewährte Abzug bei fristgerechter " +
      "Zahlung, Label z. B. „Skonto\", „abzgl. Skonto\"; oder null), skonto_zahlbetrag (der bei " +
      "Skontoabzug zu zahlende Betrag als Zahl, Label z. B. „Skontozahlbetrag\", „Zahlbetrag bei Skonto\", " +
      "„Betrag abzüglich Skonto\"; oder null). Antworte AUSSCHLIESSLICH mit JSON: " +
      '{"seiten": [ EIN Objekt ], "belegdatum": …, "lieferant": …, "beschreibung": …, "belegnummer": …, ' +
      '"skonto_eur": …, "skonto_zahlbetrag": …}. Punkt als Dezimaltrennzeichen, KEINE Tausenderpunkte. Nur JSON.',
  },
  circle: {
    label: "Total TTC",
    supplierSearch: "Circle",
    account: { number: "4530", name: "Laufende Kfz-Betriebskosten" },
    prompt:
      "Dies ist eine Circle-K-Tankrechnung (Luxemburg). Das PDF ist EINE Rechnung (evtl. mehrseitig). " +
      "Gib in seiten GENAU EIN Objekt {betrag, steuersatz} zurück. betrag = die GESAMT-Endsumme inkl. " +
      "MwSt der ganzen Rechnung, beschriftet mit „Total TTC\" (bzw. „Total à payer\"/„Montant total\") – " +
      "NICHT Seiten-Zwischensummen, NICHT „Total HT\"/„Total HTVA\". steuersatz = TVA-Satz in Prozent als " +
      "Zahl. Zusätzlich auf oberster Ebene: belegdatum (Rechnungsdatum YYYY-MM-DD oder null), lieferant, " +
      "beschreibung (kurz, z. B. „Tankkosten\" + Abrechnungszeitraum/Monat). Antworte AUSSCHLIESSLICH mit " +
      'JSON: {"seiten": [ EIN Objekt ], "belegdatum": …, "lieferant": …, "beschreibung": …}. Punkt als ' +
      "Dezimaltrennzeichen, KEINE Tausenderpunkte. Nur JSON.",
  },
  herosoftware: {
    label: "Total",
    supplierSearch: "Hero Software",
    account: {
      number: "4964",
      name: "Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen, Konzessionen)",
    },
    prompt:
      "Dies ist eine Rechnung der HERO Software GmbH (Handwerker-Software, oft englischsprachig, MwSt " +
      "0 % / Reverse-Charge). Das PDF enthält GENAU EINE Rechnung. Gib in seiten GENAU EIN Objekt " +
      "{betrag, steuersatz} zurück. betrag = der RECHNUNGS-Gesamtbetrag, beschriftet mit „Total\" " +
      "(bzw. „Total incl. VAT\"/„Rechnungsbetrag\"/„Gesamt\") – NICHT „Amount Due\"/„Betrag offen\" und " +
      "NICHT „Paid\"/„Bezahlt\" (die können 0 sein, wenn schon bezahlt). steuersatz = MwSt/VAT-Satz in " +
      "Prozent als Zahl (bei Reverse-Charge 0). Gib zusätzlich auf oberster Ebene an: belegdatum = das " +
      "Rechnungsdatum (Invoice Date) im Format YYYY-MM-DD – interpretiere reine Zahlen-Datumsangaben als " +
      "Tag/Monat/Jahr (europäisch); lieferant (Rechnungssteller); beschreibung (kurze Leistung, z. B. " +
      '„Software-Abo" + Paket). Antworte AUSSCHLIESSLICH mit JSON: {"seiten": [ EIN Objekt ], ' +
      '"belegdatum": …, "lieferant": …, "beschreibung": …}. Punkt als Dezimaltrennzeichen. Nur JSON.',
  },
  palettecad: {
    label: "Gesamtbetrag inkl. USt.",
    supplierSearch: "Palette CAD",
    account: {
      number: "4964",
      name: "Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen, Konzessionen)",
    },
    prompt:
      "Dies ist eine Palette-CAD-Rechnung (Software; evtl. mehrere Rechnungen je PDF). Gib pro RECHNUNG " +
      "genau ein Objekt in seiten:[{betrag, steuersatz}] zurück. betrag = der BRUTTO-Gesamtbetrag inkl. " +
      "MwSt (Label z. B. „Gesamtbetrag inkl. USt.\", „Gesamtbetrag\", „Bruttobetrag\", „Rechnungsbetrag\") – " +
      "NICHT der Netto-Wert. steuersatz = USt-/MwSt-Satz in Prozent als Zahl. Gib zusätzlich auf oberster " +
      "Ebene an: belegdatum (Rechnungsdatum YYYY-MM-DD oder null), lieferant (Rechnungssteller oder null), " +
      "beschreibung (kurze Leistungsbezeichnung). Antworte AUSSCHLIESSLICH mit JSON: " +
      '{"seiten": [ … ], "belegdatum": …, "lieferant": …, "beschreibung": …}. Punkt als Dezimaltrennzeichen, ' +
      "KEINE Tausenderpunkte. Nur JSON.",
  },
  mixvoip: {
    label: "Grand Total",
    supplierSearch: "Mixvoip",
    account: { number: "4920", name: "Telefon" },
    prompt:
      "Dies ist eine Mixvoip-Telefonrechnung (Luxemburg; evtl. mehrere Rechnungen je PDF). Gib pro " +
      "RECHNUNG genau ein Objekt in seiten:[{betrag, steuersatz}] zurück. betrag = der zu zahlende " +
      "BRUTTO-Gesamtbetrag inkl. MwSt (Label z. B. „Grand Total\", „Total incl. VAT\", „Montant à payer\", " +
      "„Total TTC\") – NICHT der Netto-/HT-Wert. steuersatz = MwSt/TVA-Satz in Prozent als Zahl. Gib " +
      "zusätzlich auf oberster Ebene an: belegdatum (Rechnungsdatum YYYY-MM-DD oder null), lieferant " +
      "(Rechnungssteller oder null), beschreibung (kurz, z. B. „Telefon\" + Abrechnungszeitraum Monat/Jahr). " +
      'Antworte AUSSCHLIESSLICH mit JSON: {"seiten": [ … ], "belegdatum": …, "lieferant": …, ' +
      '"beschreibung": …}. Punkt als Dezimaltrennzeichen, KEINE Tausenderpunkte. Nur JSON.',
  },
  bgl: {
    supplierSearch: "BNP Paribas Lease",
    account: { number: "4595", name: "Leasing/Mietwagen" },
    accountNeedsVehicle: true,
    label: "Total TTC à payer",
    prompt:
      "Dies ist eine (evtl. mehrseitige) BNP Paribas Lease / BGL-Leasingrechnung. Gehe das Dokument " +
      "SEITE FÜR SEITE durch. Gib für JEDE Seite genau ein Objekt zurück: " +
      "{seite: Zahl, betrag: Zahl|null, steuersatz: Zahl|null, matricule: string|null}. " +
      "matricule = die auf dieser Seite ausgewiesene „Matricule\"/„Immatriculation\" (Fahrzeug-Kennzeichen, " +
      "z. B. „WZ 5168\"); wenn nicht vorhanden: null. " +
      "betrag = der auf dieser Seite ausgewiesene, zu zahlende BRUTTO-Gesamtbetrag – i. d. R. beschriftet " +
      "mit „Total TTC à payer\" (auch „Total TTC\", „Net à payer\", „Montant total TTC\"). NICHT der " +
      "HTVA-/Netto-Wert, NICHT nur die TVA. steuersatz = der ausgewiesene TVA-/MwSt-Satz in Prozent als " +
      "Zahl (z. B. 17 für „TVA 17 %\"); wenn nicht erkennbar: null. Wenn kein Betrag vorhanden: null. " +
      "Gib zusätzlich auf oberster Ebene an: belegdatum = das Rechnungsdatum im Format YYYY-MM-DD (oder " +
      "null); lieferant = der Name des Rechnungsstellers/Lieferanten oben auf der Rechnung (oder null). " +
      'Lass KEINE Seite aus. Antworte AUSSCHLIESSLICH mit JSON: {"seiten": [ … ], "belegdatum": …, ' +
      '"lieferant": …}. Punkt als Dezimaltrennzeichen, KEINE Tausenderpunkte. Nur JSON.',
  },
};

/** Robustes Parsen deutscher/englischer Zahlen ("1.234,56", "1234.56", 1234.56). */
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Liest per OCR aus einem Beleg die relevanten Werte (Betrag, MwSt, Datum,
 * Lieferant, Beschreibung, Konto). kind="auto" erkennt den Belegtyp zuerst
 * automatisch. Reiner Server-Helfer (keine Session-/Formulardaten).
 */
export async function extractBeleg(input: {
  buffer: Buffer;
  mime: string;
  kind: BelegSumKind | "auto";
}): Promise<BelegSumResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "OCR ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt)." };
  }
  const mime = input.mime || "application/pdf";
  const isImage = mime.startsWith("image/");
  const dataB64 = input.buffer.toString("base64");
  const block = isImage
    ? { type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/png", data: dataB64 } }
    : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: dataB64 } };

  try {
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });

    // Belegtyp bestimmen: automatisch erkennen oder vorgegeben.
    let kind: BelegSumKind;
    if (input.kind === "auto") {
      const cls = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 20,
        messages: [
          {
            role: "user",
            content: [
              block,
              {
                type: "text",
                text:
                  "Klassifiziere diesen Beleg anhand des Rechnungsstellers/Inhalts. Antworte NUR mit genau " +
                  "EINEM dieser Wörter: circle (Circle K Tankrechnung), mixvoip (Mixvoip-Telefonrechnung), " +
                  "bgl (BNP Paribas Lease/BGL-Leasingrechnung), palettecad (Palette-CAD-Rechnung), " +
                  "herosoftware (HERO Software GmbH), activite (Activité Lensterbierg – Miete/Nebenkosten), " +
                  "etges (Etges & Dächer – Dachdecker/Dachbaustoffe), " +
                  "lohn (Lohnabrechnung/Lohnjournal), oder unbekannt. Nur das eine Wort, keine Erklärung.",
              },
            ],
          },
        ],
      });
      const ctb = cls.content.find((b) => b.type === "text");
      const word = ctb && ctb.type === "text" ? ctb.text.trim().toLowerCase().replace(/[^a-z]/g, "") : "";
      const detected = (
        ["circle", "mixvoip", "bgl", "palettecad", "herosoftware", "activite", "etges", "lohn"] as BelegSumKind[]
      ).find((k) => word === k);
      if (!detected) {
        return {
          ok: false,
          error: "Belegtyp konnte nicht automatisch erkannt werden – bitte Typ manuell wählen.",
        };
      }
      kind = detected;
    } else {
      kind = input.kind;
    }
    const cfg = SUM_CONFIG[kind];

    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 6000,
      messages: [{ role: "user", content: [block, { type: "text", text: cfg.prompt }] }],
    });
    const tb = res.content.find((b) => b.type === "text");
    const raw =
      tb && tb.type === "text"
        ? tb.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
        : "{}";
    const parsed = JSON.parse(raw) as {
      seiten?: { betrag?: unknown; steuersatz?: unknown; matricule?: unknown; typ?: unknown }[];
      belegdatum?: unknown;
      lieferant?: unknown;
      beschreibung?: unknown;
      belegnummer?: unknown;
      skonto_eur?: unknown;
      skonto_zahlbetrag?: unknown;
    };
    const seiten = parsed.seiten ?? [];
    // Nicht-Null-Beträge (bei Activité kann ein NK-Guthaben negativ sein).
    const values = seiten.map((s) => toNum(s?.betrag)).filter((n) => n !== 0);
    if (values.length === 0) {
      return { ok: false, error: `Es wurden keine „${cfg.label}"-Werte erkannt.`, kind, kindLabel: KIND_LABEL[kind] };
    }
    const total = round2(values.reduce((s, n) => s + n, 0));

    // Häufigsten Steuersatz bestimmen (nur relevant, wenn im Beleg ausgewiesen).
    let vatRate: number | undefined;
    const rates = seiten.map((s) => toNum(s?.steuersatz)).filter((n) => n > 0 && n < 100);
    if (rates.length > 0) {
      const freq = new Map<number, number>();
      for (const r of rates) freq.set(r, (freq.get(r) ?? 0) + 1);
      vatRate = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    // Belegdatum (yyyy-mm-dd) übernehmen, wenn plausibel.
    let date: string | undefined;
    const dRaw = String(parsed.belegdatum ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dRaw)) date = dRaw;

    // Beschreibung: BGL → Matricule(n) (dedupliziert); sonst das Feld „beschreibung".
    const matricules: string[] = [];
    for (const s of seiten) {
      const m = String(s?.matricule ?? "").trim();
      if (m && m.toLowerCase() !== "null" && !matricules.includes(m)) matricules.push(m);
    }
    let description: string | undefined;
    if (matricules.length > 0) description = matricules.join(", ").slice(0, 250);
    else {
      const b = String(parsed.beschreibung ?? "").trim();
      if (b && b.toLowerCase() !== "null") description = b.slice(0, 250);
    }
    // Fahrzeug erkannt, wenn eine Matricule/Immatriculation vorhanden ist.
    const isVehicle = kind === "bgl" && matricules.length > 0;

    // Belegnummer + Skonto (v. a. Etges & Dächer).
    let invoiceNumber: string | undefined;
    const invNr = String(parsed.belegnummer ?? "").trim();
    if (invNr && invNr.toLowerCase() !== "null") invoiceNumber = invNr.slice(0, 64);
    const skontoAmount = parsed.skonto_eur == null ? undefined : toNum(parsed.skonto_eur) || undefined;
    const skontoPayAmount =
      parsed.skonto_zahlbetrag == null ? undefined : toNum(parsed.skonto_zahlbetrag) || undefined;

    // Lieferant: bevorzugt der kanonische HERO-Name (fester Suchbegriff je Typ, sonst OCR-Name).
    let supplier: string | undefined;
    const ocrSupplier = String(parsed.lieferant ?? "").trim();
    const searchTerm = cfg.supplierSearch || ocrSupplier;
    if (ocrSupplier) supplier = ocrSupplier;
    if (searchTerm) {
      try {
        const heroName = await findContactNameBySearch(searchTerm);
        if (heroName) supplier = heroName;
      } catch {
        /* HERO-Auflösung optional – dann bleibt der OCR-Name */
      }
    }

    // Kontovorschlag. Activité: dynamisch je Rechnungstyp; sonst statisch (BGL nur bei Fahrzeug).
    let accountNumber: string | undefined;
    let accountName: string | undefined;
    if (kind === "activite") {
      const isNK = seiten.some((s) => String(s?.typ ?? "").toLowerCase().includes("nebenkosten"));
      if (isNK) {
        accountNumber = "4240";
        accountName = "Strom, Wasser, Gas";
      } else {
        accountNumber = "4210";
        accountName = "Miete / Pacht";
      }
    } else if (cfg.account && (!cfg.accountNeedsVehicle || isVehicle)) {
      accountNumber = cfg.account.number;
      accountName = cfg.account.name;
    }

    return {
      ok: true,
      total,
      count: values.length,
      values: values.map(round2),
      vatRate,
      date,
      supplier,
      description,
      isVehicle,
      accountNumber,
      accountName,
      kind,
      kindLabel: KIND_LABEL[kind],
      invoiceNumber,
      skontoAmount,
      skontoPayAmount,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "OCR fehlgeschlagen." };
  }
}
