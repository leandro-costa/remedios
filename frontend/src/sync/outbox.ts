import { api, ApiError, OfflineError } from "../api/client";
import type { OccurrenceView } from "../api/types";
import { commitEffects } from "../db/cache";
import { db, type Effect, type OutboxItem, type ReportKind } from "../db/db";

type Listener = () => void;
const listeners = new Set<Listener>();
let running: Promise<void> | null = null;
/** Resultado de cada envio, lido por quem está esperando aquele registro. */
const results = new Map<string, SubmitResult>();
/** Erro original de um envio imediato que falhou (para a tela tratar como antes). */
const causes = new Map<string, unknown>();
const waiting = new Set<string>();

function settle(id: string, result: SubmitResult) {
  if (waiting.has(id)) results.set(id, result);
}

/** Avisa as telas quando a fila muda ou quando algo foi sincronizado. */
export function onOutboxChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l());
}

export interface NewReport {
  familyId: string;
  occurrenceId: string;
  kind: ReportKind;
  deviceId: string;
  baseVersion: number;
  administeredAt?: string;
  notes?: string;
  reason?: string;
}

export type SubmitResult =
  | { state: "synced"; result: unknown }
  | { state: "queued" }
  | { state: "failed"; error: { code: string; message: string } };

/** Qualquer gravação além de doses, aferições e sintomas (cadastros, alterações, exclusões). */
export interface Mutation {
  familyId: string;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  /** Campos acrescentados só quando o envio não é imediato (ex.: preservar conflito). */
  queuedBody?: Record<string, unknown>;
  /** Descrição para o responsável, caso o envio seja recusado mais tarde. */
  label: string;
  /** Registro afetado (ex.: a dose corrigida). */
  entityId?: string;
  /** Como a gravação aparece na cópia local até ser confirmada. */
  effects?: Effect[];
}

/** Resultado de {@link mutate}: a resposta do servidor ou "na fila". */
export type Mutated<T> = { queued: false; data: T } | { queued: true; data?: undefined };

/**
 * Grava primeiro no aparelho e tenta enviar. Online, devolve a resposta do
 * servidor; offline, devolve {@code queued: true} e a gravação fica na fila,
 * já visível nas telas pelos efeitos locais. Se o servidor recusar na hora,
 * o erro chega a quem está na tela (como uma chamada direta) e a gravação
 * sai da fila; recusas posteriores ficam visíveis para tentar de novo ou
 * descartar.
 */
export async function mutate<T = unknown>(m: Mutation): Promise<Mutated<T>> {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    familyId: m.familyId,
    kind: "MUTATION",
    method: m.method,
    path: m.path,
    // A marca de "aguardando envio" da cópia local nunca vai ao servidor.
    body: Object.fromEntries(Object.entries(m.body ?? {}).filter(([k]) => k !== "_pending")),
    queuedBody: m.queuedBody,
    label: m.label,
    entityId: m.entityId,
    effects: m.effects ?? [],
    createdAt: 0,
    attempts: 0,
    state: "pending",
  };
  const result = await enqueue(item);
  const cause = causes.get(item.id);
  causes.delete(item.id);
  if (result.state === "failed") {
    await db.outbox.delete(item.id);
    notify();
    throw cause ?? new ApiError(422, result.error.code, result.error.message, null);
  }
  return result.state === "synced" ? { queued: false, data: result.result as T } : { queued: true };
}

/**
 * Registra uma dose primeiro no aparelho e depois tenta enviar. Online, o
 * envio é imediato; offline, fica na fila até a conexão voltar.
 */
export async function submitReport(report: NewReport): Promise<SubmitResult> {
  const action = report.kind === "ADMINISTER" ? "administration" : "not-administered";
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    familyId: report.familyId,
    occurrenceId: report.occurrenceId,
    kind: report.kind,
    path: `/families/${report.familyId}/occurrences/${report.occurrenceId}/${action}`,
    body: {
      deviceId: report.deviceId,
      baseVersion: report.baseVersion,
      recordedAt: new Date().toISOString(),
      administeredAt: report.administeredAt,
      notes: report.notes,
      reason: report.reason,
    },
    createdAt: 0,
    attempts: 0,
    state: "pending",
  };
  return enqueue(item);
}

export interface NewRecord {
  familyId: string;
  personId: string;
  kind: "MEASUREMENT" | "SYMPTOM";
  deviceId: string;
  /** Campos do registro, sem id/deviceId/recordedAt. */
  fields: Record<string, unknown>;
}

/**
 * Aferição ou sintoma: o id do registro é gerado aqui e vai no corpo, o que
 * torna o reenvio seguro (o servidor reconhece o mesmo id).
 */
