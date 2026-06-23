/** Seitentitel – schlicht in Weiß, ohne Effekte. */
export default function DashboardTitle({ text = "Dashboard" }: { text?: string }) {
  return (
    <h1 className="select-none text-center text-2xl font-extrabold uppercase tracking-[0.12em] text-white sm:text-4xl sm:tracking-[0.15em]">
      {text}
    </h1>
  );
}
