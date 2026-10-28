/** Anel de progresso do dia ("3/5"), com o texto completo para leitores de tela. */
export function ProgressRing({ done, total, size = 88, light = false, label }: {
  done: number; total: number; size?: number; light?: boolean; label?: string;
}) {
  const r = 40;
  const length = 2 * Math.PI * r;
  const filled = total > 0 ? (length * done) / total : 0;
  return (
    <svg className={`ring ${light ? "ring-light" : ""} ${total > 0 && done === total ? "ring-done" : ""}`}
      width={size} height={size} viewBox="0 0 96 96" role="img"
      aria-label={label ?? `${done} de ${total} ${total === 1 ? "dose dada" : "doses dadas"}`}>
      <circle className="ring-track" cx="48" cy="48" r={r} fill="none" strokeWidth="10" />
      {done > 0 && (
        <circle className="ring-value" cx="48" cy="48" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${filled} ${length}`} transform="rotate(-90 48 48)" />
      )}
      <text x="48" y={light ? 57 : 51} textAnchor="middle" className="ring-count">{done}/{total}</text>
      {!light && <text x="48" y="67" textAnchor="middle" className="ring-label">dadas</text>}
    </svg>
  );
}
