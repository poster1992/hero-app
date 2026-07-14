"use server";

import {
  getReceiptsInRange,
  heroGraphQL,
  getCalculatedMaterialsForProject,
  getFileUploadFolders,
  uploadProjectDocument,
  type ProjectMaterialCalculation,
  type HeroFolder,
} from "@/lib/hero-api";
import {
  getProjectBookedMaterials as getProjectBookedMaterialsLib,
  type ProjectBookedMaterials,
} from "@/lib/materials";
import { getInvoiceStatus, getDocumentUrl } from "@/lib/invoices";
import { listManualReceiptsByProject } from "@/lib/manual-receipts";
import { getSession } from "@/lib/session";

export interface ProjectPhoto {
  filename: string;
  /** Kleines Thumbnail (fit_256) für die Galerie-Übersicht (schnell). */
  thumbUrl: string;
  /** Größeres Bild (fit_1024) für die Vollansicht. */
  fullUrl: string;
  /** Original zum Herunterladen. */
  downloadUrl: string;
  /** Hochlade-/Erstelldatum (ISO) oder null. */
  uploadedAt: string | null;
  /** Wer die Datei hochgeladen hat (aus dem Projekt-Logbuch), oder null. */
  uploadedBy: string | null;
}

const stripTags = (s: string | null): string =>
  (s ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

/** Extrahiert die hochgeladenen Dateinamen aus einem Logbuch-Text (3 HERO-Formate). */
function extractUploadedFilenames(text: string): string[] {
  const clean = (s: string) => s.replace(/^[\s.·-]+|[\s.]+$/g, "").trim();
  // Mehrere Bilder: „… hochgeladen:. - name1. - name2 …"
  if (/hochgeladen:/i.test(text) && /\s-\s/.test(text)) {
    const after = text.split(/hochgeladen:/i)[1] ?? "";
    return after
      .split(/\s-\s/)
      .map(clean)
      .filter((n) => /\.[A-Za-z0-9]{2,5}$/.test(n));
  }
  // Einzelbild: „… hochgeladen: name.jpeg."
  const single = text.match(/hochgeladen:\s*(.+?)\.?\s*$/i);
  if (single) return [clean(single[1])].filter(Boolean);
  // Dokument: „name.pdf wurde hochgeladen."
  const doc = text.match(/^(.+?)\s+wurde hochgeladen/i);
  if (doc) return [clean(doc[1])].filter(Boolean);
  return [];
}

/**
 * Ordnet Dateinamen dem Uploader zu. HERO speichert den Uploader nicht an der
 * Datei, protokolliert ihn aber im Logbuch (mehrere Textformate, siehe
 * extractUploadedFilenames). Liefert eine Map dateiname(lowercase) → Uploader.
 */
async function getUploadAuthorsByFilename(projectId: number): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const data = await heroGraphQL<{
      project_histories: {
        custom_text: string | null;
        user: { partner: { name: string | null } | null; email: string | null } | null;
      }[];
    }>(
      `query UploadAuthors($id: Int) {
        project_histories(project_match_id: $id, show_system_histories: false, orderBy: "id", first: 2000) {
          custom_text
          user { partner { name } email }
        }
      }`,
      { id: projectId }
    );
    for (const h of data.project_histories ?? []) {
      const text = stripTags(h.custom_text);
      if (!/hochgeladen/i.test(text)) continue;
      const author = h.user?.partner?.name || h.user?.email || null;
      if (!author) continue;
      for (const name of extractUploadedFilenames(text)) {
        const key = name.toLowerCase();
        if (key && !map.has(key)) map.set(key, author);
      }
    }
  } catch {
    // Uploader ist optional – ohne Logbuch bleibt er leer.
  }
  return map;
}

