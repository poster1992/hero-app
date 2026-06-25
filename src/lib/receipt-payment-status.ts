import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Lokaler, manuell gesetzter Zahlstatus eines HERO-Belegs (überschreibt den HERO-Status). */
export type PaidStatus = "bezahlt" | "offen";

export interface PaymentOverride {
  heroReceiptId: string;
  status: PaidStatus;
  setByName: string | null;
  setAt: string | null;
  note: string | null;
}

interface OverrideRow extends RowDataPacket {
  hero_receipt_id: string;
  status: string;
  set_at: string | null;
  set_by_name: string | null;
  note: string | null;
}

/** Alle lokalen Zahlstatus-Overrides, keyed nach HERO-Beleg-ID. */
export async function getPaymentOverrideMap(): Promise<Map<string, PaymentOverride>> {
  const [rows] = await getPool().query<OverrideRow[]>(
    `SELECT ps.hero_receipt_id, ps.status, ps.set_at, ps.note,
            COALESCE(NULLIF(u.display_name, ''), u.username) AS set_by_name
     FROM receipt_payment_status ps
     LEFT JOIN users u ON u.id = ps.set_by`
  );
  const map = new Map<string, PaymentOverride>();
  for (const r of rows) {
    map.set(r.hero_receipt_id, {
      heroReceiptId: r.hero_receipt_id,
      status: r.status === "bezahlt" ? "bezahlt" : "offen",
      setByName: r.set_by_name,
      setAt: r.set_at ? String(r.set_at) : null,
      note: r.note,
    });
  }
  return map;
}

/** Setzt (oder aktualisiert) den lokalen Zahlstatus eines Belegs. */
export async function setPaymentOverride(
  heroReceiptId: string,
  status: PaidStatus,
  userId: number | null,
  note: string | null = null
): Promise<void> {
  await getPool().query(
    `INSERT INTO receipt_payment_status (hero_receipt_id, status, set_by, note)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), set_by = VALUES(set_by), set_at = NOW(), note = VALUES(note)`,
    [heroReceiptId, status, userId, note]
  );
}

/** Entfernt den lokalen Override → es gilt wieder der HERO-Status. */
export async function clearPaymentOverride(heroReceiptId: string): Promise<void> {
  await getPool().query("DELETE FROM receipt_payment_status WHERE hero_receipt_id = ?", [
    heroReceiptId,
  ]);
}
