import type { DoseStatus, Role, TreatmentKind, TreatmentStatus } from "../api/types";

export const DOSE_STATUS: Record<DoseStatus, string> = {
  SCHEDULED: "Prevista",
  PENDING: "Pendente",
  ADMINISTERED: "Administrada",
  NOT_ADMINISTERED: "Não administrada",
  CANCELLED: "Cancelada",
  REVIEW_REQUIRED: "Conferir",
};

export const TREATMENT_STATUS: Record<TreatmentStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  ENDED: "Encerrado",
};

export const TREATMENT_KIND: Record<TreatmentKind, string> = {
  CONTINUOUS: "Contínuo",
  OCCASIONAL: "Ocasional (por período)",
  AS_NEEDED: "Se necessário (sem horários)",
};

export const ROLE: Record<Role, string> = {
  ADMIN: "Administrador",
  MEMBER: "Membro",
};

export const TRAIL_EVENT: Record<string, string> = {
  DOSE_ADMINISTERED: "Administração registrada",
  DOSE_NOT_ADMINISTERED: "Registrado que não foi dada",
  DOSE_CORRECTED: "Registro corrigido",
  DOSE_CONFLICT_OPENED: "Registro divergente recebido",
  DOSE_CONFLICT_RESOLVED: "Conferência concluída",
};
