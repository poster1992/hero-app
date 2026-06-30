"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveContractAction,
  deleteContractAction,
  type SaveContractResult,
} from "@/app/dashboard/arbeitsvertrag/actions";
import type { SavedContract } from "@/lib/contracts";

interface ContractData {
  companyName: string;
  companyStreet: string;
  companyZipCity: string;
  employeeName: string;
  employeeStreet: string;
  employeeZipCity: string;
  employeeBirth: string;
  matrikel: string;
  startDate: string;
  position: string;
  weeklyHours: string;
  hourlyWage: string;
  index: string;
  probationMonths: string;
  additionalAgreement: string;
  place: string;
  contractDate: string;
}

const EMPTY: ContractData = {
  companyName: "FLOORTEC S.à r.l.",
  companyStreet: "11, Um Lenster Bierg",
  companyZipCity: "L-6125 Junglinster",
  employeeName: "",
  employeeStreet: "",
  employeeZipCity: "",
  employeeBirth: "",
  matrikel: "-",
  startDate: "",
  position: "",
  weeklyHours: "40",
  hourlyWage: "",
  index: "",
  probationMonths: "6",
  additionalAgreement: "-",
  place: "Junglinster",
  contractDate: new Date().toISOString().slice(0, 10),
};

/** Gespeicherte (lose getypte) Daten in ein vollständiges ContractData überführen. */
function toContractData(raw: Record<string, unknown>): ContractData {
  const out: ContractData = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof ContractData)[]) {
    const v = raw[k];
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number") out[k] = String(v);
  }
  return out;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "____________";
  return iso.split("-").reverse().join(".");
}

function v(s: string, fallback = "____________"): string {
  return s.trim() ? s.trim() : fallback;
}

interface TableSpec {
  headers: string[];
  rows: string[][];
}

interface Block {
  article?: string;
  heading?: string;
  paras: string[];
  table?: TableSpec;
  parasAfter?: string[];
}

/** Parteienblock (Arbeitnehmer / Arbeitgeber) als Label-Wert-Zeilen. */
function partyRows(d: ContractData): { employee: [string, string][]; employer: [string, string][] } {
  return {
    employee: [
      ["1) Herr/Frau:", `**${v(d.employeeName)}**`],
      ["wohnhaft in:", `${v(d.employeeStreet)}\n${v(d.employeeZipCity)}`],
      ["geboren am:", fmtDate(d.employeeBirth)],
      ["nationale Matrikelnummer:", v(d.matrikel, "-")],
    ],
    employer: [
      ["2) Dem Unternehmen:", `**${v(d.companyName)}**`],
      ["mit Sitz in:", `${v(d.companyStreet)}\n${v(d.companyZipCity)}`],
    ],
  };
}

