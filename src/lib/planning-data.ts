import {
  getCalendarEvents,
  getCalendarEventsForProject,
  getAbsences,
  getTrackingTimes,
} from "./hero-api";
import { tradeOf, FORCE_MONTEUR, NO_CAPACITY, type EmployeeTrade } from "./employee-trades";

/** Standard weekly capacity per employee in hours (5 days × 8 h). */
export const WEEKLY_CAPACITY = 40;
/** Max hours a single day can contribute (so multi-day/overnight events don't inflate). */
const MAX_HOURS_PER_DAY = 8;

export interface UtilWeek {
  index: number;
  /** Monday of the week (ISO date, yyyy-mm-dd). */
  monday: string;
  /** Label like "KW 24". */
  label: string;
}

export interface UtilEmployee {
  id: number;
  name: string;
  /** True if this employee is a fitter/installer (role "worker" or "sales"). */
  isMonteur: boolean;
  /** Whether this employee's capacity counts toward the available team volume. */
  countsCapacity: boolean;
  /** Job title group for Monteure (Fliesenleger / Hilfsarbeiter). */
  trade: EmployeeTrade;
  /** Planned hours per week (aligned to weeks[]). */
  perWeek: number[];
  /** Total absence hours per week that reduce capacity (aligned to weeks[]). */
  absencePerWeek: number[];
  /** Of which sickness hours per week (subset of absencePerWeek). */
  sickPerWeek: number[];
  total: number;
}

/** Absence types counted as sickness (vs. vacation / other leave). */
const SICK_TYPES = new Set([
  "sick",
  "sick_child",
  "sick_note_once",
  "sick_note_multiple",
]);

export interface UtilizationData {
  weeks: UtilWeek[];
  employees: UtilEmployee[];
  capacityPerWeek: number;
  /** Total planned hours per week across all employees. */
  weekTotals: number[];
  /** Total absence hours per week across all employees. */
  weekAbsenceTotals: number[];
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Monday 00:00 UTC of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (r.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(r, -dow);
}

/** ISO 8601 week number. */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNr + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Planned hours of an event that fall inside [rangeStart, rangeEnd), capped per weekday. */
function eventHoursInRange(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): number {
  const from = start > rangeStart ? start : rangeStart;
  const to = end < rangeEnd ? end : rangeEnd;
  if (to <= from) return 0;

  let total = 0;
  let day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (day < to) {
    const nextDay = addDays(day, 1);
    const dow = day.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) {
      const segStart = from > day ? from : day;
      const segEnd = to < nextDay ? to : nextDay;
      const hours = (segEnd.getTime() - segStart.getTime()) / 3_600_000;
      total += Math.min(hours, MAX_HOURS_PER_DAY);
    }
    day = nextDay;
  }
  return total;
}

/** Absence hours falling inside [rangeStart, rangeEnd) on weekdays (half days = 4 h). */
function absenceHoursInRange(
  absStart: Date,
  absEndIncl: Date,
  startHalf: boolean,
  endHalf: boolean,
  rangeStart: Date,
  rangeEnd: Date
): number {
  const first = absStart > rangeStart ? absStart : rangeStart;
  const lastExcl = addDays(rangeEnd, -1);
  const last = absEndIncl < lastExcl ? absEndIncl : lastExcl;

  let total = 0;
  let day = new Date(first);
  while (day <= last) {
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      let h = MAX_HOURS_PER_DAY;
      if (startHalf && day.getTime() === absStart.getTime()) h = MAX_HOURS_PER_DAY / 2;
      if (endHalf && day.getTime() === absEndIncl.getTime()) h = MAX_HOURS_PER_DAY / 2;
      total += h;
    }
    day = addDays(day, 1);
  }
  return total;
}

/**
 * Employee utilisation over `weeksCount` weeks starting at `startMonday`,
 * derived from planned calendar events (partners = assigned employees) and
 * reduced by absences (vacation, sickness, …).
 */
