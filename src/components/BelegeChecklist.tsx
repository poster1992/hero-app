"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  toggleChecklistAction,
  addChecklistItemAction,
  removeChecklistItemAction,
} from "@/app/dashboard/belege/manual-actions";

interface ChecklistItem {
  id: number;
  label: string;
  done: boolean;
  doneAt: string | null;
}

export default function BelegeChecklist({
  items,
  year,
  month,
  periodLabel,
}: {
  items: ChecklistItem[];
  year: number;
  month: number;
  periodLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newLabel, setNewLabel] = useState("");
  // Beim Öffnen zunächst minimiert darstellen.
  const [open, setOpen] = useState(false);
  // Popup-Fenster (Modal) mit derselben Checkliste.
  const [modalOpen, setModalOpen] = useState(false);

  const doneCount = items.filter((i) => i.done).length;

  // Escape schließt das Popup; Body-Scroll sperren solange offen.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [modalOpen]);

  const run = (fn: () => Promise<void>) => {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  };

  const addItem = () => {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    run(() => addChecklistItemAction(label));
  };

  // Gemeinsamer Inhalt (Liste + Eingabe) für Inline-Ansicht und Popup.
  const list =
    items.length === 0 ? (
      <p className="px-5 py-6 text-center text-sm text-gray-500">
        Noch keine Checklisten-Punkte. Unten einen wiederkehrenden Beleg hinzufügen.
      </p>
    ) : (
      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-5 py-3">
            <input
              type="checkbox"
              checked={item.done}
              disabled={pending}
              onChange={(e) => run(() => toggleChecklistAction(item.id, year, month, e.target.checked))}
              className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-brand-red"
            />
            <span className={`flex-1 text-sm ${item.done ? "text-gray-400 line-through" : "text-gray-900"}`}>
              {item.label}
            </span>
            {item.done && item.doneAt && (
              <span className="text-xs text-emerald-600">erledigt am {formatDate(item.doneAt)}</span>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => removeChecklistItemAction(item.id))}
              className="text-gray-300 transition-colors hover:text-brand-red"
              aria-label="Punkt entfernen"
              title="Punkt entfernen"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    );

  const addForm = (
    <div className="flex items-center gap-2 border-t border-gray-200 px-5 py-3">
      <input
        type="text"
        value={newLabel}
        onChange={(e) => setNewLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addItem();
          }
        }}
        placeholder="Neuen Punkt hinzufügen (z. B. Stromrechnung) …"
        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60"
      />
      <button
        type="button"
        onClick={addItem}
        disabled={pending || !newLabel.trim()}
        className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Hinzufügen
      </button>
    </div>
  );

  return (
    <>
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div
          className={`flex items-center justify-between gap-3 px-5 py-4 ${open ? "border-b border-gray-200" : ""}`}
        >
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex flex-1 items-center gap-2 text-left"
          >
            <span className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
              ▶
            </span>
            <h2 className="text-lg font-medium text-gray-900">Monatliche Checkliste {periodLabel}</h2>
          </button>
          <p className="hidden text-sm text-gray-600 sm:block">
            {doneCount} / {items.length} erledigt
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
            title="Checkliste im Fenster öffnen"
          >
            <span aria-hidden>⤢</span> Im Fenster öffnen
          </button>
        </div>

        {open && (
          <>
            {list}
            {addForm}
          </>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mt-6 w-full max-w-2xl rounded-xl border border-gray-300 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-medium text-gray-900">Monatliche Checkliste {periodLabel}</h2>
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-600">
                  {doneCount} / {items.length} erledigt
                </p>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-gray-400 transition-colors hover:text-brand-red"
                  aria-label="Fenster schließen"
                  title="Schließen (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>
            {list}
            {addForm}
          </div>
        </div>
      )}
    </>
  );
}

function formatDate(d: string): string {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("de-DE");
}
