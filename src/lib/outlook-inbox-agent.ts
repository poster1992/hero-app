import "server-only";
import { createInboxPendingReceipt } from "./manual-receipts";
import { sniffMime } from "./file-sniff";
import {
  getOutlookAgentConfig,
  setSetting,
  OUTLOOK_WATERMARK_KEY,
  OUTLOOK_LAST_RUN_KEY,
  OUTLOOK_LAST_IMPORTED_KEY,
  OUTLOOK_LAST_ERROR_KEY,
} from "./settings";
import { listCandidateMessages, listFileAttachments, moveMessageToProcessedFolder } from "./outlook-graph";

/**
 * Outlook-Posteingang-Agent: liest per Microsoft-Graph-API neue Mails mit Anhang aus
 * dem konfigurierten Postfach, erkennt Rechnungs-Mails an Betreff/Absender-Stichwörtern
 * und legt deren PDF-/Bild-Anhänge als Posteingang-Beleg an (source='inbox', wie ein
 * manueller Upload) – dieselbe OCR-Hintergrund-Erfassung (inbox-worker.ts) übernimmt
 * danach die Auto-Erfassung. Verarbeitete Mails werden nach „Verarbeitet" verschoben.
 */

const MAX_SIZE = 25 * 1024 * 1024;

function looksLikeInvoiceMail(subject: string, senderName: string, senderAddress: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = `${subject} ${senderName} ${senderAddress}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

function resolveAttachmentMime(declared: string, buffer: Buffer): string | null {
  const mime = declared && declared !== "application/octet-stream" ? declared : sniffMime(buffer, "");
  if (!mime) return null;
  return mime === "application/pdf" || mime.startsWith("image/") ? mime : null;
}

export interface OutlookPollResult {
  ok: boolean;
  skipped?: string;
  checkedMessages: number;
  imported: number;
  error?: string;
}

export async function pollOutlookInbox(): Promise<OutlookPollResult> {
  const cfg = await getOutlookAgentConfig();
  if (!cfg.enabled) return { ok: true, skipped: "deaktiviert", checkedMessages: 0, imported: 0 };
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret || !cfg.mailbox) {
    return { ok: false, skipped: "nicht konfiguriert", checkedMessages: 0, imported: 0 };
  }
  const auth = { tenantId: cfg.tenantId, clientId: cfg.clientId, clientSecret: cfg.clientSecret };

  // Baseline beim ersten Lauf: nur den Zeitpunkt merken, KEINEN Altbestand importieren
  // (analog zum Workflow-Modul, siehe [[workflow-module]]).
  if (!cfg.watermark) {
    const now = new Date().toISOString();
    await setSetting(OUTLOOK_WATERMARK_KEY, now);
    await setSetting(OUTLOOK_LAST_RUN_KEY, now);
    return { ok: true, skipped: "Baseline gesetzt (erster Lauf)", checkedMessages: 0, imported: 0 };
  }

  let checkedMessages = 0;
  let imported = 0;
  let newWatermark = cfg.watermark;
  try {
    const messages = await listCandidateMessages(auth, cfg.mailbox, cfg.watermark);
    for (const msg of messages) {
      checkedMessages++;
      if (msg.receivedDateTime > newWatermark) newWatermark = msg.receivedDateTime;

      const senderName = msg.from?.emailAddress?.name ?? "";
      const senderAddress = msg.from?.emailAddress?.address ?? "";
      if (!looksLikeInvoiceMail(msg.subject ?? "", senderName, senderAddress, cfg.keywords)) continue;

      const attachments = await listFileAttachments(auth, cfg.mailbox, msg.id);
      let anyImported = false;
      for (const att of attachments) {
        if (att.isInline || att.size <= 0 || att.size > MAX_SIZE) continue;
        const buffer = Buffer.from(att.contentBytes, "base64");
        const mime = resolveAttachmentMime(att.contentType, buffer);
        if (!mime) continue;
        await createInboxPendingReceipt({ buffer, originalName: att.name, mime }, cfg.uploadUserId);
        imported++;
        anyImported = true;
      }
      // Nur verschieben, wenn tatsächlich etwas importiert wurde – sonst bleibt die Mail
      // im Posteingang sichtbar (z. B. Anhang war kein PDF/Bild).
      if (anyImported) {
        await moveMessageToProcessedFolder(auth, cfg.mailbox, msg.id).catch(() => {});
      }
    }
    await setSetting(OUTLOOK_WATERMARK_KEY, newWatermark);
    await setSetting(OUTLOOK_LAST_RUN_KEY, new Date().toISOString());
    await setSetting(OUTLOOK_LAST_IMPORTED_KEY, String(imported));
    await setSetting(OUTLOOK_LAST_ERROR_KEY, null);
    return { ok: true, checkedMessages, imported };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler.";
    await setSetting(OUTLOOK_LAST_ERROR_KEY, message).catch(() => {});
    await setSetting(OUTLOOK_LAST_RUN_KEY, new Date().toISOString()).catch(() => {});
    return { ok: false, checkedMessages, imported, error: message };
  }
}