export async function getEmployeeUtilization(
  startMonday: Date,
  weeksCount: number
): Promise<UtilizationData> {
  const rangeStart = startMonday;
  const rangeEnd = addDays(startMonday, weeksCount * 7);

  const [events, absences] = await Promise.all([
    getCalendarEvents(rangeStart.toISOString(), rangeEnd.toISOString()),
    getAbsences(rangeStart.toISOString().slice(0, 10), rangeEnd.toISOString().slice(0, 10)),
  ]);

  const weeks: UtilWeek[] = Array.from({ length: weeksCount }, (_, i) => {
    const m = addDays(startMonday, i * 7);
    return { index: i, monday: m.toISOString().slice(0, 10), label: `KW ${isoWeek(m)}` };
  });

  const byEmp = new Map<
    number,
    {
      name: string;
      role: string | null;
      perWeek: number[];
      absencePerWeek: number[];
      sickPerWeek: number[];
    }
  >();
  const ensure = (id: number, name: string, role: string | null) => {
    let e = byEmp.get(id);
    if (!e) {
      e = {
        name,
        role,
        perWeek: new Array(weeksCount).fill(0),
        absencePerWeek: new Array(weeksCount).fill(0),
        sickPerWeek: new Array(weeksCount).fill(0),
      };
      byEmp.set(id, e);
    } else if (e.role == null && role != null) {
      e.role = role;
    }
    return e;
  };

  for (const ev of events) {
    if (!ev.start || !ev.end || ev.partners.length === 0) continue;
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    for (let i = 0; i < weeksCount; i++) {
      const ws = addDays(startMonday, i * 7);
      const we = addDays(ws, 7);
      const h = eventHoursInRange(s, e, ws, we);
      if (h <= 0) continue;
      for (const p of ev.partners) ensure(p.id, p.name, p.role).perWeek[i] += h;
    }
  }

  for (const ab of absences) {
    const s = new Date(`${ab.start}T00:00:00Z`);
    const e = new Date(`${ab.end}T00:00:00Z`);
    for (let i = 0; i < weeksCount; i++) {
      const ws = addDays(startMonday, i * 7);
      const we = addDays(ws, 7);
      const h = absenceHoursInRange(s, e, ab.startHalf, ab.endHalf, ws, we);
      if (h <= 0) continue;
      const entry = ensure(ab.partnerId, ab.partnerName, ab.partnerRole);
      const before = entry.absencePerWeek[i];
      entry.absencePerWeek[i] = Math.min(WEEKLY_CAPACITY, before + h);
      // Effektiv addierter Anteil (nach Deckelung auf die Wochenkapazität).
      const added = entry.absencePerWeek[i] - before;
      if (SICK_TYPES.has(ab.type)) entry.sickPerWeek[i] += added;
    }
  }

  const employees: UtilEmployee[] = [...byEmp.entries()]
    .map(([id, v]) => ({
      id,
      name: v.name,
      // Monteure = "worker"; Vertriebler ("sales") sind ebenfalls auf Montage und zählen mit.
      // FORCE_MONTEUR holt zusätzliche Personen (z. B. Filialleiter) in die Gruppe.
      isMonteur: v.role === "worker" || v.role === "sales" || FORCE_MONTEUR.has(v.name),
      countsCapacity: !NO_CAPACITY.has(v.name),
      trade: tradeOf(v.name),
      perWeek: v.perWeek.map(round1),
      absencePerWeek: v.absencePerWeek.map(round1),
      sickPerWeek: v.sickPerWeek.map(round1),
      total: round1(v.perWeek.reduce((a, b) => a + b, 0)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const weekTotals = Array.from({ length: weeksCount }, (_, i) =>
    round1(employees.reduce((s, emp) => s + emp.perWeek[i], 0))
  );
  const weekAbsenceTotals = Array.from({ length: weeksCount }, (_, i) =>
    round1(employees.reduce((s, emp) => s + emp.absencePerWeek[i], 0))
  );

  return { weeks, employees, capacityPerWeek: WEEKLY_CAPACITY, weekTotals, weekAbsenceTotals };
}

// ---------------------------------------------------------------------------
// Plantafel (HERO calendar) — weekly day-grid view of scheduled appointments.
// ---------------------------------------------------------------------------

/** FloorTec operates in Luxembourg; calendar times are shown in this zone. */
const PLANBOARD_TZ = "Europe/Luxembourg";

const localDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLANBOARD_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const localTimeFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: PLANBOARD_TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const dayLabelFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: PLANBOARD_TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});
const fullDayLabelFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: PLANBOARD_TZ,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const entryDateFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: PLANBOARD_TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Work-hours window shown in the Plantafel day view. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 18;

/** Local (Luxembourg) calendar date of an instant, as yyyy-mm-dd. */
function localDateOf(ms: number): string {
  return localDateFmt.format(new Date(ms));
}

export type AbsenceCategory = "sick" | "vacation" | "other";

export interface PlanboardAbsence {
  category: AbsenceCategory;
  /** German label, e.g. "Urlaub", "Krank". */
  label: string;
  /** Only a half day on this date. */
  half: boolean;
}

function absenceCategory(type: string): AbsenceCategory {
  if (SICK_TYPES.has(type)) return "sick";
  if (type === "vacation") return "vacation";
  return "other";
}

function absenceLabel(type: string): string {
  if (SICK_TYPES.has(type)) return "Krank";
  switch (type) {
    case "vacation":
      return "Urlaub";
    case "parental_leave":
      return "Elternzeit";
    case "special_leave":
      return "Sonderurlaub";
    case "overtime_reduction":
      return "Überstunden";
    case "school":
      return "Schule";
    default:
      return "Abwesend";
  }
}

export interface PlanboardDayHeader {
  /** yyyy-mm-dd (Luxembourg local date). */
  date: string;
  /** e.g. "Mo 16.06.". */
  label: string;
  isToday: boolean;
  /** True for Saturday/Sunday. */
  isWeekend: boolean;
}

export interface PlanboardCellEvent {
  id: number;
  title: string;
  /** e.g. "07:00–16:00" or "Ganztägig". */
  timeLabel: string;
  projectName: string | null;
  projectRelativeId: number | null;
  /** Planned hours of this appointment on this day (weekday-capped, like Auslastung). */
  hours: number;
}

/** A recorded working-time entry for a day (used in the week detail popup). */
export interface PlanboardWorkedEntry {
  id: number;
  projectRelativeId: number | null;
  projectName: string | null;
  /** e.g. "07:12–15:48". */
  timeLabel: string;
  hours: number;
}

export interface PlanboardRow {
  /** Partner id, or -1 for the "Ohne Zuordnung" row. */
  employeeId: number;
  employeeName: string;
  /** Events per day, aligned to days[] (one array per day, length 7). */
  cells: PlanboardCellEvent[][];
  /** Recorded working times per day, aligned to days[] (length 7). */
  workedCells: PlanboardWorkedEntry[][];
  /** Absences per day, aligned to days[] (one array per day, length 7). */
  absenceCells: PlanboardAbsence[][];
}

export interface PlanboardWeek {
  days: PlanboardDayHeader[];
  rows: PlanboardRow[];
}

/** Sort key: all-day first, then by time label, then title. */
function sortCellEvents(events: PlanboardCellEvent[]): void {
  events.sort((a, b) => {
    const aAll = a.timeLabel === "Ganztägig" ? 0 : 1;
    const bAll = b.timeLabel === "Ganztägig" ? 0 : 1;
    return aAll - bAll || a.timeLabel.localeCompare(b.timeLabel) || a.title.localeCompare(b.title, "de");
  });
}

const UNASSIGNED_ID = -1;

/**
 * The HERO Plantafel (calendar) for the week starting at `weekMonday`, as an
 * employee × day matrix: one row per assigned employee (plus an "Ohne Zuordnung"
 * row for unassigned appointments), seven day columns (Mon–Sun). Multi-day
 * appointments appear on every day they cover; day bucketing and times use the
 * Europe/Luxembourg time zone.
 */
export async function getPlanboardWeek(weekMonday: Date): Promise<PlanboardWeek> {
  const rangeStart = weekMonday;
  const rangeEnd = addDays(weekMonday, 7);

  const days: PlanboardDayHeader[] = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekMonday, i);
    return {
      date: localDateOf(d.getTime()),
      label: dayLabelFmt.format(d),
      isToday: false,
      isWeekend: i >= 5,
    };
  });
  const todayStr = localDateOf(Date.now());
  for (const d of days) d.isToday = d.date === todayStr;

  const [events, tracked, absences] = await Promise.all([
    getCalendarEvents(rangeStart.toISOString(), rangeEnd.toISOString()),
    getTrackingTimes(days[0].date, localDateOf(rangeEnd.getTime())),
    getAbsences(days[0].date, days[6].date),
  ]);

  const byEmp = new Map<
    number,
    {
      name: string;
      cells: PlanboardCellEvent[][];
      workedCells: PlanboardWorkedEntry[][];
      absenceCells: PlanboardAbsence[][];
    }
  >();
  const ensureRow = (id: number, name: string) => {
    let row = byEmp.get(id);
    if (!row) {
      row = {
        name,
        cells: Array.from({ length: 7 }, () => [] as PlanboardCellEvent[]),
        workedCells: Array.from({ length: 7 }, () => [] as PlanboardWorkedEntry[]),
        absenceCells: Array.from({ length: 7 }, () => [] as PlanboardAbsence[]),
      };
      byEmp.set(id, row);
    }
    return row;
  };
  const dayIndexByDate = new Map(days.map((d, i) => [d.date, i]));

  for (const ev of events) {
    if (!ev.start || !ev.end) continue;
    const startMs = new Date(ev.start).getTime();
    const endMs = new Date(ev.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

    const startDate = localDateOf(startMs);
    // `end` is treated as exclusive (HERO all-day events end at midnight of the
    // following day), so the last covered day is end − 1 ms.
    const endDate = localDateOf(Math.max(startMs, endMs - 1));
    const multiDay = startDate !== endDate;
    const timeLabel =
      ev.allDay || multiDay
        ? "Ganztägig"
        : `${localTimeFmt.format(new Date(startMs))}–${localTimeFmt.format(new Date(endMs))}`;

    const targets =
      ev.partners.length > 0
        ? ev.partners.map((p) => ({ id: p.id, name: p.name }))
        : [{ id: UNASSIGNED_ID, name: "Ohne Zuordnung" }];

    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (day.date < startDate || day.date > endDate) continue;
      const ws = addDays(weekMonday, i);
      const hours = round1(
        eventHoursInRange(new Date(startMs), new Date(endMs), ws, addDays(ws, 1))
      );
      const cellEvent: PlanboardCellEvent = {
        id: ev.id,
        title: ev.title?.trim() || "Termin",
        timeLabel,
        projectName: ev.projectName,
        projectRelativeId: ev.projectRelativeId,
        hours,
      };
      for (const t of targets) ensureRow(t.id, t.name).cells[i].push(cellEvent);
    }
  }

  for (const t of tracked) {
    if (!t.start || !t.end) continue;
    const startMs = new Date(t.start).getTime();
    const endMs = new Date(t.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const idx = dayIndexByDate.get(localDateOf(startMs));
    if (idx == null) continue;
    ensureRow(t.partnerId ?? UNASSIGNED_ID, t.partnerName).workedCells[idx].push({
      id: t.id,
      projectRelativeId: t.projectRelativeId,
      projectName: t.projectName,
      timeLabel: `${localTimeFmt.format(new Date(startMs))}–${localTimeFmt.format(new Date(endMs))}`,
      hours: t.durationHours,
    });
  }

  for (const ab of absences) {
    const row = ensureRow(ab.partnerId, ab.partnerName);
    for (let i = 0; i < days.length; i++) {
      const date = days[i].date;
      if (date < ab.start || date > ab.end) continue;
      const half =
        (date === ab.start && ab.startHalf) || (date === ab.end && ab.endHalf);
      row.absenceCells[i].push({
        category: absenceCategory(ab.type),
        label: absenceLabel(ab.type),
        half,
      });
    }
  }

  const rows: PlanboardRow[] = [...byEmp.entries()]
    .map(([employeeId, v]) => {
      for (const cell of v.cells) sortCellEvents(cell);
      for (const cell of v.workedCells) cell.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
      return {
        employeeId,
        employeeName: v.name,
        cells: v.cells,
        workedCells: v.workedCells,
        absenceCells: v.absenceCells,
      };
    })
    .sort((a, b) => {
      // "Ohne Zuordnung" always last.
      if (a.employeeId === UNASSIGNED_ID) return 1;
      if (b.employeeId === UNASSIGNED_ID) return -1;
      return a.employeeName.localeCompare(b.employeeName, "de");
    });

  return { days, rows };
}