/** Bilder (Fotos) eines Projekts aus den HERO-Dateien (mit Thumbnails). */
export async function getProjectPhotos(projectId: number): Promise<ProjectPhoto[]> {
  const [data, authors] = await Promise.all([
    heroGraphQL<{
      project_match: {
        file_uploads:
          | {
              filename: string | null;
              type: string | null;
              is_deleted: boolean | null;
              created: string | null;
              temporary_url: string | null;
              url_download: string | null;
              thumbnails: { format: string | null; url: string | null }[] | null;
            }[]
          | null;
      } | null;
    }>(
      `query ProjectPhotos($id: Int) {
        project_match(project_match_id: $id) {
          file_uploads(first: 2000) { filename type is_deleted created temporary_url url_download thumbnails { format url } }
        }
      }`,
      { id: projectId }
    ),
    getUploadAuthorsByFilename(projectId),
  ]);
  const files = data.project_match?.file_uploads ?? [];
  const pick = (thumbs: { format: string | null; url: string | null }[] | null, fmt: string) =>
    thumbs?.find((t) => t.format === fmt)?.url ?? null;

  return files
    .filter((f) => !f.is_deleted && (f.type ?? "").startsWith("image/") && f.temporary_url)
    .map((f) => {
      const full = f.temporary_url as string;
      const name = f.filename ?? "Foto";
      return {
        filename: name,
        thumbUrl: pick(f.thumbnails, "fit_256") ?? full,
        fullUrl: pick(f.thumbnails, "fit_1024") ?? full,
        downloadUrl: f.url_download ?? full,
        uploadedAt: f.created ?? null,
        uploadedBy: authors.get(name.trim().toLowerCase()) ?? null,
      };
    })
    // Neueste zuerst.
    .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
}

export interface ProjectDocument {
  filename: string;
  /** MIME-Typ (z.B. application/pdf) oder null. */
  type: string | null;
  /** Öffentliche Signatur-URL zum Ansehen (24 h gültig). */
  url: string;
  /** URL zum Herunterladen. */
  downloadUrl: string;
  /** HERO-Ordner der Projektakte (z.B. "Angebote") – "Ohne Ordner", wenn keiner gesetzt ist. */
  folder: string;
}

/** Dokumente eines Ordners (für die aufklappbare Ordner-Ansicht im Projekt-Popup). */
export interface ProjectDocumentFolder {
  name: string;
  documents: ProjectDocument[];
}

/** Label für Dateien, die in HERO in keinem Ordner liegen. */
const NO_FOLDER = "Ohne Ordner";

interface RawDocFileUpload {
  id: number | null;
  filename: string | null;
  type: string | null;
  is_deleted: boolean | null;
  temporary_url: string | null;
  url_download: string | null;
}

/**
 * Alle Dokumente (Nicht-Bild-Dateien) eines Projekts, gruppiert nach HERO-Ordner.
 *
 * Liest bewusst ZWEI Quellen, weil HERO die Dateien je nach Upload-Weg unterschiedlich
 * verknüpft:
 *  - `project_match.file_uploads` – die Dateien, die HERO selbst am Projekt verlinkt hat.
 *  - `customer_documents` – die Dokumente der Projektakte; nur hier tauchen die über
 *    `upload_document` (unsere "+"-Schaltfläche) abgelegten Dateien auf.
 * Der Ordner hängt in beiden Fällen am CustomerDocument (`file_upload_folder`).
 */
export async function getProjectDocuments(projectId: number): Promise<ProjectDocumentFolder[]> {
  const data = await heroGraphQL<{
    project_match: {
      file_uploads:
        | (RawDocFileUpload & {
            customer_document: { file_upload_folder: { name: string | null } | null } | null;
          })[]
        | null;
    } | null;
    customer_documents:
      | {
          status_code: number | null;
          file_upload_folder: { name: string | null } | null;
          file_upload: RawDocFileUpload | null;
        }[]
      | null;
  }>(
    `query ProjectDocuments($id: Int, $ids: [Int]) {
      project_match(project_match_id: $id) {
        file_uploads(first: 2000) {
          id
          filename
          type
          is_deleted
          temporary_url
          url_download
          customer_document { file_upload_folder { name } }
        }
      }
      customer_documents(project_match_ids: $ids, first: 500) {
        status_code
        file_upload_folder { name }
        file_upload { id filename type is_deleted temporary_url url_download }
      }
    }`,
    { id: projectId, ids: [projectId] }
  );

  const usable = (f: RawDocFileUpload | null | undefined): f is RawDocFileUpload =>
    !!f && !f.is_deleted && !(f.type ?? "").startsWith("image/") && !!(f.temporary_url || f.url_download);

  // Dateien beider Quellen zusammenführen; die Datei-ID entscheidet über Duplikate.
  const byId = new Map<number, ProjectDocument>();
  const add = (f: RawDocFileUpload, folder: string | null | undefined) => {
    if (!usable(f) || f.id == null || byId.has(f.id)) return;
    const view = (f.temporary_url || f.url_download) as string;
    byId.set(f.id, {
      filename: f.filename ?? "Dokument",
      type: f.type,
      url: view,
      downloadUrl: f.url_download ?? view,
      folder: folder?.trim() || NO_FOLDER,
    });
  };

  for (const f of data.project_match?.file_uploads ?? []) {
    add(f, f.customer_document?.file_upload_folder?.name);
  }
  // Status 1000 = in HERO gelöschte Dokumente – die gehören nicht in die Akte.
  for (const d of data.customer_documents ?? []) {
    if (d.status_code === 1000 || !d.file_upload) continue;
    add(d.file_upload, d.file_upload_folder?.name);
  }

  // Nach Ordnern gruppieren: alphabetisch, "Ohne Ordner" ans Ende.
  const folders = new Map<string, ProjectDocument[]>();
  for (const doc of byId.values()) {
    const list = folders.get(doc.folder) ?? [];
    list.push(doc);
    folders.set(doc.folder, list);
  }

  return [...folders.entries()]
    .map(([name, documents]) => ({
      name,
      documents: documents.sort((a, b) => a.filename.localeCompare(b.filename, "de")),
    }))
    .sort((a, b) => {
      if (a.name === NO_FOLDER) return 1;
      if (b.name === NO_FOLDER) return -1;
      return a.name.localeCompare(b.name, "de");
    });
}

