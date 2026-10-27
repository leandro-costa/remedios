import type { OutboxItem } from "../db/db";
import { useOutbox } from "../hooks/useOutbox";
import { discard, retry } from "../sync/outbox";
import { Notice } from "./Layout";

const KIND: Record<string, string> = {
  ADMINISTER: "Registro de dose dada",
  NOT_ADMINISTERED: "Registro de dose não dada",
  MEASUREMENT: "Aferição",
  SYMPTOM: "Sintoma",
};

function describe(item: OutboxItem) {
  return item.label ?? KIND[item.kind] ?? "Registro";
}

/**
 * Gravações feitas neste aparelho que o servidor recusou ao sincronizar.
 * Nada é descartado sozinho: o responsável tenta de novo ou descarta.
 */
export function PendingChanges({ familyId }: { familyId: string }) {
  const failed = useOutbox(familyId).filter((i) => i.state === "failed");
  if (failed.length === 0) return null;
  return (
    <div className="stack">
      {failed.map((item) => (
        <Notice key={item.id} tone="error">
          <strong>Não foi aceito: {describe(item)}.</strong> {item.lastError?.message}
          <div className="row">
            <button className="btn btn-small" onClick={() => void retry(item.id)}>Tentar de novo</button>
            <button className="btn btn-small" onClick={() => confirm("Descartar este registro feito no aparelho?") && void discard(item.id)}>
              Descartar
            </button>
          </div>
        </Notice>
      ))}
    </div>
  );
}

/** Contagem compacta no topo de todas as telas. */
export function QueueBadge({ familyId }: { familyId: string }) {
  const outbox = useOutbox(familyId);
  const pending = outbox.filter((i) => i.state === "pending").length;
  const failed = outbox.filter((i) => i.state === "failed").length;
  if (failed > 0) return <span className="badge badge-error">{failed} não {failed === 1 ? "aceito" : "aceitos"}</span>;
  if (pending > 0) return <span className="badge badge-queued">{pending} aguardando envio</span>;
  return null;
}
