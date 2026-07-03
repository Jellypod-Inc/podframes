export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`text-lg font-extrabold tracking-tight ${className}`}>
      <span className="text-[var(--color-accent)]">pod</span>
      <span className="text-[var(--color-text)]">frames</span>
    </span>
  );
}
