import type { DoseStatus } from "../api/types";
import { DOSE_STATUS } from "../lib/labels";
import { Icon, type IconName } from "./Icon";

const ICON: Partial<Record<string, IconName>> = {
  administered: "check",
  pending: "clock",
  scheduled: "clock",
  late: "alert",
  "review-required": "review",
  "not-administered": "x",
};

/** Situação da dose: sempre com texto e ícone, nunca só pela cor. */
export function StatusBadge({ status, late, queued }: { status: DoseStatus; late?: boolean; queued?: boolean }) {
  if (queued) return <span className="badge badge-queued"><Icon name="sync" />Aguardando envio</span>;
  const label = late && (status === "PENDING" || status === "SCHEDULED") ? "Atrasada" : DOSE_STATUS[status];
  const tone = late ? "late" : status.toLowerCase().replace("_", "-");
  const icon = ICON[tone];
  return <span className={`badge badge-${tone}`}>{icon && <Icon name={icon} />}{label}</span>;
}
