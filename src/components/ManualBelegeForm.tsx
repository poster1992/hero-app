"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import {
  uploadBelegAction,
  updateBelegAction,
  computeBelegSumAction,
  type UploadBelegState,
} from "@/app/dashboard/belege/manual-actions";

interface AccountOption {
  number: string;
  name: string;
}

export interface ProjectOption {
  id: number;
  relativeId: number | null;
  name: string;
  customerName?: string | null;
}

/** Belegtyp für die automatische PDF-Auswertung ("" = aus, "auto" = automatisch erkennen). */
type SumTyp =
  | ""
  | "auto"
  | "lohn"
  | "bgl"
  | "mixvoip"
  | "palettecad"
  | "activite"
  | "herosoftware"
  | "circle"
  | "etges"
  | "niederer"
  | "raabkarcher"
  | "fliesenzentrum"
  | "etbkenn"
  | "kiesel"
  | "moselbaustoff"
  | "postdeep"
  | "johanntrierweiler"
  | "akemi"
  | "maroldt"
  | "hieronimi"
  | "kennerbeton"
  | "bureaucaisse"
  | "sigre"
  | "carlgeisen"
  | "wohlwert"
  | "ibod"
  | "eon"
  | "idealfliesen"
  | "garagelosch"
  | "reifenkruetten"
  | "henrichbaustoff";

/** Bezeichnung des summierten Betrags je erkanntem Typ (für die Meldung). */
const KIND_AMOUNT_LABEL: Record<string, string> = {
  lohn: "Total Brutto",
  bgl: "Total TTC",
  mixvoip: "Grand Total",
  palettecad: "Gesamtbetrag",
  activite: "Endbetrag",
  herosoftware: "Total",
  circle: "Total TTC",
  etges: "Gesamtbetrag brutto",
  niederer: "Gesamtbetrag brutto",
  raabkarcher: "Gesamtbetrag brutto",
  fliesenzentrum: "Gesamtbetrag brutto",
  etbkenn: "Gesamtbetrag brutto",
  kiesel: "Gesamtbetrag brutto",
  moselbaustoff: "Gesamtbetrag brutto",
  postdeep: "Total TTC",
  johanntrierweiler: "Gesamtbetrag brutto",
  akemi: "Gesamtbetrag brutto",
  maroldt: "Gesamtbetrag brutto",
  hieronimi: "Gesamtbetrag brutto",
  kennerbeton: "Gesamtbetrag brutto",
  bureaucaisse: "Gesamtbetrag brutto",
  sigre: "Gesamtbetrag brutto",
  carlgeisen: "Gesamtbetrag brutto",
  wohlwert: "Gesamtbetrag brutto",
  ibod: "Gesamtbetrag brutto",
  eon: "Gesamtbetrag brutto",
  idealfliesen: "Gesamtbetrag brutto",
  garagelosch: "Gesamtbetrag brutto",
  reifenkruetten: "Gesamtbetrag brutto",
  henrichbaustoff: "Gesamtbetrag brutto",
};

/** Subset of a manual receipt needed to prefill the edit form. */
export interface EditableReceipt {
  id: number;
  date: string | null;
  supplier: string | null;
  description: string | null;
  gross: number;
  vatRate: number | null;
  accountNumber: string | null;
  accountName: string | null;
  fileName: string | null;
  projectId: number | null;
  projectRelativeId: number | null;
  projectName: string | null;
  invoiceNumber: string | null;
  skontoAmount: number | null;
  skontoPayAmount: number | null;
  skontoDueDate: string | null;
}

