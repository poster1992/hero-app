/**
 * Vollflächige Ladeanzeige (schwarz + animierter Balken), die während des
 * Streamings der Dashboard-Seiten automatisch angezeigt wird.
 */
export default function Loading() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-paper">
      <div className="text-xl font-bold tracking-[0.2em] text-ink">FLOORTEC</div>
      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-paper-2">
        <div className="loading-bar h-full w-1/3 rounded-full bg-brand-red" />
      </div>
      <div className="font-mono text-xs uppercase tracking-[0.1em] text-muted">Lädt …</div>
      <style>{`
        @keyframes loadingbar {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
        .loading-bar { animation: loadingbar 1.1s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
