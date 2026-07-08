import Link from "next/link";
import type { PlanboardDayData } from "@/lib/planning-data";
import { absenceStyle } from "@/lib/planboard-colors";

/** Height of one appointment lane, in rem. */
const LANE_H = 2.6;

/**
 * Greedy lane packing: items that overlap in time are pushed onto separate
 * lanes (stacked downward); non-overlapping items reuse the topmost free lane.
 * Assumes `items` is sorted by startMin.
 */
function assignLanes<T extends { startMin: number; endMin: number }>(
  items: T[]
): { placed: { item: T; lane: number }[]; laneCount: number } {
  const laneEnds: number[] = []; // lane index -> end minute of its last item
  const placed = items.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    return { item, lane };
  });
  return { placed, laneCount: laneEnds.length };
}

/**
 * Plantafel single-day view: employees down the left, a 06:00–18:00 time axis
 * across the top. Planned appointments are drawn as coloured bars; recorded
 * working times (Ist) are stacked below them in grey on the same axis.
 */
export default function PlanboardDay({ data, backUrl }: { data: PlanboardDayData; backUrl?: string }) {
  const { rows, startHour, endHour } = data;
  const backParam = backUrl ? `&back=${encodeURIComponent(backUrl)}` : "";
  const totalMin = (endHour - startHour) * 60;
  const winStart = startHour * 60;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        Keine Termine an diesem Tag.
      </p>
    );
  }

  const cols = "grid-cols-[11rem_1fr]";
  const pct = (min: number) => ((min - winStart) / totalMin) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <div className="min-w-[900px]">
          {/* Header: corner + hour labels */}
          <div className={`grid ${cols} border-b border-gray-200 bg-gray-50`}>
            <div className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
              Mitarbeiter
            </div>
            <div className="flex">
              {hours.map((h) => (
                <div
                  key={h}
                  className="flex-1 border-l border-gray-200 px-1 py-2 text-center text-xs font-semibold text-gray-700"
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
          </div>

          {/* One row per employee */}
          {rows.map((row) => {
            const planned = assignLanes(row.events);
            const worked = assignLanes(row.worked);
            const absenceLanes = row.absences.length;
            const totalLanes = Math.max(
              1,
              absenceLanes + planned.laneCount + worked.laneCount
            );
            return (
              <div
                key={row.employeeId}
                className={`grid ${cols} border-b border-gray-100 last:border-b-0`}
              >
                <div className="sticky left-0 z-10 flex items-center bg-white px-3 py-2 text-sm font-medium text-gray-900">
                  {row.employeeName}
                </div>
                <div className="relative" style={{ height: `${totalLanes * LANE_H}rem` }}>
                  {/* Hour grid lines */}
                  <div className="absolute inset-0 flex">
                    {hours.map((h) => (
                      <div key={h} className="flex-1 border-l border-gray-100" />
                    ))}
                  </div>

                  {/* Divider between plan and Ist lanes */}
                  {planned.laneCount > 0 && worked.laneCount > 0 && (
                    <div
                      className="absolute inset-x-0 border-t border-dashed border-gray-300"
                      style={{ top: `${(absenceLanes + planned.laneCount) * LANE_H}rem` }}
                    />
                  )}

                  {/* Absences (full-width bands at the top) */}
                  {row.absences.map((ab, ai) => {
                    const style = absenceStyle(ab.category);
                    return (
                      <div
                        key={`a-${ai}`}
                        style={{
                          left: "0%",
                          width: "100%",
                          top: `${ai * LANE_H + 0.15}rem`,
                          height: `${LANE_H - 0.3}rem`,
                        }}
                        className={`absolute flex items-center justify-center overflow-hidden rounded-md border text-[11px] font-semibold ${style.band}`}
                        title={`${ab.label}${ab.half ? " (½ Tag)" : ""}`}
                      >
                        {ab.label}
                        {ab.half ? " (½ Tag)" : ""}
                      </div>
                    );
                  })}

                  {/* Planned appointments (coloured) */}
                  {planned.placed.map(({ item: ev, lane }) => {
                    const left = pct(ev.startMin);
                    const width = Math.max(pct(ev.endMin) - left, 2);
                    const clickable = ev.projectId != null && ev.projectId > 0;
                    const style = {
                      left: `${left}%`,
                      width: `${width}%`,
                      top: `${(absenceLanes + lane) * LANE_H + 0.15}rem`,
                      height: `${LANE_H - 0.3}rem`,
                    };
                    const inner = (
                      <>
                        <p className="truncate text-[11px] font-medium leading-tight">{ev.title}</p>
                        <p className="truncate text-[10px] leading-tight opacity-90">
                          {ev.timeLabel}
                          {ev.projectRelativeId != null ? ` · #${ev.projectRelativeId}` : ""}
                        </p>
                      </>
                    );
                    const titleText = clickable
                      ? "Projekt öffnen"
                      : `${ev.timeLabel} · ${ev.title}${
                          ev.projectRelativeId != null ? ` · #${ev.projectRelativeId}` : ""
                        }${ev.projectName ? ` ${ev.projectName}` : ""}`;
                    return clickable ? (
                      <Link
                        key={`p-${ev.id}`}
                        href={`/dashboard/projekte?open=${ev.projectId}${backParam}`}
                        style={style}
                        className="absolute block overflow-hidden rounded-md bg-gray-500 px-1.5 py-0.5 text-white shadow-sm transition-colors hover:bg-brand-red"
                        title={titleText}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div
                        key={`p-${ev.id}`}
                        style={style}
                        className="absolute overflow-hidden rounded-md bg-gray-500 px-1.5 py-0.5 text-white shadow-sm"
                        title={titleText}
                      >
                        {inner}
                      </div>
                    );
                  })}

                  {/* Recorded working times (Ist, grey) */}
                  {worked.placed.map(({ item: seg, lane }) => {
                    const left = pct(seg.startMin);
                    const width = Math.max(pct(seg.endMin) - left, 2);
                    return (
                      <div
                        key={`w-${seg.id}`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          top: `${(absenceLanes + planned.laneCount + lane) * LANE_H + 0.15}rem`,
                          height: `${LANE_H - 0.3}rem`,
                        }}
                        className="absolute overflow-hidden rounded-md bg-emerald-600 px-1.5 py-0.5 text-white shadow-sm"
                        title={`Ist ${seg.timeLabel} · ${seg.hours} h${
                          seg.projectRelativeId != null ? ` · #${seg.projectRelativeId}` : ""
                        }${seg.projectName ? ` ${seg.projectName}` : ""}`}
                      >
                        <p className="truncate text-[11px] font-medium leading-tight">
                          Ist · {seg.hours} h
                          {seg.projectRelativeId != null ? ` · #${seg.projectRelativeId}` : ""}
                        </p>
                        <p className="truncate text-[10px] leading-tight opacity-90">{seg.timeLabel}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-1 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-gray-500" />
          Termin (Plan)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-emerald-600" />
          Arbeitszeit (Ist)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-amber-300 bg-amber-100" />
          Urlaub
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-rose-300 bg-rose-100" />
          Krank
        </span>
      </div>
    </div>
  );
}