// ---------------------------------------------------------------------------
// Plantafel — single-day view: employee × time (06:00–18:00) as Gantt bars.
// ---------------------------------------------------------------------------

/** "HH:mm" (24h) → minutes from midnight. */
function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export interface PlanboardDayEvent {
  id: number;
  title: string;
  projectName: string | null;
  projectRelativeId: number | null;
  /** Original time label, e.g. "07:00–16:00" or "Ganztägig". */
  timeLabel: string;
  /** Start/end minutes from midnight, clamped to the 06:00–18:00 window. */
  startMin: number;
  endMin: number;
}

/** A recorded working-time entry (Ist-Zeit) shown alongside the plan. */
export interface PlanboardWorkedSegment {
  id: number;
  projectRelativeId: number | null;
  projectName: string | null;
  /** e.g. "07:12–15:48". */
  timeLabel: string;
  /** Recorded duration in hours. */
  hours: number;
  /** Start/end minutes from midnight, clamped to the 06:00–18:00 window. */
  startMin: number;
  endMin: number;
}

export interface PlanboardDayRow {
  /** Partner id, or -1 for the "Ohne Zuordnung" row. */
  employeeId: number;
  employeeName: string;
  events: PlanboardDayEvent[];
  /** Recorded working times (Ist) for this employee on the day. */
  worked: PlanboardWorkedSegment[];
  /** Absences (vacation, sickness, …) for this employee on the day. */
  absences: PlanboardAbsence[];
}

