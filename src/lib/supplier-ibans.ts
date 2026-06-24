import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

export interface SupplierIban {
  customerId: number;
  supplierName: string | null;
  iban: string | null;
  bic: string | null;
  /** Lieferant zieht per Lastschrift ein (kein Überweisungs-Export). */
  directDebit: boolean;
  /** Skontofrist in Tagen (Zahlung innerhalb dieser Frist gibt Skonto). */
  skontoDays: number | null;
  /** Skontosatz in Prozent (z.B. 2.00). */
  skontoPercent: number | null;
}

interface IbanRow extends RowDataPacket {
  customer_id: number;
  supplier_name: string | null;
  iban: string | null;
  bic: string | null;
  direct_debit: number;
  skonto_days: number | null;
  skonto_percent: string | number | null;
}

/** Map of customerId → stored IBAN/BIC/Bankeinzug for suppliers. */
export async function getSupplierIbanMap(): Promise<Map<number, SupplierIban>> {
  const [rows] = await getPool().query<IbanRow[]>(
    "SELECT customer_id, supplier_name, iban, bic, direct_debit, skonto_days, skonto_percent FROM supplier_ibans"
  );
  const map = new Map<number, SupplierIban>();
  for (const r of rows) {
    map.set(r.customer_id, {
      customerId: r.customer_id,
      supplierName: r.supplier_name,
      iban: r.iban,
      bic: r.bic,
      directDebit: r.direct_debit === 1,
      skontoDays: r.skonto_days ?? null,
      // DECIMAL kommt aus mysql2 als String -> in Zahl wandeln.
      skontoPercent: r.skonto_percent != null ? Number(r.skonto_percent) : null,
    });
  }
  return map;
}

/** Sets the Bankeinzug (direct debit) flag for a supplier (creates row if needed). */
export async function setSupplierDirectDebit(input: {
  customerId: number;
  supplierName: string | null;
  directDebit: boolean;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO supplier_ibans (customer_id, supplier_name, direct_debit)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE supplier_name = VALUES(supplier_name), direct_debit = VALUES(direct_debit)`,
    [input.customerId, input.supplierName, input.directDebit ? 1 : 0]
  );
}

/** Inserts or updates a supplier's IBAN/BIC and Skonto terms. */
export async function upsertSupplierIban(input: {
  customerId: number;
  supplierName: string | null;
  iban: string;
  bic: string | null;
  skontoDays: number | null;
  skontoPercent: number | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO supplier_ibans (customer_id, supplier_name, iban, bic, skonto_days, skonto_percent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE supplier_name = VALUES(supplier_name), iban = VALUES(iban), bic = VALUES(bic), skonto_days = VALUES(skonto_days), skonto_percent = VALUES(skonto_percent)`,
    [input.customerId, input.supplierName, input.iban, input.bic, input.skontoDays, input.skontoPercent]
  );
}
