import { Link, useParams } from "react-router";
import { api } from "../api/client";
import type { OccurrenceView } from "../api/types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Notice, Spinner } from "../components/Layout";
import { ScreenBar } from "../components/ScreenBar";
import { StatusBadge } from "../components/StatusBadge";
import { useCached } from "../hooks/useCached";
import { formatTime, formatWhen } from "../lib/time";
import { useFamily } from "../session";
import { doseLabel } from "../lib/labels";
import { useMedications } from "./MedicationsPage";

const DAY_MS = 86_400_000;

/**
 * Um medicamento da família e o histórico de uso consolidado: as doses dele
 * em todos os tratamentos (receitas e uso eventual), de todas as pessoas.
 */
export function MedicationDetailPage() {
  const { id } = useParams();
  const family = useFamily();
  const medications = useMedications();
  const m = medications.data?.find((x) => x.id === id);
  const history = useCached(`medication-history:${id}`, () => {
    const now = Date.now();
    return api<OccurrenceView[]>(`/families/${family.id}/history`, {
      query: { medicationId: id, from: new Date(now - 60 * DAY_MS).toISOString(), to: new Date(now + 3_600_000).toISOString(), limit: 200 },
    });
  });
  if (!m) return medications.loading ? <Spinner /> : <div className="page"><Notice tone="error">Medicamento não encontrado.</Notice></div>;

  return (
    <div className="page">
      <ScreenBar title={m.name} />
      <section className="dose-hero">
        <span className="dose-hero-icon"><Icon name="pill" size={44} /></span>
        <strong className="dose-hero-name">{m.name}</strong>
        {m.category && <span className="muted small">{m.category} na ANVISA</span>}
      </section>
      <dl className="facts card">
        <dt>Substâncias</dt>
        <dd>
          {m.substances.length === 0 ? "Não informadas" : m.substances.map((s) => (
            <div key={s.substance}>{s.substance}{s.concentration ? ` · ${s.concentration}` : ""}</div>
          ))}
        </dd>
        {m.form && (<><dt>Forma</dt><dd>{m.form}</dd></>)}
        {m.manufacturer && (<><dt>Fabricante</dt><dd>{m.manufacturer}</dd></>)}
        {m.notes && (<><dt>Observações</dt><dd className="pre">{m.notes}</dd></>)}
      </dl>
      <div className="row">
        <Link className="btn" to={`/medicamentos/${m.id}/editar`}>Editar</Link>
      </div>

      <section className="stack" aria-label="Histórico de uso">
        <h2>Histórico de uso</h2>
        <p className="muted small">Todas as doses deste medicamento nos últimos 60 dias, de todos os tratamentos.</p>
        {!history.fresh && <Notice tone="warn">Sem conexão: histórico guardado neste aparelho.</Notice>}
        {history.loading && !history.data && <Spinner />}
        {history.data?.length === 0 && <p className="empty">Nenhuma dose registrada.</p>}
        <ul className="cards">
          {(history.data ?? []).map((o) => (
            <li key={o.id}>
              <Link to={`/doses/${o.id}`} state={{ occurrence: o }} className="item history-item">
                <Avatar name={o.person.displayName} id={o.person.id} size={40} />
                <span className="item-main">
                  <span className="row between wrap">
                    <strong>{formatWhen(o.administration?.administeredAt ?? o.statusChangedAt ?? o.scheduledAt)}</strong>
                    <StatusBadge status={o.status} />
                  </span>
                  <span>{o.person.displayName} · {doseLabel(o)}</span>
                  <span className="muted small">
                    {o.treatment.kind === "AS_NEEDED" ? "" : `Previsto ${formatTime(o.scheduledAt)} · `}
                    Registrado por {o.administration?.recordedBy?.displayName ?? o.statusChangedBy?.displayName ?? "—"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
