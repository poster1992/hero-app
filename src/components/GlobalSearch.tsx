"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
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
import { deleteBelegAction, loadBelegEditDataAction, type BelegEditData } from "@/app/dashboard/belege/manual-actions";
import BelegDetailModal from "@/components/BelegDetailModal";
import ReceiptHistoryModal from "@/components/ReceiptHistoryModal";

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Hängt &download=1 an eine bereits mit ?… versehene Beleg-URL an. */
function withDownload(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
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

  // Rechtsklick-Kontextmenü auf einem Beleg-Treffer (Ansehen/Download/Bearbeiten/Historie/Löschen).
  const [menu, setMenu] = useState<{ item: GlobalSearchReceipt; x: number; y: number } | null>(null);
  const [historyFor, setHistoryFor] = useState<{
    kind: "manual" | "hero";
    id: number | string;
    title: string;
    subtitle: string;
  } | null>(null);
  const [editBelegId, setEditBelegId] = useState<number | null>(null);
  const [belegEdit, setBelegEdit] = useState<BelegEditData | null>(null);
  const [belegEditLoading, setBelegEditLoading] = useState(false);
  const [deletePending, startDelete] = useTransition();

  useEffect(() => {
    if (editBelegId == null) return;
    let cancelled = false;
    setBelegEditLoading(true);
    loadBelegEditDataAction(editBelegId)
      .then((d) => {
        if (!cancelled) setBelegEdit(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBelegEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editBelegId]);

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
  function openBeleg(r: GlobalSearchReceipt, download = false) {
    const win = window.open("", "_blank");
    getGlobalBelegFileUrlAction(r.kind, r.ref).then((res) => {
      if (res.url && win) win.location.href = download ? withDownload(res.url) : res.url;
      else if (win) win.close();
      if (res.error && !res.url) alert(res.error);
    });
  }

  function selectBeleg(r: GlobalSearchReceipt) {
    setQuery("");
    setFocused(false);
    openBeleg(r);
  }

  function openBelegMenu(e: MouseEvent, r: GlobalSearchReceipt) {
    e.preventDefault();
    setMenu({ item: r, x: e.clientX, y: e.clientY });
  }

  function doDeleteBeleg(r: GlobalSearchReceipt) {
    setMenu(null);
    const label = r.supplier ?? `Beleg ${r.ref}`;
    if (!window.confirm(`Beleg „${label}" (#${r.ref}) wirklich löschen?`)) return;
    const fd = new FormData();
    fd.set("id", r.ref);
    startDelete(async () => {
      await deleteBelegAction(fd);
      setBelege((prev) => prev.filter((x) => !(x.kind === "manual" && x.ref === r.ref)));
      router.refresh();
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
                      onContextMenu={(e) => openBelegMenu(e, r)}
                      title="Klick: öffnen · Rechtsklick: weitere Aktionen"
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

      {/* Rechtsklick-Kontextmenü eines Beleg-Treffers. */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              type="button"
              onClick={() => {
                openBeleg(menu.item);
                setMenu(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              👁 Ansehen
            </button>
            <button
              type="button"
              onClick={() => {
                openBeleg(menu.item, true);
                setMenu(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              ⬇ Download
            </button>
            {menu.item.kind === "manual" && (
              <button
                type="button"
                onClick={() => {
                  setEditBelegId(Number(menu.item.ref));
                  setMenu(null);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                ✏️ Bearbeiten
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setHistoryFor({
                  kind: menu.item.kind,
                  id: menu.item.kind === "manual" ? Number(menu.item.ref) : menu.item.ref,
                  title: menu.item.kind === "manual" ? `Beleg #${menu.item.ref}` : `HERO-Beleg ${menu.item.invoiceNumber || menu.item.ref}`,
                  subtitle: [
                    menu.item.supplier,
                    menu.item.invoiceNumber ? `Nr. ${menu.item.invoiceNumber}` : null,
                    fmtEur(menu.item.gross),
                  ]
                    .filter(Boolean)
                    .join(" · "),
                });
                setMenu(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              🕘 Historie
            </button>
            {menu.item.kind === "manual" && (
              <button
                type="button"
                disabled={deletePending}
                onClick={() => doDeleteBeleg(menu.item)}
                className="block w-full px-3 py-2 text-left text-sm font-medium text-brand-red hover:bg-gray-50 disabled:opacity-50"
              >
                🗑 Löschen
              </button>
            )}
          </div>
        </>
      )}

      {historyFor && (
        <ReceiptHistoryModal
          kind={historyFor.kind}
          receiptId={historyFor.id}
          title={historyFor.title}
          subtitle={historyFor.subtitle}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {editBelegId != null && (
        <>
          {belegEditLoading && !belegEdit?.receipt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
              <span className="rounded-md bg-white px-4 py-2 text-sm text-gray-700 shadow-xl">Lädt …</span>
            </div>
          )}
          {belegEdit?.receipt && (
            <BelegDetailModal
              belegId={editBelegId}
              receipt={belegEdit.receipt}
              accounts={belegEdit.accounts}
              projects={belegEdit.projects}
              suppliers={belegEdit.suppliers}
              hasFile={belegEdit.receipt.fileName != null}
              onClose={() => {
                setEditBelegId(null);
                setBelegEdit(null);
                router.refresh();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
