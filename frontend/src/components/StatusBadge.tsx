import type { DoseStatus } from "../api/types";
import { DOSE_STATUS } from "../lib/labels";

export function StatusBadge({ status, late, queued }: { status: DoseStatus; late?: boolean; queued?: boolean }) {
  if (queued) return <span className="badge badge-queued">Aguardando envio</span>;
  const label = late && (status === "PENDING" || status === "SCHEDULED") ? "Atrasada" : DOSE_STATUS[status];
  const tone = late ? "late" : status.toLowerCase().replace("_", "-");
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
