import { getCalendarEvents, getAbsences } from "./hero-api";
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
