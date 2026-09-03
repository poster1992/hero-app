import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

/**
 * Beleg-Historie: wer hat wann was mit einem Beleg gemacht.
 *
 * Zwei Quellen fließen zusammen:
 *  1. Eigene Log-Einträge (Tabelle `receipt_history`, self-healing angelegt) –
 *     alles, was ab Einführung der Historie passiert (Bearbeiten, Zahlstatus,
 *     Datei ersetzt, SEPA-Export, Auto-Erfassung).
 *  2. Abgeleitete Einträge aus vorhandenen Daten – damit auch Altbelege eine
 *     sinnvolle Historie zeigen: Erfassung (manual_receipts.created/source),
 *     Zahlung (paid_date), Rechnungsprüfung (receipt_review_history),
 *     HERO-Zahlstatus (receipt_payment_status) und verknüpfte Aufgaben.
 */

/** "manual" = eigener Beleg (manual_receipts.id) · "hero" = HERO-Beleg (String-ID). */
export type ReceiptKind = "manual" | "hero";

export interface ReceiptHistoryEntry {
  /** Eindeutiger Schlüssel für React-Listen. */
  key: string;
  action: string;
  /** Klartext-Bezeichnung der Aktion (deutsch). */
  label: string;
  icon: string;
  detail: string | null;
  byName: string | null;
  /** Zeitpunkt als DB-/ISO-String (kann bei alten Daten fehlen). */
  at: string | null;
}

/** Bezeichnung + Symbol je Aktion. */
const ACTIONS: Record<string, { label: string; icon: string }> = {
  created: { label: "Beleg erfasst", icon: "📥" },
  auto: { label: "Automatisch erfasst (OCR)", icon: "🤖" },
  updated: { label: "Bearbeitet", icon: "✏️" },
  file: { label: "Datei ersetzt", icon: "📎" },
  paid: { label: "Als bezahlt markiert", icon: "✅" },
  unpaid: { label: "Auf offen gesetzt", icon: "↩️" },
  status: { label: "Zahlstatus gesetzt", icon: "💶" },
  sepa: { label: "In SEPA-Überweisung exportiert", icon: "🏦" },
  assigned: { label: "Zur Prüfung zugewiesen", icon: "👤" },
  freigegeben: { label: "Rechnungsprüfung: freigegeben", icon: "✔️" },
  abgelehnt: { label: "Rechnungsprüfung: abgelehnt", icon: "✖️" },
  task: { label: "Aufgabe angelegt", icon: "📌" },
  task_done: { label: "Aufgabe erledigt", icon: "☑️" },
  task_status: { label: "Aufgabe: Status geändert", icon: "🔄" },
  task_note: { label: "Notiz zur Aufgabe", icon: "💬" },
  task_forward: { label: "Aufgabe weitergeleitet", icon: "↪️" },
};

function describe(action: string): { label: string; icon: string } {
  return ACTIONS[action] ?? { label: action, icon: "•" };
}

let tableReady = false;

/** Legt die Log-Tabelle bei Bedarf an (kein Migrationsskript nötig). */
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS receipt_history (
         id INT AUTO_INCREMENT PRIMARY KEY,
         receipt_kind VARCHAR(10) NOT NULL DEFAULT 'manual',
         receipt_id VARCHAR(64) NOT NULL,
         action VARCHAR(30) NOT NULL,
         detail VARCHAR(1000) NULL,
         user_id INT NULL,
         by_name VARCHAR(190) NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_rh_receipt (receipt_kind, receipt_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    )
    .catch(() => {});
  tableReady = true;
}

/**
 * Schreibt einen Historien-Eintrag. Bewusst fehlertolerant: eine kaputte
 * Historie darf nie das eigentliche Speichern des Belegs verhindern.
 */
