import Link from "next/link";

export default function YearSelector({
  year,
  basePath,
  extraParams,
}: {
  year: number;
  basePath: string;
  extraParams?: Record<string, string | undefined>;
}) {
  const currentYear = new Date().getUTCFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  const buildHref = (y: number) => {
    const params = new URLSearchParams();
    params.set("year", String(y));
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      if (value != null) params.set(key, value);
    }
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="flex gap-2">
      {yearOptions.map((y) => (
        <Link
          key={y}
          href={buildHref(y)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            y === year
              ? "bg-brand-red text-white shadow-[0_0_20px_-6px_rgba(232,57,42,0.8)]"
              : "border border-gray-300 text-gray-600 hover:border-brand-red/50 hover:text-gray-900"
          }`}
        >
          {y}
        </Link>
      ))}
    </div>
  );
}
