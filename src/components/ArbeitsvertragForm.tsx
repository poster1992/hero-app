"use client";

import { useMemo, useState } from "react";

interface ContractData {
  companyName: string;
  companyAddress: string;
  companyRep: string;
  employeeName: string;
  employeeAddress: string;
  employeeBirth: string;
  position: string;
  startDate: string;
  limited: boolean;
  endDate: string;
  probationMonths: string;
  weeklyHours: string;
  grossSalary: string;
  vacationDays: string;
  place: string;
  contractDate: string;
}

const EMPTY: ContractData = {
  companyName: "FLOORTEC",
  companyAddress: "",
  companyRep: "",
  employeeName: "",
  employeeAddress: "",
  employeeBirth: "",
  position: "",
  startDate: "",
  limited: false,
  endDate: "",
  probationMonths: "6",
  weeklyHours: "40",
  grossSalary: "",
  vacationDays: "25",
  place: "",
  contractDate: new Date().toISOString().slice(0, 10),
};

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "________________";
  return iso.split("-").reverse().join(".");
}

function fmtSalary(v: string): string {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  if (v.trim() && Number.isFinite(n)) {
    return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }
  return v.trim() ? v.trim() : "________________ €";
}

function ph(v: string): string {
  return v.trim() ? v.trim() : "________________";
}

interface Section {
  title?: string;
  paras: string[];
}

/** Baut die personalisierten Vertragsabschnitte aus den Eingaben. */
function buildSections(d: ContractData): Section[] {
  const sections: Section[] = [];

  sections.push({
    paras: [
      "Zwischen",
      `${ph(d.companyName)}, ${ph(d.companyAddress)}${d.companyRep.trim() ? `, vertreten durch ${d.companyRep.trim()}` : ""}`,
      "– nachfolgend „Arbeitgeber“ genannt –",
      "und",
      `${ph(d.employeeName)}, ${ph(d.employeeAddress)}${d.employeeBirth.trim() ? `, geboren am ${fmtDate(d.employeeBirth)}` : ""}`,
      "– nachfolgend „Arbeitnehmer/in“ genannt –",
      "wird folgender Arbeitsvertrag geschlossen:",
    ],
  });

  const beginn = [
    `Der/Die Arbeitnehmer/in wird ab dem ${fmtDate(d.startDate)} als ${ph(d.position)} eingestellt.`,
    d.limited
      ? `Das Arbeitsverhältnis ist befristet und endet ohne Kündigung mit Ablauf des ${fmtDate(d.endDate)}.`
      : "Das Arbeitsverhältnis wird auf unbestimmte Zeit geschlossen.",
  ];
  sections.push({ title: "§ 1 Beginn und Tätigkeit", paras: beginn });

  if (Number(d.probationMonths) > 0) {
    sections.push({
      title: "§ 2 Probezeit",
      paras: [
        `Die ersten ${ph(d.probationMonths)} Monate gelten als Probezeit. Während der Probezeit kann das Arbeitsverhältnis beiderseits mit einer Frist von zwei Wochen gekündigt werden.`,
      ],
    });
  }

  sections.push({
    title: "§ 3 Arbeitszeit",
    paras: [
      `Die regelmäßige wöchentliche Arbeitszeit beträgt ${ph(d.weeklyHours)} Stunden. Beginn und Ende der täglichen Arbeitszeit richten sich nach den betrieblichen Erfordernissen.`,
    ],
  });

  sections.push({
    title: "§ 4 Vergütung",
    paras: [
      `Der/Die Arbeitnehmer/in erhält ein monatliches Bruttogehalt von ${fmtSalary(d.grossSalary)}. Die Zahlung erfolgt jeweils zum Ende eines Kalendermonats bargeldlos auf ein vom Arbeitnehmer/von der Arbeitnehmerin anzugebendes Konto.`,
    ],
  });

  sections.push({
    title: "§ 5 Urlaub",
    paras: [
      `Der jährliche Erholungsurlaub beträgt ${ph(d.vacationDays)} Arbeitstage. Der Urlaub ist rechtzeitig zu beantragen und unter Berücksichtigung der betrieblichen Belange zu nehmen.`,
    ],
  });

  sections.push({
    title: "§ 6 Arbeitsverhinderung",
    paras: [
      "Der/Die Arbeitnehmer/in ist verpflichtet, dem Arbeitgeber jede Arbeitsverhinderung und ihre voraussichtliche Dauer unverzüglich mitzuteilen. Bei Arbeitsunfähigkeit infolge Krankheit ist spätestens am dritten Tag eine ärztliche Bescheinigung vorzulegen.",
    ],
  });

  sections.push({
    title: "§ 7 Kündigung",
    paras: [
      "Nach Ablauf der Probezeit kann das Arbeitsverhältnis unter Einhaltung der gesetzlichen Kündigungsfristen gekündigt werden. Die Kündigung bedarf zu ihrer Wirksamkeit der Schriftform.",
    ],
  });

  sections.push({
    title: "§ 8 Verschwiegenheit",
    paras: [
      "Der/Die Arbeitnehmer/in verpflichtet sich, über alle Betriebs- und Geschäftsgeheimnisse sowie sonstige vertrauliche Angelegenheiten Stillschweigen zu bewahren. Diese Pflicht besteht auch nach Beendigung des Arbeitsverhältnisses fort.",
    ],
  });

  sections.push({
    title: "§ 9 Schlussbestimmungen",
    paras: [
      "Änderungen und Ergänzungen dieses Vertrages bedürfen der Schriftform. Mündliche Nebenabreden bestehen nicht.",
      "Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, so bleibt die Wirksamkeit der übrigen Bestimmungen hiervon unberührt.",
    ],
  });

  return sections;
}

