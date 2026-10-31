import { api } from "../api/client";
import type {
  CustomReminderView, DeviceView, FamilySettings, InvitationView, NotificationSettings, MeasurementView, MedicationView, MemberView, OccurrenceDetail, OccurrenceView, PersonView,
  PrescriptionView, ReferenceLineView, RevisionView, SymptomView, TreatmentConflictView, TreatmentProgressView, TreatmentView,
} from "../api/types";
import { addDays, startOfDay } from "./time";

/**
 * Consultas guardadas no aparelho: a chave da cópia offline e a busca na API.
 * As telas e o pré-carregamento (sync/prefetch.ts) usam as mesmas, para que o
 * que foi guardado em segundo plano seja encontrado pela tela sem conexão.
 * A chave nunca leva o horário exato da consulta, senão cada abertura geraria
 * uma chave nova e a cópia anterior nunca seria achada offline.
 */
export interface Query<T> {
  key: string;
  fetch: () => Promise<T>;
}

const DAY_MS = 86_400_000;
const q = <T>(key: string, fetch: () => Promise<T>): Query<T> => ({ key, fetch });

export const queries = {
  persons: (f: string) => q(`persons:${f}`, () => api<PersonView[]>(`/families/${f}/persons`, { query: { active: "true" } })),
  personsAll: (f: string) => q(`persons-all:${f}`, () => api<PersonView[]>(`/families/${f}/persons`)),
  members: (f: string) => q(`members:${f}`, () => api<MemberView[]>(`/families/${f}/members`)),
  treatments: (f: string) => q(`treatments:${f}`, () => api<TreatmentView[]>(`/families/${f}/treatments`)),
  treatment: (f: string, id: string) => q(`treatment:${id}`, () => api<TreatmentView>(`/families/${f}/treatments/${id}`)),
  revisions: (f: string, id: string) => q(`revisions:${id}`, () => api<RevisionView[]>(`/families/${f}/treatments/${id}/revisions`)),
  treatmentProgress: (f: string) => q(`treatment-progress:${f}`, () => api<TreatmentProgressView[]>(`/families/${f}/treatments/progress`)),
  treatmentConflicts: (f: string) => q(`treatment-conflicts:${f}`, () => api<TreatmentConflictView[]>(`/families/${f}/treatments/conflicts`)),
  conflicts: (f: string) => q(`conflicts:${f}`, () => api<OccurrenceDetail[]>(`/families/${f}/conflicts`)),
  prescriptions: (f: string) => q(`prescriptions:${f}`, () => api<PrescriptionView[]>(`/families/${f}/prescriptions`)),
  medications: (f: string) => q(`medications:${f}`, () => api<MedicationView[]>(`/families/${f}/medications`)),
  settings: (f: string) => q(`settings:${f}`, () => api<FamilySettings>(`/families/${f}/settings`)),
  referenceLines: (f: string) => q(`reference-lines:${f}`, () => api<ReferenceLineView[]>(`/families/${f}/reference-lines`)),
  invitations: (f: string) => q(`invitations:${f}`, () => api<InvitationView[]>(`/families/${f}/invitations`)),
  recipients: (f: string) => q(`notification-recipients:${f}`, () => api<unknown[]>(`/families/${f}/notification-recipients`)),
  notificationPrefs: (userId: string) => q(`prefs:${userId}`, () => api<NotificationSettings>("/me/notification-settings")),
  devices: () => q("devices", () => api<DeviceView[]>("/me/devices")),
  reminders: (f: string, personId: string) =>
    q(`reminders:${f}:${personId}`, () => api<CustomReminderView[]>(`/families/${f}/persons/${personId}/reminders`)),

  /** Doses de um dia (busca de um dia antes a três depois: a cópia cobre os próximos dias). */
  agenda: (f: string, day: Date) => q(`agenda:${f}:${day.toISOString()}`, () =>
    api<OccurrenceView[]>(`/families/${f}/occurrences`, {
      query: { from: addDays(day, -1).toISOString(), to: addDays(day, 3).toISOString() },
    })),

  /** Saúde de uma pessoa nas últimas `hours` horas, até `anchor` (o período escolhido na tela). */
  measurements: (f: string, personId: string, hours: number, anchor: number) =>
    q(`measurements:${f}:${personId}:${hours}h`, () =>
      api<MeasurementView[]>(`/families/${f}/persons/${personId}/measurements`, { query: healthRange(hours, anchor) })),
  symptoms: (f: string, personId: string, hours: number, anchor: number) =>
    q(`symptoms:${f}:${personId}:${hours}h`, () =>
      api<SymptomView[]>(`/families/${f}/persons/${personId}/symptoms`, { query: healthRange(hours, anchor) })),
  healthDoses: (f: string, personId: string, hours: number, anchor: number) =>
    q(`doses:${f}:${personId}:${hours}h`, () =>
      api<OccurrenceView[]>(`/families/${f}/history`, { query: { ...healthRange(hours, anchor), personId, limit: 500 } })),

  /** Histórico dos últimos `days` dias (até o fim de hoje), com filtros. */
  history: (f: string, days: number, personId = "", medicationId = "", recordedBy = "") =>
    q(`history:${f}:${days}:${personId}:${medicationId}:${recordedBy}`, () => {
      const to = addDays(startOfDay(new Date()), 1);
      return api<OccurrenceView[]>(`/families/${f}/history`, {
        query: { from: addDays(to, -days).toISOString(), to: to.toISOString(), personId, medicationId, recordedBy, limit: 300 },
      });
    }),

  /** Uso de um medicamento nos últimos 60 dias, de todas as pessoas. */
  medicationHistory: (f: string, id: string) => q(`medication-history:${id}`, () => {
    const now = Date.now();
    return api<OccurrenceView[]>(`/families/${f}/history`, {
      query: { medicationId: id, from: new Date(now - 60 * DAY_MS).toISOString(), to: new Date(now + 3_600_000).toISOString(), limit: 200 },
    });
  }),

  /**
   * Doses "se necessário" consolidadas por pessoa e medicamento: as de todos os
   * tratamentos com o mesmo medicamento (receita ou uso eventual). Sem
   * medicamento (cadastro ainda não enviado), as do tratamento.
   */
  asNeeded: (f: string, t: Pick<TreatmentView, "id" | "personId" | "medicationId">) =>
    q(t.medicationId ? `med-history:${t.personId}:${t.medicationId}` : `as-needed:${t.id}`, () => {
      const now = Date.now();
      return api<OccurrenceView[]>(`/families/${f}/history`, {
        query: {
          ...(t.medicationId ? { personId: t.personId, medicationId: t.medicationId } : { treatmentId: t.id }), limit: "200",
          // A API aceita no máximo 62 dias por consulta.
          from: new Date(now - 60 * DAY_MS).toISOString(),
          to: new Date(now + 3_600_000).toISOString(),
        },
      });
    }),
};

function healthRange(hours: number, anchor: number) {
  return { from: new Date(anchor - hours * 3_600_000).toISOString(), to: new Date(anchor + 60_000).toISOString() };
}

/** Período padrão da tela Saúde. */
export const HEALTH_DEFAULT_HOURS = 24;
/** Período padrão do Histórico. */
export const HISTORY_DEFAULT_DAYS = 7;