export async function submitRecord(record: NewRecord): Promise<SubmitResult> {
  const id = crypto.randomUUID();
  const collection = record.kind === "MEASUREMENT" ? "measurements" : "symptoms";
  return enqueue({
    id,
    familyId: record.familyId,
    personId: record.personId,
    kind: record.kind,
    path: `/families/${record.familyId}/persons/${record.personId}/${collection}`,
    body: { ...record.fields, id, deviceId: record.deviceId, recordedAt: new Date().toISOString() },
    createdAt: 0,
    attempts: 0,
    state: "pending",
  });
}

async function enqueue(item: OutboxItem): Promise<SubmitResult> {
  waiting.add(item.id);
  await store(item);
  notify();
  await flush();
  const result = results.get(item.id);
  results.delete(item.id);
  waiting.delete(item.id);
  if (result) return result;
  const stored = await db.outbox.get(item.id);
  return stored?.state === "failed" && stored.lastError
    ? { state: "failed", error: { code: stored.lastError.code, message: stored.lastError.message } }
    : { state: "queued" };
}

/**
 * Guarda o item com um createdAt estritamente maior que o do último da fila:
 * dois registros no mesmo milissegundo (ou com o relógio voltando) não trocam
 * de ordem no envio.
 */
async function store(item: OutboxItem) {
  await db.transaction("rw", db.outbox, async () => {
    const last = await db.outbox.orderBy("createdAt").last();
    item.createdAt = Math.max(Date.now(), (last?.createdAt ?? 0) + 1);
    await db.outbox.add(item);
  });
}

async function send(item: OutboxItem): Promise<unknown> {
  if (item.kind === "MUTATION") {
    // Envio imediato, com o responsável na tela: o pedido como foi feito.
    // Envio posterior (fila): com os campos de fila (ex.: preservar conflito).
    const immediate = waiting.has(item.id) && item.attempts === 0 && !item.lastError;
    const body = immediate ? item.body : { ...item.body, ...item.queuedBody };
    const empty = Object.keys(body).length === 0;
    return api(item.path, {
      method: item.method ?? "POST",
      body: item.method === "DELETE" && empty ? undefined : body,
      headers: { "Idempotency-Key": item.id },
    });
  }
  // Doses levam operationId; aferições e sintomas já levam o próprio id no corpo.
  const dose = item.kind === "ADMINISTER" || item.kind === "NOT_ADMINISTERED";
  return api<OccurrenceView>(item.path, { method: "POST", body: dose ? { ...item.body, operationId: item.id } : item.body });
}

/**
 * Envia os registros pendentes, na ordem em que foram feitos. Reenviar é
 * seguro: o servidor reconhece o operationId e não repete os efeitos.
 * Erros de negócio ficam marcados para o responsável ver; nada é descartado
 * em silêncio.
 */
export function flush(): Promise<void> {
  const run = async () => {
    const items = await db.outbox.where("createdAt").above(0).sortBy("createdAt");
    for (const item of items) {
      if (item.state !== "pending") continue;
      try {
        const result = await send(item);
        await db.transaction("rw", db.cache, db.outbox, async () => {
          await commitEffects(item.effects ?? []);
          await db.outbox.delete(item.id);
        });
        settle(item.id, { state: "synced", result });
      } catch (error) {
        if (error instanceof OfflineError) break;
        if (error instanceof ApiError && error.status === 401) break;
        const lastError = error instanceof ApiError
          ? { code: error.code, message: error.message, status: error.status, details: error.details }
          : { code: "UNKNOWN", message: "Falha ao enviar o registro." };
        await db.outbox.update(item.id, { state: "failed", attempts: item.attempts + 1, lastError });
        if (waiting.has(item.id)) causes.set(item.id, error);
        settle(item.id, { state: "failed", error: { code: lastError.code, message: lastError.message } });
      }
    }
  };
  const previous = running ?? Promise.resolve();
  const current = previous.then(run).finally(() => {
    if (running === current) running = null;
    notify();
  });
  running = current;
  return current;
}

export async function pendingFor(familyId: string): Promise<OutboxItem[]> {
  return db.outbox.where("familyId").equals(familyId).sortBy("createdAt");
}

/** Descarta um registro que falhou (o responsável decide, nunca automático). */
export async function discard(id: string) {
  await db.outbox.delete(id);
  notify();
}

/** Tenta de novo um registro que falhou. */
export async function retry(id: string) {
  await db.outbox.update(id, { state: "pending" });
  notify();
  await flush();
}

/** Dispara o envio ao reconectar, ao voltar para o app e periodicamente. */
export function startAutoFlush(): () => void {
  const trigger = () => void flush();
  window.addEventListener("online", trigger);
  const onVisible = () => document.visibilityState === "visible" && trigger();
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(trigger, 30_000);
  trigger();
  return () => {
    window.removeEventListener("online", trigger);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
