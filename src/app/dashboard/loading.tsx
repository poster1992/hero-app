/**
 * Vollflächige Ladeanzeige (schwarz + animierter Balken), die während des
 * Streamings der Dashboard-Seiten automatisch angezeigt wird.
 */
export default function Loading() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-black">
      <div className="text-xl font-semibold tracking-[0.3em] text-white">FLOORTEC</div>
      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-white/10">
        <div className="loading-bar h-full w-1/3 rounded-full bg-brand-red" />
      </div>
      <div className="text-sm text-white/50">Lädt …</div>
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
