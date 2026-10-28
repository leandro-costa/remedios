import { useEffect, useRef, useState } from "react";
import type { OccurrenceView } from "../api/types";
import { formatTime } from "../lib/time";
import { useFamily, useSession } from "../session";
import { discard, pendingFor, submitReport } from "../sync/outbox";
import { Notice } from "./Layout";

/** "Dada no horário" só vale para dose em aberto cujo horário já chegou (a API recusa horário futuro). */
export function canRecordOnTime(o: OccurrenceView, queued: boolean): boolean {
  return (o.status === "PENDING" || o.status === "SCHEDULED") && !queued && new Date(o.scheduledAt) <= new Date();
}

/**
 * Confirmação de "Dada no horário": registra a administração com o horário
 * previsto, depois de a pessoa conferir quem, o quê e quando. Funciona
 * offline (vai pela fila, como qualquer registro de dose).
 */
export function OnTimeDialog({ occurrence, who, onClose }: { occurrence: OccurrenceView; who: string; onClose: () => void }) {
  const family = useFamily();
  const { deviceId } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = formatTime(occurrence.scheduledAt);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function confirm() {
    if (!deviceId) {
      setError("Este aparelho ainda não foi registrado. Conecte-se à internet e abra o app de novo.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await submitReport({
      familyId: family.id,
      occurrenceId: occurrence.id,
      kind: "ADMINISTER",
      deviceId,
      baseVersion: occurrence.version,
      administeredAt: occurrence.scheduledAt,
    });
    setBusy(false);
    if (result.state === "failed") {
      setError(result.error.message);
      // O erro já está na tela; não precisa ficar na fila de pendências.
      const items = await pendingFor(family.id);
      await Promise.all(items.filter((i) => i.occurrenceId === occurrence.id && i.state === "failed").map((i) => discard(i.id)));
      return;
    }
    // Offline, a dose aparece como "Aguardando envio" na lista.
    onClose();
  }

  return (
    <dialog ref={ref} className="confirm-dialog" aria-labelledby="on-time-title" onClose={onClose}>
      <h2 id="on-time-title">Dada no horário?</h2>
      <p>
        Registrar que <strong>{who}</strong> recebeu <strong>{occurrence.treatment.name}</strong> (
        {occurrence.treatment.prescribedDose}) às <strong>{at}</strong>, no horário previsto?
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="stack">
        <button className="btn btn-primary btn-big" disabled={busy} onClick={() => void confirm()}>
          Confirmar: dada às {at}
        </button>
        <button className="btn" disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button>
      </div>
      <p className="muted small">O registro fica com o seu nome. Se foi em outro horário, abra a dose.</p>
    </dialog>
  );
}
