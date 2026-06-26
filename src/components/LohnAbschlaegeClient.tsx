"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveEmployeeAction,
  deleteEmployeeAction,
  buildWageSepaAction,
  deleteLohnRunAction,
  type SaveEmployeeState,
  type WageItem,
} from "@/app/dashboard/lohn-abschlaege/actions";
import type { LohnEmployee } from "@/lib/lohn-employees";
import type { LohnRun } from "@/lib/lohn-runs";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** IBAN gruppiert (4er-Blöcke) für die Anzeige. */
function fmtIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return y && m && day ? `${day}.${m}.${y}` : d;
}

function fmtStamp(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Erzeugt aus einem Lohnlauf ein PDF-Dokument (Liste der Abschläge). */
async function generateLohnPdf(run: LohnRun): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF("p", "pt", "a4");
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageW - 40;
  let y = 56;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Lohn-Abschläge", left, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const meta = [
    `Auftraggeber: ${run.debtorName || "FLOORTEC"}`,
    `Verwendungszweck: ${run.reference}`,
    `Ausführungsdatum: ${fmtDate(run.executionDate)}`,
    `Erstellt: ${fmtStamp(run.createdAt)}${run.createdByName ? ` · ${run.createdByName}` : ""}`,
  ];
  for (const line of meta) {
    doc.text(line, left, y);
    y += 15;
  }
  y += 8;

  // Tabellenkopf
  const xNr = left;
  const xName = left + 28;
  const xIban = left + 220;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Nr.", xNr, y);
  doc.text("Name", xName, y);
  doc.text("IBAN", xIban, y);
  doc.text("Betrag", right, y, { align: "right" });
  y += 6;
  doc.setLineWidth(0.5);
  doc.line(left, y, right, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  run.positions.forEach((p, i) => {
    if (y > pageH - 60) {
      doc.addPage();
      y = 56;
    }
    doc.text(String(i + 1), xNr, y);
    doc.text(doc.splitTextToSize(p.name, xIban - xName - 6)[0] ?? p.name, xName, y);
    doc.text(fmtIban(p.iban), xIban, y);
    doc.text(euro.format(p.amount), right, y, { align: "right" });
    y += 15;
  });

  y += 4;
  doc.line(left, y, right, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Summe (${run.count} Abschläge)`, xName, y);
  doc.text(euro.format(run.total), right, y, { align: "right" });

  doc.save(`lohn-abschlaege-${run.executionDate ?? "lauf"}-${run.id}.pdf`);
}

function parseAmount(s: string): number {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function LohnAbschlaegeClient({
  employees,
  companyIbanOk,
  companyName,
  history,
}: {
  employees: LohnEmployee[];
  companyIbanOk: boolean;
  companyName: string | null;
  history: LohnRun[];
}) {
  const router = useRouter();
  const [pdfBusy, setPdfBusy] = useState<number | null>(null);
  const [deletingRun, startDeleteRun] = useTransition();

  const makePdf = async (run: LohnRun) => {
    setPdfBusy(run.id);
    try {
      await generateLohnPdf(run);
    } finally {
      setPdfBusy(null);
    }
  };

  const removeRun = (run: LohnRun) => {
    if (!window.confirm(`Lohnlauf „${run.reference}" aus der Historie löschen?`)) return;
    const fd = new FormData();
    fd.set("id", String(run.id));
    startDeleteRun(async () => {
      await deleteLohnRunAction(fd);
      router.refresh();
    });
  };

  // --- Abschläge erfassen ---
  const today = new Date().toISOString().slice(0, 10);
  const defaultRef = useMemo(() => {
    const d = new Date();
    const month = d.toLocaleString("de-DE", { month: "long", year: "numeric" });
    return `Lohn Abschlag ${month}`;
  }, []);

  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [reference, setReference] = useState(defaultRef);
  const [execDate, setExecDate] = useState(today);
  const [sepaBusy, startSepa] = useTransition();
  const [sepaError, setSepaError] = useState<string | null>(null);
  const [sepaInfo, setSepaInfo] = useState<string | null>(null);

  const entered = employees
    .map((e) => ({ e, amount: parseAmount(amounts[e.id] ?? "") }))
    .filter((x) => x.amount > 0);
  const total = entered.reduce((s, x) => s + x.amount, 0);

  const downloadXml = (xml: string, filename: string) => {
    const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const createSepa = () => {
    setSepaError(null);
    setSepaInfo(null);
    if (entered.length === 0) {
      setSepaError("Bitte mindestens einen Betrag erfassen.");
      return;
    }
    if (!reference.trim()) {
      setSepaError("Bitte einen Verwendungszweck angeben.");
      return;
    }
    const items: WageItem[] = entered.map((x) => ({ employeeId: x.e.id, amount: x.amount }));
    startSepa(async () => {
      const res = await buildWageSepaAction(items, {
        reference: reference.trim(),
        executionDate: execDate,
      });
      if (res.error) {
        setSepaError(res.error);
        return;
      }
      if (res.xml && res.filename) {
        downloadXml(res.xml, res.filename);
        setSepaInfo(
          `SEPA-Datei erstellt · ${res.count} Überweisung(en) · ${euro.format(res.total ?? 0)}`
        );
        setAmounts({});
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {!companyIbanOk && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Achtung: In HERO ist keine Firmen-IBAN (Auftraggeber) hinterlegt – ohne diese
          kann keine SEPA-Datei erzeugt werden.
        </div>
      )}

      {/* Abschläge erfassen + Export */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Abschläge erfassen</h2>
          <p className="mt-1 text-sm text-gray-600">
            Auftraggeber: {companyName || "FLOORTEC"} · Betrag je Mitarbeiter eintragen, der
            leer bleibt, wird nicht überwiesen.
          </p>
        </div>

        {employees.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            Noch keine Mitarbeiter. Lege unten Mitarbeiter mit Bankverbindung an.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-700">
                    <th className="px-5 py-3 font-medium">Mitarbeiter</th>
                    <th className="px-5 py-3 font-medium">IBAN</th>
                    <th className="px-5 py-3 font-medium text-right">Abschlag (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id} className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
                      <td className="px-5 py-2.5 font-medium text-gray-900">{e.name}</td>
                      <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{fmtIban(e.iban)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <input
                          inputMode="decimal"
                          value={amounts[e.id] ?? ""}
                          onChange={(ev) => setAmounts((p) => ({ ...p, [e.id]: ev.target.value }))}
                          placeholder="0,00"
                          className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900 outline-none focus:border-brand-red/60"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td className="px-5 py-3 text-sm font-medium text-gray-700" colSpan={2}>
                      {entered.length} Abschlag(e)
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-gray-900">
                      {euro.format(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-4 border-t border-gray-200 px-5 py-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-600">Verwendungszweck</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-64 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-gray-600">Ausführungsdatum</span>
                <input
                  type="date"
                  value={execDate}
                  min={today}
                  onChange={(e) => setExecDate(e.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
                />
              </label>
              <button
                type="button"
                onClick={createSepa}
                disabled={sepaBusy || !companyIbanOk || entered.length === 0}
                className="ml-auto rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {sepaBusy ? "Erstelle …" : "SEPA-Datei erstellen"}
              </button>
            </div>
            {sepaError && <p className="px-5 pb-4 text-sm text-rose-400">{sepaError}</p>}
            {sepaInfo && <p className="px-5 pb-4 text-sm text-emerald-400">{sepaInfo}</p>}
          </>
        )}
      </div>

      {/* Mitarbeiterverwaltung */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Mitarbeiter &amp; Bankverbindung</h2>
          <p className="mt-1 text-sm text-gray-600">
            Eigene Liste – Name + IBAN/BIC. Wird für den SEPA-Export verwendet.
          </p>
        </div>

        <div className="border-b border-gray-200 px-5 py-4">
          <NewEmployeeForm onSaved={() => router.refresh()} />
        </div>

        {employees.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-500">Noch keine Mitarbeiter angelegt.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-700">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">IBAN</th>
                  <th className="px-5 py-3 font-medium">BIC</th>
                  <th className="px-5 py-3 font-medium text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <EmployeeRow key={e.id} emp={e} onChanged={() => router.refresh()} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historie der erstellten Lohnläufe */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Historie · erstellte Lohndateien</h2>
          <p className="mt-1 text-sm text-gray-600">
            Jeder SEPA-Export wird hier gespeichert – nachträglich als PDF erstellbar.
          </p>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-gray-500">Noch keine Lohndateien erstellt.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-700">
                  <th className="px-5 py-3 font-medium">Verwendungszweck</th>
                  <th className="px-5 py-3 font-medium">Ausführung</th>
                  <th className="px-5 py-3 font-medium">Erstellt</th>
                  <th className="px-5 py-3 font-medium text-right">Abschläge</th>
                  <th className="px-5 py-3 font-medium text-right">Summe</th>
                  <th className="px-5 py-3 font-medium text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run) => (
                  <tr key={run.id} className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
                    <td className="px-5 py-2.5 font-medium text-gray-900">{run.reference}</td>
                    <td className="px-5 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(run.executionDate)}</td>
                    <td className="px-5 py-2.5 whitespace-nowrap text-gray-600">
                      {fmtStamp(run.createdAt)}
                      {run.createdByName ? ` · ${run.createdByName}` : ""}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-700">{run.count}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-gray-900">
                      {euro.format(run.total)}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => makePdf(run)}
                          disabled={pdfBusy === run.id}
                          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
                        >
                          {pdfBusy === run.id ? "…" : "PDF erstellen"}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRun(run)}
                          disabled={deletingRun}
                          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
                        >
                          Löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NewEmployeeForm({ onSaved }: { onSaved: () => void }) {
  const [state, action, pending] = useActionState<SaveEmployeeState, FormData>(saveEmployeeAction, {});
  const [name, setName] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");

  useEffect(() => {
    if (state.success) {
      setName("");
      setIban("");
      setBic("");
      onSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-600">Name</span>
        <input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vor- und Nachname"
          className="w-56 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-600">IBAN</span>
        <input
          name="iban"
          required
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          placeholder="LU.. / DE.."
          className="w-60 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-600">BIC (optional)</span>
        <input
          name="bic"
          value={bic}
          onChange={(e) => setBic(e.target.value)}
          placeholder="BIC"
          className="w-36 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "…" : "Mitarbeiter hinzufügen"}
      </button>
      {state.error && <span className="text-sm text-rose-500">{state.error}</span>}
    </form>
  );
}

function EmployeeRow({ emp, onChanged }: { emp: LohnEmployee; onChanged: () => void }) {
  const [state, action, pending] = useActionState<SaveEmployeeState, FormData>(saveEmployeeAction, {});
  const [editing, setEditing] = useState(false);
  const [deleting, startDelete] = useTransition();

  useEffect(() => {
    if (state.success) {
      setEditing(false);
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  const onDelete = () => {
    if (!window.confirm(`Mitarbeiter „${emp.name}" wirklich löschen?`)) return;
    const fd = new FormData();
    fd.set("id", String(emp.id));
    startDelete(async () => {
      await deleteEmployeeAction(fd);
      onChanged();
    });
  };

  if (!editing) {
    return (
      <tr className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
        <td className="px-5 py-2.5 font-medium text-gray-900">{emp.name}</td>
        <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{fmtIban(emp.iban)}</td>
        <td className="px-5 py-2.5 text-gray-600">{emp.bic || "—"}</td>
        <td className="px-5 py-2.5 text-right">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50"
            >
              Bearbeiten
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50"
            >
              {deleting ? "…" : "Löschen"}
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-200 last:border-0 bg-gray-50">
      <td className="px-5 py-2.5" colSpan={4}>
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={emp.id} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">Name</span>
            <input
              name="name"
              required
              defaultValue={emp.name}
              className="w-56 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">IBAN</span>
            <input
              name="iban"
              required
              defaultValue={emp.iban}
              className="w-60 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600">BIC (optional)</span>
            <input
              name="bic"
              defaultValue={emp.bic ?? ""}
              className="w-36 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-red/60"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-red px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "…" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-red/50"
          >
            Abbrechen
          </button>
          {state.error && <span className="text-sm text-rose-500">{state.error}</span>}
        </form>
      </td>
    </tr>
  );
}
