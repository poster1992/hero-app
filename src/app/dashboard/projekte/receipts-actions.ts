"use server";

import { getReceiptsInRange, heroGraphQL } from "@/lib/hero-api";
import { getInvoiceStatus, getDocumentUrl } from "@/lib/invoices";

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

/** All receipts (Belege) linked to a project, newest first. */
export async function getProjectReceipts(projectId: number): Promise<ProjectReceiptItem[]> {
  const now = new Date();
  const from = `${now.getUTCFullYear() - 6}-01-01T00:00:00Z`;
  const to = `${now.getUTCFullYear() + 1}-12-31T23:59:59Z`;
  const receipts = await getReceiptsInRange(from, to);
  return receipts
    .filter((r) => r.receiptPositions.some((p) => p.projectMatch?.id === projectId))
    .map((r) => {
      const status = getInvoiceStatus(r);
      const file = r.fileUpload;
      return {
        id: r.id,
        number: r.number,
        date: r.receiptDate,
        net: r.netValue,
        gross: r.value,
        statusLabel: status.label,
        docUrl: file?.src ? getDocumentUrl(file.src) : null,
        filename: file?.filename ?? null,
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
