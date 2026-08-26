"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitBooking } from "@/app/dashboard/lager/actions";
import CameraScanner from "@/components/CameraScanner";

export interface ScanArticle {
  id: number;
  name: string;
  itemNumber: string;
  qrId: string | null;
  /** Voller QR-Inhalt aus HERO (z. B. „hero:s:<qr_id>"). */
  qrPayload?: string | null;
  unit: string;
}

interface ProjectOption {
  id: number;
  relativeId: number | null;
  name: string;
  /** Projekt ist „In Umsetzung" – nur solche dürfen ausgebucht werden. */
  inImplementation?: boolean;
}

interface CartRow {
  article: ScanArticle;
  qty: number;
}

const EMPLOYEE_KEY = "lager-employee";

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
  const [search, setSearch] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [camFeedback, setCamFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [cart, setCart] = useState<CartRow[]>([]);
  const [employee, setEmployee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kurze Bestätigungs-Einblendung („✓ Artikel hinzugefügt"), damit man den Scan bemerkt.
  const [addedToast, setAddedToast] = useState<{ name: string; n: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Timer beim Unmount aufräumen.
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Barcode-Bibliothek (@zxing) schon beim Öffnen des Dialogs im Hintergrund laden,
  // damit „Artikel scannen" auf Mobilgeräten ohne Download-Verzögerung startet.
  useEffect(() => {
    if (!open) return;
    import("@zxing/browser").catch(() => {});
    import("@zxing/library").catch(() => {});
  }, [open]);

  // Zuletzt genutzten Mitarbeiternamen vorbelegen (spart Tippen bei jeder Buchung).
  useEffect(() => {
    if (!open) return;
    setEmployee((cur) => {
      if (cur) return cur;
      try {
        return localStorage.getItem(EMPLOYEE_KEY) ?? "";
      } catch {
        return "";
      }
    });
  }, [open]);

  /** Zeigt kurz einen grünen Haken mit dem Artikelnamen. */
  function flashAdded(name: string) {
    // n zählt hoch → gleicher Artikel löst die Einblende-Animation erneut aus.
    setAddedToast((prev) => ({ name, n: (prev?.n ?? 0) + 1 }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setAddedToast(null), 1600);
  }

  function close() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setAddedToast(null);
    setDirection(null);
    setProjectQuery("");
    setProject(null);
    setSearch("");
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
    // Beim Ausbuchen nur Projekte „In Umsetzung" zulassen.
    const base = direction === "out" ? projects.filter((p) => p.inImplementation) : projects;
    return base
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.relativeId != null && String(p.relativeId).includes(q))
      )
      .slice(0, 8);
  }, [projectQuery, project, projects, direction]);

  const ready = direction != null && project != null;

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
    flashAdded(found.name);
  }

  function addByCode(raw: string): ScanArticle | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Mögliche Vergleichswerte aus dem Scan ableiten. HERO gibt im QR-Code
    // „hero:s:<qr_id>" aus (z. B. „hero:s:jlRflnZsmGU"), teils auch als URL –
    // daraus den eigentlichen Code herausziehen, damit der Scan zum qr_id passt.
    const cand = new Set<string>();
    cand.add(trimmed.toLowerCase());
    const heroMatch = /^hero:[^:]*:(.+)$/i.exec(trimmed);
    if (heroMatch) cand.add(heroMatch[1].trim().toLowerCase());
    // Falls eine URL codiert ist: letztes Pfadsegment ebenfalls versuchen.
    const seg = trimmed.split(/[/?#]/).filter(Boolean).pop();
    if (seg) cand.add(seg.trim().toLowerCase());

    const found = articles.find(
      (a) =>
        cand.has(a.itemNumber.toLowerCase()) ||
        (a.qrId != null && cand.has(a.qrId.toLowerCase())) ||
        (a.qrPayload != null && cand.has(a.qrPayload.toLowerCase())) ||
        cand.has(a.name.toLowerCase())
    );
    if (!found) {
      setScanError(`Nicht gefunden: ${trimmed}`);
      return null;
    }
    setScanError(null);
    addArticle(found);
    return found;
  }

  const searchMatches = (() => {
    const q = search.trim().toLowerCase();
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
  function stepQty(id: number, delta: number) {
    setCart((prev) =>
      prev.map((r) =>
        r.article.id === id ? { ...r, qty: Math.max(0, Math.round((r.qty + delta) * 100) / 100) } : r
      )
    );
  }
  function removeRow(id: number) {
    setCart((prev) => prev.filter((r) => r.article.id !== id));
  }

  const totalItems = cart.reduce((s, r) => s + (r.qty > 0 ? 1 : 0), 0);
  const canSubmit = ready && employee.trim() !== "" && cart.some((r) => r.qty > 0) && !submitting;

  async function handleSubmit() {
    if (!direction || !project) return;
    if (direction === "out" && !project.inImplementation) {
      setError("Ausbuchen ist nur auf Projekte „In Umsetzung“ möglich.");
      return;
    }
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
      try {
        localStorage.setItem(EMPLOYEE_KEY, employee.trim());
      } catch {
        /* localStorage optional */
      }
      close();
      router.refresh();
    } else {
      setError(res.error ?? "Fehler.");
    }
  }

  if (!open) return null;

  // 16px-Schrift verhindert das automatische Zoomen von iOS beim Fokussieren.
  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 outline-none focus:border-brand-red/60";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white sm:items-start sm:justify-center sm:overflow-y-auto sm:bg-black/50 sm:p-4">
      {/* Kurze Bestätigung nach dem Scannen/Hinzufügen */}
      {addedToast && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
          <div
            key={addedToast.n}
            className="flex animate-[bookingAdded_1.6s_ease-out_forwards] items-center gap-2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xl shadow-emerald-900/30"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/25 text-base leading-none">
              ✓
            </span>
            <span>
              Hinzugefügt
              <span className="ml-1 font-normal text-emerald-50">· {addedToast.name}</span>
            </span>
          </div>
          <style>{`@keyframes bookingAdded{0%{opacity:0;transform:translateY(-8px) scale(.9)}12%{opacity:1;transform:translateY(0) scale(1)}80%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-6px) scale(.98)}}`}</style>
        </div>
      )}

      <div className="flex h-full w-full flex-col overflow-hidden bg-white sm:my-8 sm:h-auto sm:max-h-[calc(100vh-4rem)] sm:max-w-xl sm:rounded-xl sm:border sm:border-gray-200 sm:shadow-2xl">
        {/* Sticky Kopfzeile */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
        >
          <h3 className="text-lg font-semibold text-gray-900">
            Lager-Buchung
            {direction && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  direction === "in" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                }`}
              >
                {direction === "in" ? "Einbuchen" : "Ausbuchen"}
              </span>
            )}
          </h3>
          <button
            onClick={close}
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        {/* Scrollbarer Inhalt */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* 1. Richtung */}
          <div className="mb-4">
            <p className="mb-1.5 text-sm font-medium text-gray-700">1. Art der Buchung</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection("in")}
                className={`rounded-lg border py-3 text-sm font-semibold transition-colors ${
                  direction === "in"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-500/30"
                    : "border-gray-300 text-gray-700 active:bg-gray-50"
                }`}
              >
                ＋ Einbuchen
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirection("out");
                  // Bereits gewähltes Projekt verwerfen, wenn es nicht „In Umsetzung" ist.
                  if (project && !project.inImplementation) {
                    setProject(null);
                    setProjectQuery("");
                  }
                }}
                className={`rounded-lg border py-3 text-sm font-semibold transition-colors ${
                  direction === "out"
                    ? "border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-500/30"
                    : "border-gray-300 text-gray-700 active:bg-gray-50"
                }`}
              >
                － Ausbuchen
              </button>
            </div>
          </div>

          {/* 2. Projekt */}
          <div className="mb-4">
            <p className="mb-1.5 text-sm font-medium text-gray-700">2. Projekt</p>
            {direction === "out" && (
              <p className="mb-1.5 text-xs text-amber-700">
                Ausbuchen nur auf Projekte „In Umsetzung".
              </p>
            )}
            {project ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm">
                <span className="min-w-0 truncate font-medium text-gray-900">
                  {project.relativeId != null ? `#${project.relativeId} ` : ""}
                  {project.name}
                </span>
                <button
                  onClick={() => setProject(null)}
                  className="ml-2 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                >
                  ändern
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
                  <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    {projectMatches.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setProject(p);
                            setProjectQuery("");
                            setTimeout(() => searchRef.current?.focus(), 50);
                          }}
                          className="block w-full px-3 py-2.5 text-left text-sm hover:bg-gray-100"
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

          {/* 3. Artikel erfassen */}
          <div className="mb-4">
            <p className="mb-1.5 text-sm font-medium text-gray-700">3. Artikel erfassen</p>

            {/* Großer Kamera-Scan als primäre Aktion */}
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                setCamFeedback(null);
                setCameraOn((v) => !v);
              }}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 ${
                cameraOn
                  ? "border border-gray-300 bg-white text-gray-700"
                  : "bg-brand-red text-white hover:opacity-90"
              }`}
            >
              <span aria-hidden className="text-lg">📷</span>
              {cameraOn ? "Kamera schließen" : "Artikel scannen"}
            </button>
            {!ready && (
              <p className="mt-1 text-center text-xs text-gray-400">Erst Richtung &amp; Projekt wählen</p>
            )}

            {cameraOn && (
              <CameraScanner
                feedback={camFeedback}
                onClose={() => setCameraOn(false)}
                onDetect={(code) => {
                  const found = addByCode(code);
                  setCamFeedback(
                    found
                      ? { ok: true, text: `✓ ${found.name}` }
                      : { ok: false, text: `Nicht gefunden: ${code}` }
                  );
                  // Artikel erfasst → Vollbild-Kamera schließen (weiterer Scan per Button).
                  if (found) setCameraOn(false);
                }}
              />
            )}

            {/* Kombiniertes Such-/Code-Feld (manuell oder Hardware-Scanner) */}
            <div className="relative mt-2">
              <input
                ref={searchRef}
                type="text"
                value={search}
                disabled={!ready}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const found = addByCode(search);
                    if (found) setSearch("");
                  }
                }}
                placeholder={ready ? "Artikel suchen oder Nr./Code eingeben" : "Erst Richtung & Projekt wählen"}
                className={`${inputClass} disabled:bg-gray-100`}
              />
              {searchMatches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {searchMatches.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          addArticle(a);
                          setSearch("");
                          searchRef.current?.focus();
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-100"
                      >
                        <span className="truncate text-gray-900">{a.name}</span>
                        <span className="shrink-0 text-xs text-gray-500">{a.itemNumber}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {scanError && <p className="mt-1 text-xs text-rose-600">{scanError}</p>}

            {/* Warenkorb */}
            {cart.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Erfasste Artikel ({cart.length})
                </p>
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                  {cart.map((r) => (
                    <li key={r.article.id} className="flex items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{r.article.name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {r.article.itemNumber}
                          {r.article.unit ? ` · ${r.article.unit}` : ""}
                        </p>
                      </div>
                      {/* Mengen-Stepper */}
                      <div className="flex shrink-0 items-center rounded-lg border border-gray-300">
                        <button
                          type="button"
                          onClick={() => stepQty(r.article.id, -1)}
                          className="flex h-9 w-9 items-center justify-center text-lg text-gray-600 active:bg-gray-100"
                          aria-label="weniger"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={r.qty}
                          onChange={(e) => setQty(r.article.id, Number(e.target.value))}
                          className="h-9 w-12 border-x border-gray-300 text-center text-base text-gray-900 outline-none focus:bg-brand-red/5"
                        />
                        <button
                          type="button"
                          onClick={() => stepQty(r.article.id, 1)}
                          className="flex h-9 w-9 items-center justify-center text-lg text-gray-600 active:bg-gray-100"
                          aria-label="mehr"
                        >
                          ＋
                        </button>
                      </div>
                      <button
                        onClick={() => removeRow(r.article.id)}
                        className="flex h-9 w-8 shrink-0 items-center justify-center text-gray-400 hover:text-rose-600"
                        aria-label="Entfernen"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 4. Mitarbeiter */}
          <div className="mb-1">
            <p className="mb-1.5 text-sm font-medium text-gray-700">4. Name des Mitarbeiters</p>
            <input
              type="text"
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
              placeholder="Vor- und Nachname"
              className={inputClass}
            />
          </div>
        </div>

        {/* Sticky Fußzeile mit immer erreichbarem Buchen-Button */}
        <div
          className="shrink-0 border-t border-gray-200 bg-white px-4 pt-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={close}
              className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 active:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 rounded-lg bg-brand-red px-4 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {submitting
                ? "Wird gebucht …"
                : `${direction === "out" ? "Ausbuchen" : "Einbuchen"}${totalItems > 0 ? ` (${totalItems})` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
