import { api, ApiError, OfflineError } from "../api/client";
import type { OccurrenceView } from "../api/types";
import { db, type OutboxItem, type ReportKind } from "../db/db";

type Listener = () => void;
const listeners = new Set<Listener>();
let running: Promise<void> | null = null;
/** Resultado de cada envio, lido por quem está esperando aquele registro. */
const results = new Map<string, SubmitResult>();
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
  | { state: "synced"; occurrence: OccurrenceView }
  | { state: "queued" }
  | { state: "failed"; error: { code: string; message: string } };

/**
 * Registra uma dose primeiro no aparelho e depois tenta enviar. Online, o
 * envio é imediato; offline, fica na fila até a conexão voltar.
 */
export async function submitReport(report: NewReport): Promise<SubmitResult> {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    familyId: report.familyId,
    occurrenceId: report.occurrenceId,
    kind: report.kind,
    body: {
      deviceId: report.deviceId,
      baseVersion: report.baseVersion,
      recordedAt: new Date().toISOString(),
      administeredAt: report.administeredAt,
      notes: report.notes,
      reason: report.reason,
    },
    createdAt: Date.now(),
    attempts: 0,
    state: "pending",
  };
  waiting.add(item.id);
  await db.outbox.add(item);
  notify();
  await flush();
  const result = results.get(item.id);
  results.delete(item.id);
  waiting.delete(item.id);
  if (result) return result;
  const stored = await db.outbox.get(item.id);
  return stored?.state === "failed" && stored.lastError
    ? { state: "failed", error: stored.lastError }
    : { state: "queued" };
}

async function send(item: OutboxItem): Promise<OccurrenceView> {
  const path = item.kind === "ADMINISTER" ? "administration" : "not-administered";
  return api<OccurrenceView>(`/families/${item.familyId}/occurrences/${item.occurrenceId}/${path}`, {
    method: "POST",
    body: { ...item.body, operationId: item.id },
  });
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
        const occurrence = await send(item);
        await db.outbox.delete(item.id);
        settle(item.id, { state: "synced", occurrence });
      } catch (error) {
        if (error instanceof OfflineError) break;
        if (error instanceof ApiError && error.status === 401) break;
        const lastError = error instanceof ApiError
          ? { code: error.code, message: error.message }
          : { code: "UNKNOWN", message: "Falha ao enviar o registro." };
        await db.outbox.update(item.id, { state: "failed", attempts: item.attempts + 1, lastError });
        settle(item.id, { state: "failed", error: lastError });
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
  await db.outbox.update(id, { state: "pending", lastError: undefined });
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
