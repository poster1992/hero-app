/**
 * Deterministic colour assignment for Plantafel appointments. The same key
 * (typically a project) always maps to the same colour, so a job is visually
 * recognisable across the week view, the day view and all employee rows.
 *
 * Tailwind v4 scans source for class literals, so every class string used here
 * is written out in full (no dynamic `bg-${x}` interpolation).
 */
export interface PlanboardColor {
  /** Solid background for day-view bars (paired with white text). */
  bar: string;
  /** Light background tint for week-view cards. */
  tint: string;
  /** Border colour for week-view cards. */
  border: string;
  /** Accent text colour (e.g. the time label). */
  text: string;
}

const PALETTE: PlanboardColor[] = [
  { bar: "bg-blue-600", tint: "bg-blue-50", border: "border-blue-300", text: "text-blue-700" },
  { bar: "bg-emerald-600", tint: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700" },
  { bar: "bg-amber-600", tint: "bg-amber-50", border: "border-amber-300", text: "text-amber-700" },
  { bar: "bg-violet-600", tint: "bg-violet-50", border: "border-violet-300", text: "text-violet-700" },
  { bar: "bg-rose-600", tint: "bg-rose-50", border: "border-rose-300", text: "text-rose-700" },
  { bar: "bg-cyan-600", tint: "bg-cyan-50", border: "border-cyan-300", text: "text-cyan-700" },
  { bar: "bg-orange-600", tint: "bg-orange-50", border: "border-orange-300", text: "text-orange-700" },
  { bar: "bg-teal-600", tint: "bg-teal-50", border: "border-teal-300", text: "text-teal-700" },
  { bar: "bg-fuchsia-600", tint: "bg-fuchsia-50", border: "border-fuchsia-300", text: "text-fuchsia-700" },
  { bar: "bg-indigo-600", tint: "bg-indigo-50", border: "border-indigo-300", text: "text-indigo-700" },
  { bar: "bg-lime-600", tint: "bg-lime-50", border: "border-lime-300", text: "text-lime-700" },
  { bar: "bg-sky-600", tint: "bg-sky-50", border: "border-sky-300", text: "text-sky-700" },
];

/** Stable colour for a key (project id/name, or any string). */
export function planboardColor(key: string | number | null | undefined): PlanboardColor {
  const s = key == null || key === "" ? "default" : String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Visual style for an absence band/badge, keyed by category. */
export function absenceStyle(category: "sick" | "vacation" | "other"): {
  band: string;
  dot: string;
} {
  switch (category) {
    case "sick":
      return { band: "border-rose-300 bg-rose-100 text-rose-700", dot: "bg-rose-400" };
    case "vacation":
      return { band: "border-amber-300 bg-amber-100 text-amber-700", dot: "bg-amber-400" };
    default:
      return { band: "border-gray-300 bg-gray-100 text-gray-600", dot: "bg-gray-400" };
  }
}

/** The key an appointment is coloured by: its project, else its title. */
export function planboardColorKey(ev: {
  projectRelativeId: number | null;
  projectName: string | null;
  title: string;
}): string {
  if (ev.projectRelativeId != null) return `p:${ev.projectRelativeId}`;
  if (ev.projectName) return `n:${ev.projectName}`;
  return `t:${ev.title}`;
}
