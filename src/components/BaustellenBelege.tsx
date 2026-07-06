"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadBaustellenBelegAction,
  deleteBaustellenBelegAction,
  reocrBaustellenBelegAction,
} from "@/app/dashboard/baustellen/actions";
import type { BaustellenBeleg } from "@/lib/baustellen-belege";

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function BaustellenBelege({
  baustelleId,
  belege,
  query = "",
}: {
  baustelleId: number;
  belege: BaustellenBeleg[];
  query?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(query);
  const fileInput = useRef<HTMLInputElement>(null);

  const runSearch = (value: string) => {
    const params = value.trim() ? `?q=${encodeURIComponent(value.trim())}` : "";
    router.push(`/dashboard/baustellen/${baustelleId}/belege${params}`);
  };

  const reocr = (id: number) => {
    startTransition(async () => {
      await reocrBaustellenBelegAction(id, baustelleId);
      router.refresh();
    });
  };

  const ocrBadge = (b: BaustellenBeleg) => {
    if (b.ocrStatus === "pending") return <span className="text-xs text-gray-400">⏳ OCR läuft…</span>;
    if (b.ocrStatus === "error") return <span className="text-xs text-brand-red">⚠ OCR-Fehler</span>;
    if (b.hasOcr) return <span className="text-xs text-emerald-600">✓ Text erkannt</span>;
    if (b.ocrStatus === "done") return <span className="text-xs text-gray-400">kein Text</span>;
    return null;
  };

  const upload = (files: FileList) => {
    setError(null);
    startTransition(async () => {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set("baustelleId", String(baustelleId));
        fd.set("file", file);
        const res = await uploadBaustellenBelegAction(fd);
        if (!res.ok) {
          setError(res.error ?? "Upload fehlgeschlagen.");
          break;
        }
      }
      router.refresh();
    });
  };

  const remove = (id: number) => {
    startTransition(async () => {
      await deleteBaustellenBelegAction(id, baustelleId);
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Belege</h2>
          <p className="text-xs text-gray-500">
            Nur für diese Baustelle · unabhängig von den HERO-Belegen
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{belege.length} Belege</span>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) upload(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={pending}
            className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Lädt …" : "Beleg hochladen"}
          </button>
        </div>
      </div>

      {error && <p className="px-5 py-2 text-sm text-brand-red">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-5 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch(q);
          }}
          placeholder="In Belegen suchen (Volltext/OCR) …"
          className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        <button
          type="button"
          onClick={() => runSearch(q)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-red/50 hover:text-gray-900"
        >
          Suchen
        </button>
        {query && (
          <button
            type="button"
            onClick={() => { setQ(""); runSearch(""); }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            zurücksetzen
          </button>
        )}
      </div>

      {belege.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          {query
            ? `Keine Belege gefunden für „${query}“.`
            : "Noch keine Belege. Oben „Beleg hochladen“ (PDF oder Foto)."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {belege.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="text-lg">{b.mime?.startsWith("image/") ? "🖼️" : "📄"}</span>
              <a
                href={`/api/baustellen-beleg?id=${b.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-sm font-medium text-brand-red hover:underline"
                title={b.fileName}
              >
                {b.fileName}
              </a>
              {ocrBadge(b)}
              <span className="text-xs text-gray-500">
                {fmtSize(b.size)}
                {b.uploadedByName ? ` · ${b.uploadedByName}` : ""}
                {b.uploadedAt ? ` · ${dateFmt.format(new Date(b.uploadedAt))}` : ""}
              </span>
              {(b.ocrStatus === "error" || (b.ocrStatus === "done" && !b.hasOcr)) && (
                <button
                  type="button"
                  onClick={() => reocr(b.id)}
                  disabled={pending}
                  className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:border-brand-red/50 disabled:opacity-50"
                  title="OCR erneut ausführen"
                >
                  OCR
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(b.id)}
                disabled={pending}
                className="text-xs text-gray-400 hover:text-brand-red disabled:opacity-40"
                title="Entfernen"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
