"use server";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { getReceiptsInRange, type Receipt } from "@/lib/hero-api";
import { getCustomerName } from "@/lib/invoices";
import {
  listFuelInvoices,
  getFuelInvoicesMap,
  upsertFuelInvoice,
  type FuelVehicle,
} from "@/lib/fuel-invoices";

const HERO_HOST = "https://login.hero-software.de";
const MODEL = "claude-opus-4-8";
const PRICE = { in: 5, out: 25 }; // $ / 1 Mio Tokens (Opus)
const USD_EUR = 0.92;
const OCR_VERSION = "v1";
const BATCH = 3;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const docHashOf = (src: string) => createHash("sha256").update(`${src}|${OCR_VERSION}`).digest("hex");

/** Eingangsrechnungen des Tankkarten-Lieferanten Circle (mit Dokument). */
async function getCircleReceipts(): Promise<Receipt[]> {
  const now = new Date();
  const from = `${now.getUTCFullYear() - 3}-01-01T00:00:00Z`;
  const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
  const receipts = await getReceiptsInRange(from, to);
  return receipts.filter(
    (r) =>
      r.type === "output" &&
      !!r.fileUpload?.src &&
      getCustomerName(r).toLowerCase().includes("circle")
  );
}

async function fetchDocument(src: string): Promise<string | null> {
  const token = process.env.HERO_API_TOKEN;
  if (!token) return null;
  const res = await fetch(HERO_HOST + src, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

interface OcrFuel {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalNet: number;
  totalGross: number;
  vehicles: FuelVehicle[];
  cost: number;
}

async function ocrFuelInvoice(client: Anthropic, receipt: Receipt): Promise<OcrFuel | null> {
  const data = await fetchDocument(receipt.fileUpload!.src!);
  if (!data) return null;
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
          {
            type: "text",
            text:
              "Dies ist eine Circle-K-Tankrechnung (Luxemburg) mit einem Detail je Tankkarte/Fahrzeug. " +
              "Lies das GESAMTE Dokument inkl. der Transaktionsdetails je Karte. Antworte AUSSCHLIESSLICH mit JSON: " +
              '{"invoice_number":string|null,"invoice_date":"YYYY-MM-DD"|null,"total_net":number|null,"total_gross":number|null,' +
              '"vehicles":[{"vehicle":string,"card":string|null,"liters":number,"net":number,"gross":number}]}. ' +
              'vehicle = Fahrzeug-/Träger-Kennung der Karte (z.B. "FLOORTEC 1", "SH4549", "VS8802", "TR-ID-19"); ' +
              "wenn keine Kennung erkennbar ist, nutze die Kartennummer (N°carte). card = Kartennummer. " +
              "liters = Summe getankte Liter dieser Karte (Diesel/Gazole + Benzin/Sans Plomb + AdBlue). " +
              "net = Summe Betrag NETTO (HT) in EUR dieser Karte; gross = Summe Betrag BRUTTO (TTC) in EUR. " +
              "Aggregiere ALLE Transaktionen je Karte zu GENAU EINER Zeile. invoice_date = Rechnungsdatum. " +
              "total_net/total_gross = Gesamtbeträge der Rechnung (Total Général). " +
              "Zahlen mit Punkt als Dezimaltrennzeichen, keine Tausenderpunkte. Keine Erklärung, nur JSON.",
          },
        ],
      },
    ],
  });

  const cost = round4(
    (((res.usage?.input_tokens ?? 0) / 1e6) * PRICE.in + ((res.usage?.output_tokens ?? 0) / 1e6) * PRICE.out) *
      USD_EUR
  );
  const tb = res.content.find((b) => b.type === "text");
  const raw = tb && tb.type === "text" ? tb.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim() : "{}";
  try {
    const p = JSON.parse(raw) as {
      invoice_number?: string | null;
      invoice_date?: string | null;
      total_net?: number | null;
      total_gross?: number | null;
      vehicles?: unknown[];
    };
    const vehicles: FuelVehicle[] = (p.vehicles ?? [])
      .map((v) => {
        const o = v as Record<string, unknown>;
        return {
          vehicle: String(o.vehicle ?? "").trim() || "Unbekannt",
          card: o.card != null && String(o.card).trim() ? String(o.card).slice(0, 40) : null,
          liters: round2(Number(o.liters ?? 0) || 0),
          net: round2(Number(o.net ?? 0) || 0),
          gross: round2(Number(o.gross ?? 0) || 0),
        };
      })
      .filter((v) => v.net !== 0 || v.gross !== 0 || v.liters !== 0);
    return {
      invoiceNumber: p.invoice_number ? String(p.invoice_number).slice(0, 64) : receipt.number || null,
      invoiceDate: p.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(p.invoice_date)
        ? p.invoice_date
        : receipt.receiptDate?.slice(0, 10) ?? null,
      totalNet: round2(Number(p.total_net ?? 0) || 0),
      totalGross: round2(Number(p.total_gross ?? 0) || 0),
      vehicles,
      cost,
    };
  } catch {
    return { invoiceNumber: receipt.number || null, invoiceDate: receipt.receiptDate?.slice(0, 10) ?? null, totalNet: 0, totalGross: 0, vehicles: [], cost };
  }
}

