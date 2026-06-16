const TITLE_SHADOW =
  "0 1px 0 #c4291d, 0 2px 0 #b8261b, 0 3px 0 #ac2319, 0 4px 0 #9f2016, 0 5px 0 #8f1d14, 0 6px 1px rgba(0,0,0,0.12), 0 8px 8px rgba(0,0,0,0.30), 0 11px 14px rgba(0,0,0,0.20)";

/** "Dashboard" im 3D-Look – Buchstaben laufen beim Öffnen von links rein und hüpfen. */
export default function DashboardTitle({ text = "Dashboard" }: { text?: string }) {
  const letters = [...text];
  return (
    <h1
      className="select-none text-center text-4xl font-extrabold uppercase tracking-[0.15em] text-brand-red"
      style={{ textShadow: TITLE_SHADOW }}
      aria-label={text}
    >
      {letters.map((ch, i) => (
        <span
          key={i}
          className="letter-run"
          style={{ animationDelay: `${i * 0.08}s` }}
          aria-hidden
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </h1>
  );
}
