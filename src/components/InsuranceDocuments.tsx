"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadInsuranceDocAction,
  updateInsuranceDocAction,
  deleteInsuranceDocAction,
  addInsuranceCategoryAction,
  removeInsuranceCategoryAction,
} from "@/app/dashboard/versicherungen/actions";
import type { InsuranceDocument } from "@/lib/insurance-docs";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}
function docIcon(name: string | null, mime: string | null): string {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if ((mime ?? "").includes("pdf") || ext === "pdf") return "📕";
  if ((mime ?? "").startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) return "🖼️";
  return "📄";
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

export default function InsuranceDocuments({
  docs,
  categories,
  presets,
}: {
  docs: InsuranceDocument[];
  categories: string[];
  presets: string[];
}) {
  const router = useRouter();

  // Verwaltete Kategorien lokal halten, damit Anlegen/Löschen sofort greift.
  const [cats, setCats] = useState<string[]>(categories);
  useEffect(() => setCats(categories), [categories]);

  // Nach Kategorie gruppieren (Reihenfolge kommt bereits sortiert aus der DB).
  const groups = useMemo(() => {
    const map = new Map<string, InsuranceDocument[]>();
    for (const d of docs) {
      const arr = map.get(d.category) ?? [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return Array.from(map.entries());
  }, [docs]);

  // Auswahlvorschläge = verwaltete Kategorien + bereits verwendete (dedupliziert).
  const allCategories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...cats, ...docs.map((d) => d.category)]) {
      const key = c.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(c.trim());
    }
    return out;
  }, [cats, docs]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-4">
        <UploadPanel categories={allCategories} onDone={() => router.refresh()} />
        <CategoryManager categories={cats} presets={presets} onChange={setCats} />
      </div>

      <div className="flex flex-col gap-5">
        {docs.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-lg shadow-black/10">
            Noch keine Versicherungsunterlagen. Lade links das erste Dokument hoch.
          </p>
        ) : (
          groups.map(([category, items]) => (
            <div key={category} className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">{category}</h2>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {items.length}
                </span>
              </div>
              <ul className="divide-y divide-gray-100">
                {items.map((d) => (
                  <DocRow key={d.id} doc={d} categories={allCategories} onChanged={() => router.refresh()} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* --------------------------------- Upload ---------------------------------- */

function UploadPanel({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const [category, setCategory] = useState(categories[0] ?? "Sonstige");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (busy) return;
    if (files.length === 0) {
      setMsg({ ok: false, text: "Bitte mindestens eine Datei auswählen." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("category", category.trim() || "Sonstige");
    fd.set("label", label.trim());
    fd.set("note", note.trim());
    for (const f of files) fd.append("file", f);
    const res = await uploadInsuranceDocAction(fd);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: `${res.count ?? files.length} Dokument(e) hochgeladen.` });
      setLabel("");
      setNote("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    } else {
      setMsg({ ok: false, text: res.error ?? "Upload fehlgeschlagen." });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Unterlage hinzufügen</h2>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-600">Kategorie</label>
          <input
            list="ins-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="z. B. Flottenvertrag"
            className={inputClass}
          />
          <datalist id="ins-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <label className="mt-1 text-xs font-medium text-gray-600">Bezeichnung (optional)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="z. B. Haftpflicht Police 2026"
            className={inputClass}
          />

          <label className="mt-1 text-xs font-medium text-gray-600">Notiz (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="z. B. Versicherer, Vertragsnummer, Laufzeit …"
            className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
          />

          <label className="mt-1 text-xs font-medium text-gray-600">Datei(en)</label>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/*"
            onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
            className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-red/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-red hover:file:bg-brand-red/20"
          />
          {files.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 truncate text-xs text-gray-500">
                  <span aria-hidden>{docIcon(f.name, f.type)}</span>
                  <span className="truncate">{f.name}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-400">PDF oder Bild, max. 25 MB je Datei.</p>

          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Lädt hoch …" : "Hochladen"}
            </button>
            {msg && (
              <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Kategorien verwalten -------------------------- */

function CategoryManager({
  categories,
  presets,
  onChange,
}: {
  categories: string[];
  presets: string[];
  onChange: (next: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const presetSet = useMemo(() => new Set(presets.map((p) => p.toLowerCase())), [presets]);

  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    setErr(null);
    startBusy(async () => {
      const res = await addInsuranceCategoryAction(clean);
      if (res.ok && res.categories) {
        onChange(res.categories);
        setName("");
      } else {
        setErr(res.error ?? "Fehler.");
      }
    });
  };

  const remove = (cat: string) => {
    setErr(null);
    startBusy(async () => {
      const res = await removeInsuranceCategoryAction(cat);
      if (res.ok && res.categories) onChange(res.categories);
      else setErr(res.error ?? "Fehler.");
    });
  };

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Kategorien verwalten</h2>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Neue Kategorie …"
          className={inputClass}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !name.trim()}
          className="shrink-0 rounded-md bg-brand-red px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          + Hinzufügen
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {categories.map((c) => {
          const isPreset = presetSet.has(c.toLowerCase());
          return (
            <li
              key={c}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2.5 pr-1 text-xs text-gray-700"
            >
              <span>{c}</span>
              {isPreset ? (
                <span className="ml-0.5 text-gray-300" title="Standard-Kategorie (nicht löschbar)">
                  🔒
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => remove(c)}
                  disabled={busy}
                  title="Kategorie entfernen"
                  className="ml-0.5 rounded-full px-1 text-gray-400 hover:bg-rose-100 hover:text-rose-600 disabled:opacity-50"
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-gray-400">
        Standard-Kategorien (🔒) bleiben immer erhalten. Bereits genutzte Kategorien verschwinden erst, wenn keine
        Unterlage mehr sie verwendet.
      </p>
    </div>
  );
}

/* ------------------------------- Dokumentzeile ----------------------------- */

function DocRow({
  doc,
  categories,
  onChanged,
}: {
  doc: InsuranceDocument;
  categories: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(doc.category);
  const [label, setLabel] = useState(doc.label);
  const [note, setNote] = useState(doc.note ?? "");
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    if (!label.trim()) {
      setErr("Bitte eine Bezeichnung angeben.");
      return;
    }
    startBusy(async () => {
      const res = await updateInsuranceDocAction(doc.id, {
        category: category.trim() || "Sonstige",
        label: label.trim(),
        note: note.trim() || null,
      });
      if (res.ok) {
        setEditing(false);
        setErr(null);
        onChanged();
      } else {
        setErr(res.error ?? "Speichern fehlgeschlagen.");
      }
    });
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3">
        <input
          list="ins-categories"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Kategorie"
          className={inputClass}
        />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bezeichnung *" className={inputClass} />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Notiz (optional)"
          className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Speichert …" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCategory(doc.category);
              setLabel(doc.label);
              setNote(doc.note ?? "");
              setErr(null);
              setEditing(false);
            }}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Abbrechen
          </button>
          {err && <span className="text-xs text-rose-600">{err}</span>}
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span className="mt-0.5 text-lg" aria-hidden>{docIcon(doc.fileName, doc.mime)}</span>
      <div className="min-w-0 flex-1">
        <a
          href={`/api/versicherung-dokument?id=${doc.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium text-gray-900 hover:text-brand-red hover:underline"
          title="Öffnen"
        >
          {doc.label || doc.fileName || "Dokument"}
        </a>
        {doc.note && <p className="mt-0.5 whitespace-pre-line text-xs text-gray-600">{doc.note}</p>}
        <span className="mt-0.5 block truncate text-xs text-gray-400">
          {doc.fileName}
          {doc.created ? ` · ${fmtDate(doc.created)}` : ""}
          {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Bearbeiten"
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-red/50 hover:text-brand-red"
        >
          ✎
        </button>
        <button
          type="button"
          title="Löschen"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Dokument „${doc.label || doc.fileName}" löschen?`)) return;
            startBusy(async () => {
              const fd = new FormData();
              fd.set("id", String(doc.id));
              await deleteInsuranceDocAction(fd);
              onChanged();
            });
          }}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
        >
          🗑
        </button>
      </div>
    </li>
  );
}