export async function logReceiptEvent(input: {
  kind: ReceiptKind;
  receiptId: number | string;
  action: string;
  detail?: string | null;
  /** Benutzer-ID (wird beim Lesen auf den Anzeigenamen aufgelöst). */
  userId?: number | null;
  /** Ersatzname, wenn kein Benutzer dahintersteht (z. B. "Automatik"). */
  byName?: string | null;
}): Promise<void> {
  try {
    await ensureTable();
    await getPool().query(
      `INSERT INTO receipt_history (receipt_kind, receipt_id, action, detail, user_id, by_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.kind,
        String(input.receiptId),
        input.action.slice(0, 30),
        input.detail ? input.detail.slice(0, 1000) : null,
        input.userId ?? null,
        input.byName ? input.byName.slice(0, 190) : null,
      ]
    );
  } catch {
    // Historie ist Beiwerk – Fehler bewusst schlucken.
  }
}

interface LogRow extends RowDataPacket {
  id: number;
  action: string;
  detail: string | null;
  by_name: string | null;
  created_at: string | null;
}

/** Eigene Log-Einträge eines Belegs. */
async function loadLogged(kind: ReceiptKind, receiptId: string): Promise<ReceiptHistoryEntry[]> {
  await ensureTable();
  const rows = await getPool()
    .query<LogRow[]>(
      `SELECT h.id, h.action, h.detail, h.created_at,
              COALESCE(NULLIF(u.display_name, ''), u.username, h.by_name) AS by_name
         FROM receipt_history h
         LEFT JOIN users u ON u.id = h.user_id
        WHERE h.receipt_kind = ? AND h.receipt_id = ?
        ORDER BY h.created_at, h.id`,
      [kind, receiptId]
    )
    .then(([r]) => r)
    .catch(() => [] as LogRow[]);
  return rows.map((r) => ({
    key: `log-${r.id}`,
    action: r.action,
    ...describe(r.action),
    detail: r.detail,
    byName: r.by_name,
    at: r.created_at ? String(r.created_at) : null,
  }));
}

interface TaskEventRow extends RowDataPacket {
  task_id: number;
  title: string;
  task_created_at: string | Date | null;
  created_by_name: string | null;
  assignee_names: string | null;
  h_id: number | null;
  action: string | null;
  detail: string | null;
  h_created_at: string | Date | null;
  by_name: string | null;
}

/** Ordnet einen Aufgaben-Verlaufseintrag einer Historien-Aktion zu. */
function taskAction(action: string, detail: string | null): string {
  switch (action) {
    case "created":
      return "task";
    case "note":
      return "task_note";
    case "forwarded":
      return "task_forward";
    case "status":
      return /^Status:\s*Erledigt/i.test(detail ?? "") ? "task_done" : "task_status";
    default:
      return "task_status";
  }
}

/**
 * Verknüpfte Aufgaben (Buchung/Rechnungsprüfung) als Historien-Einträge –
 * inklusive des kompletten Aufgaben-Verlaufs (`task_history`), damit auch
 * sichtbar ist, WER eine Aufgabe erledigt hat und welche Notiz dabei stand.
 */
async function loadTaskEvents(marker: string): Promise<ReceiptHistoryEntry[]> {
  const rows = await getPool()
    .query<TaskEventRow[]>(
      `SELECT t.id AS task_id, t.title, t.created_at AS task_created_at,
              COALESCE(NULLIF(cu.display_name, ''), cu.username) AS created_by_name,
              COALESCE(
                (SELECT GROUP_CONCAT(COALESCE(NULLIF(tu.display_name, ''), tu.username) SEPARATOR ', ')
                   FROM task_assignees ta JOIN users tu ON tu.id = ta.user_id
                  WHERE ta.task_id = t.id),
                COALESCE(NULLIF(au.display_name, ''), au.username)
              ) AS assignee_names,
              h.id AS h_id, h.action, h.detail, h.created_at AS h_created_at,
              COALESCE(NULLIF(hu.display_name, ''), hu.username) AS by_name
         FROM tasks t
         LEFT JOIN task_history h ON h.task_id = t.id
         LEFT JOIN users cu ON cu.id = t.created_by
         LEFT JOIN users au ON au.id = t.assigned_to
         LEFT JOIN users hu ON hu.id = h.user_id
        WHERE t.description LIKE ?
        ORDER BY t.id, h.created_at, h.id`,
      [`%${marker}%`]
    )
    .then(([r]) => r)
    .catch(() => [] as TaskEventRow[]);

  const out: ReceiptHistoryEntry[] = [];
  const seenTasks = new Set<number>();
  for (const r of rows) {
    const title = `„${r.title}"`;
    // Aufgabe ganz ohne Verlauf (Altdaten): wenigstens die Anlage zeigen.
    if (r.h_id == null) {
      if (seenTasks.has(r.task_id)) continue;
      seenTasks.add(r.task_id);
      out.push({
        key: `task-${r.task_id}`,
        action: "task",
        ...describe("task"),
        detail: `${title}${r.assignee_names ? ` · für ${r.assignee_names}` : ""}`,
        byName: r.created_by_name,
        at: r.task_created_at ? String(r.task_created_at) : null,
      });
      continue;
    }

    const action = taskAction(r.action ?? "", r.detail);
    // „Status: Erledigt – Notiz" → nur die Notiz übrig lassen (Status steht im Label).
    let rest = (r.detail ?? "")
      .replace(/^Status:\s*[^–-]*[–-]\s*/i, "")
      .replace(/^Status:\s*/i, "")
      .replace(/^Aufgabe erstellt$/i, "")
      .trim();
    // Beim Erledigen steht der Status schon im Label – nur die Notiz zeigen.
    if (action === "task_done" && /^Erledigt$/i.test(rest)) rest = "";
    const detail =
      action === "task"
        ? `${title}${r.assignee_names ? ` · für ${r.assignee_names}` : ""}`
        : `${title}${rest ? ` · ${rest}` : ""}`;
    out.push({
      key: `task-h-${r.h_id}`,
      action,
      ...describe(action),
      detail,
      byName: r.by_name ?? (action === "task" ? r.created_by_name : null),
      at: r.h_created_at ? String(r.h_created_at) : null,
    });
  }
  return out;
}

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/** Klartext zur Herkunft eines manuellen Belegs. */
function sourceLabel(source: string | null): string {
  switch (source) {
    case "inbox":
      return "über den Posteingang hochgeladen";
    case "recurring":
      return "automatisch aus einem wiederkehrenden Beleg erzeugt";
    case "form":
      return "über das Beleg-Formular erfasst";
    default:
      return source ? `Quelle: ${source}` : "erfasst";
  }
}

interface ManualBaseRow extends RowDataPacket {
  created: string | Date | null;
  source: string | null;
  file_name: string | null;
  is_paid: number | null;
  paid_date: string | Date | null;
  paid_with_skonto: number | null;
  gross: string | number;
  skonto_pay_amount: string | number | null;
  uploaded_by_name: string | null;
}

/** Abgeleitete Einträge eines manuellen Belegs (Erfassung, Zahlung). */
async function loadManualDerived(
  id: string,
  logged: ReceiptHistoryEntry[]
): Promise<ReceiptHistoryEntry[]> {
  const rows = await getPool()
    .query<ManualBaseRow[]>(
      `SELECT r.created, r.source, r.file_name, r.is_paid, r.paid_date, r.paid_with_skonto,
              r.gross, r.skonto_pay_amount,
              COALESCE(NULLIF(u.display_name, ''), u.username) AS uploaded_by_name
         FROM manual_receipts r
         LEFT JOIN users u ON u.id = r.uploaded_by
        WHERE r.id = ? LIMIT 1`,
      [id]
    )
    .then(([r]) => r)
    .catch(() => [] as ManualBaseRow[]);
  const r = rows[0];
  if (!r) return [];

  const out: ReceiptHistoryEntry[] = [
    {
      key: "created",
      action: "created",
      ...describe("created"),
      detail: `${sourceLabel(r.source)}${r.file_name ? ` · ${r.file_name}` : ""}`,
      byName: r.uploaded_by_name,
      at: r.created ? String(r.created) : null,
    },
  ];

  // Zahlung: nur ableiten, wenn dazu (noch) nichts geloggt ist – sonst doppelt.
  const hasPaidLog = logged.some((e) => e.action === "paid" || e.action === "unpaid");
  if (!hasPaidLog && r.is_paid === 1) {
    const withSkonto = r.paid_with_skonto === 1;
    const pay = r.skonto_pay_amount == null ? null : Number(r.skonto_pay_amount);
    out.push({
      key: "paid-derived",
      action: "paid",
      ...describe("paid"),
      detail: withSkonto && pay != null ? `mit Skonto · ${eur(pay)}` : eur(Number(r.gross)),
      byName: null,
      at: r.paid_date ? `${String(r.paid_date).slice(0, 10)} 00:00:00` : null,
    });
  }
  return out;
}

interface ReviewEventRow extends RowDataPacket {
  id: number;
  action: string;
  detail: string | null;
  by_name: string | null;
  created_at: string | Date | null;
}

interface OverrideRow extends RowDataPacket {
  status: string;
  set_at: string | Date | null;
  note: string | null;
  remark: string | null;
  set_by_name: string | null;
}

/** Abgeleitete Einträge eines HERO-Belegs (Rechnungsprüfung, lokaler Zahlstatus). */
async function loadHeroDerived(
  heroId: string,
  logged: ReceiptHistoryEntry[]
): Promise<ReceiptHistoryEntry[]> {
  const pool = getPool();
  const out: ReceiptHistoryEntry[] = [];

  const hist = await pool
    .query<ReviewEventRow[]>(
      `SELECT h.id, h.action, h.detail, h.created_at,
              COALESCE(NULLIF(u.display_name, ''), u.username) AS by_name
         FROM receipt_review_history h
         LEFT JOIN users u ON u.id = h.user_id
        WHERE h.hero_receipt_id = ?
        ORDER BY h.created_at, h.id`,
      [heroId]
    )
    .then(([r]) => r)
    .catch(() => [] as ReviewEventRow[]);
  for (const h of hist) {
    out.push({
      key: `rev-${h.id}`,
      action: h.action,
      ...describe(h.action),
      detail: h.detail,
      byName: h.by_name,
      at: h.created_at ? String(h.created_at) : null,
    });
  }

  // Aktueller lokaler Zahlstatus nur ableiten, wenn dazu nichts geloggt ist
  // (sonst stünde derselbe Vorgang zweimal in der Historie).
  if (logged.some((e) => e.action === "status")) return out;

  const ov = await pool
    .query<OverrideRow[]>(
      `SELECT ps.status, ps.set_at, ps.note, ps.remark,
              COALESCE(NULLIF(u.display_name, ''), u.username) AS set_by_name
         FROM receipt_payment_status ps
         LEFT JOIN users u ON u.id = ps.set_by
        WHERE ps.hero_receipt_id = ? LIMIT 1`,
      [heroId]
    )
    .then(([r]) => r)
    .catch(() => [] as OverrideRow[]);
  const o = ov[0];
  if (o) {
    const extra = [o.note, o.remark].filter(Boolean).join(" · ");
    out.push({
      key: "override",
      action: "status",
      ...describe("status"),
      detail: `${o.status === "bezahlt" ? "bezahlt" : "offen"}${extra ? ` · ${extra}` : ""} (lokal, überschreibt HERO)`,
      byName: o.set_by_name,
      at: o.set_at ? String(o.set_at) : null,
    });
  }
  return out;
}

/** Vollständige Historie eines Belegs, älteste Einträge zuerst. */
export async function listReceiptHistory(
  kind: ReceiptKind,
  receiptId: number | string
): Promise<ReceiptHistoryEntry[]> {
  const id = String(receiptId);
  if (!id) return [];
  const logged = await loadLogged(kind, id);
  const derived =
    kind === "manual" ? await loadManualDerived(id, logged) : await loadHeroDerived(id, logged);
  const tasks = await loadTaskEvents(
    kind === "manual" ? `[BELEGPRUEF:${id}]` : `[RECHNPRUEF:${id}]`
  ).catch(() => [] as ReceiptHistoryEntry[]);

  const all = [...derived, ...logged, ...tasks];
  // Ohne Zeitstempel (Altdaten) nach hinten – sonst chronologisch aufsteigend.
  return all.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return a.at.localeCompare(b.at);
  });
}

/**
 * Beschreibt die Änderungen zwischen zwei Beleg-Ständen als Klartext
 * ("Betrag: 100,00 € → 120,00 €"). Leerer String = nichts geändert.
 */
export function describeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>
): string {
  const norm = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const parts: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (norm(before[key]) === norm(after[key])) continue;
    parts.push(`${label}: ${norm(before[key])} → ${norm(after[key])}`);
  }
  return parts.join(" · ");
}
