/** FLOORTEC wordmark (Schriftzug only, no image). */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`whitespace-nowrap text-lg font-semibold tracking-[0.2em] text-white ${className}`}
    >
      FLOORTEC
    </span>
  );
}
