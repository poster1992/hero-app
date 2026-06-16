import Link from "next/link";
import { MONTH_LABELS_SHORT } from "@/lib/invoices";

export default function MonthTabs({
  year,
  month,
  basePath,
  counts,
  view,
}: {
  year: number;
  month: number;
  basePath: string;
  counts?: number[];
  view?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MONTH_LABELS_SHORT.map((label, i) => {
        const m = i + 1;
        const active = m === month;
        return (
          <Link
            key={m}
            href={`${basePath}?year=${year}&month=${m}${view ? `&view=${view}` : ""}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-brand-red text-white shadow-[0_0_20px_-6px_rgba(232,57,42,0.8)]"
                : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
            }`}
          >
            {label}
            {counts && counts[i] > 0 && (
              <span className={active ? "ml-1.5 text-xs text-white/70" : "ml-1.5 text-xs text-gray-500"}>
                {counts[i]}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
