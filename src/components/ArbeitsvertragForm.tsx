"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveContractAction,
  deleteContractAction,
  type SaveContractResult,
} from "@/app/dashboard/arbeitsvertrag/actions";
import type { SavedContract, DocKind } from "@/lib/contracts";

interface ContractData {
  // Arbeitgeber
  companyName: string;
  companyStreet: string;
  companyZipCity: string;
  // Arbeitnehmer (gemeinsam)
  lastName: string;
  firstName: string;
  geburtsname: string;
  employeeStreet: string;
  employeeZipCity: string;
  employeeBirth: string;
  matrikel: string; // Versicherungs-/Matrikelnummer
  // Vertragsdaten (gemeinsam)
  startDate: string;
  position: string;
  weeklyHours: string;
  hourlyWage: string;
  index: string;
  probationMonths: string;
  additionalAgreement: string;
  place: string;
  contractDate: string;
  // Personalfragebogen – Zusatzangaben
  personalnummer: string;
  geschlecht: string; // "m" | "w"
  familienstand: string;
  familienstandSeit: string;
  geburtsort: string;
  staatsangehoerigkeit: string;
  anzahlKinder: string;
  ehegatte: string;
  email: string;
  iban: string;
  status: string; // "angestellter" | "leitender" | "geschaeftsfuehrer"
  hoechsterAbschluss: string;
  urlaubsanspruch: string;
  qualifikation: string; // "qualifiziert" | "unqualifiziert"
  vertragArt: string; // "befristet" | "unbefristet"
  befristetBis: string;
  taegMo: string;
  taegDi: string;
  taegMi: string;
  taegDo: string;
  taegFr: string;
  taegSa: string;
  probezeitVom: string;
  probezeitBis: string;
  bruttogehaltBetrag: string;
  bruttogehaltGueltigAb: string;
  stundenlohnGueltigAb: string;
  aerztlich: string; // "ja" | "nein"
  weitereBesch: string; // "ja" | "nein"
  weitereWelche: string;
}

const EMPTY: ContractData = {
  companyName: "FLOORTEC S.à r.l.",
  companyStreet: "11, Um Lenster Bierg",
  companyZipCity: "L-6125 Junglinster",
  lastName: "",
  firstName: "",
  geburtsname: "",
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
  personalnummer: "",
  geschlecht: "",
  familienstand: "",
  familienstandSeit: "",
  geburtsort: "",
  staatsangehoerigkeit: "",
  anzahlKinder: "",
  ehegatte: "",
  email: "",
  iban: "",
  status: "angestellter",
  hoechsterAbschluss: "",
  urlaubsanspruch: "26",
  qualifikation: "",
  vertragArt: "unbefristet",
  befristetBis: "",
  taegMo: "8",
  taegDi: "8",
  taegMi: "8",
  taegDo: "8",
  taegFr: "8",
  taegSa: "",
  probezeitVom: "",
  probezeitBis: "",
  bruttogehaltBetrag: "",
  bruttogehaltGueltigAb: "",
  stundenlohnGueltigAb: "",
  aerztlich: "",
  weitereBesch: "",
  weitereWelche: "",
};

function toContractData(raw: Record<string, unknown>): ContractData {
  const out: ContractData = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof ContractData)[]) {
    const val = raw[k];
    if (typeof val === "string") out[k] = val;
    else if (typeof val === "number") out[k] = String(val);
  }
  // Rückwärtskompatibel: früher gab es employeeName statt lastName/firstName.
  if (!out.lastName && !out.firstName && typeof raw.employeeName === "string") {
    const parts = (raw.employeeName as string).trim().split(/\s+/);
    out.lastName = parts[0] ?? "";
    out.firstName = parts.slice(1).join(" ");
  }
  return out;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-red/60";

function fmtDate(iso: string, fallback = ""): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || fallback;
  return iso.split("-").reverse().join(".");
}

function v(s: string, fallback = "____________"): string {
  return s.trim() ? s.trim() : fallback;
}

function fullName(d: ContractData): string {
  return `${d.lastName} ${d.firstName}`.trim();
}

