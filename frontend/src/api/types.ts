// Tipos das respostas da API (docs/api.md).

export type Role = "ADMIN" | "MEMBER";

export interface UserView {
  id: string;
  displayName: string;
}

export interface FamilyView {
  id: string;
  name: string;
  myRole: Role;
  createdAt: string;
}

export interface MemberView {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
}

export interface InvitationView {
  id: string;
  role: Role;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

export interface IssuedInvitation {
  id: string;
  code: string;
  role: Role;
  expiresAt: string;
}

export interface PersonView {
  id: string;
  displayName: string;
  birthDate: string | null;
  userId: string | null;
  active: boolean;
}

export type ConfirmationPolicy = "IMPORTANT_ONLY" | "ALL" | "NONE";

export interface FamilySettings {
  reminderBeforeMinutes: number;
  repeatIntervalMinutes: number;
  repeatLimit: number;
  lateToleranceMinutes: number;
  confirmationPolicy: ConfirmationPolicy;
  version: number;
}

export interface NotificationSettings {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  earlyReminderEnabled: boolean;
  repeatIntervalMinutes: number | null;
  confirmationNotifications: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  syncNoticeMode: "NOTIFY" | "SILENT";
  lockScreenDetails: boolean;
}

export interface DeviceView {
  id: string;
  platform: "ANDROID" | "WEB";
  name: string | null;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  lastSeenAt: string | null;
}

export type ScheduleType = "DAILY" | "WEEKLY" | "INTERVAL";
export type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

export interface ScheduleRule {
  type: ScheduleType;
  timezone: string;
  times?: string[];
  everyDays?: number;
  daysOfWeek?: DayOfWeek[];
  everyHours?: number;
  firstDoseAt?: string;
  reminders?: {
    reminderBeforeMinutes?: number;
    repeatIntervalMinutes?: number;
    repeatLimit?: number;
    lateToleranceMinutes?: number;
  };
}

export type TreatmentStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "ENDED";
/** {@code AS_NEEDED}: "se necessário", sem horários; cada dose é registrada quando é dada. */
export type TreatmentKind = "CONTINUOUS" | "OCCASIONAL" | "AS_NEEDED";

export interface TreatmentView {
  id: string;
  personId: string;
  name: string;
  kind: TreatmentKind;
  prescribedDose: string;
  route: string | null;
  instructions: string | null;
  status: TreatmentStatus;
  startAt: string;
  endAt: string | null;
  /** Término por número de doses (excludente com endAt). */
  doseCount?: number | null;
  schedule: ScheduleRule | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  /** Alteração feita sem conexão aguardando conferência (seção 10.2). */
  conflictId: string | null;
}

/** Andamento do tratamento: total e última previstos (nulos sem término). */
export interface TreatmentProgressView {
  treatmentId: string;
  total: number | null;
  administered: number;
  notAdministered: number;
  /** Horário já passou e ninguém registrou. */
  unrecorded: number;
  review: number;
  upcoming: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

/** Doses previstas antes de agora, ao ativar um tratamento que começou no passado. */
export type PastDoses = "OPEN" | "ADMINISTERED";

export interface TreatmentProposal {
  id: string;
  action: "UPDATE" | "STATUS";
  proposedBy: string;
  deviceId: string;
  baseVersion: number | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TreatmentConflictView {
  id: string;
  reason: string;
  baseVersion: number | null;
  createdAt: string;
  treatment: TreatmentView;
  proposals: TreatmentProposal[];
}

export interface RevisionView {
  version: number;
  baseVersion: number | null;
  snapshot: Record<string, unknown>;
  effectiveFrom: string;
  changeReason: string | null;
  createdBy: string;
  createdAt: string;
}

export type DoseStatus =
  | "SCHEDULED"
  | "PENDING"
  | "ADMINISTERED"
  | "NOT_ADMINISTERED"
  | "CANCELLED"
  | "REVIEW_REQUIRED";

export interface UserRef {
  id: string;
  displayName: string;
}

export interface AdministrationView {
  id: string;
  administeredAt: string;
  recordedAt: string;
  receivedAt: string;
  recordedBy: UserRef | null;
  deviceId: string;
  notes: string | null;
  voidedAt: string | null;
  voidedBy: UserRef | null;
  voidReason: string | null;
}

export interface OccurrenceView {
  id: string;
  scheduledAt: string;
  status: DoseStatus;
  late: boolean;
  version: number;
  person: { id: string; displayName: string };
  treatment: { id: string; name: string; prescribedDose: string; route: string | null; kind?: TreatmentKind };
  administration: AdministrationView | null;
  statusReason: string | null;
  statusChangedBy: UserRef | null;
  statusChangedAt: string | null;
  /** "Estou cuidando desta dose", quando ativo. */
  claimedBy: UserRef | null;
  claimedUntil: string | null;
  /** "Lembrar daqui a pouco" de quem consulta: só o lembrete, não a dose. */
  remindAt?: string | null;
}

export interface TrailEntry {
  eventType: string;
  actor: UserRef | null;
  occurredAt: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ProposalView {
  id: string;
  type: "ADMINISTER" | "MARK_NOT_ADMINISTERED";
  administeredAt: string | null;
  notes: string | null;
  reason: string | null;
  recordedBy: UserRef | null;
  deviceId: string | null;
  recordedAt: string | null;
  receivedAt: string;
}

export interface ConflictView {
  id: string;
  createdAt: string;
  reason: string;
  previous: Record<string, unknown> | null;
  proposals: ProposalView[];
}

export interface OccurrenceDetail {
  occurrence: OccurrenceView;
  records: AdministrationView[];
  trail: TrailEntry[];
  conflict: ConflictView | null;
}

export type MeasurementType =
  | "TEMPERATURE"
  | "HEART_RATE"
  | "BLOOD_PRESSURE"
  | "OXYGEN_SATURATION"
  | "BLOOD_GLUCOSE"
  | "WEIGHT"
  | "OTHER";

export interface MeasurementView {
  id: string;
  personId: string;
  type: MeasurementType;
  value: number;
  value2: number | null;
  unit: string;
  label: string | null;
  method: string | null;
  measuredAt: string;
  notes: string | null;
  recordedBy: UserRef | null;
  deviceId: string;
  recordedAt: string;
  receivedAt: string;
  replacesId: string | null;
  voidedAt: string | null;
  voidedBy: UserRef | null;
  voidReason: string | null;
}

export type Intensity = "MILD" | "MODERATE" | "SEVERE";

export interface SymptomView {
  id: string;
  personId: string;
  description: string;
  intensity: Intensity | null;
  startedAt: string;
  endedAt: string | null;
  treatmentId: string | null;
  notes: string | null;
  version: number;
  recordedBy: UserRef | null;
  deviceId: string;
  recordedAt: string;
  updatedBy: UserRef | null;
  updatedAt: string | null;
}

export interface ReferenceLineView {
  id: string;
  personId: string | null;
  type: Exclude<MeasurementType, "OTHER">;
  value: number;
  value2: number | null;
  label: string;
  updatedAt: string;
}

export interface CustomReminderView {
  id: string;
  personId: string;
  message: string;
  remindAt: string;
  notifyEveryone: boolean;
  createdBy: string;
}
