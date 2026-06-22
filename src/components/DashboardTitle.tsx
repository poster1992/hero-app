/** Seitentitel – schlicht in Weiß, ohne Effekte. */
export default function DashboardTitle({ text = "Dashboard" }: { text?: string }) {
  return (
    <h1 className="select-none text-center text-4xl font-extrabold uppercase tracking-[0.15em] text-white">
      {text}
    </h1>
  );
}