export interface FuelStatus {
  total: number;
  done: number;
}

/** Wie viele Circle-Rechnungen sind schon ausgewertet? */
export async function getFuelStatus(): Promise<FuelStatus> {
  if (!(await getSession())) return { total: 0, done: 0 };
  try {
    const circle = await getCircleReceipts();
    const cached = await getFuelInvoicesMap(circle.map((r) => r.id));
    const done = circle.filter((r) => {
      const c = cached.get(r.id);
      return c && c.docHash === docHashOf(r.fileUpload!.src!);
    }).length;
    return { total: circle.length, done };
  } catch {
    return { total: 0, done: 0 };
  }
}

export interface FuelOcrResult {
  processed: number;
  remaining: number;
  total: number;
  costEur: number;
  error?: string;
}

/** Verarbeitet einen Block noch nicht ausgewerteter Circle-Rechnungen. */
export async function runFuelOcr(): Promise<FuelOcrResult> {
  if (!(await getSession())) return { processed: 0, remaining: 0, total: 0, costEur: 0, error: "Kein Zugriff." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { processed: 0, remaining: 0, total: 0, costEur: 0, error: "OCR ist nicht konfiguriert: ANTHROPIC_API_KEY fehlt." };
  }
  let circle: Receipt[];
  try {
    circle = await getCircleReceipts();
  } catch (e) {
    return { processed: 0, remaining: 0, total: 0, costEur: 0, error: e instanceof Error ? e.message : "Laden fehlgeschlagen." };
  }
  const cached = await getFuelInvoicesMap(circle.map((r) => r.id));
  const missing = circle.filter((r) => {
    const c = cached.get(r.id);
    return !c || c.docHash !== docHashOf(r.fileUpload!.src!);
  });
  const batch = missing.slice(0, BATCH);
  const client = new Anthropic({ maxRetries: 2, timeout: 180_000 });
  let costEur = 0;
  for (const r of batch) {
    try {
      const out = await ocrFuelInvoice(client, r);
      if (!out) continue;
      costEur += out.cost;
      await upsertFuelInvoice({
        heroId: r.id,
        invoiceNumber: out.invoiceNumber,
        invoiceDate: out.invoiceDate,
        totalNet: out.totalNet,
        totalGross: out.totalGross,
        vehicles: out.vehicles,
        docHash: docHashOf(r.fileUpload!.src!),
        model: MODEL,
        costEur: out.cost,
      });
    } catch {
      /* einzelne Rechnung überspringen */
    }
  }
  return { processed: batch.length, remaining: missing.length - batch.length, total: circle.length, costEur: round4(costEur) };
}

export interface FuelVehicleAgg {
  vehicle: string;
  liters: number;
  net: number;
  gross: number;
  pricePerL: number;
}
export interface FuelMonthAgg {
  month: string; // YYYY-MM
  label: string;
  liters: number;
  net: number;
  gross: number;
}
/** Eine Monatszeile mit je Fahrzeug einem Wert (für gestapeltes Diagramm). */
export type FuelMonthByVehicle = { month: string; label: string } & Record<string, number | string>;

