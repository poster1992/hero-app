"use client";

import { useCallback, useEffect, useRef, useState, useTransition, useActionState } from "react";
import {
  createVehicleAction,
  updateVehicleAction,
  deleteVehicleAction,
  uploadVehicleDocAction,
  renameVehicleDocAction,
  deleteVehicleDocAction,
  loadVehicleDocsAction,
  type VehicleActionState,
} from "@/app/dashboard/fahrzeuge/actions";
import type { Vehicle, VehicleDocument } from "@/lib/vehicles";

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
function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** Liest Dateien robust aus einem Drop-Event (files, sonst items-Fallback). */
function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files && dt.files.length > 0) return Array.from(dt.files);
  const out: File[] = [];
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

interface Pending {
  key: string;
  file: File;
  label: string;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

export default function VehicleDocuments({ vehicles }: { vehicles: Vehicle[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(vehicles[0]?.id ?? null);
  const [docs, setDocs] = useState<VehicleDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [, startLoad] = useTransition();

  const selected = vehicles.find((v) => v.id === selectedId) ?? null;

  // Auswahl gültig halten (z. B. nach dem Löschen des aktiven Fahrzeugs).
  useEffect(() => {
    if (selectedId != null && !vehicles.some((v) => v.id === selectedId)) {
      setSelectedId(vehicles[0]?.id ?? null);
    }
  }, [vehicles, selectedId]);

  // Verhindert, dass der Browser eine daneben abgelegte Datei öffnet (statt sie aufzunehmen).
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const reloadDocs = (vehicleId: number) => {
    setLoadingDocs(true);
    startLoad(async () => {
      const d = await loadVehicleDocsAction(vehicleId);
      setDocs(d);
      setLoadingDocs(false);
    });
  };

  useEffect(() => {
    if (selectedId != null) reloadDocs(selectedId);
    else setDocs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
      <VehicleList
        vehicles={vehicles}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <div>
        {selected ? (
          <VehiclePanel
            key={selected.id}
            vehicle={selected}
            docs={docs}
            loading={loadingDocs}
            onChanged={() => reloadDocs(selected.id)}
          />
        ) : (
          <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-lg shadow-black/10">
            Lege links ein Fahrzeug an oder wähle eines aus.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Fahrzeugliste ------------------------------ */

function VehicleList({
  vehicles,
  selectedId,
  onSelect,
}: {
  vehicles: Vehicle[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [state, formAction, pending] = useActionState<VehicleActionState, FormData>(createVehicleAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Neues Fahrzeug</h2>
        <form action={formAction} ref={formRef} className="flex flex-col gap-2">
          <input name="name" placeholder="Bezeichnung * (z. B. VW Crafter)" className={inputClass} required />
          <input name="plate" placeholder="Kennzeichen (optional)" className={inputClass} />
          <input name="note" placeholder="Notiz (optional)" className={inputClass} />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-red px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Legt an …" : "Anlegen"}
            </button>
            {state.error && <span className="text-xs text-rose-600">{state.error}</span>}
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">
          Fahrzeuge ({vehicles.length})
        </div>
        {vehicles.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">Noch keine Fahrzeuge.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
            {vehicles.map((v) => {
              const active = v.id === selectedId;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(v.id)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors ${
                      active ? "bg-brand-red/10" : "hover:bg-gray-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">{v.name}</span>
                      {v.plate && <span className="block truncate text-xs text-gray-500">{v.plate}</span>}
                    </span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {v.docCount}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Fahrzeug-Panel ----------------------------- */

function VehiclePanel({
  vehicle,
  docs,
  loading,
  onChanged,
}: {
  vehicle: Vehicle;
  docs: VehicleDocument[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editState, editAction] = useActionState<VehicleActionState, FormData>(updateVehicleAction, {});
  const [showEdit, setShowEdit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...list.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, label: baseName(file.name) })),
    ]);
  }, []);

  // Drag & Drop über native Listener (zuverlässiger als React-Synthetic-Events).
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        try {
          e.dataTransfer.dropEffect = "copy";
        } catch {
          /* egal */
        }
      }
      setDragOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      addFiles(filesFromDataTransfer(e.dataTransfer));
    };
    el.addEventListener("dragenter", onEnter);
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", onEnter);
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  const uploadAll = async () => {
    if (pending.length === 0 || uploading) return;
    setUploading(true);
    setMsg(null);
    let ok = 0;
    let failed = 0;
    for (const p of pending) {
      const fd = new FormData();
      fd.set("vehicleId", String(vehicle.id));
      fd.set("label", p.label.trim() || p.file.name);
      fd.set("file", p.file);
      const res = await uploadVehicleDocAction(fd);
      if (res.ok) ok++;
      else failed++;
    }
    setUploading(false);
    setPending([]);
    setMsg({ ok: failed === 0, text: `${ok} hochgeladen${failed ? `, ${failed} fehlgeschlagen` : ""}.` });
    onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Kopf */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{vehicle.name}</h2>
          <p className="text-sm text-gray-600">
            {vehicle.plate ?? "— kein Kennzeichen —"}
            {vehicle.note ? ` · ${vehicle.note}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowEdit((s) => !s)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:text-gray-900"
          >
            Bearbeiten
          </button>
          <form action={deleteVehicleAction}>
            <input type="hidden" name="id" value={vehicle.id} />
            <button
              type="submit"
              onClick={(e) => {
                if (!window.confirm(`Fahrzeug „${vehicle.name}" samt aller Dokumente löschen?`)) e.preventDefault();
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:text-brand-red"
            >
              Löschen
            </button>
          </form>
        </div>
      </div>

      {showEdit && (
        <form action={editAction} className="grid grid-cols-1 gap-2 rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10 sm:grid-cols-3">
          <input type="hidden" name="id" value={vehicle.id} />
          <input name="name" defaultValue={vehicle.name} placeholder="Bezeichnung *" className={inputClass} required />
          <input name="plate" defaultValue={vehicle.plate ?? ""} placeholder="Kennzeichen" className={inputClass} />
          <input name="note" defaultValue={vehicle.note ?? ""} placeholder="Notiz" className={inputClass} />
          <div className="sm:col-span-3 flex items-center gap-2">
            <button type="submit" className="rounded-md bg-brand-red px-3 py-2 text-sm font-semibold text-white hover:opacity-90">
              Speichern
            </button>
            {editState.error && <span className="text-xs text-rose-600">{editState.error}</span>}
            {editState.success && <span className="text-xs text-emerald-700">{editState.success}</span>}
          </div>
        </form>
      )}

      {/* Upload-Zone (Drag & Drop via native Listener, siehe useEffect) */}
      <div
        ref={dropRef}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? "border-brand-red bg-brand-red/5" : "border-gray-300 bg-white hover:border-brand-red/50"
        }`}
      >
        <p className="text-sm text-gray-600">
          <span className="font-medium text-brand-red">Dateien auswählen</span> oder PDF/Dokumente hierher ziehen
        </p>
        <p className="mt-1 text-xs text-gray-400">Danach je Datei eine Beschriftung vergeben (max. 25 MB).</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Ausstehende Uploads mit Beschriftung */}
      {pending.length > 0 && (
        <div className="rounded-xl border border-gray-300 bg-white p-4 shadow-lg shadow-black/10">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Bereit zum Hochladen ({pending.length})</h3>
          <ul className="flex flex-col gap-2">
            {pending.map((p, i) => (
              <li key={p.key} className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>{docIcon(p.file.name, p.file.type)}</span>
                <div className="min-w-0 flex-1">
                  <input
                    value={p.label}
                    onChange={(e) =>
                      setPending((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Beschriftung *"
                    className={inputClass}
                  />
                  <span className="mt-0.5 block truncate text-xs text-gray-400">{p.file.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:text-brand-red"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={uploadAll}
              disabled={uploading}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {uploading ? "Lädt hoch …" : `${pending.length} hochladen`}
            </button>
            <button
              type="button"
              onClick={() => setPending([])}
              disabled={uploading}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Verwerfen
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`rounded-md border p-3 text-sm ${
            msg.ok ? "border-green-300 bg-green-50 text-green-800" : "border-brand-red/30 bg-brand-red/10 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Dokumentliste */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">
          Unterlagen ({docs.length})
        </div>
        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">Wird geladen …</p>
        ) : docs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">Noch keine Unterlagen für dieses Fahrzeug.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {docs.map((d) => (
              <DocRow key={d.id} doc={d} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Dokumentzeile ----------------------------- */

function DocRow({ doc, onChanged }: { doc: VehicleDocument; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(doc.label);
  const [busy, startBusy] = useTransition();

  const save = () => {
    if (!label.trim() || busy) return;
    startBusy(async () => {
      const res = await renameVehicleDocAction(doc.id, label);
      if (res.ok) {
        setEditing(false);
        onChanged();
      }
    });
  };

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-lg" aria-hidden>{docIcon(doc.fileName, doc.mime)}</span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") {
                  setLabel(doc.label);
                  setEditing(false);
                }
              }}
              autoFocus
              className={inputClass}
            />
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-brand-red px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              OK
            </button>
          </div>
        ) : (
          <>
            <a
              href={`/api/fahrzeug-dokument?id=${doc.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm font-medium text-gray-900 hover:text-brand-red hover:underline"
              title="Öffnen"
            >
              {doc.label}
            </a>
            <span className="block truncate text-xs text-gray-400">
              {doc.fileName}
              {doc.created ? ` · ${fmtDate(doc.created)}` : ""}
              {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
            </span>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Beschriftung ändern"
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-red/50 hover:text-brand-red"
          >
            ✎
          </button>
          <button
            type="button"
            title="Löschen"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Dokument „${doc.label}" löschen?`)) return;
              startBusy(async () => {
                const fd = new FormData();
                fd.set("id", String(doc.id));
                await deleteVehicleDocAction(fd);
                onChanged();
              });
            }}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
          >
            🗑
          </button>
        </div>
      )}
    </li>
  );
}