/** Die Ordnerstruktur aus HERO – für die Ordner-Auswahl beim Hochladen. */
export async function getProjectDocumentFolders(): Promise<HeroFolder[]> {
  if (!(await getSession())) return [];
  return getFileUploadFolders();
}

/**
 * Lädt ein Dokument in einen HERO-Ordner der Projektakte hoch
 * (FormData: projectId, folderId, files).
 */
export async function uploadProjectDocumentAction(
  formData: FormData
): Promise<{ ok: boolean; uploaded: number; error?: string }> {
  if (!(await getSession())) return { ok: false, uploaded: 0, error: "Nicht angemeldet." };

  const projectId = Number(formData.get("projectId"));
  const folderId = Number(formData.get("folderId"));
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return { ok: false, uploaded: 0, error: "Ungültiges Projekt." };
  }
  if (!Number.isFinite(folderId) || folderId <= 0) {
    return { ok: false, uploaded: 0, error: "Bitte einen Ordner wählen." };
  }

  const files = formData
    .getAll("files")
    .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  if (files.length === 0) return { ok: false, uploaded: 0, error: "Keine Datei gewählt." };

  let uploaded = 0;
  const failed: string[] = [];

  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) {
      failed.push(`${f.name} (größer als 25 MB)`);
      continue;
    }
    try {
      await uploadProjectDocument(projectId, folderId, {
        buffer: Buffer.from(await f.arrayBuffer()),
        filename: f.name || "dokument.pdf",
        mime: f.type || "application/octet-stream",
      });
      uploaded++;
    } catch (e) {
      failed.push(`${f.name} (${e instanceof Error ? e.message : "Fehler"})`);
    }
  }

  if (uploaded === 0) {
    return { ok: false, uploaded, error: `Upload fehlgeschlagen: ${failed.join(", ")}` };
  }
  if (failed.length > 0) {
    return { ok: true, uploaded, error: `${failed.length} nicht hochgeladen: ${failed.join(", ")}` };
  }
  return { ok: true, uploaded };
}

export interface ProjectEmployeeDay {
  /** yyyy-mm-dd */
  date: string;
  hours: number;
}

export interface ProjectEmployeeHours {
  name: string;
  hours: number;
  entries: number;
  /** Hours per day, ascending by date. */
  days: ProjectEmployeeDay[];
}

