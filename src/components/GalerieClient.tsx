"use client";

import { useMemo, useState } from "react";
import type { ProjectSummary } from "@/lib/hero-api";
import { getGalleryPhotosAction, type ProjectPhoto } from "@/app/dashboard/galerie/actions";
import PhotoGallery from "@/components/PhotoGallery";

/** Bulk-"Alle anzeigen" nur bei einer überschaubaren gefilterten Trefferzahl – sonst zu viele parallele HERO-Abfragen auf einmal. */
const BULK_EXPAND_LIMIT = 25;

export default function GalerieClient({ projects }: { projects: ProjectSummary[] }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [photosByProject, setPhotosByProject] = useState<Record<number, ProjectPhoto[]>>({});
  const [loading, setLoading] = useState<Set<number>>(new Set());

  // Neueste Projekte zuerst (höhere HERO-ID = später angelegt).
  const sorted = useMemo(() => [...projects].sort((a, b) => b.id - a.id), [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.customerName ?? "").toLowerCase().includes(q) ||
        (p.relativeId != null && String(p.relativeId).includes(q))
    );
  }, [sorted, query]);

  const loadPhotos = (projectId: number) => {
    if (photosByProject[projectId] || loading.has(projectId)) return;
    setLoading((prev) => new Set(prev).add(projectId));
    getGalleryPhotosAction(projectId)
      .then((photos) => setPhotosByProject((prev) => ({ ...prev, [projectId]: photos })))
      .catch(() => setPhotosByProject((prev) => ({ ...prev, [projectId]: [] })))
      .finally(() =>
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(projectId);
          return next;
        })
      );
  };

  const toggle = (projectId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        loadPhotos(projectId);
      }
      return next;
    });
  };

  const expandAllFiltered = () => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of filtered) next.add(p.id);
      return next;
    });
    for (const p of filtered) loadPhotos(p.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Projekt, Kunde oder Nummer suchen …"
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60 sm:w-auto"
        />
        <span className="text-xs text-gray-500">
          {filtered.length} von {projects.length} Projekten
        </span>
        {filtered.length > 0 && filtered.length <= BULK_EXPAND_LIMIT && (
          <button
            type="button"
            onClick={expandAllFiltered}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-brand-red/50 hover:text-gray-900"
          >
            📷 Alle anzeigen
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-gray-200 px-3 py-6 text-center text-sm text-gray-400">
          Keine Projekte gefunden.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((p) => {
            const isOpen = expanded.has(p.id);
            const photos = photosByProject[p.id];
            const isLoading = loading.has(p.id);
            return (
              <div key={p.id} className="rounded-md border border-gray-200">
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    {p.customerName && <span className="text-gray-500"> — {p.customerName}</span>}
                    {p.relativeId != null && <span className="ml-1 text-gray-400">#{p.relativeId}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {photos
                      ? `${photos.length} Foto${photos.length === 1 ? "" : "s"}`
                      : isLoading
                        ? "Lädt …"
                        : isOpen
                          ? "–"
                          : "+"}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    {isLoading ? (
                      <p className="py-4 text-center text-sm text-gray-400">Fotos werden geladen …</p>
                    ) : photos && photos.length > 0 ? (
                      <PhotoGallery photos={photos} />
                    ) : (
                      <p className="py-4 text-center text-sm text-gray-400">Keine Fotos zu diesem Projekt.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
