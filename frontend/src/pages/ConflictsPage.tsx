import { Link } from "react-router";
import { api } from "../api/client";
import type { OccurrenceDetail } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { formatWhen } from "../lib/time";
import { useFamily } from "../session";

/** Doses com registros divergentes aguardando conferência (seção 7.6). */
export function ConflictsPage() {
  const family = useFamily();
  const conflicts = useCached(`conflicts:${family.id}`, () => api<OccurrenceDetail[]>(`/families/${family.id}/conflicts`));
  return (
    <div className="page">
      <h1>Para conferir</h1>
      <p className="muted">Registros feitos em aparelhos diferentes que não combinam. Nenhum foi aplicado automaticamente.</p>
      {conflicts.loading && !conflicts.data && <Spinner />}
      {conflicts.error && <Notice tone="error">{conflicts.error}</Notice>}
      {conflicts.data?.length === 0 && <p className="empty">Nada para conferir.</p>}
      <ul className="cards">
        {(conflicts.data ?? []).map(({ occurrence, conflict }) => (
          <li key={occurrence.id}>
            <Link to={`/doses/${occurrence.id}`} className="card card-link">
              <strong>{occurrence.person.displayName} · {occurrence.treatment.name}</strong>
              <span className="muted small">Previsto {formatWhen(occurrence.scheduledAt)}</span>
              <span className="small">
                {conflict?.proposals.map((p) => p.recordedBy?.displayName).join(", ")} registrou sem ver o registro anterior
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