/** Worked hours per employee (and per day) for a project, from tracking_times. */
export async function getProjectHoursByEmployee(
  projectId: number
): Promise<ProjectEmployeeHours[]> {
  const pageSize = 200;
  const maxPages = 60;
  const map = new Map<string, { hours: number; entries: number; days: Map<string, number> }>();

  for (let page = 0; page < maxPages; page++) {
    const data = await heroGraphQL<{
      tracking_times: { start: string | null; end: string | null; partner: { name: string | null } | null }[];
    }>(
      `query ProjectHours($pid: Int, $first: Int, $offset: Int) {
        tracking_times(
          project_match_id: $pid
          show_all_partners: true
          orderBy: "id"
          first: $first
          offset: $offset
        ) {
          start
          end
          partner { name }
        }
      }`,
      { pid: projectId, first: pageSize, offset: page * pageSize }
    );
    const entries = data.tracking_times ?? [];
    for (const e of entries) {
      if (!e.start || !e.end) continue;
      const ms = new Date(e.end).getTime() - new Date(e.start).getTime();
      if (ms <= 0) continue;
      const h = ms / 3_600_000;
      const name = e.partner?.name ?? "Unbekannt";
      const day = e.start.slice(0, 10);
      const agg = map.get(name) ?? { hours: 0, entries: 0, days: new Map<string, number>() };
      agg.hours += h;
      agg.entries++;
      agg.days.set(day, (agg.days.get(day) ?? 0) + h);
      map.set(name, agg);
    }
    if (entries.length < pageSize) break;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      hours: round2(v.hours),
      entries: v.entries,
      days: [...v.days.entries()]
        .map(([date, hh]) => ({ date, hours: round2(hh) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.hours - a.hours);
}

export interface ProjectReceiptItem {
  id: string;
  number: string;
  date: string | null;
  net: number;
  gross: number;
  statusLabel: string;
  /** Auth-gated PDF URL (/api/document?src=…) or null when no file. */
  docUrl: string | null;
  filename: string | null;
}

/** Kalkulierte Materialpositionen eines Projekts (aus der Auftragsbestätigung). */
export async function getProjectCalculatedMaterials(
  projectId: number
): Promise<ProjectMaterialCalculation> {
  return getCalculatedMaterialsForProject(projectId);
}

/** Tatsächlich auf das Projekt gebuchte Ware (Lagerbewegungen, EK-bewertet). */
export async function getProjectBookedMaterials(
  projectRelativeId: number
): Promise<ProjectBookedMaterials> {
  return getProjectBookedMaterialsLib(projectRelativeId);
}

/** All receipts (Belege) linked to a project, newest first. */
export async function getProjectReceipts(projectId: number): Promise<ProjectReceiptItem[]> {
  const now = new Date();
  const from = `${now.getUTCFullYear() - 6}-01-01T00:00:00Z`;
  const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
  const receipts = await getReceiptsInRange(from, to);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const heroItems: ProjectReceiptItem[] = receipts
    .filter((r) => r.receiptPositions.some((p) => p.projectMatch?.id === projectId))
    .map((r) => {
      const status = getInvoiceStatus(r);
      const file = r.fileUpload;
      // Nur der diesem Projekt zugeordnete Anteil des Belegs – ein Beleg kann auf
      // mehrere Projekte aufgeteilt sein. Gleiche Vorzeichen-Logik wie "Ist Material"
      // (getCostNetByProject): Belege (output) +, Gutschriften (income) −.
      const sign = r.type === "output" ? 1 : r.type === "income" ? -1 : 0;
      const projPos = r.receiptPositions.filter((p) => p.projectMatch?.id === projectId);
      const net = round2(
        projPos.reduce((s, p) => s + (sign === 1 ? p.valueExclVat : -Math.abs(p.valueExclVat)), 0)
      );
      const gross = round2(
        projPos.reduce((s, p) => s + (sign === 1 ? p.valueInclVat : -Math.abs(p.valueInclVat)), 0)
      );
      return {
        id: r.id,
        number: r.number,
        date: r.receiptDate,
        net,
        gross,
        statusLabel: status.label,
        docUrl: file?.src ? getDocumentUrl(file.src) : null,
        filename: file?.filename ?? null,
      };
    });

  // Manuelle Belege (Posteingang), die diesem Projekt zugeordnet sind.
  let manualItems: ProjectReceiptItem[] = [];
  try {
    const manual = await listManualReceiptsByProject(projectId);
    manualItems = manual.map((m) => ({
      id: `manual-${m.id}`,
      number: m.invoiceNumber || m.supplier || `#${m.id}`,
      date: m.date,
      net: m.net,
      gross: m.gross,
      statusLabel: m.isPaid ? "Bezahlt" : "Offen",
      docUrl: m.hasFile ? `/api/beleg?id=${m.id}` : null,
      filename: m.fileName,
    }));
  } catch {
    // Manuelle Belege sind optional – Fehler blockiert die HERO-Belegliste nicht.
  }

  return [...heroItems, ...manualItems].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
