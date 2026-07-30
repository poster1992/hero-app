"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  uploadAvisAction,
  deleteAvisAction,
  type UploadAvisState,
} from "@/app/dashboard/belege/avis-actions";
import type { PaymentAdvice } from "@/lib/payment-advices";

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" });
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

/**
 * Kopfzeilen-Button „Zahlungsavis" (neben Checkliste/Posteingang) – öffnet ein
 * Upload-Fenster. Reine Speicherung je Monat; Export läuft über den Belege-PDF-ZIP.
 */
export function PaymentAdviceButton({
  year,
  month,
  monthLabel,
}: {
  year: number;
  month: number;
  monthLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<UploadAvisState, FormData>(uploadAvisAction, {});
  const lastSuccess = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!state.success || state.success === lastSuccess.current) return;
    lastSuccess.current = state.success;
    const t = setTimeout(() => {
      setOpen(false);
      router.refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [state.success, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
      >
        🧾 Zahlungsavis
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Zahlungsavis hochladen · {monthLabel}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="month" value={month} />
              <div>
                <label className="mb-1 block text-sm text-gray-600">Datei (PDF/Bild) *</label>
                <input
                  name="file"
                  type="file"
                  accept=".pdf,image/*"
                  required
                  className="w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-red file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
                />
              </div>
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Speichert …" : "Speichern"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Abbrechen
                </button>
                {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/** Liste der Zahlungsavise eines Monats (Ansehen/Löschen). Upload läuft über den
 *  Kopfzeilen-Button PaymentAdviceButton. */
export default function PaymentAdvices({
  monthLabel,
  advices,
}: {
  monthLabel: string;
  advices: PaymentAdvice[];
}) {
  const router = useRouter();
  const [, startDelete] = useTransition();

  const doDelete = (a: PaymentAdvice) => {
    if (!window.confirm(`Zahlungsavis „${a.fileName ?? a.supplier ?? a.id}" wirklich löschen?`)) return;
    const fd = new FormData();
    fd.set("id", String(a.id));
    startDelete(async () => {
      await deleteAvisAction(fd);
      router.refresh();
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Zahlungsavise · {monthLabel}</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Vom Lieferanten erhaltene Zahlungsavise – werden beim Steuerberater-Export (PDF-ZIP) mitgeliefert.
          </p>
        </div>
        <span className="text-sm text-gray-600">
          {advices.length} {advices.length === 1 ? "Avis" : "Avise"}
        </span>
      </div>

      {advices.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          Keine Zahlungsavise für {monthLabel}. Oben über „🧾 Zahlungsavis“ hochladen.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-5 py-2 font-semibold">Datei</th>
              <th className="px-3 py-2 font-semibold">Hochgeladen</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {advices.map((a) => (
              <tr key={a.id} className="border-t border-gray-100">
                <td className="px-5 py-2 text-gray-900">
                  {a.hasFile ? (
                    <a
                      href={`/api/payment-advice?id=${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-red hover:underline"
                    >
                      {a.fileName ?? `Avis ${a.id}`}
                    </a>
                  ) : (
                    a.fileName ?? `Avis ${a.id}`
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-gray-500">{fmtDate(a.created)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => doDelete(a)}
                    className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-brand-red transition-colors hover:border-brand-red/50"
                  >
                    🗑 Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
