/** FLOORTEC wordmark (Schriftzug only, no image). */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`whitespace-nowrap text-lg font-bold tracking-[0.14em] text-ink ${className}`}
    >
      FLOORTEC
    </span>
  );
}
