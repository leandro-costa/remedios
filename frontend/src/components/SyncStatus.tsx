import { useOnline } from "../hooks/useOnline";
import { useOutbox } from "../hooks/useOutbox";
import { formatAgo } from "../lib/time";

/**
 * Estado de sincronização sempre visível (seção 1.2). Nunca diz
 * "sincronizado" enquanto houver registro sem confirmação do servidor.
 */
export function SyncStatus({ familyId, savedAt, fresh }: { familyId: string; savedAt?: number | null; fresh?: boolean }) {
  const online = useOnline();
  const outbox = useOutbox(familyId);
  const pending = outbox.filter((i) => i.state === "pending").length;
  const failed = outbox.filter((i) => i.state === "failed").length;

  let tone = "ok";
  let text = "Sincronizado";
  if (failed > 0) {
    tone = "error";
    text = `${failed} ${failed === 1 ? "registro não foi aceito" : "registros não foram aceitos"} — veja em Hoje`;
  } else if (pending > 0) {
    tone = "warn";
    text = `${pending} ${pending === 1 ? "registro aguardando" : "registros aguardando"} envio`;
  } else if (!online || fresh === false) {
    tone = "warn";
    text = savedAt ? `Offline · dados de ${formatAgo(savedAt)}` : "Offline";
  }
  return (
    <p className={`sync sync-${tone}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" /> {text}
    </p>
  );
}
