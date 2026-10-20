"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listProjectsForSearch,
  searchBelegeGlobalAction,
  searchDocumentsGlobalAction,
  getGlobalBelegFileUrlAction,
  type SearchProject,
  type GlobalSearchReceipt,
  type GlobalSearchDocument,
} from "@/app/dashboard/search-actions";

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

const DOC_KIND_LABEL: Record<GlobalSearchDocument["kind"], string> = {
  angebote: "Angebot",
  auftraege: "Auftrag",
  rechnungen: "Rechnung",
};

export default function GlobalSearch({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<SearchProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const loadStarted = useRef(false);

  // Admin-only: Belege/Dokumente – teure HERO-Abfragen, daher erst nach einer
  // Tippause (nicht bei jedem Tastendruck) und nur ab 2 Zeichen.
  const [belege, setBelege] = useState<GlobalSearchReceipt[]>([]);
  const [documents, setDocuments] = useState<GlobalSearchDocument[]>([]);
  const [searchingExtra, setSearchingExtra] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!isAdmin) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setBelege([]);
      setDocuments([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearchingExtra(true);
      Promise.all([searchBelegeGlobalAction(q), searchDocumentsGlobalAction(q)])
        .then(([r, d]) => {
          setBelege(r);
          setDocuments(d);
        })
        .catch(() => {
          setBelege([]);
          setDocuments([]);
        })
        .finally(() => setSearchingExtra(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isAdmin]);

  function select(p: SearchProject) {
    setQuery("");
    setFocused(false);
    router.push(`/dashboard/projekte?q=${encodeURIComponent(p.name)}`);
  }

  /** Öffnet den Beleg direkt (neuer Tab sofort geöffnet, URL erst nach Auflösung gesetzt – umgeht Popup-Blocker). */
  function selectBeleg(r: GlobalSearchReceipt) {
    setQuery("");
    setFocused(false);
    const win = window.open("", "_blank");
    getGlobalBelegFileUrlAction(r.kind, r.ref).then((res) => {
      if (res.url && win) win.location.href = res.url;
      else if (win) win.close();
      if (res.error && !res.url) alert(res.error);
    });
  }

  function selectDocument(d: GlobalSearchDocument) {
    const q = query.trim();
    setQuery("");
    setFocused(false);
    router.push(`/dashboard/dokumente/${d.kind}?search=${encodeURIComponent(q)}`);
  }

  const hasExtraResults = isAdmin && query.trim().length >= 2;

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
        <ul className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
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
                  {p.customerName && <span className="text-xs text-gray-500">{p.customerName}</span>}
                </button>
              </li>
            ))
          )}

          {hasExtraResults && (
            <>
              <li className="border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Belege {searchingExtra && "· sucht …"}
              </li>
              {belege.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-400">
                  {searchingExtra ? "Sucht …" : "Keine Belege gefunden."}
                </li>
              ) : (
                belege.map((r) => (
                  <li key={`${r.kind}-${r.ref}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectBeleg(r)}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-gray-100"
                    >
                      <span className="font-medium text-gray-900">
                        {r.supplier ?? "Unbekannt"}
                        {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}
                      </span>
                      <span className="text-xs text-gray-500">
                        {r.date ? r.date.split("-").reverse().join(".") : "—"} · {fmtEur(r.gross)}
                      </span>
                    </button>
                  </li>
                ))
              )}

              <li className="border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Dokumente {searchingExtra && "· sucht …"}
              </li>
              {documents.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-400">
                  {searchingExtra ? "Sucht …" : "Keine Dokumente gefunden."}
                </li>
              ) : (
                documents.map((d) => (
                  <li key={`${d.kind}-${d.id}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectDocument(d)}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-gray-100"
                    >
                      <span className="font-medium text-gray-900">
                        {DOC_KIND_LABEL[d.kind]} {d.number}
                      </span>
                      <span className="text-xs text-gray-500">
                        {d.customerName ?? "—"} · {d.date ? d.date.split("-").reverse().join(".") : "—"} ·{" "}
                        {fmtEur(d.gross)}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
