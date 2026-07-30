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

export default function PaymentAdvices({
  year,
  month,
  monthLabel,
  advices,
}: {
  year: number;
  month: number;
  monthLabel: string;
  advices: PaymentAdvice[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<UploadAvisState, FormData>(uploadAvisAction, {});
  const [, startDelete] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const lastSuccess = useRef<string | undefined>(undefined);

  // Nach erfolgreichem Upload: Formular leeren, aufklappen lassen, Liste aktualisieren.
  useEffect(() => {
    if (!state.success || state.success === lastSuccess.current) return;
    lastSuccess.current = state.success;
    formRef.current?.reset();
    router.refresh();
  }, [state.success, router]);

  const doDelete = (a: PaymentAdvice) => {
    if (!window.confirm(`Zahlungsavis „${a.fileName ?? a.supplier ?? a.id}" wirklich löschen?`)) return;
    const fd = new FormData();
    fd.set("id", String(a.id));
    startDelete(async () => {
      await deleteAvisAction(fd);
      router.refresh();
    });
  };

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  return (
    <div className="overflow-hidden rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Zahlungsavise · {monthLabel}</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Vom Lieferanten erhaltene Zahlungsavise ablegen – werden beim Steuerberater-Export (PDF-ZIP) mitgeliefert.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {advices.length} {advices.length === 1 ? "Avis" : "Avise"}
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {open ? "Schließen" : "+ Avis hochladen"}
          </button>
        </div>
      </div>

      {open && (
        <form
          ref={formRef}
          action={formAction}
          className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50 px-5 py-4 sm:grid-cols-4"
        >
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <div className="sm:col-span-1">
            <label className="mb-1 block text-sm text-gray-600">Datei (PDF/Bild) *</label>
            <input
              name="file"
              type="file"
              accept=".pdf,image/*"
              required
              className="w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-red file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Lieferant (optional)</label>
            <input name="supplier" type="text" className={inputClass} placeholder="z. B. Mosel Baustoff" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Notiz (optional)</label>
            <input name="note" type="text" className={inputClass} placeholder="z. B. Avis KW 30" />
          </div>
          <div className="flex items-end gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Speichert …" : "Speichern"}
            </button>
            {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
            {state.success && <span className="text-sm text-emerald-600">✓</span>}
          </div>
        </form>
      )}

      {advices.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          Keine Zahlungsavise für {monthLabel}.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-5 py-2 font-semibold">Datei</th>
              <th className="px-3 py-2 font-semibold">Lieferant</th>
              <th className="px-3 py-2 font-semibold">Notiz</th>
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
                <td className="px-3 py-2 text-gray-700">{a.supplier ?? "—"}</td>
                <td className="px-3 py-2 text-gray-700">{a.note ?? "—"}</td>
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
