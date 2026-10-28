/** Anel de progresso do dia ("3/5"), com o texto completo para leitores de tela. */
export function ProgressRing({ done, total, size = 88 }: { done: number; total: number; size?: number }) {
  const r = 40;
  const length = 2 * Math.PI * r;
  const filled = total > 0 ? (length * done) / total : 0;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 96 96" role="img"
      aria-label={`${done} de ${total} ${total === 1 ? "dose dada" : "doses dadas"}`}>
      <circle className="ring-track" cx="48" cy="48" r={r} fill="none" strokeWidth="10" />
      {done > 0 && (
        <circle className="ring-value" cx="48" cy="48" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${filled} ${length}`} transform="rotate(-90 48 48)" />
      )}
      <text x="48" y="51" textAnchor="middle" className="ring-count">{done}/{total}</text>
      <text x="48" y="67" textAnchor="middle" className="ring-label">dadas</text>
    </svg>
  );
}
