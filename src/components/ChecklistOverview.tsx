import Link from "next/link";
import type { ChecklistMonthOpen } from "@/lib/belege-checklist";

export default function ChecklistOverview({
  year,
  months,
}: {
  year: number;
  months: ChecklistMonthOpen[];
}) {
  const hasItems = months.some((m) => m.total > 0);
  const totalOpen = months.reduce((s, m) => s + m.openItems.length, 0);

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-900">Offene Beleg-Checkliste {year}</h2>
        <span className="text-sm text-gray-600">{totalOpen} offen</span>
      </div>

      {!hasItems ? (
        <p className="py-4 text-sm text-gray-500">
          Noch keine Checklisten-Punkte angelegt. Unter{" "}
          <Link href="/dashboard/belege" className="text-brand-red hover:underline">
            Belege
          </Link>{" "}
          wiederkehrende Belege hinzufügen.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {months.map((m) => {
            const done = m.openItems.length === 0;
            return (
              <Link
                key={m.month}
                href={`/dashboard/belege?view=month&year=${year}&month=${m.month}`}
                className={`block rounded-lg border p-3 transition-colors ${
                  done
                    ? "border-emerald-200 bg-emerald-50 hover:border-emerald-300"
                    : "border-gray-200 bg-gray-50 hover:border-brand-red/40 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{m.label}</span>
                  {done ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      erledigt ✓
                    </span>
                  ) : (
                    <span className="rounded-full bg-brand-red/10 px-2 py-0.5 text-xs font-medium text-brand-red">
                      {m.openItems.length} offen
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
