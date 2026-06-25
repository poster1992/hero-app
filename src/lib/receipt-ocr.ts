import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/** Aus dem Beleg-Dokument extrahierte Felder (für Zusatzspalten). */
export interface ReceiptOcrFields {
  zahlungsziel: string | null;
  skontoBetrag: number | null;
  ersparnis: number | null;
  skontoPercent: number | null;
}

interface FieldRow extends RowDataPacket {
  hero_id: string;
  zahlungsziel: string | null;
  skonto_betrag: string | number | null;
  ersparnis: string | number | null;
  skonto_percent: string | number | null;
}

/** Extrahierte Felder je HERO-Beleg-ID (für die Belegliste). */
export async function getReceiptOcrMap(): Promise<Map<string, ReceiptOcrFields>> {
  const [rows] = await getPool().query<FieldRow[]>(
    "SELECT hero_id, zahlungsziel, skonto_betrag, ersparnis, skonto_percent FROM receipt_ocr"
  );
  const map = new Map<string, ReceiptOcrFields>();
  for (const r of rows) {
    map.set(r.hero_id, {
      zahlungsziel: r.zahlungsziel,
      skontoBetrag: r.skonto_betrag == null ? null : Number(r.skonto_betrag),
      ersparnis: r.ersparnis == null ? null : Number(r.ersparnis),
      skontoPercent: r.skonto_percent == null ? null : Number(r.skonto_percent),
    });
  }
  return map;
}

/** HERO-Beleg-IDs, die bereits OCR-indexiert sind. */
export async function getOcrHeroIds(): Promise<Set<string>> {
  const [rows] = await getPool().query<RowDataPacket[]>("SELECT hero_id FROM receipt_ocr");
  return new Set(rows.map((r) => String((r as { hero_id: string }).hero_id)));
}

/** Volltext-Schlagwortsuche → Menge passender HERO-Beleg-IDs. */
export async function searchOcrHeroIds(query: string): Promise<Set<string>> {
  const q = query.trim();
  if (!q) return new Set();
  // LIKE-Suche (robust für Teilwörter); FULLTEXT-Index beschleunigt zusätzlich.
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT hero_id FROM receipt_ocr WHERE full_text LIKE ? LIMIT 5000",
    [`%${q}%`]
  );
  return new Set(rows.map((r) => String((r as { hero_id: string }).hero_id)));
}

/** Speichert/aktualisiert das OCR-Ergebnis eines Belegs. */
export async function upsertReceiptOcr(input: {
  heroId: string;
  fullText: string | null;
  zahlungsziel: string | null;
  skontoPercent: number | null;
  skontoBetrag: number | null;
  ersparnis: number | null;
  docHash: string | null;
  model: string | null;
  costEur: number | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO receipt_ocr
       (hero_id, full_text, zahlungsziel, skonto_percent, skonto_betrag, ersparnis, doc_hash, model, cost_eur)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_text = VALUES(full_text), zahlungsziel = VALUES(zahlungsziel),
       skonto_percent = VALUES(skonto_percent), skonto_betrag = VALUES(skonto_betrag),
       ersparnis = VALUES(ersparnis), doc_hash = VALUES(doc_hash), model = VALUES(model),
       cost_eur = VALUES(cost_eur), ocr_at = NOW()`,
    [
      input.heroId,
      input.fullText,
      input.zahlungsziel,
      input.skontoPercent,
      input.skontoBetrag,
      input.ersparnis,
      input.docHash,
      input.model,
      input.costEur,
    ]
  );
}
