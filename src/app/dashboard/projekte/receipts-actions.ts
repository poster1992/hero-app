"use server";

import {
  getReceiptsInRange,
  heroGraphQL,
  getCalculatedMaterialsForProject,
  type ProjectMaterialCalculation,
} from "@/lib/hero-api";
import {
  getProjectBookedMaterials as getProjectBookedMaterialsLib,
  type ProjectBookedMaterials,
} from "@/lib/materials";
import { getInvoiceStatus, getDocumentUrl } from "@/lib/invoices";

export interface ProjectPhoto {
  filename: string;
  /** Kleines Thumbnail (fit_256) für die Galerie-Übersicht (schnell). */
  thumbUrl: string;
  /** Größeres Bild (fit_1024) für die Vollansicht. */
  fullUrl: string;
  /** Original zum Herunterladen. */
  downloadUrl: string;
}

/** Bilder (Fotos) eines Projekts aus den HERO-Dateien (mit Thumbnails). */
export async function getProjectPhotos(projectId: number): Promise<ProjectPhoto[]> {
  const data = await heroGraphQL<{
    project_match: {
      file_uploads:
        | {
            filename: string | null;
            type: string | null;
            is_deleted: boolean | null;
            temporary_url: string | null;
            url_download: string | null;
            thumbnails: { format: string | null; url: string | null }[] | null;
          }[]
        | null;
    } | null;
  }>(
    `query ProjectPhotos($id: Int) {
      project_match(project_match_id: $id) {
        file_uploads(first: 2000) { filename type is_deleted temporary_url url_download thumbnails { format url } }
      }
    }`,
    { id: projectId }
  );
  const files = data.project_match?.file_uploads ?? [];
  const pick = (thumbs: { format: string | null; url: string | null }[] | null, fmt: string) =>
    thumbs?.find((t) => t.format === fmt)?.url ?? null;

  return files
    .filter((f) => !f.is_deleted && (f.type ?? "").startsWith("image/") && f.temporary_url)
    .map((f) => {
      const full = f.temporary_url as string;
      return {
        filename: f.filename ?? "Foto",
        thumbUrl: pick(f.thumbnails, "fit_256") ?? full,
        fullUrl: pick(f.thumbnails, "fit_1024") ?? full,
        downloadUrl: f.url_download ?? full,
      };
    });
}

export interface ProjectDocument {
  filename: string;
  /** MIME-Typ (z.B. application/pdf) oder null. */
  type: string | null;
  /** Öffentliche Signatur-URL zum Ansehen (24 h gültig). */
  url: string;
  /** URL zum Herunterladen. */
  downloadUrl: string;
}

/** Alle Dokumente (Nicht-Bild-Dateien) eines Projekts aus den HERO-Dateien. */
export async function getProjectDocuments(projectId: number): Promise<ProjectDocument[]> {
  const data = await heroGraphQL<{
    project_match: {
      file_uploads:
        | {
            filename: string | null;
            type: string | null;
            is_deleted: boolean | null;
            temporary_url: string | null;
            url_download: string | null;
          }[]
        | null;
    } | null;
  }>(
    `query ProjectDocuments($id: Int) {
      project_match(project_match_id: $id) {
        file_uploads(first: 2000) { filename type is_deleted temporary_url url_download }
      }
    }`,
    { id: projectId }
  );
  const files = data.project_match?.file_uploads ?? [];
  return files
    .filter(
      (f) =>
        !f.is_deleted &&
        !(f.type ?? "").startsWith("image/") &&
        (f.temporary_url || f.url_download)
    )
    .map((f) => {
      const view = (f.temporary_url || f.url_download) as string;
      return {
        filename: f.filename ?? "Dokument",
        type: f.type,
        url: view,
        downloadUrl: f.url_download ?? view,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename, "de"));
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
  return receipts
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
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
