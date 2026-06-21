"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ProjectDetailModal from "@/components/ProjectDetailModal";

export interface ProjectRow {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
  status: string | null;
  confirmationNet: number;
  confirmationDate: string | null;
  invoiceNet: number;
  costNet: number;
  hours: number;
  calcHours: number;
  calcMaterial: number;
  sollLabor: number;
}

const hoursFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("de-DE");

/** Leading emoji of a status label (e.g. "🔓 Angebot offen" → "🔓"); falls back to full text. */
function statusSymbol(status: string): string {
  const m = status.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/u);
  return m ? m[1] : status;
}

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const STATUS_FILTERS: { key: string; label: string; needles: string[] | null }[] = [
  { key: "all", label: "Alle", needles: null },
  {
    key: "laufend",
    label: "Laufende Projekte",
    needles: [
      "auftragsbestätigung",
      "arbeitsplanung",
      "materialbestellung",
      "montage-doku",
      "laufende projekte",
      "schlussrechnung",
    ],
  },
  { key: "abgeschlossen", label: "Abgeschlossene Projekte", needles: ["abgeschlossen"] },
  { key: "nachkalkulation", label: "Nachkalkulation", needles: ["nachkalkulation"] },
];

export default function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [detail, setDetail] = useState<ProjectRow | null>(null);

  const sortBy = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Verfügbare Jahre aus dem AB-Datum (absteigend).
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      if (p.confirmationDate) set.add(p.confirmationDate.slice(0, 4));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const needles = STATUS_FILTERS.find((f) => f.key === statusFilter)?.needles ?? null;
    return projects.filter((p) => {
      if (
        q &&
        ![
          p.name,
          p.customerName ?? "",
          p.status ?? "",
          p.relativeId != null ? String(p.relativeId) : "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      if (needles) {
        const st = (p.status ?? "").toLowerCase();
        if (!needles.some((n) => st.includes(n))) return false;
      }
      if (yearFilter !== "all") {
        if (!p.confirmationDate || p.confirmationDate.slice(0, 4) !== yearFilter) return false;
      }
      return true;
    });
  }, [projects, search, statusFilter, yearFilter]);

  const confirmationTotal = useMemo(
    () => filtered.reduce((s, p) => s + p.confirmationNet, 0),
    [filtered]
  );
  const invoiceTotal = useMemo(
    () => filtered.reduce((s, p) => s + p.invoiceNet, 0),
    [filtered]
  );
  // Offen = Auftragsbestätigung − Rechnungen, nie negativ (auf 0 begrenzt):
  // weder bei fehlender Auftragsbestätigung noch wenn die Rechnung größer ist.
  const openOf = (p: ProjectRow) => Math.max(0, p.confirmationNet - p.invoiceNet);
  const openTotal = useMemo(() => filtered.reduce((s, p) => s + openOf(p), 0), [filtered]);
  const costTotal = useMemo(() => filtered.reduce((s, p) => s + p.costNet, 0), [filtered]);
  const hoursTotal = useMemo(() => filtered.reduce((s, p) => s + p.hours, 0), [filtered]);
  const calcHoursTotal = useMemo(() => filtered.reduce((s, p) => s + p.calcHours, 0), [filtered]);
  const calcMaterialTotal = useMemo(
    () => filtered.reduce((s, p) => s + p.calcMaterial, 0),
    [filtered]
  );
  // Durchschnittslohnsatz (€/h) = Soll-Lohnkosten / Kalk. Stunden; Ist-Lohn = Ist-Stunden × Satz.
  const rateOf = (p: ProjectRow) => (p.calcHours > 0 ? p.sollLabor / p.calcHours : 0);
  const istLaborOf = (p: ProjectRow) => p.hours * rateOf(p);
  const sollLaborTotal = useMemo(() => filtered.reduce((s, p) => s + p.sollLabor, 0), [filtered]);
  const istLaborTotal = useMemo(() => filtered.reduce((s, p) => s + istLaborOf(p), 0), [filtered]);
  // Ertrag (Deckungsbeitrag): Soll = AB − Kalk.Material − Soll-Lohn; Ist = REC − Ist-Material − Ist-Lohn.
  const sollErtragOf = (p: ProjectRow) => p.confirmationNet - p.calcMaterial - p.sollLabor;
  const istErtragOf = (p: ProjectRow) => p.invoiceNet - p.costNet - istLaborOf(p);

  // Sortierwert je Spalte (Zahlen numerisch, Texte alphabetisch).
  const sortValue = (p: ProjectRow, key: string): number | string => {
    switch (key) {
      case "nr": return p.relativeId ?? -Infinity;
      case "name": return p.name ?? "";
      case "customer": return p.customerName ?? "";
      case "status": return p.status ?? "";
      case "date": return p.confirmationDate ?? "";
      case "ab": return p.confirmationNet;
      case "rec": return p.invoiceNet;
      case "offen": return openOf(p);
      case "calcMaterial": return p.calcMaterial;
      case "istMaterial": return p.costNet;
      case "restMaterial": return p.calcMaterial - p.costNet;
      case "calcHours": return p.calcHours;
      case "hours": return p.hours;
      case "restHours": return p.calcHours - p.hours;
      case "sollLabor": return p.sollLabor;
      case "istLabor": return istLaborOf(p);
      case "rate": return rateOf(p);
      case "sollErtrag": return sollErtragOf(p);
      case "istErtrag": return istErtragOf(p);
      default: return 0;
    }
  };

  // Sortierung nach beliebiger Spalte (auf-/absteigend); ohne Auswahl Originalreihenfolge.
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "de") * dir;
      }
      return (va - vb) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir]);

  // Sortierbarer Spaltenkopf.
  const Th = ({
    k,
    label,
    cls = "",
    center = false,
  }: {
    k: string;
    label: string;
    cls?: string;
    center?: boolean;
  }) => (
    <th className={`px-3 py-2 font-medium ${center ? "text-center" : ""} ${cls}`}>
      <button
        type="button"
        onClick={() => sortBy(k)}
        className="inline-flex items-center gap-1 transition-colors hover:text-gray-900"
      >
        {label}
        <span className="text-gray-400">
          {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Projekte durchsuchen (Nr., Name, Kunde, Status)…"
        className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = f.key === statusFilter;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-red text-white shadow-[0_0_20px_-6px_rgba(232,57,42,0.8)]"
                  : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
              }`}
            >
              {f.label}
            </button>
          );
        })}

        {years.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-2">
            {["all", ...years].map((y) => {
              const active = y === yearFilter;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYearFilter(y)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-brand-red text-white shadow-[0_0_20px_-6px_rgba(232,57,42,0.8)]"
                      : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
                  }`}
                >
                  {y === "all" ? "Alle Jahre" : y}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Projekte</h2>
          <p className="text-sm text-gray-600">{filtered.length} Projekte</p>
        </div>

        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">Keine Projekte gefunden.</p>
        ) : (
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-xs">
            <colgroup>
              <col style={{ width: "3%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "4%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "4%" }} />
              <col style={{ width: "4%" }} />
              <col style={{ width: "4%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "4%" }} />
              <col style={{ width: "4%" }} />
              <col style={{ width: "4%" }} />
            </colgroup>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-gray-300 [&>th]:bg-gray-100">
                <Th k="nr" label="Nr." />
                <Th k="name" label="Projekt" />
                <Th k="customer" label="Kunde" />
                <Th k="status" label="Status" center />
                <Th k="date" label="AB-Datum" />
                <Th k="ab" label="AB" cls="text-right" />
                <Th k="rec" label="REC" cls="text-right" />
                <Th k="offen" label="Offen (netto)" cls="text-right" />
                <Th k="calcMaterial" label="Kalk. Material" cls="border-l-2 border-gray-300 text-right" />
                <Th k="istMaterial" label="Ist Material" cls="text-right" />
                <Th k="restMaterial" label="Rest Material" cls="text-right" />
                <Th k="calcHours" label="Kalk. Stunden" cls="border-l-2 border-gray-300 text-right" />
                <Th k="hours" label="Stunden" cls="text-right" />
                <Th k="restHours" label="Rest Stunden" cls="text-right" />
                <Th k="sollLabor" label="Soll Lohnkosten" cls="border-l-2 border-gray-300 text-right" />
                <Th k="istLabor" label="Ist Lohnkosten" cls="text-right" />
                <Th k="rate" label="Ø Lohnsatz" cls="text-right" />
                <Th k="sollErtrag" label="Soll Ertrag" cls="border-l-2 border-gray-300 text-right" />
                <Th k="istErtrag" label="Ist Ertrag" cls="text-right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-200 last:border-0 hover:bg-gray-100"
                >
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => setDetail(p)}
                      className="font-medium text-brand-red transition-colors hover:text-brand-red-dark hover:underline"
                      title="Details anzeigen"
                    >
                      {p.relativeId ?? "—"}
                    </button>
                  </td>
                  <td className="px-3 py-2 align-top font-medium text-gray-800">
                    {p.name || "—"}
                  </td>
                  <td className="px-3 py-2 align-top break-words text-gray-700">
                    {p.customerName ?? "—"}
                  </td>
                  <td
                    className="cursor-default px-3 py-2 align-top text-center text-base text-gray-700"
                    title={p.status ?? undefined}
                  >
                    {p.status ? statusSymbol(p.status) : "—"}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap text-gray-600">
                    {p.confirmationDate ? dateFormatter.format(new Date(p.confirmationDate)) : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {p.confirmationNet !== 0 ? currencyFormatter.format(p.confirmationNet) : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {p.invoiceNet !== 0 ? currencyFormatter.format(p.invoiceNet) : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap font-medium text-gray-900">
                    {openOf(p) > 0
                      ? currencyFormatter.format(openOf(p))
                      : p.confirmationNet !== 0 || p.invoiceNet !== 0
                        ? currencyFormatter.format(0)
                        : "—"}
                  </td>
                  <td className="border-l-2 border-gray-300 px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {p.calcMaterial !== 0 ? currencyFormatter.format(p.calcMaterial) : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {p.costNet !== 0 ? currencyFormatter.format(p.costNet) : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 align-top text-right whitespace-nowrap font-medium ${
                      p.calcMaterial === 0 && p.costNet === 0
                        ? "text-gray-500"
                        : p.calcMaterial - p.costNet < 0
                          ? "text-brand-red"
                          : "text-emerald-600"
                    }`}
                  >
                    {p.calcMaterial === 0 && p.costNet === 0
                      ? "—"
                      : currencyFormatter.format(p.calcMaterial - p.costNet)}
                  </td>
                  <td className="border-l-2 border-gray-300 px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {p.calcHours > 0 ? `${hoursFormatter.format(p.calcHours)} h` : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {p.hours > 0 ? `${hoursFormatter.format(p.hours)} h` : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 align-top text-right whitespace-nowrap font-medium ${
                      p.calcHours === 0 && p.hours === 0
                        ? "text-gray-500"
                        : p.calcHours - p.hours < 0
                          ? "text-brand-red"
                          : "text-emerald-600"
                    }`}
                  >
                    {p.calcHours === 0 && p.hours === 0
                      ? "—"
                      : `${hoursFormatter.format(p.calcHours - p.hours)} h`}
                  </td>
                  <td className="border-l-2 border-gray-300 px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {p.sollLabor !== 0 ? currencyFormatter.format(p.sollLabor) : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap text-gray-800">
                    {istLaborOf(p) > 0 ? currencyFormatter.format(istLaborOf(p)) : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap text-gray-700">
                    {rateOf(p) > 0 ? `${currencyFormatter.format(rateOf(p))}/h` : "—"}
                  </td>
                  <td
                    className={`border-l-2 border-gray-300 px-3 py-2 align-top text-right whitespace-nowrap font-medium ${
                      p.confirmationNet === 0 && p.calcMaterial === 0 && p.sollLabor === 0
                        ? "text-gray-500"
                        : sollErtragOf(p) < 0
                          ? "text-brand-red"
                          : "text-emerald-600"
                    }`}
                  >
                    {p.confirmationNet === 0 && p.calcMaterial === 0 && p.sollLabor === 0
                      ? "—"
                      : currencyFormatter.format(sollErtragOf(p))}
                  </td>
                  <td
                    className={`px-3 py-2 align-top text-right whitespace-nowrap font-medium ${
                      p.invoiceNet === 0 && p.costNet === 0 && istLaborOf(p) === 0
                        ? "text-gray-500"
                        : istErtragOf(p) < 0
                          ? "text-brand-red"
                          : "text-emerald-600"
                    }`}
                  >
                    {p.invoiceNet === 0 && p.costNet === 0 && istLaborOf(p) === 0
                      ? "—"
                      : currencyFormatter.format(istErtragOf(p))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-300 text-sm font-semibold text-gray-900">
                <td className="px-3 py-2" colSpan={4}>
                  Summe
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {currencyFormatter.format(confirmationTotal)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {currencyFormatter.format(invoiceTotal)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {currencyFormatter.format(openTotal)}
                </td>
                <td className="border-l-2 border-gray-300 px-3 py-2 text-right whitespace-nowrap">
                  {currencyFormatter.format(calcMaterialTotal)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {currencyFormatter.format(costTotal)}
                </td>
                <td
                  className={`px-3 py-2 text-right whitespace-nowrap ${
                    calcMaterialTotal - costTotal < 0 ? "text-brand-red" : "text-emerald-600"
                  }`}
                >
                  {currencyFormatter.format(calcMaterialTotal - costTotal)}
                </td>
                <td className="border-l-2 border-gray-300 px-3 py-2 text-right whitespace-nowrap">
                  {hoursFormatter.format(calcHoursTotal)} h
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {hoursFormatter.format(hoursTotal)} h
                </td>
                <td
                  className={`px-3 py-2 text-right whitespace-nowrap ${
                    calcHoursTotal - hoursTotal < 0 ? "text-brand-red" : "text-emerald-600"
                  }`}
                >
                  {hoursFormatter.format(calcHoursTotal - hoursTotal)} h
                </td>
                <td className="border-l-2 border-gray-300 px-3 py-2 text-right whitespace-nowrap">
                  {currencyFormatter.format(sollLaborTotal)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {currencyFormatter.format(istLaborTotal)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {calcHoursTotal > 0
                    ? `${currencyFormatter.format(sollLaborTotal / calcHoursTotal)}/h`
                    : "—"}
                </td>
                {(() => {
                  const sollErtragTotal = confirmationTotal - calcMaterialTotal - sollLaborTotal;
                  const istErtragTotal = invoiceTotal - costTotal - istLaborTotal;
                  return (
                    <>
                      <td
                        className={`border-l-2 border-gray-300 px-3 py-2 text-right whitespace-nowrap ${
                          sollErtragTotal < 0 ? "text-brand-red" : "text-emerald-600"
                        }`}
                      >
                        {currencyFormatter.format(sollErtragTotal)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right whitespace-nowrap ${
                          istErtragTotal < 0 ? "text-brand-red" : "text-emerald-600"
                        }`}
                      >
                        {currencyFormatter.format(istErtragTotal)}
                      </td>
                    </>
                  );
                })()}
              </tr>
            </tfoot>
          </table>
          </div>
        )}
      </div>

      <ProjectDetailModal project={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
