import { Dexie, type EntityTable } from "dexie";

/** Resposta da API guardada para uso offline. */
export interface CacheEntry {
  key: string;
  value: unknown;
  savedAt: number;
}

export type ReportKind = "ADMINISTER" | "NOT_ADMINISTERED";
/** MUTATION: qualquer outra gravação (cadastros, alterações, exclusões). */
export type OutboxKind = ReportKind | "MEASUREMENT" | "SYMPTOM" | "MUTATION";

/**
 * Efeito de uma gravação pendente sobre a cópia local de uma consulta: é o
 * que faz o registro aparecer na tela antes de chegar ao servidor.
 * {@code key} é a chave da consulta guardada (ou o prefixo, com {@code prefix}).
 */
export type Effect =
  /** upsert: substitui pelo id ou acrescenta; {@code list}: a consulta é uma lista (cria uma se não houver). */
  | { key: string; prefix?: boolean; op: "upsert"; value: Record<string, unknown>; list?: boolean }
  | { key: string; prefix?: boolean; op: "merge"; id?: string; value: Record<string, unknown> }
  | { key: string; prefix?: boolean; op: "remove"; id: string };

/**
 * Registro feito neste aparelho e ainda não confirmado pelo servidor.
 * O id é o operationId: o mesmo em todas as tentativas de envio (seção 10.1).
 */
export interface OutboxItem {
  id: string;
  familyId: string;
  kind: OutboxKind;
  /** Rota da API (sem /api) para onde o registro é enviado. */
  path: string;
  /** MUTATION: registro afetado, para a tela dele mostrar que há alteração pendente. */
  entityId?: string;
  /** MUTATION: método HTTP (padrão POST). */
  method?: "POST" | "PUT" | "DELETE";
  /** MUTATION: descrição para o responsável ("Nova pessoa: Gabriel"). */
  label?: string;
  /** MUTATION: como o registro aparece na cópia local enquanto não é enviado. */
  effects?: Effect[];
  /** MUTATION: campos acrescentados quando o envio não é imediato (fila offline). */
  queuedBody?: Record<string, unknown>;
  /** Doses: a ocorrência. */
  occurrenceId?: string;
  /** Aferições e sintomas: a pessoa. */
  personId?: string;
  body: {
    deviceId?: string;
    recordedAt?: string;
    baseVersion?: number;
    administeredAt?: string;
    notes?: string;
    reason?: string;
    [field: string]: unknown;
  };
  createdAt: number;
  attempts: number;
  state: "pending" | "failed";
  lastError?: { code: string; message: string; status?: number; details?: Record<string, unknown> | null };
}

export const db = new Dexie("remedios") as Dexie & {
  cache: EntityTable<CacheEntry, "key">;
  outbox: EntityTable<OutboxItem, "id">;
};

db.version(1).stores({
  cache: "key",
  outbox: "id, familyId, occurrenceId, createdAt",
});

// v2: a fila também leva aferições e sintomas; cada item guarda sua rota.
db.version(2).stores({
  cache: "key",
  outbox: "id, familyId, occurrenceId, personId, createdAt",
}).upgrade((tx) =>
  tx.table("outbox").toCollection().modify((item: OutboxItem) => {
    if (!item.path) {
      const action = item.kind === "ADMINISTER" ? "administration" : "not-administered";
      item.path = `/families/${item.familyId}/occurrences/${item.occurrenceId}/${action}`;
    }
  }));
