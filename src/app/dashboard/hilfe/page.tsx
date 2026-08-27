const SECTIONS: { title: string; text: string }[] = [
  {
    title: "Dashboard",
    text: "Überblick über Ausgangsrechnungen, Belege und Saldo des Jahres, Angebots- und Auftragsvolumen, Monatsverlauf, Einsatzorte-Karte sowie Projekt-Pipeline, GuV und Steuerlast.",
  },
  {
    title: "Belege",
    text: "Alle Eingangs- und Ausgangsbelege mit Beträgen, Status und Vorschau der hinterlegten Dokumente.",
  },
  {
    title: "Rechnungen",
    text: "Kundenrechnungen (inkl. Gutschriften und Stornos) mit Netto-, Steuer- und Bruttobeträgen pro Projekt.",
  },
  {
    title: "Projekte",
    text: "Projektliste mit Status, kalkulierten und tatsächlichen Stunden, Material- und Lohnkosten sowie Detailansicht je Projekt.",
  },
  {
    title: "Kunden",
    text: "Kontaktübersicht aller Kunden und Lieferanten mit Adresse und Kategorie.",
  },
  {
    title: "Auslastung",
    text: "Planung der Mitarbeiterauslastung auf Basis von Kalenderterminen und Abwesenheiten (Urlaub, Krankheit).",
  },
  {
    title: "Arbeitszeiten",
    text: "Erfasste Arbeitszeiten je Mitarbeiter und Projekt für einen wählbaren Zeitraum.",
  },
  {
    title: "ABC-Analyse",
    text: "Einordnung der Kunden bzw. Projekte nach Umsatzanteil in die Klassen A, B und C.",
  },
];

export default function HilfePage() {
  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header className="border-b-2 border-brand-red pb-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Hilfe</h1>
        <p className="mt-1 text-sm text-gray-600">
          Kurze Erklärung der einzelnen Bereiche des FloorTec-Dashboards.
        </p>
      </header>

      {/* Anleitungen zum Herunterladen */}
      <div className="border border-line bg-white p-5">
        <h2 className="text-base font-medium text-gray-900">Anleitungen (PDF)</h2>
        <p className="mt-1 text-sm text-gray-600">
          Zum Ansehen oder Herunterladen und Weiterleiten an Mitarbeiter.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span aria-hidden>📄</span>
              Ware auf ein Projekt buchen – App installieren &amp; scannen
            </span>
            <span className="flex items-center gap-2">
              <a
                href="/anleitung-lager-buchung.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
              >
                Ansehen
              </a>
              <a
                href="/anleitung-lager-buchung.pdf"
                download="FLOORTEC-Anleitung-Lager-Buchung.pdf"
                className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                ⬇ Herunterladen
              </a>
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span aria-hidden>📄</span>
              Belege hochladen – Posteingang (Sammel-Upload)
            </span>
            <span className="flex items-center gap-2">
              <a
                href="/anleitung-belege-hochladen.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900"
              >
                Ansehen
              </a>
              <a
                href="/anleitung-belege-hochladen.pdf"
                download="FLOORTEC-Anleitung-Belege-hochladen.pdf"
                className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                ⬇ Herunterladen
              </a>
            </span>
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <div
            key={s.title}
            className="border border-line bg-white p-5"
          >
            <h2 className="text-base font-medium text-gray-900">{s.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{s.text}</p>
          </div>
        ))}
      </div>

      <div className="border border-line bg-white p-5">
        <h2 className="text-base font-medium text-gray-900">Support</h2>
        <p className="mt-1 text-sm text-gray-600">
          Die Daten stammen live aus HERO Software. Bei Fragen oder Problemen mit dem
          Dashboard wende dich an{" "}
          <a
            className="text-brand-red hover:underline"
            href="mailto:pascal.oster@floortec.design"
          >
            pascal.oster@floortec.design
          </a>
          .
        </p>
      </div>
    </div>
  );
}