export function ManualBelegeFormFields({
  accounts,
  projects,
  receipt,
  onSuccess,
  onCancel,
  formClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
}: {
  accounts: AccountOption[];
  projects: ProjectOption[];
  /** When set, the form edits this receipt instead of creating a new one. */
  receipt?: EditableReceipt;
  /** Nach erfolgreichem Speichern aufgerufen (z. B. Modal schließen). */
  onSuccess?: () => void;
  /** Wenn gesetzt, wird ein Abbrechen-Button angezeigt. */
  onCancel?: () => void;
  /** CSS-Klassen für das Formular-Grid (Layout je Einsatzort). */
  formClassName?: string;
}) {
  const isEdit = !!receipt;
  const [state, formAction, pending] = useActionState<UploadBelegState, FormData>(
    isEdit ? updateBelegAction : uploadBelegAction,
    {}
  );
  const [accountQuery, setAccountQuery] = useState("");
  const [account, setAccount] = useState<AccountOption | null>(
    receipt?.accountNumber
      ? { number: receipt.accountNumber, name: receipt.accountName ?? "" }
      : null
  );
  const [projectQuery, setProjectQuery] = useState("");
  const [project, setProject] = useState<ProjectOption | null>(
    receipt?.projectId
      ? {
          id: receipt.projectId,
          relativeId: receipt.projectRelativeId,
          name: receipt.projectName ?? `Projekt ${receipt.projectRelativeId ?? receipt.projectId}`,
        }
      : null
  );

  // OCR-Summe je Seite (Lohn: „Total Brutto", BGL: „Total TTC à payer").
  const fileInputRef = useRef<HTMLInputElement>(null);
  const grossInputRef = useRef<HTMLInputElement>(null);
  const vatInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const supplierInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const skontoInputRef = useRef<HTMLInputElement>(null);
  const skontoPayInputRef = useRef<HTMLInputElement>(null);
  const skontoDueInputRef = useRef<HTMLInputElement>(null);
  const [belegTyp, setBelegTyp] = useState<SumTyp>("auto");
  const [sumBusy, startSum] = useTransition();
  const [sumMsg, setSumMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isSumType = belegTyp !== "";

  // Konto vorauswählen (echtes HERO-Konto anhand Nummer, sonst Fallbackname).
  const applyAccount = (number: string, name?: string) => {
    const match = accounts.find((a) => a.number === number) ?? { number, name: name ?? number };
    setAccount(match);
    setAccountQuery("");
  };

  const runSum = () => {
    if (!isSumType) return;
    const file = fileInputRef.current?.files?.[0] ?? null;
    if (!file) {
      setSumMsg({ ok: false, text: "Bitte zuerst die Datei auswählen." });
      return;
    }
    setSumMsg(null);
    startSum(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", belegTyp);
      const res = await computeBelegSumAction(fd);
      if (res.ok && res.total != null) {
        if (grossInputRef.current) grossInputRef.current.value = res.total.toFixed(2).replace(".", ",");
        if (res.vatRate != null && vatInputRef.current) {
          vatInputRef.current.value = String(res.vatRate).replace(".", ",");
        }
        if (res.date && dateInputRef.current) dateInputRef.current.value = res.date;
        if (res.supplier && supplierInputRef.current) supplierInputRef.current.value = res.supplier;
        if (res.description && descInputRef.current) descInputRef.current.value = res.description;
        // Belegnummer + Skonto (v. a. Etges & Dächer).
        if (res.invoiceNumber && invoiceInputRef.current) invoiceInputRef.current.value = res.invoiceNumber;
        if (res.skontoAmount != null && skontoInputRef.current)
          skontoInputRef.current.value = res.skontoAmount.toFixed(2).replace(".", ",");
        if (res.skontoPayAmount != null && skontoPayInputRef.current)
          skontoPayInputRef.current.value = res.skontoPayAmount.toFixed(2).replace(".", ",");
        if (res.skontoDueDate && skontoDueInputRef.current)
          skontoDueInputRef.current.value = res.skontoDueDate;
        // Konto vorschlagen (BGL nur bei erkanntem Fahrzeug – von der Action entschieden).
        if (res.accountNumber) applyAccount(res.accountNumber, res.accountName);
        // Falls automatisch erkannt: Typ in der Auswahl übernehmen.
        if (belegTyp === "auto" && res.kind) setBelegTyp(res.kind);
        const k = res.kind ?? (belegTyp === "auto" ? undefined : belegTyp);
        const perInvoice = k !== "lohn" && k !== "bgl";
        const unit = perInvoice
          ? res.count === 1
            ? "Rechnung"
            : "Rechnungen"
          : res.count === 1
            ? "Seite"
            : "Seiten";
        const amountLabel = (k && KIND_AMOUNT_LABEL[k]) || "Betrag";
        setSumMsg({
          ok: true,
          text:
            (res.kindLabel ? `Erkannt: ${res.kindLabel} · ` : "") +
            `${res.count} ${unit} · Summe ${amountLabel} ${res.total.toLocaleString("de-DE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} €` +
            (res.vatRate != null ? ` · MwSt ${res.vatRate} %` : "") +
            (res.date ? ` · Datum ${res.date.split("-").reverse().join(".")}` : "") +
            (res.accountNumber
              ? ` · Konto ${res.accountNumber}${res.isVehicle ? " (Fahrzeug)" : ""}`
              : ""),
        });
      } else {
        setSumMsg({ ok: false, text: res.error ?? "OCR fehlgeschlagen." });
      }
    });
  };

  // Nach erfolgreichem Speichern den Aufrufer benachrichtigen (deferred, um
  // setState synchron im Effekt zu vermeiden).
  const lastSuccess = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!state.success || state.success === lastSuccess.current) return;
    lastSuccess.current = state.success;
    const t = setTimeout(() => {
      onSuccess?.();
    }, 0);
    return () => clearTimeout(t);
  }, [state.success, onSuccess]);

  const accountMatches = (() => {
    const words = accountQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0 || account) return [];
    return accounts
      .filter((a) => {
        const hay = `${a.number} ${a.name}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 12);
  })();

  const projectMatches = (() => {
    const words = projectQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0 || project) return [];
    return projects
      .filter((p) => {
        const hay = `${p.relativeId ?? ""} ${p.name} ${p.customerName ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 12);
  })();

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

  const grossDefault = receipt ? String(receipt.gross).replace(".", ",") : "";
  const vatDefault = receipt?.vatRate != null ? String(receipt.vatRate) : "";
  const invoiceDefault = receipt?.invoiceNumber ?? "";
  const skontoDefault = receipt?.skontoAmount != null ? String(receipt.skontoAmount).replace(".", ",") : "";
  const skontoPayDefault =
    receipt?.skontoPayAmount != null ? String(receipt.skontoPayAmount).replace(".", ",") : "";
  const skontoDueDefault = receipt?.skontoDueDate ?? "";

  return (
            <form action={formAction} className={formClassName}>
              {isEdit && <input type="hidden" name="id" value={receipt.id} />}
              <div>
                <label className="mb-1 block text-sm text-gray-600">
                  {isEdit ? "Datei ersetzen (optional)" : "Datei (PDF/Bild)"}
                </label>
                <input
                  ref={fileInputRef}
                  name="file"
                  type="file"
                  accept=".pdf,image/*"
                  className="w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-red file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90"
                />
                {isEdit && receipt.fileName && (
                  <p className="mt-1 text-xs text-gray-500">Aktuell: {receipt.fileName}</p>
                )}
                {/* OCR-Summe je Seite (Lohn: Total Brutto, BGL: Total TTC) → Betrag füllen. */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={belegTyp}
                    onChange={(e) => {
                      setBelegTyp(e.target.value as SumTyp);
                      setSumMsg(null);
                    }}
                    title="Automatisch aus dem PDF ausfüllen (Summe, MwSt, Datum, Lieferant, Konto)"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 outline-none focus:border-brand-red/60"
                  >
                    <option value="auto">Typ: Automatisch erkennen</option>
                    <option value="">Typ: Standard (kein Auto-Ausfüllen)</option>
                    <option value="lohn">Typ: Lohn</option>
                    <option value="bgl">Typ: BGL-Leasing</option>
                    <option value="mixvoip">Typ: Mixvoip</option>
                    <option value="palettecad">Typ: Palette CAD</option>
                    <option value="activite">Typ: Activité (Miete/NK)</option>
                    <option value="herosoftware">Typ: Hero-Software</option>
                    <option value="circle">Typ: Circle (Tankkosten)</option>
                    <option value="etges">Typ: Etges &amp; Dächer</option>
                    <option value="niederer">Typ: Niederer</option>
                    <option value="raabkarcher">Typ: Raab Karcher</option>
                    <option value="fliesenzentrum">Typ: Fliesen-Zentrum</option>
                    <option value="etbkenn">Typ: ETB Kenn</option>
                    <option value="kiesel">Typ: Kiesel</option>
                    <option value="moselbaustoff">Typ: Mosel Baustoff</option>
                    <option value="postdeep">Typ: Post Telecom / DEEP</option>
                    <option value="johanntrierweiler">Typ: Johann Trierweiler (Kfz)</option>
                    <option value="akemi">Typ: AKEMI Benelux</option>
                    <option value="maroldt">Typ: Maroldt</option>
                    <option value="hieronimi">Typ: Hieronimi</option>
                    <option value="kennerbeton">Typ: Kenner Betonwerk Eiden</option>
                    <option value="bureaucaisse">Typ: Bureau Caisse Centrale (Kfz-Steuer)</option>
                    <option value="sigre">Typ: SIGRE (Entsorgung)</option>
                    <option value="carlgeisen">Typ: Carl Geisen (Arbeitskleidung)</option>
                    <option value="wohlwert">Typ: wohlwert (Konto manuell)</option>
                    <option value="ibod">Typ: Ibod (Material)</option>
                    <option value="eon">Typ: E.On (Strom)</option>
                    <option value="idealfliesen">Typ: Idealfliesen (Subunternehmer)</option>
                    <option value="garagelosch">Typ: Garage Losch (Kfz)</option>
                    <option value="reifenkruetten">Typ: Reifen Krütten</option>
                    <option value="henrichbaustoff">Typ: Henrich Baustoffzentrum</option>
                  </select>
                  {isSumType && (
                    <button
                      type="button"
                      onClick={runSum}
                      disabled={sumBusy}
                      title="Wertet das PDF automatisch aus (Betrag, MwSt, Datum, Lieferant, Beschreibung, Konto)"
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
                    >
                      {sumBusy
                        ? belegTyp === "auto"
                          ? "Erkenne …"
                          : "Rechne …"
                        : belegTyp === "auto"
                          ? "🔎 Beleg automatisch auswerten"
                          : "🧮 Summe aus PDF"}
                    </button>
                  )}
                  {sumMsg && (
                    <span className={`text-xs ${sumMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
                      {sumMsg.text}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Belegdatum</label>
                <input ref={dateInputRef} name="date" type="date" defaultValue={receipt?.date ?? ""} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Lieferant</label>
                <input
                  ref={supplierInputRef}
                  name="supplier"
                  type="text"
                  defaultValue={receipt?.supplier ?? ""}
                  className={inputClass}
                  placeholder="z. B. Baumarkt XY"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="mb-1 block text-sm text-gray-600">Beschreibung</label>
                <input
                  ref={descInputRef}
                  name="description"
                  type="text"
                  defaultValue={receipt?.description ?? ""}
                  className={inputClass}
                  placeholder="Verwendungszweck"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Betrag (brutto) *</label>
                <input
                  ref={grossInputRef}
                  name="gross"
                  type="text"
                  inputMode="decimal"
                  required
                  defaultValue={grossDefault}
                  className={inputClass}
                  placeholder="z. B. 119,00"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">MwSt-Satz %</label>
                <input
                  ref={vatInputRef}
                  name="vatRate"
                  type="text"
                  inputMode="decimal"
                  defaultValue={vatDefault}
                  className={inputClass}
                  placeholder="z. B. 17"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Belegnummer</label>
                <input
                  ref={invoiceInputRef}
                  name="invoiceNumber"
                  type="text"
                  defaultValue={invoiceDefault}
                  className={inputClass}
                  placeholder="Rechnungs-/Belegnummer"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Skonto EUR</label>
                <input
                  ref={skontoInputRef}
                  name="skontoAmount"
                  type="text"
                  inputMode="decimal"
                  defaultValue={skontoDefault}
                  className={inputClass}
                  placeholder="z. B. 12,34"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Skontozahlbetrag</label>
                <input
                  ref={skontoPayInputRef}
                  name="skontoPayAmount"
                  type="text"
                  inputMode="decimal"
                  defaultValue={skontoPayDefault}
                  className={inputClass}
                  placeholder="Betrag abzgl. Skonto"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Skontozahlungsziel</label>
                <input
                  ref={skontoDueInputRef}
                  name="skontoDueDate"
                  type="date"
                  defaultValue={skontoDueDefault}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Konto *</label>
                {/* trägt die Auswahl ins Formular */}
                <input type="hidden" name="account" value={account ? `${account.number}|${account.name}` : ""} />
                {account ? (
                  <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
                    <span className="text-gray-900">
                      {account.number} – {account.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAccount(null);
                        setAccountQuery("");
                      }}
                      className="text-xs text-gray-400 hover:text-gray-700"
                    >
                      ✕ ändern
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={accountQuery}
                      onChange={(e) => setAccountQuery(e.target.value)}
                      placeholder="Konto suchen (Nr. oder Schlagwort) …"
                      className={inputClass}
                    />
                    {accountMatches.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                        {accountMatches.map((a) => (
                          <li key={a.number}>
                            <button
                              type="button"
                              onClick={() => {
                                setAccount(a);
                                setAccountQuery("");
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                            >
                              <span className="text-gray-500">{a.number}</span> {a.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="mb-1 block text-sm text-gray-600">Projekt (optional)</label>
                {/* trägt die Projektzuordnung ins Formular: "id|relativeId|name" */}
                <input
                  type="hidden"
                  name="project"
                  value={project ? `${project.id}|${project.relativeId ?? ""}|${project.name}` : ""}
                />
                {project ? (
                  <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
                    <span className="text-gray-900">
                      {project.relativeId != null && (
                        <span className="text-gray-500">#{project.relativeId} </span>
                      )}
                      {project.name}
                      {project.customerName ? (
                        <span className="text-gray-500"> · {project.customerName}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setProject(null);
                        setProjectQuery("");
                      }}
                      className="text-xs text-gray-400 hover:text-gray-700"
                    >
                      ✕ entfernen
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={projectQuery}
                      onChange={(e) => setProjectQuery(e.target.value)}
                      placeholder="Projekt suchen (Nr., Name oder Kunde) …"
                      className={inputClass}
                    />
                    {projectMatches.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                        {projectMatches.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setProject(p);
                                setProjectQuery("");
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                            >
                              {p.relativeId != null && (
                                <span className="text-gray-500">#{p.relativeId} </span>
                              )}
                              {p.name}
                              {p.customerName ? (
                                <span className="text-gray-500"> · {p.customerName}</span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending
                    ? "Wird gespeichert …"
                    : isEdit
                      ? "Änderungen speichern"
                      : "Beleg speichern"}
                </button>
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Abbrechen
                  </button>
                )}
                {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
                {state.success && <span className="text-sm text-emerald-600">✓ Gespeichert</span>}
              </div>
            </form>
  );
}

export default function ManualBelegeForm({
  accounts,
  projects,
  receipt,
}: {
  accounts: AccountOption[];
  projects: ProjectOption[];
  /** When set, the form edits this receipt instead of creating a new one. */
  receipt?: EditableReceipt;
}) {
  const isEdit = !!receipt;
  const [open, setOpen] = useState(false);
  return (
    <div className={isEdit ? "inline-block" : "flex items-center justify-end"}>
      {isEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
        >
          Bearbeiten
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          + Beleg hochladen
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {isEdit ? "Beleg bearbeiten" : "Beleg manuell hochladen"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
            <ManualBelegeFormFields
              accounts={accounts}
              projects={projects}
              receipt={receipt}
              onSuccess={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