export interface FuelAnalysis {
  invoiceCount: number;
  totalLiters: number;
  totalNet: number;
  totalGross: number;
  vehicles: FuelVehicleAgg[];
  months: FuelMonthAgg[];
  /** Fahrzeugnamen (sortiert nach Kosten) – Reihenfolge der Stapel/Legende. */
  vehicleNames: string[];
  /** Je Monat eine Zeile mit Netto-Kosten pro Fahrzeug. */
  monthlyByVehicleNet: FuelMonthByVehicle[];
  /** Je Monat eine Zeile mit Litern pro Fahrzeug. */
  monthlyByVehicleLiters: FuelMonthByVehicle[];
}

const MONTH_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Aggregierte Auswertung der Tankrechnungen (nach Fahrzeug und Monat). */
export async function getFuelAnalysis(): Promise<FuelAnalysis> {
  if (!(await getSession())) {
    return {
      invoiceCount: 0,
      totalLiters: 0,
      totalNet: 0,
      totalGross: 0,
      vehicles: [],
      months: [],
      vehicleNames: [],
      monthlyByVehicleNet: [],
      monthlyByVehicleLiters: [],
    };
  }
  const invoices = await listFuelInvoices();
  const vehMap = new Map<string, FuelVehicleAgg>();
  const monMap = new Map<string, FuelMonthAgg>();
  // month → vehicleKey → { net, liters }
  const matrix = new Map<string, Map<string, { net: number; liters: number }>>();
  const labelOf = (month: string) => `${MONTH_SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
  let totalLiters = 0;
  let totalNet = 0;
  let totalGross = 0;

  for (const inv of invoices) {
    const month = inv.invoiceDate ? inv.invoiceDate.slice(0, 7) : null;
    for (const v of inv.vehicles) {
      const key = v.vehicle.trim().toUpperCase();
      const cur = vehMap.get(key) ?? { vehicle: v.vehicle.trim(), liters: 0, net: 0, gross: 0, pricePerL: 0 };
      cur.liters += v.liters;
      cur.net += v.net;
      cur.gross += v.gross;
      vehMap.set(key, cur);
      totalLiters += v.liters;
      totalNet += v.net;
      totalGross += v.gross;
      if (month) {
        const m = monMap.get(month) ?? { month, label: labelOf(month), liters: 0, net: 0, gross: 0 };
        m.liters += v.liters;
        m.net += v.net;
        m.gross += v.gross;
        monMap.set(month, m);

        const mv = matrix.get(month) ?? new Map<string, { net: number; liters: number }>();
        const e = mv.get(cur.vehicle) ?? { net: 0, liters: 0 };
        e.net += v.net;
        e.liters += v.liters;
        mv.set(cur.vehicle, e);
        matrix.set(month, mv);
      }
    }
  }

  const vehicles = [...vehMap.values()]
    .map((v) => ({
      vehicle: v.vehicle,
      liters: round2(v.liters),
      net: round2(v.net),
      gross: round2(v.gross),
      pricePerL: v.liters > 0 ? round4(v.net / v.liters) : 0,
    }))
    .sort((a, b) => b.net - a.net);
  const vehicleNames = vehicles.map((v) => v.vehicle);
  const months = [...monMap.values()]
    .map((m) => ({ month: m.month, label: m.label, liters: round2(m.liters), net: round2(m.net), gross: round2(m.gross) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Gestapelte Monatsdaten (eine Zeile je Monat, je Fahrzeug ein Wert).
  const sortedMonths = [...matrix.keys()].sort((a, b) => a.localeCompare(b));
  const monthlyByVehicleNet: FuelMonthByVehicle[] = [];
  const monthlyByVehicleLiters: FuelMonthByVehicle[] = [];
  for (const month of sortedMonths) {
    const mv = matrix.get(month)!;
    const rowNet: FuelMonthByVehicle = { month, label: labelOf(month) };
    const rowLit: FuelMonthByVehicle = { month, label: labelOf(month) };
    for (const name of vehicleNames) {
      const e = mv.get(name);
      rowNet[name] = e ? round2(e.net) : 0;
      rowLit[name] = e ? round2(e.liters) : 0;
    }
    monthlyByVehicleNet.push(rowNet);
    monthlyByVehicleLiters.push(rowLit);
  }

  return {
    invoiceCount: invoices.length,
    totalLiters: round2(totalLiters),
    totalNet: round2(totalNet),
    totalGross: round2(totalGross),
    vehicles,
    months,
    vehicleNames,
    monthlyByVehicleNet,
    monthlyByVehicleLiters,
  };
}
