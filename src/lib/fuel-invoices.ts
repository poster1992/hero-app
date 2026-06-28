import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Tankmenge/-kosten je Fahrzeug (Tankkarte) auf einer Circle-Rechnung. */
export interface FuelVehicle {
  vehicle: string;
  card: string | null;
  liters: number;
  net: number;
  gross: number;
}

export interface FuelInvoice {
  heroId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalNet: number;
  totalGross: number;
  vehicles: FuelVehicle[];
  docHash: string | null;
}

interface FuelRow extends RowDataPacket {
  hero_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  total_net: string | number;
  total_gross: string | number;
  vehicles: unknown;
  doc_hash: string | null;
}

function parseVehicles(value: unknown): FuelVehicle[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    vehicle: String((p as FuelVehicle)?.vehicle ?? "").trim() || "Unbekannt",
    card: (p as FuelVehicle)?.card != null ? String((p as FuelVehicle).card) : null,
    liters: Number((p as FuelVehicle)?.liters ?? 0),
    net: Number((p as FuelVehicle)?.net ?? 0),
    gross: Number((p as FuelVehicle)?.gross ?? 0),
  }));
}

function mapRow(r: FuelRow): FuelInvoice {
  return {
    heroId: r.hero_id,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date ? String(r.invoice_date).slice(0, 10) : null,
    totalNet: Number(r.total_net),
    totalGross: Number(r.total_gross),
    vehicles: parseVehicles(r.vehicles),
    docHash: r.doc_hash,
  };
}

/** Alle gecachten Tankrechnungen. */
export async function listFuelInvoices(): Promise<FuelInvoice[]> {
  const [rows] = await getPool().query<FuelRow[]>(
    "SELECT hero_id, invoice_number, invoice_date, total_net, total_gross, vehicles, doc_hash FROM fuel_invoices ORDER BY invoice_date ASC"
  );
  return rows.map(mapRow);
}

/** Gecachte Tankrechnungen für bestimmte HERO-IDs (heroId → Eintrag). */
export async function getFuelInvoicesMap(heroIds: string[]): Promise<Map<string, FuelInvoice>> {
  const map = new Map<string, FuelInvoice>();
  if (heroIds.length === 0) return map;
  const placeholders = heroIds.map(() => "?").join(",");
  const [rows] = await getPool().query<FuelRow[]>(
    `SELECT hero_id, invoice_number, invoice_date, total_net, total_gross, vehicles, doc_hash
     FROM fuel_invoices WHERE hero_id IN (${placeholders})`,
    heroIds
  );
  for (const r of rows) map.set(r.hero_id, mapRow(r));
  return map;
}

/** Speichert/aktualisiert eine ausgewertete Tankrechnung. */
export async function upsertFuelInvoice(input: {
  heroId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalNet: number;
  totalGross: number;
  vehicles: FuelVehicle[];
  docHash: string | null;
  model: string | null;
  costEur: number;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO fuel_invoices (hero_id, invoice_number, invoice_date, total_net, total_gross, vehicles, doc_hash, model, cost_eur)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE invoice_number = VALUES(invoice_number), invoice_date = VALUES(invoice_date),
       total_net = VALUES(total_net), total_gross = VALUES(total_gross), vehicles = VALUES(vehicles),
       doc_hash = VALUES(doc_hash), model = VALUES(model), cost_eur = VALUES(cost_eur)`,
    [
      input.heroId,
      input.invoiceNumber?.slice(0, 64) ?? null,
      input.invoiceDate,
      input.totalNet,
      input.totalGross,
      JSON.stringify(input.vehicles),
      input.docHash,
      input.model,
      input.costEur,
    ]
  );
}