/** Baut die personalisierte FLOORTEC-Vertragsvorlage (Wortlaut der Muster-PDF). */
function buildBlocks(d: ContractData): Block[] {
  return [
    {
      article: "Artikel 1",
      paras: [
        `Der unter 1) bezeichnete Arbeitnehmer tritt ab dem **${fmtDate(d.startDate)}** in die Dienste des unter 2) bezeichneten Arbeitgebers ein.`,
      ],
    },
    {
      article: "Artikel 2",
      paras: [
        "Die Arbeitsleistung wird vorwiegend an der Betriebsadresse des Unternehmens erbracht. Ungeachtet vorstehendem, erklärt der Arbeitnehmer sein Einverständnis für den Fall, dass er seine Leistung auch an anderen Betriebsstätten des Arbeitgebers oder dessen Kunden erbringen muss, wenn er entsendet wird.",
      ],
    },
    {
      article: "Artikel 3",
      paras: [
        `Der Arbeitnehmer wird, unbeachtet einer späteren Zuweisung, die den beruflichen und persönlichen Fähigkeiten des Arbeitnehmers oder des Unternehmens Rechnung tragen, unter Beachtung des Artikels L.121-7 des Arbeitsgesetzbuchs, als **${v(d.position)}** eingestellt.`,
      ],
    },
    {
      article: "Artikel 4",
      paras: [
        `Die normale Arbeitszeit beträgt **${v(d.weeklyHours)}** Stunden pro Woche.`,
        "Die Arbeitszeit und der (die) wöchentliche(n) Ruhetag(e) dürfen den Bedürfnissen des Unternehmens angepasst werden und können dementsprechend ändern.",
      ],
    },
    {
      article: "Artikel 5",
      paras: [
        `Der Anfangsbruttolohn oder Anfangsgehalt ist auf **${v(d.hourlyWage)}** pro Stunde, Index **${v(d.index)}** festgelegt.`,
        "Der Bruttolohn oder das Bruttogehalt werden am Ende des Monats unter Abzug der gesetzlich vorgesehenen Soziallasten (inklusive der Pflegeversicherung) und Steuern ausbezahlt.",
      ],
    },
    {
      article: "Artikel 6",
      paras: [
        "Die Dauer des jährlichen Erholungsurlaubs wird durch die Bestimmungen der Artikel L.233-1 bis L.233-20 des Arbeitsgesetzbuches geregelt.",
        "Prinzipiell wird der Urlaub aufgrund des, von dem Arbeitnehmer geäußerten Wunschs, und unter Vorbehalt, dass die Bedürfnisse des Unternehmens es gestatten respektive die anderen Arbeitnehmer sich dessen nicht widersetzen, gewährt.",
        "Außer, wenn eine Bestimmung eine günstigere Regelung aufweist, beträgt der jährliche Erholungsurlaub 26 Arbeitstage pro Jahr.",
        "Der Erholungsurlaub, der bis zum Jahresende nicht vom Arbeitnehmer genommen wurde, verfällt wenn Arbeitgeber und Arbeitnehmer diesbezüglich keine Einigung erzielen.",
        "Der Erholungsurlaub kann dem Arbeitnehmer verweigert werden, wenn dessen ungerechtfertigte Abwesenheit, die auf den abgelaufenen Teil des Jahrs berechnet wird, 10 Prozent der Zeit überschreiten, in der er normalerweise hätte arbeiten müssen.",
      ],
    },
    {
      article: "Artikel 7",
      paras: [
        "Bei krankheitsbedingter Arbeitsunfähigkeit oder bei einer Arbeitsunfähigkeit aufgrund eines Unfalls, verpflichtet sich der Arbeitnehmer, den Arbeitgeber, am Tag wo diese Arbeitsunfähigkeit eintritt, vor neun Uhr zu informieren.",
        "Spätestens am dritten Tag seiner Abwesenheit überbringt der Arbeitnehmer dem Arbeitgeber eine ärztliche Bescheinigung bezüglich der Arbeitsunfähigkeit ab dem ersten Krankentag sowie die voraussichtliche Dauer der Krankheit.",
      ],
    },
    {
      article: "Artikel 8",
      paras: [
        `Die **${v(d.probationMonths)} Monate** nach Arbeitsbeginn stellen die Probezeit dar. Diese Probezeit wird durch die diesbezüglichen gesetzlichen Bestimmungen geregelt.`,
      ],
    },
    {
      article: "Artikel 9",
      heading: "KÜNDIGUNG DES ARBEITSVERTRAGS WÄHREND DER PROBEZEIT",
      paras: [
        "Der Mindestprobezeit von zwei Wochen kann nicht, außer bei schwerwiegender Verfehlung, ein Ende gesetzt werden.",
        "Nach Ablauf der zwei Wochen kann der Vertrag auf Probe, von beiden Seiten durch eingeschriebenen Brief, oder durch Unterschrift auf der Ablichtung des Briefs, unter Wahrung folgender Kündigungsfristen, gekündigt werden:",
      ],
      table: {
        headers: ["Dauer der Probezeit", "Kündigungsfrist"],
        rows: [
          ["bis 4 Wochen", "4 Kalendertage"],
          ["bis 3 Monate", "15 Kalendertage"],
          ["bis 6 Monate", "24 Kalendertage"],
        ],
      },
      parasAfter: [
        "Wenn keine der Vertragsparteien vor Ende der vereinbarten Probezeit der anderen Partei, unter Wahrung der gesetzlichen Kündigungsfrist von 24 Kalendertagen mittels eingeschriebenen Briefs, informiert hat, wird gegenwärtiger Vertrag als ein, endgültig und auf unbestimmte Zeit abgeschlossener, Vertrag betrachtet, und zwar von dem Tag an wo der Arbeitnehmer in die Dienste des Arbeitgebers eingetreten ist.",
      ],
    },
    {
      article: "Artikel 10",
      paras: [
        "Nach dem Ende der Probezeit kann gegenwärtiger Vertrag mittels eingeschriebenen Briefs, respektive durch die, auf der Ablichtung des Briefes eingetragene Unterschrift unter Wahrung nachstehender Kündigungsfristen, gekündigt werden:",
      ],
      heading: "KÜNDIGUNGSFRISTEN",
      table: {
        headers: ["Dienstalter", "für den Arbeitgeber", "für den Arbeitnehmer"],
        rows: [
          ["unter fünf (5) Jahre", "zwei (2) Monate", "ein (1) Monat"],
          ["zwischen fünf (5) Jahren und zehn (10) Jahren", "vier (4) Monate", "zwei (2) Monate"],
          ["bei zehn (10) Jahren und mehr", "sechs (6) Monate", "drei (3) Monate"],
        ],
      },
      parasAfter: ["Die Kündigungsfristen können erst am 15. oder am 1. des Kalendermonats beginnen."],
    },
    {
      article: "Artikel 11",
      paras: [
        "Der Arbeitnehmer verpflichtet sich seine Fähigkeiten und sein Wissen sowie seine beruflichen Tätigkeiten ausschließlich des Dienstes seines Arbeitgebers zu widmen und dies unabhängig von den, ihm zugewiesenen oder zugeteilten Bereichen.",
      ],
    },
    {
      article: "Artikel 12",
      paras: [
        "Der Arbeitnehmer verpflichtet sich, alle Informationen im Zusammenhang mit den Aktivitäten des Arbeitgebers, die er während seiner Dienstzeit für den Arbeitgeber erhalten hat, seien sie mündlich oder schriftlich, als vertrauliche Informationen zu behandeln und sie keiner dritten Person weiterzugeben, sie für seine eigenen Zwecke zu verwenden oder in irgendeiner Weise zu verbreiten.",
      ],
    },
    {
      article: "Artikel 13",
      paras: [
        "Der Arbeitnehmer verpflichtet sich, während seiner Dienstzeit sich korrekt und seiner Arbeit angemessen zu kleiden und sich gegenüber anderen Personen zuvorkommend zu verhalten.",
      ],
    },
    {
      article: "Artikel 14",
      paras: [
        "Gegenwärtiger Arbeitsvertrag unterliegt den gesetzlichen Bestimmungen und insbesondere dem Arbeitsgesetzbuchs sowie dem Tarifvertrag, dem das Unternehmen gegebenenfalls unterliegt.",
      ],
    },
    {
      article: "Artikel 15",
      paras: [
        "Die Vertragsparteien vereinbaren ausdrücklich, dass gegenwärtiger Vertrag nur dann zum Tragen kommt, wenn dem Arbeitnehmer, im Rahmen der arbeitsmedizinischen Untersuchung bei der Einstellung, bescheinigt wird, dass er den Posten, für den er eingestellt wird, auch ausüben kann.",
        "Sollte bei der arbeitsmedizinischen Untersuchung bei der Einstellung festgestellt werden, dass der Arzt der Arbeitsmediziner eine Untauglichkeit für den Posten feststellt, wird gegenwärtiger Vertrag aufgelöst und beendet.",
        "Das Vertragsende tritt an dem Tag ein, wo der Arbeitgeber die Bescheinigung des arbeitsmedizinischen Dienstes empfängt.",
      ],
    },
    {
      article: "Artikel 16",
      paras: [
        "Der Arbeitnehmer bestätigt keine Drogen zu nehmen, nicht alkoholabhängig zu sein, keine körperliche Beeinträchtigung, Behinderung oder Krankheit zu haben, die während der Dauer von seinem Arbeitsverhältnis eine Invalidität oder Krankheit mit sich führen würde. Es wurde ausdrücklich unter beiden Parteien vereinbart und anerkannt durch den Arbeitnehmer, dass jeglicher Verbrauch von Drogen und Alkohol während der Arbeit und vom Arbeitsverhältnis eine schwere Verfehlung ist, was zur Kündigung des Arbeitsvertrages mit sofortiger Wirkung führen könnte.",
      ],
    },
    {
      article: "Artikel 17",
      heading: "Abweichende und zusätzliche Vereinbarungen",
      paras: [`Zusatzvereinbarung: ${v(d.additionalAgreement, "-")}`],
    },
    {
      paras: [
        "Der Arbeitnehmer bescheinigt und erklärt ausdrücklich, dass er ein unterzeichnetes Exemplar gegenwärtigen Arbeitsvertrags bei der Unterzeichnung erhalten hat.",
        `Erstellt in zweifacher Ausführung in ${v(d.place)}, am ${fmtDate(d.contractDate)}.`,
      ],
    },
  ];
}