export default function ArbeitsvertragForm() {
  const [d, setD] = useState<ContractData>(EMPTY);
  const set = (k: keyof ContractData, v: string | boolean) => setD((p) => ({ ...p, [k]: v }));
  const sections = useMemo(() => buildSections(d), [d]);

  const printContract = () => {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const body = sections
      .map((sec) => {
        const head = sec.title ? `<h2>${esc(sec.title)}</h2>` : "";
        const paras = sec.paras.map((p) => `<p>${esc(p)}</p>`).join("");
        return `<section>${head}${paras}</section>`;
      })
      .join("");
    const signatures = `
      <div class="sig-line">${esc(ph(d.place))}, den ${fmtDate(d.contractDate)}</div>
      <table class="sigs"><tr>
        <td><div class="line"></div>Arbeitgeber<br/>${esc(ph(d.companyName))}</td>
        <td><div class="line"></div>Arbeitnehmer/in<br/>${esc(ph(d.employeeName))}</td>
      </tr></table>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
      <title>Arbeitsvertrag ${esc(d.employeeName)}</title>
      <style>
        @page { margin: 2.2cm; }
        * { box-sizing: border-box; }
        body { font-family: "Times New Roman", Georgia, serif; color: #000; font-size: 12pt; line-height: 1.5; }
        h1 { text-align: center; font-size: 18pt; margin: 0 0 1.4em; }
        h2 { font-size: 12.5pt; margin: 1.1em 0 0.3em; }
        p { margin: 0 0 0.5em; text-align: justify; }
        section { margin-bottom: 0.3em; }
        .sig-line { margin-top: 2.5em; }
        table.sigs { width: 100%; margin-top: 3.5em; border-collapse: collapse; }
        table.sigs td { width: 50%; vertical-align: top; padding-right: 1.5em; font-size: 10.5pt; }
        .line { border-top: 1px solid #000; margin-bottom: 0.3em; height: 0; }
      </style></head>
      <body><h1>Arbeitsvertrag</h1>${body}${signatures}</body></html>`;
    const w = window.open("", "_blank", "width=820,height=1040");
    if (!w) {
      alert("Bitte Pop-ups für diese Seite erlauben, um den Vertrag zu drucken.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Eingabe */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Angaben</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arbeitgeber</p>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Firma</label>
            <input className={inputClass} value={d.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Vertreten durch (optional)</label>
            <input className={inputClass} value={d.companyRep} onChange={(e) => set("companyRep", e.target.value)} placeholder="z.B. Pascal Oster" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">Anschrift Firma</label>
            <input className={inputClass} value={d.companyAddress} onChange={(e) => set("companyAddress", e.target.value)} placeholder="Straße Nr., PLZ Ort" />
          </div>

          <div className="sm:col-span-2 mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arbeitnehmer/in</p>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Name</label>
            <input className={inputClass} value={d.employeeName} onChange={(e) => set("employeeName", e.target.value)} placeholder="Vor- und Nachname" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Geburtsdatum</label>
            <input type="date" className={inputClass} value={d.employeeBirth} onChange={(e) => set("employeeBirth", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">Anschrift</label>
            <input className={inputClass} value={d.employeeAddress} onChange={(e) => set("employeeAddress", e.target.value)} placeholder="Straße Nr., PLZ Ort" />
          </div>

          <div className="sm:col-span-2 mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vertragsdaten</p>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Position / Tätigkeit</label>
            <input className={inputClass} value={d.position} onChange={(e) => set("position", e.target.value)} placeholder="z.B. Bodenleger/in" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Eintrittsdatum</label>
            <input type="date" className={inputClass} value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="limited" type="checkbox" checked={d.limited} onChange={(e) => set("limited", e.target.checked)} />
            <label htmlFor="limited" className="text-sm text-gray-700">Befristet</label>
            {d.limited && (
              <input type="date" className={`${inputClass} ml-2 max-w-[12rem]`} value={d.endDate} onChange={(e) => set("endDate", e.target.value)} />
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Probezeit (Monate)</label>
            <input type="number" min={0} className={inputClass} value={d.probationMonths} onChange={(e) => set("probationMonths", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Wochenstunden</label>
            <input type="number" min={0} step="0.5" className={inputClass} value={d.weeklyHours} onChange={(e) => set("weeklyHours", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Bruttogehalt / Monat</label>
            <input className={inputClass} value={d.grossSalary} onChange={(e) => set("grossSalary", e.target.value)} placeholder="z.B. 2800" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Urlaubstage / Jahr</label>
            <input type="number" min={0} className={inputClass} value={d.vacationDays} onChange={(e) => set("vacationDays", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Ort (Unterschrift)</label>
            <input className={inputClass} value={d.place} onChange={(e) => set("place", e.target.value)} placeholder="z.B. Trier" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Datum (Unterschrift)</label>
            <input type="date" className={inputClass} value={d.contractDate} onChange={(e) => set("contractDate", e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={printContract}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Drucken / als PDF speichern
          </button>
          <button
            type="button"
            onClick={() => setD(EMPTY)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Zurücksetzen
          </button>
        </div>
      </div>

      {/* Vorschau */}
      <div className="rounded-xl border border-gray-300 bg-gray-100 p-4 shadow-lg shadow-black/10">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Vorschau</p>
        <div
          className="mx-auto max-w-[800px] rounded-md bg-white px-8 py-10 text-[13px] leading-relaxed text-gray-900 shadow"
          style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
        >
          <h1 className="mb-6 text-center text-2xl font-bold">Arbeitsvertrag</h1>
          {sections.map((sec, i) => (
            <div key={i} className="mb-2">
              {sec.title && <h3 className="mt-3 mb-1 font-semibold">{sec.title}</h3>}
              {sec.paras.map((p, j) => (
                <p key={j} className="mb-1.5 text-justify">{p}</p>
              ))}
            </div>
          ))}
          <p className="mt-8">{ph(d.place)}, den {fmtDate(d.contractDate)}</p>
          <div className="mt-12 grid grid-cols-2 gap-6 text-xs">
            <div>
              <div className="border-t border-black pt-1">Arbeitgeber<br />{ph(d.companyName)}</div>
            </div>
            <div>
              <div className="border-t border-black pt-1">Arbeitnehmer/in<br />{ph(d.employeeName)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
