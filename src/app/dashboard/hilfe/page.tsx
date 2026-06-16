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
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Hilfe</h1>
        <p className="mt-1 text-sm text-gray-600">
          Kurze Erklärung der einzelnen Bereiche des FloorTec-Dashboards.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <div
            key={s.title}
            className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10"
          >
            <h2 className="text-base font-medium text-gray-900">{s.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{s.text}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-300 bg-white p-5 shadow-lg shadow-black/10">
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