/** Inline **fett** in JSX rendern. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
      )}
    </>
  );
}

/** Mehrzeiliger Wert (\n) mit **fett** für die Parteien-Tabelle. */
function PartyVal({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((ln, i) => (
        <div key={i}>
          <Rich text={ln} />
        </div>
      ))}
    </>
  );
}

function PartyTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="my-1 ml-3 border-collapse">
      <tbody>
        {rows.map(([k, val], i) => (
          <tr key={i}>
            <td className="w-[5.4cm] pr-2 align-top">{k}</td>
            <td className="align-top">
              <PartyVal text={val} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TITLE = "ARBEITSVERTRAG AUF UNBEFRISTETE ZEIT";

export default function ArbeitsvertragForm({ contracts }: { contracts: SavedContract[] }) {
  const [d, setD] = useState<ContractData>(EMPTY);
  const set = (k: keyof ContractData, val: string) => setD((p) => ({ ...p, [k]: val }));
  const blocks = useMemo(() => buildBlocks(d), [d]);
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [busy, startBusy] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const printData = (data: ContractData) => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rich = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const blks = buildBlocks(data);
    const body = blks
      .map((b) => {
        const art = b.article ? `<div class="art">${esc(b.article)}</div>` : "";
        const head = b.heading ? `<div class="head">${esc(b.heading)}</div>` : "";
        const paras = b.paras.map((p) => `<p>${rich(p)}</p>`).join("");
        let table = "";
        if (b.table) {
          const th = b.table.headers.map((h) => `<th>${esc(h)}</th>`).join("");
          const tr = b.table.rows
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
            .join("");
          table = `<table class="kf"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
        }
        const after = (b.parasAfter ?? []).map((p) => `<p>${rich(p)}</p>`).join("");
        return `<section>${art}${head}${paras}${table}${after}</section>`;
      })
      .join("");
    const { employee, employer } = partyRows(data);
    const partyTable = (rows: [string, string][]) =>
      `<table class="party">${rows
        .map(
          ([k, val]) =>
            `<tr><td class="k">${esc(k)}</td><td class="val">${rich(val).replace(/\n/g, "<br/>")}</td></tr>`
        )
        .join("")}</table>`;
    const parties = `
      <p class="lead">Zwischen</p>
      ${partyTable(employee)}
      <p class="lead">Arbeitnehmer einerseits,</p>
      <p class="lead">und</p>
      ${partyTable(employer)}
      <p class="lead">als Arbeitgeber andererseits,</p>
      <p>wurde folgender Arbeitsvertrag auf unbestimmte Zeit, der den Bestimmungen des Arbeitsgesetzbuches unterliegt, abgeschlossen.</p>`;
    const letterhead = `
      <div class="lh">
        <div class="brand">FLOORTEC</div>
        <div class="lh-meta">${esc(v(data.companyName, ""))}<br/>${esc(v(data.companyStreet, ""))} · ${esc(v(data.companyZipCity, ""))}</div>
      </div>`;
    const sigs = `<table class="sigs"><tr>
        <td><div class="line"></div><div class="who">Der Arbeitnehmer</div><div class="who-sub">${esc(v(data.employeeName, ""))}</div></td>
        <td><div class="line"></div><div class="who">Der Arbeitgeber</div><div class="who-sub">${esc(v(data.companyName, ""))}<br/>${esc(v(data.companyStreet, ""))}, ${esc(v(data.companyZipCity, ""))}</div></td>
      </tr></table>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
      <title>Arbeitsvertrag ${esc(data.employeeName)}</title>
      <style>
        @page { margin: 1.8cm 2cm; }
        * { box-sizing: border-box; }
        body { font-family: "Times New Roman", Georgia, serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; }
        .lh { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #c01818; padding-bottom: 6px; margin-bottom: 1.5em; }
        .brand { font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 22pt; letter-spacing: 4px; color: #c01818; line-height: 1; }
        .lh-meta { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #555; text-align: right; line-height: 1.35; }
        h1 { text-align: center; font-size: 14pt; letter-spacing: 1px; text-decoration: underline; margin: 0 0 1.4em; }
        .lead { margin: 0.35em 0; }
        table.party { border-collapse: collapse; margin: 0.1em 0 0.1em 0.4cm; }
        table.party td { vertical-align: top; padding: 1px 0; }
        table.party td.k { width: 5.4cm; padding-right: 0.5cm; }
        .art { font-weight: bold; text-decoration: underline; margin: 1.15em 0 0.3em; }
        .head { font-weight: bold; text-decoration: underline; text-align: center; margin: 0.5em 0; letter-spacing: 0.5px; }
        p { margin: 0 0 0.5em; text-align: justify; }
        section { margin-bottom: 0.15em; }
        table.kf { margin: 0.7em auto; border-collapse: collapse; }
        table.kf th { padding: 0.2em 1.3em; text-align: center; font-weight: bold; border-bottom: 1px solid #999; }
        table.kf td { padding: 0.18em 1.3em; text-align: center; }
        table.sigs { width: 100%; margin-top: 4.5em; border-collapse: collapse; }
        table.sigs td { width: 50%; vertical-align: top; padding-right: 2.5em; font-size: 10pt; }
        .line { border-top: 1px solid #000; margin-bottom: 0.3em; height: 3em; }
        .who { font-weight: 600; }
        .who-sub { color: #444; font-size: 9pt; }
        section, table.kf, p { page-break-inside: avoid; }
      </style></head>
      <body>${letterhead}<h1>${esc(TITLE)}</h1>${parties}${body}${sigs}</body></html>`;
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

  const saveContract = () => {
    setMsg(null);
    startSave(async () => {
      const res: SaveContractResult = await saveContractAction(d.employeeName, { ...d });
      if (res.ok) {
        setMsg("Vertrag gespeichert.");
        router.refresh();
      } else {
        setMsg(res.error ?? "Speichern fehlgeschlagen.");
      }
    });
  };

  const loadContract = (c: SavedContract) => {
    setD(toContractData(c.data));
    setMsg(`„${c.employeeName}" geladen.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeContract = (id: number) => {
    if (!window.confirm("Diesen gespeicherten Vertrag löschen?")) return;
    startBusy(async () => {
      await deleteContractAction(id);
      router.refresh();
    });
  };

  const fmtStamp = (s: string | null) => {
    if (!s) return "";
    const dt = new Date(s.replace(" ", "T"));
    return Number.isNaN(dt.getTime())
      ? s
      : dt.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Eingabe */}
      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Angaben</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arbeitnehmer</p>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">Name</label>
            <input className={inputClass} value={d.employeeName} onChange={(e) => set("employeeName", e.target.value)} placeholder="z.B. Engels Willi" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Straße / Nr.</label>
            <input className={inputClass} value={d.employeeStreet} onChange={(e) => set("employeeStreet", e.target.value)} placeholder="Merowingerstraße 50" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">PLZ / Ort</label>
            <input className={inputClass} value={d.employeeZipCity} onChange={(e) => set("employeeZipCity", e.target.value)} placeholder="D-54293 Trier" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Geboren am</label>
            <input type="date" className={inputClass} value={d.employeeBirth} onChange={(e) => set("employeeBirth", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Nationale Matrikelnummer</label>
            <input className={inputClass} value={d.matrikel} onChange={(e) => set("matrikel", e.target.value)} placeholder="-" />
          </div>

          <div className="sm:col-span-2 mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arbeitgeber</p>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">Unternehmen</label>
            <input className={inputClass} value={d.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Straße / Nr.</label>
            <input className={inputClass} value={d.companyStreet} onChange={(e) => set("companyStreet", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">PLZ / Ort</label>
            <input className={inputClass} value={d.companyZipCity} onChange={(e) => set("companyZipCity", e.target.value)} />
          </div>

          <div className="sm:col-span-2 mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vertragsdaten</p>
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Eintrittsdatum (Art. 1)</label>
            <input type="date" className={inputClass} value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Position / Tätigkeit (Art. 3)</label>
            <input className={inputClass} value={d.position} onChange={(e) => set("position", e.target.value)} placeholder="FLIESENLEGER" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Wochenstunden (Art. 4)</label>
            <input className={inputClass} value={d.weeklyHours} onChange={(e) => set("weeklyHours", e.target.value)} placeholder="40" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Stundenlohn brutto (Art. 5)</label>
            <input className={inputClass} value={d.hourlyWage} onChange={(e) => set("hourlyWage", e.target.value)} placeholder="25,50 €" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Index (Art. 5)</label>
            <input className={inputClass} value={d.index} onChange={(e) => set("index", e.target.value)} placeholder="992,24" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Probezeit in Monaten (Art. 8)</label>
            <input className={inputClass} value={d.probationMonths} onChange={(e) => set("probationMonths", e.target.value)} placeholder="6" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-gray-600">Zusatzvereinbarung (Art. 17)</label>
            <textarea className={inputClass} rows={2} value={d.additionalAgreement} onChange={(e) => set("additionalAgreement", e.target.value)} placeholder="-" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Ort (Unterschrift)</label>
            <input className={inputClass} value={d.place} onChange={(e) => set("place", e.target.value)} placeholder="Junglinster" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Datum (Unterschrift)</label>
            <input type="date" className={inputClass} value={d.contractDate} onChange={(e) => set("contractDate", e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveContract}
            disabled={saving}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Speichert …" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={() => printData(d)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:border-brand-red/50"
          >
            Drucken / als PDF
          </button>
          <button
            type="button"
            onClick={() => setD(EMPTY)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Zurücksetzen
          </button>
          {msg && <span className="text-sm text-gray-500">{msg}</span>}
        </div>

        {/* Gespeicherte Verträge */}
        <div className="mt-5 border-t border-gray-200 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Gespeicherte Verträge <span className="font-normal text-gray-400">({contracts.length})</span>
          </h3>
          {contracts.length === 0 ? (
            <p className="text-sm text-gray-400">Noch keine gespeicherten Verträge.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {contracts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{c.employeeName}</p>
                    <p className="text-xs text-gray-400">
                      {fmtStamp(c.createdAt)}
                      {c.createdByName ? ` · ${c.createdByName}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => loadContract(c)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50">
                    Laden
                  </button>
                  <button type="button" onClick={() => printData(toContractData(c.data))} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50">
                    Drucken
                  </button>
                  <button type="button" onClick={() => removeContract(c.id)} disabled={busy} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50">
                    Löschen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Vorschau */}
      <div className="rounded-xl border border-gray-300 bg-gray-100 p-4 shadow-lg shadow-black/10">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Vorschau</p>
        <div
          className="mx-auto max-w-[800px] rounded-md bg-white px-8 py-10 text-[12.5px] leading-relaxed text-gray-900 shadow"
          style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
        >
          {/* Briefkopf */}
          <div className="mb-5 flex items-end justify-between border-b-2 border-[#c01818] pb-1.5">
            <span
              className="text-2xl font-extrabold tracking-[0.25em] text-[#c01818]"
              style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
            >
              FLOORTEC
            </span>
            <span
              className="text-right text-[9px] leading-tight text-gray-500"
              style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
            >
              {v(d.companyName, "")}
              <br />
              {v(d.companyStreet, "")} · {v(d.companyZipCity, "")}
            </span>
          </div>

          <h1 className="mb-5 text-center text-base font-bold uppercase tracking-wide underline">{TITLE}</h1>

          {/* Parteien */}
          <p className="my-1.5">Zwischen</p>
          <PartyTable rows={partyRows(d).employee} />
          <p className="my-1.5">Arbeitnehmer einerseits,</p>
          <p className="my-1.5">und</p>
          <PartyTable rows={partyRows(d).employer} />
          <p className="my-1.5">als Arbeitgeber andererseits,</p>
          <p className="mb-3 text-justify">
            wurde folgender Arbeitsvertrag auf unbestimmte Zeit, der den Bestimmungen des
            Arbeitsgesetzbuches unterliegt, abgeschlossen.
          </p>

          {blocks.map((b, i) => (
            <div key={i} className="mb-2">
              {b.article && <p className="mt-3 font-bold underline">{b.article}</p>}
              {b.heading && <p className="text-center font-bold underline">{b.heading}</p>}
              {b.paras.map((p, j) => (
                <p key={j} className="mb-1 text-justify">
                  <Rich text={p} />
                </p>
              ))}
              {b.table && (
                <table className="mx-auto my-2 w-[90%] border-collapse">
                  <thead>
                    <tr>
                      {b.table.headers.map((h, k) => (
                        <th key={k} className="px-2 py-0.5 text-center font-bold underline">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.table.rows.map((r, k) => (
                      <tr key={k}>
                        {r.map((cell, m) => (
                          <td key={m} className="px-2 py-0.5 text-center">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(b.parasAfter ?? []).map((p, j) => (
                <p key={`a${j}`} className="mb-1 text-justify">
                  <Rich text={p} />
                </p>
              ))}
            </div>
          ))}
          <div className="mt-16 grid grid-cols-2 gap-8 text-xs">
            <div className="border-t border-black pt-1">
              <span className="font-semibold">Der Arbeitnehmer</span>
              <div className="text-[10px] text-gray-500">{v(d.employeeName, "")}</div>
            </div>
            <div className="border-t border-black pt-1">
              <span className="font-semibold">Der Arbeitgeber</span>
              <div className="text-[10px] text-gray-500">
                {v(d.companyName, "")}
                <br />
                {v(d.companyStreet, "")}, {v(d.companyZipCity, "")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