export interface PlanboardDayData {
  /** yyyy-mm-dd (Luxembourg local date). */
  date: string;
  /** e.g. "Montag, 16.06.2026". */
  label: string;
  isToday: boolean;
  startHour: number;
  endHour: number;
  rows: PlanboardDayRow[];
}

/**
 * The HERO Plantafel for a single day as an employee × time matrix, with each
 * appointment placed on a 06:00–18:00 work-hours axis (times clamped to that
 * window). Events with no overlap in the window are omitted; all times use the
 * Europe/Luxembourg time zone.
 */
export async function getPlanboardDay(day: Date): Promise<PlanboardDayData> {
  const dayStart = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  );
  const dayEnd = addDays(dayStart, 1);
  const dayStr = localDateOf(dayStart.getTime());

  const nextDayStr = localDateOf(dayEnd.getTime());
  const [events, tracked, absences] = await Promise.all([
    getCalendarEvents(dayStart.toISOString(), dayEnd.toISOString()),
    getTrackingTimes(dayStr, nextDayStr),
    getAbsences(dayStr, dayStr),
  ]);

  const winStart = DAY_START_HOUR * 60;
  const winEnd = DAY_END_HOUR * 60;
  const clamp = (n: number) => Math.min(winEnd, Math.max(winStart, n));

  const byEmp = new Map<
    number,
    {
      name: string;
      events: PlanboardDayEvent[];
      worked: PlanboardWorkedSegment[];
      absences: PlanboardAbsence[];
    }
  >();
  const ensureRow = (id: number, name: string) => {
    let row = byEmp.get(id);
    if (!row) {
      row = { name, events: [], worked: [], absences: [] };
      byEmp.set(id, row);
    }
    return row;
  };

  for (const ev of events) {
    if (!ev.start || !ev.end) continue;
    const startMs = new Date(ev.start).getTime();
    const endMs = new Date(ev.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

    const startLocalDate = localDateOf(startMs);
    const endLocalDate = localDateOf(Math.max(startMs, endMs - 1));
    // Skip events that don't touch this calendar day at all.
    if (endLocalDate < dayStr || startLocalDate > dayStr) continue;

    const multiDay = startLocalDate !== endLocalDate;
    // Raw minutes within the day: events starting earlier / ending later or
    // spanning the whole day fill the window.
    let startMin: number;
    let endMin: number;
    if (ev.allDay || multiDay) {
      startMin = winStart;
      endMin = winEnd;
    } else {
      startMin = startLocalDate < dayStr ? 0 : hhmmToMin(localTimeFmt.format(new Date(startMs)));
      endMin = endLocalDate > dayStr ? 24 * 60 : hhmmToMin(localTimeFmt.format(new Date(endMs)));
    }

    // Drop appointments wholly outside the 06:00–18:00 work-hours window.
    if (endMin <= winStart || startMin >= winEnd) continue;

    const timeLabel =
      ev.allDay || multiDay
        ? "Ganztägig"
        : `${localTimeFmt.format(new Date(startMs))}–${localTimeFmt.format(new Date(endMs))}`;

    const targets =
      ev.partners.length > 0
        ? ev.partners.map((p) => ({ id: p.id, name: p.name }))
        : [{ id: UNASSIGNED_ID, name: "Ohne Zuordnung" }];

    const dayEvent: PlanboardDayEvent = {
      id: ev.id,
      title: ev.title?.trim() || "Termin",
      projectName: ev.projectName,
      projectRelativeId: ev.projectRelativeId,
      timeLabel,
      startMin: clamp(startMin),
      endMin: clamp(endMin),
    };
    for (const t of targets) ensureRow(t.id, t.name).events.push(dayEvent);
  }

  // Recorded working times (Ist) for the same day, on the same axis.
  for (const t of tracked) {
    if (!t.start || !t.end) continue;
    const startMs = new Date(t.start).getTime();
    const endMs = new Date(t.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    const startLocalDate = localDateOf(startMs);
    const endLocalDate = localDateOf(endMs - 1);
    if (endLocalDate < dayStr || startLocalDate > dayStr) continue;

    const startMin = startLocalDate < dayStr ? 0 : hhmmToMin(localTimeFmt.format(new Date(startMs)));
    const endMin = endLocalDate > dayStr ? 24 * 60 : hhmmToMin(localTimeFmt.format(new Date(endMs)));
    if (endMin <= winStart || startMin >= winEnd) continue;

    const segment: PlanboardWorkedSegment = {
      id: t.id,
      projectRelativeId: t.projectRelativeId,
      projectName: t.projectName,
      timeLabel: `${localTimeFmt.format(new Date(startMs))}–${localTimeFmt.format(new Date(endMs))}`,
      hours: t.durationHours,
      startMin: clamp(startMin),
      endMin: clamp(endMin),
    };
    const id = t.partnerId ?? UNASSIGNED_ID;
    ensureRow(id, t.partnerName).worked.push(segment);
  }

  for (const ab of absences) {
    if (dayStr < ab.start || dayStr > ab.end) continue;
    const half =
      (dayStr === ab.start && ab.startHalf) || (dayStr === ab.end && ab.endHalf);
    ensureRow(ab.partnerId, ab.partnerName).absences.push({
      category: absenceCategory(ab.type),
      label: absenceLabel(ab.type),
      half,
    });
  }

  const rows: PlanboardDayRow[] = [...byEmp.entries()]
    .map(([employeeId, v]) => {
      v.events.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title, "de"));
      v.worked.sort((a, b) => a.startMin - b.startMin);
      return {
        employeeId,
        employeeName: v.name,
        events: v.events,
        worked: v.worked,
        absences: v.absences,
      };
    })
    .sort((a, b) => {
      if (a.employeeId === UNASSIGNED_ID) return 1;
      if (b.employeeId === UNASSIGNED_ID) return -1;
      return a.employeeName.localeCompare(b.employeeName, "de");
    });

  return {
    date: dayStr,
    label: fullDayLabelFmt.format(dayStart),
    isToday: dayStr === localDateOf(Date.now()),
    startHour: DAY_START_HOUR,
    endHour: DAY_END_HOUR,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Planned man-hours for a project (sum of its calendar events).
// ---------------------------------------------------------------------------

/** One scheduled block of a project: when it is, how many man-hours, by whom. */
export interface PlannedEntry {
  id: number;
  /** e.g. "Mo 16.06.2026" or a "… – …" range for multi-day events. */
  dateLabel: string;
  /** Effective man-hours of this block (hours × assigned employees). */
  manHours: number;
  title: string;
  employees: string[];
}

/**
 * Total planned man-hours scheduled for a project plus a per-block breakdown
 * (when, how many hours): for each calendar event, its effective work hours
 * (weekday, capped at 8 h/day like the utilisation model) multiplied by the
 * number of assigned employees.
 */
export async function getProjectPlannedManHours(
  projectMatchId: number
): Promise<{ plannedHours: number; eventCount: number; entries: PlannedEntry[] }> {
  const events = await getCalendarEventsForProject(projectMatchId);
  let hours = 0;
  let eventCount = 0;
  const entries: { sort: number; entry: PlannedEntry }[] = [];
  for (const ev of events) {
    if (!ev.start || !ev.end) continue;
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) continue;
    const effectiveHours = eventHoursInRange(s, e, s, e);
    const manHours = round1(effectiveHours * ev.partners.length);
    hours += effectiveHours * ev.partners.length;
    eventCount++;

    const startDate = localDateOf(s.getTime());
    const endDate = localDateOf(e.getTime() - 1);
    const dateLabel =
      startDate === endDate
        ? entryDateFmt.format(s)
        : `${entryDateFmt.format(s)} – ${entryDateFmt.format(new Date(e.getTime() - 1))}`;

    entries.push({
      sort: s.getTime(),
      entry: {
        id: ev.id,
        dateLabel,
        manHours,
        title: ev.title?.trim() || "Termin",
        employees: ev.partners.map((p) => p.name),
      },
    });
  }
  entries.sort((a, b) => a.sort - b.sort);
  return {
    plannedHours: round1(hours),
    eventCount,
    entries: entries.map((x) => x.entry),
  };
}