const escHtml = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rich = (s: string) => escHtml(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

// ---------------------------------------------------------------------------
// Arbeitsvertrag (Wortlaut der Muster-PDF)
// ---------------------------------------------------------------------------

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

function partyRows(d: ContractData): { employee: [string, string][]; employer: [string, string][] } {
  return {
    employee: [
      ["1) Herr/Frau:", `**${v(fullName(d))}**`],
      ["wohnhaft in:", `${v(d.employeeStreet)}\n${v(d.employeeZipCity)}`],
      ["geboren am:", fmtDate(d.employeeBirth, "____________")],
      ["nationale Matrikelnummer:", v(d.matrikel, "-")],
    ],
    employer: [
      ["2) Dem Unternehmen:", `**${v(d.companyName)}**`],
      ["mit Sitz in:", `${v(d.companyStreet)}\n${v(d.companyZipCity)}`],
    ],
  };
}

function buildBlocks(d: ContractData): Block[] {
  return [
    { article: "Artikel 1", paras: [`Der unter 1) bezeichnete Arbeitnehmer tritt ab dem **${fmtDate(d.startDate, "____________")}** in die Dienste des unter 2) bezeichneten Arbeitgebers ein.`] },
    { article: "Artikel 2", paras: ["Die Arbeitsleistung wird vorwiegend an der Betriebsadresse des Unternehmens erbracht. Ungeachtet vorstehendem, erklärt der Arbeitnehmer sein Einverständnis für den Fall, dass er seine Leistung auch an anderen Betriebsstätten des Arbeitgebers oder dessen Kunden erbringen muss, wenn er entsendet wird."] },
    { article: "Artikel 3", paras: [`Der Arbeitnehmer wird, unbeachtet einer späteren Zuweisung, die den beruflichen und persönlichen Fähigkeiten des Arbeitnehmers oder des Unternehmens Rechnung tragen, unter Beachtung des Artikels L.121-7 des Arbeitsgesetzbuchs, als **${v(d.position)}** eingestellt.`] },
    { article: "Artikel 4", paras: [`Die normale Arbeitszeit beträgt **${v(d.weeklyHours)}** Stunden pro Woche.`, "Die Arbeitszeit und der (die) wöchentliche(n) Ruhetag(e) dürfen den Bedürfnissen des Unternehmens angepasst werden und können dementsprechend ändern."] },
    { article: "Artikel 5", paras: [`Der Anfangsbruttolohn oder Anfangsgehalt ist auf **${v(d.hourlyWage)}** pro Stunde, Index **${v(d.index)}** festgelegt.`, "Der Bruttolohn oder das Bruttogehalt werden am Ende des Monats unter Abzug der gesetzlich vorgesehenen Soziallasten (inklusive der Pflegeversicherung) und Steuern ausbezahlt."] },
    { article: "Artikel 6", paras: ["Die Dauer des jährlichen Erholungsurlaubs wird durch die Bestimmungen der Artikel L.233-1 bis L.233-20 des Arbeitsgesetzbuches geregelt.", "Prinzipiell wird der Urlaub aufgrund des, von dem Arbeitnehmer geäußerten Wunschs, und unter Vorbehalt, dass die Bedürfnisse des Unternehmens es gestatten respektive die anderen Arbeitnehmer sich dessen nicht widersetzen, gewährt.", "Außer, wenn eine Bestimmung eine günstigere Regelung aufweist, beträgt der jährliche Erholungsurlaub 26 Arbeitstage pro Jahr.", "Der Erholungsurlaub, der bis zum Jahresende nicht vom Arbeitnehmer genommen wurde, verfällt wenn Arbeitgeber und Arbeitnehmer diesbezüglich keine Einigung erzielen.", "Der Erholungsurlaub kann dem Arbeitnehmer verweigert werden, wenn dessen ungerechtfertigte Abwesenheit, die auf den abgelaufenen Teil des Jahrs berechnet wird, 10 Prozent der Zeit überschreiten, in der er normalerweise hätte arbeiten müssen."] },
    { article: "Artikel 7", paras: ["Bei krankheitsbedingter Arbeitsunfähigkeit oder bei einer Arbeitsunfähigkeit aufgrund eines Unfalls, verpflichtet sich der Arbeitnehmer, den Arbeitgeber, am Tag wo diese Arbeitsunfähigkeit eintritt, vor neun Uhr zu informieren.", "Spätestens am dritten Tag seiner Abwesenheit überbringt der Arbeitnehmer dem Arbeitgeber eine ärztliche Bescheinigung bezüglich der Arbeitsunfähigkeit ab dem ersten Krankentag sowie die voraussichtliche Dauer der Krankheit."] },
    { article: "Artikel 8", paras: [`Die **${v(d.probationMonths)} Monate** nach Arbeitsbeginn stellen die Probezeit dar. Diese Probezeit wird durch die diesbezüglichen gesetzlichen Bestimmungen geregelt.`] },
    {
      article: "Artikel 9",
      heading: "KÜNDIGUNG DES ARBEITSVERTRAGS WÄHREND DER PROBEZEIT",
      paras: ["Der Mindestprobezeit von zwei Wochen kann nicht, außer bei schwerwiegender Verfehlung, ein Ende gesetzt werden.", "Nach Ablauf der zwei Wochen kann der Vertrag auf Probe, von beiden Seiten durch eingeschriebenen Brief, oder durch Unterschrift auf der Ablichtung des Briefs, unter Wahrung folgender Kündigungsfristen, gekündigt werden:"],
      table: { headers: ["Dauer der Probezeit", "Kündigungsfrist"], rows: [["bis 4 Wochen", "4 Kalendertage"], ["bis 3 Monate", "15 Kalendertage"], ["bis 6 Monate", "24 Kalendertage"]] },
      parasAfter: ["Wenn keine der Vertragsparteien vor Ende der vereinbarten Probezeit der anderen Partei, unter Wahrung der gesetzlichen Kündigungsfrist von 24 Kalendertagen mittels eingeschriebenen Briefs, informiert hat, wird gegenwärtiger Vertrag als ein, endgültig und auf unbestimmte Zeit abgeschlossener, Vertrag betrachtet, und zwar von dem Tag an wo der Arbeitnehmer in die Dienste des Arbeitgebers eingetreten ist."],
    },
    {
      article: "Artikel 10",
      paras: ["Nach dem Ende der Probezeit kann gegenwärtiger Vertrag mittels eingeschriebenen Briefs, respektive durch die, auf der Ablichtung des Briefes eingetragene Unterschrift unter Wahrung nachstehender Kündigungsfristen, gekündigt werden:"],
      heading: "KÜNDIGUNGSFRISTEN",
      table: { headers: ["Dienstalter", "für den Arbeitgeber", "für den Arbeitnehmer"], rows: [["unter fünf (5) Jahre", "zwei (2) Monate", "ein (1) Monat"], ["zwischen fünf (5) Jahren und zehn (10) Jahren", "vier (4) Monate", "zwei (2) Monate"], ["bei zehn (10) Jahren und mehr", "sechs (6) Monate", "drei (3) Monate"]] },
      parasAfter: ["Die Kündigungsfristen können erst am 15. oder am 1. des Kalendermonats beginnen."],
    },
    { article: "Artikel 11", paras: ["Der Arbeitnehmer verpflichtet sich seine Fähigkeiten und sein Wissen sowie seine beruflichen Tätigkeiten ausschließlich des Dienstes seines Arbeitgebers zu widmen und dies unabhängig von den, ihm zugewiesenen oder zugeteilten Bereichen."] },
    { article: "Artikel 12", paras: ["Der Arbeitnehmer verpflichtet sich, alle Informationen im Zusammenhang mit den Aktivitäten des Arbeitgebers, die er während seiner Dienstzeit für den Arbeitgeber erhalten hat, seien sie mündlich oder schriftlich, als vertrauliche Informationen zu behandeln und sie keiner dritten Person weiterzugeben, sie für seine eigenen Zwecke zu verwenden oder in irgendeiner Weise zu verbreiten."] },
    { article: "Artikel 13", paras: ["Der Arbeitnehmer verpflichtet sich, während seiner Dienstzeit sich korrekt und seiner Arbeit angemessen zu kleiden und sich gegenüber anderen Personen zuvorkommend zu verhalten."] },
    { article: "Artikel 14", paras: ["Gegenwärtiger Arbeitsvertrag unterliegt den gesetzlichen Bestimmungen und insbesondere dem Arbeitsgesetzbuchs sowie dem Tarifvertrag, dem das Unternehmen gegebenenfalls unterliegt."] },
    { article: "Artikel 15", paras: ["Die Vertragsparteien vereinbaren ausdrücklich, dass gegenwärtiger Vertrag nur dann zum Tragen kommt, wenn dem Arbeitnehmer, im Rahmen der arbeitsmedizinischen Untersuchung bei der Einstellung, bescheinigt wird, dass er den Posten, für den er eingestellt wird, auch ausüben kann.", "Sollte bei der arbeitsmedizinischen Untersuchung bei der Einstellung festgestellt werden, dass der Arzt der Arbeitsmediziner eine Untauglichkeit für den Posten feststellt, wird gegenwärtiger Vertrag aufgelöst und beendet.", "Das Vertragsende tritt an dem Tag ein, wo der Arbeitgeber die Bescheinigung des arbeitsmedizinischen Dienstes empfängt."] },
    { article: "Artikel 16", paras: ["Der Arbeitnehmer bestätigt keine Drogen zu nehmen, nicht alkoholabhängig zu sein, keine körperliche Beeinträchtigung, Behinderung oder Krankheit zu haben, die während der Dauer von seinem Arbeitsverhältnis eine Invalidität oder Krankheit mit sich führen würde. Es wurde ausdrücklich unter beiden Parteien vereinbart und anerkannt durch den Arbeitnehmer, dass jeglicher Verbrauch von Drogen und Alkohol während der Arbeit und vom Arbeitsverhältnis eine schwere Verfehlung ist, was zur Kündigung des Arbeitsvertrages mit sofortiger Wirkung führen könnte."] },
    { article: "Artikel 17", heading: "Abweichende und zusätzliche Vereinbarungen", paras: [`Zusatzvereinbarung: ${v(d.additionalAgreement, "-")}`] },
    { paras: ["Der Arbeitnehmer bescheinigt und erklärt ausdrücklich, dass er ein unterzeichnetes Exemplar gegenwärtigen Arbeitsvertrags bei der Unterzeichnung erhalten hat.", `Erstellt in zweifacher Ausführung in ${v(d.place)}, am ${fmtDate(d.contractDate, "____________")}.`] },
  ];
}

const CONTRACT_TITLE = "ARBEITSVERTRAG AUF UNBEFRISTETE ZEIT";

const CONTRACT_STYLE = `
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
  section, table.kf, p { page-break-inside: avoid; }`;

function contractBody(data: ContractData): string {
  const { employee, employer } = partyRows(data);
  const partyTable = (rows: [string, string][]) =>
    `<table class="party">${rows.map(([k, val]) => `<tr><td class="k">${escHtml(k)}</td><td class="val">${rich(val).replace(/\n/g, "<br/>")}</td></tr>`).join("")}</table>`;
  const parties = `
    <p class="lead">Zwischen</p>${partyTable(employee)}
    <p class="lead">Arbeitnehmer einerseits,</p><p class="lead">und</p>${partyTable(employer)}
    <p class="lead">als Arbeitgeber andererseits,</p>
    <p>wurde folgender Arbeitsvertrag auf unbestimmte Zeit, der den Bestimmungen des Arbeitsgesetzbuches unterliegt, abgeschlossen.</p>`;
  const body = buildBlocks(data)
    .map((b) => {
      const art = b.article ? `<div class="art">${escHtml(b.article)}</div>` : "";
      const head = b.heading ? `<div class="head">${escHtml(b.heading)}</div>` : "";
      const paras = b.paras.map((p) => `<p>${rich(p)}</p>`).join("");
      let table = "";
      if (b.table) {
        const th = b.table.headers.map((h) => `<th>${escHtml(h)}</th>`).join("");
        const tr = b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`).join("");
        table = `<table class="kf"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
      }
      const after = (b.parasAfter ?? []).map((p) => `<p>${rich(p)}</p>`).join("");
      return `<section>${art}${head}${paras}${table}${after}</section>`;
    })
    .join("");
  const letterhead = `<div class="lh"><div class="brand">FLOORTEC</div><div class="lh-meta">${escHtml(v(data.companyName, ""))}<br/>${escHtml(v(data.companyStreet, ""))} · ${escHtml(v(data.companyZipCity, ""))}</div></div>`;
  const sigs = `<table class="sigs"><tr>
      <td><div class="line"></div><div class="who">Der Arbeitnehmer</div><div class="who-sub">${escHtml(v(fullName(data), ""))}</div></td>
      <td><div class="line"></div><div class="who">Der Arbeitgeber</div><div class="who-sub">${escHtml(v(data.companyName, ""))}<br/>${escHtml(v(data.companyStreet, ""))}, ${escHtml(v(data.companyZipCity, ""))}</div></td>
    </tr></table>`;
  return `${letterhead}<h1>${escHtml(CONTRACT_TITLE)}</h1>${parties}${body}${sigs}`;
}

// ---------------------------------------------------------------------------
// Personalfragebogen Luxembourg
// ---------------------------------------------------------------------------

const PF_STYLE = `
  @page { margin: 1.4cm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9pt; line-height: 1.3; }
  .pf-h { font-size: 15pt; font-weight: 800; margin: 0; }
  .pf-sub { color: #c01818; font-weight: bold; font-size: 8pt; margin: 0 0 0.6em; }
  .pf-firma { font-size: 12pt; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 2px; margin: 0.4em 0; }
  .pf-note { float: right; font-style: italic; font-size: 7.5pt; color: #333; text-align: right; }
  .pf-sec { font-weight: bold; border-bottom: 1px solid #000; margin: 0.8em 0 0.3em; padding-bottom: 1px; }
  table.pf { width: 100%; border-collapse: collapse; margin-bottom: 0.3em; table-layout: fixed; }
  table.pf td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
  .lbl { display: block; font-size: 7.5pt; color: #000; }
  .val { display: block; font-size: 10pt; font-weight: bold; min-height: 1.25em; }
  .q { margin: 0.5em 0 0.2em; font-weight: bold; }
  .decl { font-size: 8pt; margin: 0.8em 0; }
  table.pf-sig { width: 100%; border-collapse: collapse; margin-top: 1.8em; }
  table.pf-sig td { vertical-align: bottom; padding: 0 8px; font-size: 8pt; }
  .sigline { border-top: 1px solid #000; padding-top: 2px; text-align: center; }
  .foot { font-size: 7.5pt; font-weight: bold; margin-top: 1em; }`;

function pfBody(d: ContractData): string {
  const cb = (on: boolean) => (on ? "☒" : "☐");
  const box = (label: string, value: string, span = 1) =>
    `<td${span > 1 ? ` colspan="${span}"` : ""}><span class="lbl">${escHtml(label)}</span><span class="val">${escHtml(value)}</span></td>`;
  const cell = (label: string, html: string, span = 1) =>
    `<td${span > 1 ? ` colspan="${span}"` : ""}><span class="lbl">${escHtml(label)}</span><span class="val">${html}</span></td>`;

  const geschlecht = `${cb(d.geschlecht === "m")} männlich&nbsp;&nbsp; ${cb(d.geschlecht === "w")} weiblich`;
  const status = `${cb(d.status === "angestellter")} Angestellter&nbsp; ${cb(d.status === "leitender")} leitender Angestellter&nbsp; ${cb(d.status === "geschaeftsfuehrer")} techn. Geschäftsführer`;
  const qual = `${cb(d.qualifikation === "qualifiziert")} Qualifiziert&nbsp; ${cb(d.qualifikation === "unqualifiziert")} Unqualifiziert`;
  const vertrag = `${cb(d.vertragArt === "befristet")} befristet bis ${escHtml(fmtDate(d.befristetBis, "________"))}&nbsp; ${cb(d.vertragArt === "unbefristet")} unbefristet`;
  const taeglich = `Mo ${escHtml(d.taegMo || "__")} · Di ${escHtml(d.taegDi || "__")} · Mi ${escHtml(d.taegMi || "__")} · Do ${escHtml(d.taegDo || "__")} · Fr ${escHtml(d.taegFr || "__")} · Sa ${escHtml(d.taegSa || "__")} (h)`;
  const probe = `vom ${escHtml(fmtDate(d.probezeitVom, "________"))} bis ${escHtml(fmtDate(d.probezeitBis, "________"))}`;
  const famstand = `${escHtml(d.familienstand)}${d.familienstandSeit ? `  seit: ${escHtml(fmtDate(d.familienstandSeit, ""))}` : ""}`;

  return `
    <div class="pf-note">Bitte umgehend per Mail an uns zurück. Vielen Dank</div>
    <div class="pf-h">Personalfragebogen Luxembourg</div>
    <div class="pf-sub">Die Anmeldung bei der CCSS muss innerhalb von 8 Tagen nach Arbeitsantritt erfolgen</div>
    <div class="pf-firma">FIRMA: ${escHtml(v(d.companyName, ""))}</div>
    <div style="font-size:8pt;margin-bottom:0.4em;">Name und Personalnummer des Mitarbeiters: <strong>${escHtml(fullName(d))}${d.personalnummer ? " · " + escHtml(d.personalnummer) : ""}</strong></div>

    <div class="pf-sec">Persönliche Angaben</div>
    <table class="pf">
      <tr>${box("Familienname / ggf. Geburtsname", d.lastName + (d.geburtsname ? ` (geb. ${d.geburtsname})` : ""))}${box("Vorname", d.firstName)}</tr>
      <tr>${box("Straße und Hausnummer", d.employeeStreet)}${box("PLZ, Ort", d.employeeZipCity)}</tr>
      <tr>${box("Versicherungsnummer (falls vorhanden)", d.matrikel)}${cell("Geschlecht", geschlecht)}</tr>
      <tr>${box("Geburtsdatum", fmtDate(d.employeeBirth, ""))}${cell("Familienstand", famstand)}</tr>
      <tr>${box("Geburtsort, -land", d.geburtsort)}${box("Anzahl der Kinder", d.anzahlKinder)}</tr>
      <tr>${box("Staatsangehörigkeit", d.staatsangehoerigkeit)}${box("Name, Vorname des Ehegatten", d.ehegatte)}</tr>
      <tr>${box("IBAN / BIC", d.iban)}${box("E-Mail", d.email)}</tr>
    </table>

    <div class="pf-sec">Beschäftigung</div>
    <table class="pf">
      <tr>${box("Eintrittsdatum", fmtDate(d.startDate, ""))}${cell("Status", status)}</tr>
      <tr>${box("Ausgeübte Tätigkeit", d.position)}${box("Höchster Abschluss / Berufsausbildung", d.hoechsterAbschluss)}</tr>
      <tr>${box("Urlaubsanspruch (Kalenderjahr)", d.urlaubsanspruch)}${box("Wöchentliche Arbeitszeit", d.weeklyHours)}${cell("Qualifikation", qual)}</tr>
      <tr>${cell("Arbeitsvertrag (Kopie einreichen)", vertrag)}${cell("Tägliche Arbeitszeit", taeglich)}${cell("Probezeit", probe)}</tr>
    </table>

    <div class="pf-sec">Entlohnung</div>
    <table class="pf">
      <tr>${box("Bezeichnung", "Bruttogehalt")}${box("Betrag", d.bruttogehaltBetrag)}${box("Gültig ab", fmtDate(d.bruttogehaltGueltigAb, ""))}${box("Stundenlohn", d.hourlyWage)}${box("Gültig ab", fmtDate(d.stundenlohnGueltigAb, ""))}</tr>
    </table>

    <div class="q">Fand die Ärztliche Untersuchung STM bereits statt? &nbsp; ${cb(d.aerztlich === "ja")} ja&nbsp;&nbsp; ${cb(d.aerztlich === "nein")} nein</div>
    <div class="q">Üben Sie weitere Beschäftigungen aus? &nbsp; ${cb(d.weitereBesch === "ja")} ja&nbsp;&nbsp; ${cb(d.weitereBesch === "nein")} nein</div>
    <div style="font-size:8pt;">Falls ja, welche: ${escHtml(d.weitereWelche || "____________________________")}</div>

    <div class="decl"><strong>Erklärung des Arbeitnehmers:</strong> Ich versichere, dass die vorstehenden Angaben der Wahrheit entsprechen. Ich verpflichte mich, meinem Arbeitgeber alle Änderungen unverzüglich mitzuteilen.</div>

    <table class="pf-sig">
      <tr>
        <td style="width:18%"><div class="sigline">${escHtml(fmtDate(d.contractDate, ""))}</div>Datum</td>
        <td style="width:32%"><div class="sigline">&nbsp;</div>Unterschrift Arbeitnehmer</td>
        <td style="width:18%"><div class="sigline">${escHtml(fmtDate(d.contractDate, ""))}</div>Datum</td>
        <td style="width:32%"><div class="sigline">&nbsp;</div>Unterschrift Arbeitgeber</td>
      </tr>
    </table>

    <div class="foot">*Sollte noch keine Sozialversicherungsnummer in Luxemburg vorliegen: Bitte Kopie des Personalausweises (Vor- und Rückseite)</div>`;
}

// ---------------------------------------------------------------------------

export default function ArbeitsvertragForm({ contracts }: { contracts: SavedContract[] }) {
  const [d, setD] = useState<ContractData>(EMPTY);
  const [kind, setKind] = useState<DocKind>("arbeitsvertrag");
  const set = (k: keyof ContractData, val: string) => setD((p) => ({ ...p, [k]: val }));
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [busy, startBusy] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const isPf = kind === "personalfragebogen";

  const previewHtml = useMemo(() => (isPf ? `<style>${PF_STYLE}</style>${pfBody(d)}` : ""), [isPf, d]);

  const openPrint = (title: string, style: string, body: string) => {
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"/><title>${escHtml(title)}</title><style>${style}</style></head><body>${body}</body></html>`;
    const w = window.open("", "_blank", "width=840,height=1060");
    if (!w) {
      alert("Bitte Pop-ups für diese Seite erlauben, um das Dokument zu drucken.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  const printDoc = (docKind: DocKind, data: ContractData) => {
    if (docKind === "personalfragebogen") {
      openPrint(`Personalfragebogen ${fullName(data)}`, PF_STYLE, pfBody(data));
    } else {
      openPrint(`Arbeitsvertrag ${fullName(data)}`, CONTRACT_STYLE, contractBody(data));
    }
  };

  const saveDoc = () => {
    setMsg(null);
    startSave(async () => {
      const res: SaveContractResult = await saveContractAction(kind, fullName(d), { ...d });
      if (res.ok) {
        setMsg(isPf ? "Personalfragebogen gespeichert." : "Arbeitsvertrag gespeichert.");
        router.refresh();
      } else {
        setMsg(res.error ?? "Speichern fehlgeschlagen.");
      }
    });
  };

  const loadContract = (c: SavedContract) => {
    setD(toContractData(c.data));
    setKind(c.kind);
    setMsg(`„${c.employeeName}" geladen (${c.kind === "personalfragebogen" ? "Personalfragebogen" : "Arbeitsvertrag"}).`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeContract = (id: number) => {
    if (!window.confirm("Dieses gespeicherte Dokument löschen?")) return;
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

  const tab = (k: DocKind, label: string) => (
    <button
      type="button"
      onClick={() => setKind(k)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        kind === k ? "bg-brand-red text-white" : "border border-gray-300 text-gray-600 hover:border-brand-red/50"
      }`}
    >
      {label}
    </button>
  );

  const contractBlocks = buildBlocks(d);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">Dokument:</span>
        {tab("arbeitsvertrag", "Arbeitsvertrag")}
        {tab("personalfragebogen", "Personalfragebogen")}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Eingabe */}
        <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
          <h2 className="mb-3 text-lg font-medium text-gray-900">Angaben</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arbeitnehmer</p></div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Familienname</label>
              <input className={inputClass} value={d.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Engels" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Vorname</label>
              <input className={inputClass} value={d.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Willi" />
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
              <label className="mb-1 block text-sm text-gray-600">Versicherungs-/Matrikelnr.</label>
              <input className={inputClass} value={d.matrikel} onChange={(e) => set("matrikel", e.target.value)} placeholder="-" />
            </div>

            {isPf && (
              <>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Geburtsname (optional)</label>
                  <input className={inputClass} value={d.geburtsname} onChange={(e) => set("geburtsname", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Geschlecht</label>
                  <select className={inputClass} value={d.geschlecht} onChange={(e) => set("geschlecht", e.target.value)}>
                    <option value="">—</option>
                    <option value="m">männlich</option>
                    <option value="w">weiblich</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Geburtsort, -land</label>
                  <input className={inputClass} value={d.geburtsort} onChange={(e) => set("geburtsort", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Staatsangehörigkeit</label>
                  <input className={inputClass} value={d.staatsangehoerigkeit} onChange={(e) => set("staatsangehoerigkeit", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Familienstand</label>
                  <input className={inputClass} value={d.familienstand} onChange={(e) => set("familienstand", e.target.value)} placeholder="ledig / verheiratet …" />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">… seit</label>
                  <input type="date" className={inputClass} value={d.familienstandSeit} onChange={(e) => set("familienstandSeit", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Anzahl der Kinder</label>
                  <input className={inputClass} value={d.anzahlKinder} onChange={(e) => set("anzahlKinder", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Name, Vorname Ehegatte</label>
                  <input className={inputClass} value={d.ehegatte} onChange={(e) => set("ehegatte", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">IBAN / BIC</label>
                  <input className={inputClass} value={d.iban} onChange={(e) => set("iban", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">E-Mail</label>
                  <input className={inputClass} value={d.email} onChange={(e) => set("email", e.target.value)} />
                </div>
              </>
            )}

            <div className="sm:col-span-2 mt-2"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Arbeitgeber</p></div>
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
            {isPf && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm text-gray-600">Personalnummer des Mitarbeiters</label>
                <input className={inputClass} value={d.personalnummer} onChange={(e) => set("personalnummer", e.target.value)} />
              </div>
            )}

            <div className="sm:col-span-2 mt-2"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vertragsdaten</p></div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Eintrittsdatum</label>
              <input type="date" className={inputClass} value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Position / Tätigkeit</label>
              <input className={inputClass} value={d.position} onChange={(e) => set("position", e.target.value)} placeholder="FLIESENLEGER" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Wochenstunden</label>
              <input className={inputClass} value={d.weeklyHours} onChange={(e) => set("weeklyHours", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Stundenlohn brutto</label>
              <input className={inputClass} value={d.hourlyWage} onChange={(e) => set("hourlyWage", e.target.value)} placeholder="25,50 €" />
            </div>

            {!isPf && (
              <>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Index (Art. 5)</label>
                  <input className={inputClass} value={d.index} onChange={(e) => set("index", e.target.value)} placeholder="992,24" />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Probezeit in Monaten (Art. 8)</label>
                  <input className={inputClass} value={d.probationMonths} onChange={(e) => set("probationMonths", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm text-gray-600">Zusatzvereinbarung (Art. 17)</label>
                  <textarea className={inputClass} rows={2} value={d.additionalAgreement} onChange={(e) => set("additionalAgreement", e.target.value)} placeholder="-" />
                </div>
              </>
            )}

            {isPf && (
              <>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Status</label>
                  <select className={inputClass} value={d.status} onChange={(e) => set("status", e.target.value)}>
                    <option value="angestellter">Angestellter</option>
                    <option value="leitender">leitender Angestellter</option>
                    <option value="geschaeftsfuehrer">techn. Geschäftsführer</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Höchster Abschluss</label>
                  <input className={inputClass} value={d.hoechsterAbschluss} onChange={(e) => set("hoechsterAbschluss", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Urlaubsanspruch (Tage)</label>
                  <input className={inputClass} value={d.urlaubsanspruch} onChange={(e) => set("urlaubsanspruch", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Qualifikation</label>
                  <select className={inputClass} value={d.qualifikation} onChange={(e) => set("qualifikation", e.target.value)}>
                    <option value="">—</option>
                    <option value="qualifiziert">Qualifiziert</option>
                    <option value="unqualifiziert">Unqualifiziert</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Arbeitsvertrag</label>
                  <select className={inputClass} value={d.vertragArt} onChange={(e) => set("vertragArt", e.target.value)}>
                    <option value="unbefristet">unbefristet</option>
                    <option value="befristet">befristet</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">… befristet bis</label>
                  <input type="date" className={inputClass} value={d.befristetBis} onChange={(e) => set("befristetBis", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm text-gray-600">Tägliche Arbeitszeit (h): Mo · Di · Mi · Do · Fr · Sa</label>
                  <div className="grid grid-cols-6 gap-1">
                    {(["taegMo", "taegDi", "taegMi", "taegDo", "taegFr", "taegSa"] as const).map((k) => (
                      <input key={k} className={inputClass} value={d[k]} onChange={(e) => set(k, e.target.value)} />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Probezeit vom</label>
                  <input type="date" className={inputClass} value={d.probezeitVom} onChange={(e) => set("probezeitVom", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Probezeit bis</label>
                  <input type="date" className={inputClass} value={d.probezeitBis} onChange={(e) => set("probezeitBis", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Bruttogehalt Betrag</label>
                  <input className={inputClass} value={d.bruttogehaltBetrag} onChange={(e) => set("bruttogehaltBetrag", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Bruttogehalt gültig ab</label>
                  <input type="date" className={inputClass} value={d.bruttogehaltGueltigAb} onChange={(e) => set("bruttogehaltGueltigAb", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Stundenlohn gültig ab</label>
                  <input type="date" className={inputClass} value={d.stundenlohnGueltigAb} onChange={(e) => set("stundenlohnGueltigAb", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Ärztl. Untersuchung STM erfolgt?</label>
                  <select className={inputClass} value={d.aerztlich} onChange={(e) => set("aerztlich", e.target.value)}>
                    <option value="">—</option>
                    <option value="ja">ja</option>
                    <option value="nein">nein</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Weitere Beschäftigung?</label>
                  <select className={inputClass} value={d.weitereBesch} onChange={(e) => set("weitereBesch", e.target.value)}>
                    <option value="">—</option>
                    <option value="ja">ja</option>
                    <option value="nein">nein</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm text-gray-600">Falls ja, welche</label>
                  <input className={inputClass} value={d.weitereWelche} onChange={(e) => set("weitereWelche", e.target.value)} />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-sm text-gray-600">Ort (Unterschrift)</label>
              <input className={inputClass} value={d.place} onChange={(e) => set("place", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Datum (Unterschrift)</label>
              <input type="date" className={inputClass} value={d.contractDate} onChange={(e) => set("contractDate", e.target.value)} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveDoc} disabled={saving} className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "Speichert …" : isPf ? "Personalfragebogen speichern" : "Arbeitsvertrag speichern"}
            </button>
            <button type="button" onClick={() => printDoc(kind, d)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:border-brand-red/50">
              Drucken / als PDF
            </button>
            <button type="button" onClick={() => setD(EMPTY)} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Zurücksetzen
            </button>
            {msg && <span className="text-sm text-gray-500">{msg}</span>}
          </div>

          {/* Gespeicherte Dokumente */}
          <div className="mt-5 border-t border-gray-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              Gespeicherte Dokumente <span className="font-normal text-gray-400">({contracts.length})</span>
            </h3>
            {contracts.length === 0 ? (
              <p className="text-sm text-gray-400">Noch keine gespeicherten Dokumente.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {contracts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.kind === "personalfragebogen" ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {c.kind === "personalfragebogen" ? "Fragebogen" : "Vertrag"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{c.employeeName}</p>
                      <p className="text-xs text-gray-400">{fmtStamp(c.createdAt)}{c.createdByName ? ` · ${c.createdByName}` : ""}</p>
                    </div>
                    <button type="button" onClick={() => loadContract(c)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50">Laden</button>
                    <button type="button" onClick={() => printDoc(c.kind, toContractData(c.data))} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50">Drucken</button>
                    <button type="button" onClick={() => removeContract(c.id)} disabled={busy} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-brand-red/50 hover:text-brand-red disabled:opacity-50">Löschen</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Vorschau */}
        <div className="rounded-xl border border-gray-300 bg-gray-100 p-4 shadow-lg shadow-black/10">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Vorschau — {isPf ? "Personalfragebogen" : "Arbeitsvertrag"}</p>
          {isPf ? (
            <div className="mx-auto max-w-[800px] rounded-md bg-white px-8 py-8 text-gray-900 shadow" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <div className="mx-auto max-w-[800px] rounded-md bg-white px-8 py-10 text-[12.5px] leading-relaxed text-gray-900 shadow" style={{ fontFamily: '"Times New Roman", Georgia, serif' }}>
              <div className="mb-5 flex items-end justify-between border-b-2 border-[#c01818] pb-1.5">
                <span className="text-2xl font-extrabold tracking-[0.25em] text-[#c01818]" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>FLOORTEC</span>
                <span className="text-right text-[9px] leading-tight text-gray-500" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                  {v(d.companyName, "")}<br />{v(d.companyStreet, "")} · {v(d.companyZipCity, "")}
                </span>
              </div>
              <h1 className="mb-5 text-center text-base font-bold uppercase tracking-wide underline">{CONTRACT_TITLE}</h1>
              <p className="my-1.5">Zwischen</p>
              <PartyTable rows={partyRows(d).employee} />
              <p className="my-1.5">Arbeitnehmer einerseits,</p>
              <p className="my-1.5">und</p>
              <PartyTable rows={partyRows(d).employer} />
              <p className="my-1.5">als Arbeitgeber andererseits,</p>
              <p className="mb-3 text-justify">wurde folgender Arbeitsvertrag auf unbestimmte Zeit, der den Bestimmungen des Arbeitsgesetzbuches unterliegt, abgeschlossen.</p>
              {contractBlocks.map((b, i) => (
                <div key={i} className="mb-2">
                  {b.article && <p className="mt-3 font-bold underline">{b.article}</p>}
                  {b.heading && <p className="text-center font-bold underline">{b.heading}</p>}
                  {b.paras.map((p, j) => (<p key={j} className="mb-1 text-justify"><Rich text={p} /></p>))}
                  {b.table && (
                    <table className="mx-auto my-2 w-[90%] border-collapse">
                      <thead><tr>{b.table.headers.map((h, k) => (<th key={k} className="px-2 py-0.5 text-center font-bold underline">{h}</th>))}</tr></thead>
                      <tbody>{b.table.rows.map((r, k) => (<tr key={k}>{r.map((cell, m) => (<td key={m} className="px-2 py-0.5 text-center">{cell}</td>))}</tr>))}</tbody>
                    </table>
                  )}
                  {(b.parasAfter ?? []).map((p, j) => (<p key={`a${j}`} className="mb-1 text-justify"><Rich text={p} /></p>))}
                </div>
              ))}
              <div className="mt-16 grid grid-cols-2 gap-8 text-xs">
                <div className="border-t border-black pt-1"><span className="font-semibold">Der Arbeitnehmer</span><div className="text-[10px] text-gray-500">{fullName(d)}</div></div>
                <div className="border-t border-black pt-1"><span className="font-semibold">Der Arbeitgeber</span><div className="text-[10px] text-gray-500">{v(d.companyName, "")}<br />{v(d.companyStreet, "")}, {v(d.companyZipCity, "")}</div></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline **fett** in JSX. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}</>;
}

function PartyTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="my-1 ml-3 border-collapse">
      <tbody>
        {rows.map(([k, val], i) => (
          <tr key={i}>
            <td className="w-[5.4cm] pr-2 align-top">{k}</td>
            <td className="align-top">{val.split("\n").map((ln, j) => (<div key={j}><Rich text={ln} /></div>))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
