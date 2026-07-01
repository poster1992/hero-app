"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitBooking } from "@/app/dashboard/lager/actions";
import CameraScanner from "@/components/CameraScanner";

export interface ScanArticle {
  id: number;
  name: string;
  itemNumber: string;
  qrId: string | null;
  unit: string;
}

interface ProjectOption {
  id: number;
  relativeId: number | null;
  name: string;
}

interface CartRow {
  article: ScanArticle;
  qty: number;
}

export default function BookingScanModal({
  open,
  onClose,
  articles,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  articles: ScanArticle[];
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"in" | "out" | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [camFeedback, setCamFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [employee, setEmployee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  function close() {
    setDirection(null);
    setProjectQuery("");
    setProject(null);
    setScan("");
    setScanError(null);
    setCameraOn(false);
    setCamFeedback(null);
    setCart([]);
    setEmployee("");
    setError(null);
    onClose();
  }

  const projectMatches = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q || project) return [];
    return projects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.relativeId != null && String(p.relativeId).includes(q))
      )
      .slice(0, 8);
  }, [projectQuery, project, projects]);

  if (!open) return null;

  function addArticle(found: ScanArticle, amount = 1) {
    setCart((prev) => {
      const i = prev.findIndex((r) => r.article.id === found.id);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], qty: copy[i].qty + amount };
        return copy;
      }
      return [...prev, { article: found, qty: amount }];
    });
  }

  function addByCode(raw: string): ScanArticle | null {
    const code = raw.trim().toLowerCase();
    if (!code) return null;
    const found = articles.find(
      (a) =>
        a.itemNumber.toLowerCase() === code ||
        (a.qrId != null && a.qrId.toLowerCase() === code) ||
        a.name.toLowerCase() === code
    );
    if (!found) {
      setScanError(`Nicht gefunden: ${raw.trim()}`);
      return null;
    }
    setScanError(null);
    addArticle(found);
    return found;
  }

  const manualMatches = (() => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return [];
    return articles
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.itemNumber.toLowerCase().includes(q)
      )
      .slice(0, 8);
  })();

  function setQty(id: number, qty: number) {
    setCart((prev) => prev.map((r) => (r.article.id === id ? { ...r, qty } : r)));
  }
  function removeRow(id: number) {
    setCart((prev) => prev.filter((r) => r.article.id !== id));
  }

  const canSubmit =
    direction != null && project != null && employee.trim() !== "" && cart.length > 0 && !submitting;

  async function handleSubmit() {
    if (!direction || !project) return;
    setSubmitting(true);
    setError(null);
    const res = await submitBooking({
      direction,
      project: { relativeId: project.relativeId, name: project.name },
      employeeName: employee.trim(),
      items: cart
        .filter((r) => r.qty > 0)
        .map((r) => ({
          heroArticleId: r.article.id,
          name: r.article.name,
          itemNumber: r.article.itemNumber,
          unit: r.article.unit,
          qty: r.qty,
        })),
    });
    setSubmitting(false);
    if (res.ok) {
      close();
      router.refresh();
    } else {
      setError(res.error ?? "Fehler.");
    }
  }

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-xl rounded-xl border border-gray-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Lager-Buchung</h3>
          <button onClick={close} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Schließen">
            ✕
          </button>
        </div>

        {/* 1. Richtung */}
        <div className="mb-4">
          <p className="mb-1 text-sm font-medium text-gray-700">1. Art der Buchung</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDirection("in")}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                direction === "in"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              + Einbuchung
            </button>
            <button
              type="button"
              onClick={() => setDirection("out")}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                direction === "out"
                  ? "border-rose-500 bg-rose-50 text-rose-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              − Ausbuchung
            </button>
          </div>
        </div>

        {/* 2. Projekt */}
        <div className="mb-4">
          <p className="mb-1 text-sm font-medium text-gray-700">2. Projekt</p>
          {project ? (
            <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
              <span className="text-gray-900">
                {project.relativeId != null ? `#${project.relativeId} ` : ""}
                {project.name}
              </span>
              <button onClick={() => setProject(null)} className="text-xs text-gray-400 hover:text-gray-700">
                ✕ ändern
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
                placeholder="Projekt suchen (Name oder Nummer) …"
                className={inputClass}
              />
              {projectMatches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                  {projectMatches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setProject(p);
                          setProjectQuery("");
                          setTimeout(() => scanRef.current?.focus(), 50);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        {p.relativeId != null && <span className="text-gray-500">#{p.relativeId} </span>}
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 3. Scannen */}
        <div className="mb-4">
          <p className="mb-1 text-sm font-medium text-gray-700">3. Artikel scannen</p>
          <input
            ref={scanRef}
            type="text"
            value={scan}
            disabled={!direction || !project}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addByCode(scan);
                setScan("");
              }
            }}
            placeholder={!direction || !project ? "Erst Richtung & Projekt wählen" : "Barcode/QR scannen oder Artikel-Nr. eingeben + Enter"}
            className={`${inputClass} disabled:bg-gray-100`}
          />
          {scanError && <p className="mt-1 text-xs text-rose-600">{scanError}</p>}

          {/* Kamera-Scan */}
          <button
            type="button"
            disabled={!direction || !project}
            onClick={() => {
              setCamFeedback(null);
              setCameraOn((v) => !v);
            }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-brand-red/50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            <span aria-hidden>📷</span>
            {cameraOn ? "Kamera schließen" : "Mit Kamera scannen"}
          </button>
          {cameraOn && (
            <CameraScanner
              feedback={camFeedback}
              onClose={() => setCameraOn(false)}
              onDetect={(code) => {
                const found = addByCode(code);
                setCamFeedback(
                  found
                    ? { ok: true, text: `✓ hinzugefügt: ${found.name}` }
                    : { ok: false, text: `Nicht gefunden: ${code}` }
                );
              }}
            />
          )}

          {/* Manuell hinzufügen */}
          <div className="relative mt-2">
            <input
              type="text"
              value={manualQuery}
              disabled={!direction || !project}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="… oder Artikel manuell suchen (Name oder Nr.)"
              className={`${inputClass} disabled:bg-gray-100`}
            />
            {manualMatches.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                {manualMatches.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        addArticle(a);
                        setManualQuery("");
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100"
                    >
                      <span className="truncate text-gray-900">{a.name}</span>
                      <span className="shrink-0 text-xs text-gray-500">{a.itemNumber}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cart.length > 0 && (
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Erfasste Artikel ({cart.length})
            </p>
          )}
          {cart.length > 0 && (
            <ul className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-200">
              {cart.map((r) => (
                <li key={r.article.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{r.article.name}</p>
                    <p className="truncate text-xs text-gray-500">{r.article.itemNumber}</p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={r.qty}
                    onChange={(e) => setQty(r.article.id, Number(e.target.value))}
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm outline-none focus:border-brand-red/60"
                  />
                  <span className="w-8 text-xs text-gray-500">{r.article.unit}</span>
                  <button
                    onClick={() => removeRow(r.article.id)}
                    className="text-xs text-gray-400 hover:text-rose-600"
                    aria-label="Entfernen"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 4. Name */}
        <div className="mb-4">
          <p className="mb-1 text-sm font-medium text-gray-700">4. Name des Mitarbeiters</p>
          <input
            type="text"
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
            placeholder="Vor- und Nachname"
            className={inputClass}
          />
        </div>

        {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={close}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting
              ? "Wird gebucht …"
              : direction === "out"
                ? "Auf Projekt ausbuchen"
                : "Auf Projekt einbuchen"}
          </button>
        </div>
      </div>
    </div>
  );
}
