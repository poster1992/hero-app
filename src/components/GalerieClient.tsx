"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary, ProjectPhoto } from "@/lib/hero-api";
import { getGalleryPhotosAction } from "@/app/dashboard/galerie/actions";
import PhotoGallery from "@/components/PhotoGallery";

/** Wie viele Projekte gleichzeitig abgefragt werden – 371 Projekte à ~250ms dauern damit nur wenige Sekunden. */
const CONCURRENCY = 12;
/** Wie oft neu eingetroffene Fotos ins UI übernommen werden (ms) – vermeidet 300+ einzelne Re-Renders. */
const FLUSH_INTERVAL_MS = 250;

interface GalleryPhoto extends ProjectPhoto {
  projectId: number;
  projectName: string;
  projectRelativeId: number | null;
  projectCustomerName: string | null;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let idx = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

export default function GalerieClient({ projects }: { projects: ProjectSummary[] }) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: projects.length });
  const [finished, setFinished] = useState(false);
  const [query, setQuery] = useState("");
  const bufferRef = useRef<GalleryPhoto[]>([]);

  useEffect(() => {
    let cancelled = false;
    bufferRef.current = [];

    const flush = () => {
      if (cancelled || bufferRef.current.length === 0) return;
      const toAdd = bufferRef.current;
      bufferRef.current = [];
      setPhotos((prev) => {
        const next = [...prev, ...toAdd];
        next.sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
        return next;
      });
    };
    const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

    // Neueste Projekte zuerst abfragen (höhere HERO-ID = später angelegt) – so
    // tauchen zuerst wahrscheinlich aktuelle Fotos auf, während im Hintergrund
    // noch weiter geladen wird.
    const sorted = [...projects].sort((a, b) => b.id - a.id);
    let done = 0;

    runPool(sorted, CONCURRENCY, async (p) => {
      try {
        const projectPhotos = await getGalleryPhotosAction(p.id);
        for (const ph of projectPhotos) {
          bufferRef.current.push({
            ...ph,
            projectId: p.id,
            projectName: p.name,
            projectRelativeId: p.relativeId,
            projectCustomerName: p.customerName,
          });
        }
      } catch {
        // Einzelnes Projekt übersprungen – der Rest lädt trotzdem weiter.
      } finally {
        done++;
        if (!cancelled) setProgress({ done, total: sorted.length });
      }
    }).then(() => {
      flush();
      clearInterval(flushTimer);
      if (!cancelled) setFinished(true);
    });

    return () => {
      cancelled = true;
      clearInterval(flushTimer);
    };
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return photos;
    return photos.filter(
      (p) =>
        p.projectName.toLowerCase().includes(q) ||
        (p.projectCustomerName ?? "").toLowerCase().includes(q) ||
        (p.projectRelativeId != null && String(p.projectRelativeId).includes(q)) ||
        p.filename.toLowerCase().includes(q)
    );
  }, [photos, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nach Projekt, Kunde oder Nummer filtern …"
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60 sm:w-auto"
        />
        <span className="text-xs text-gray-500">
          {!finished
            ? `Lädt … ${progress.done}/${progress.total} Projekte durchsucht · ${photos.length} Foto${photos.length === 1 ? "" : "s"} gefunden`
            : `${filtered.length} von ${photos.length} Fotos`}
        </span>
      </div>

      {!finished && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand-red transition-all"
            style={{ width: `${progress.total > 0 ? Math.min((progress.done / progress.total) * 100, 100) : 0}%` }}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-md border border-gray-200 px-3 py-10 text-center text-sm text-gray-400">
          {finished ? "Keine Fotos gefunden." : "Fotos werden geladen …"}
        </p>
      ) : (
        <PhotoGallery photos={filtered} />
      )}
    </div>
  );
}
