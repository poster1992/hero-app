"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listProjectsForSearch, type SearchProject } from "@/app/dashboard/search-actions";

export default function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<SearchProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const loadStarted = useRef(false);

  async function ensureLoaded() {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setLoading(true);
    try {
      setProjects(await listProjectsForSearch());
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !projects) return [];
    return projects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.customerName?.toLowerCase().includes(q) ?? false) ||
          (p.relativeId != null && String(p.relativeId).includes(q))
      )
      .slice(0, 8);
  }, [query, projects]);

  function select(p: SearchProject) {
    setQuery("");
    setFocused(false);
    router.push(`/dashboard/projekte?q=${encodeURIComponent(p.name)}`);
  }

  return (
    <div className="relative w-full max-w-md">
      <input
        type="text"
        value={query}
        onFocus={() => {
          setFocused(true);
          void ensureLoaded();
        }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Projekt suchen (Name, Kunde oder Nummer) …"
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
      />
      {focused && query.trim() && (
        <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {loading ? (
            <li className="px-3 py-2 text-sm text-gray-400">Lade Projekte …</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">Keine Projekte gefunden.</li>
          ) : (
            matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(p)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-gray-100"
                >
                  <span className="font-medium text-gray-900">
                    {p.relativeId != null && <span className="text-gray-500">#{p.relativeId} </span>}
                    {p.name}
                  </span>
                  {p.customerName && (
                    <span className="text-xs text-gray-500">{p.customerName}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
