import { Dexie, type EntityTable } from "dexie";

/** Resposta da API guardada para uso offline. */
export interface CacheEntry {
  key: string;
  value: unknown;
  savedAt: number;
}

export type ReportKind = "ADMINISTER" | "NOT_ADMINISTERED";
export type OutboxKind = ReportKind | "MEASUREMENT" | "SYMPTOM";

/**
 * Registro feito neste aparelho e ainda não confirmado pelo servidor.
 * O id é o operationId: o mesmo em todas as tentativas de envio (seção 10.1).
 */
export interface OutboxItem {
  id: string;
  familyId: string;
  kind: OutboxKind;
  /** Rota da API (sem /api) para onde o registro é enviado (POST). */
  path: string;
  /** Doses: a ocorrência. */
  occurrenceId?: string;
  /** Aferições e sintomas: a pessoa. */
  personId?: string;
  body: {
    deviceId: string;
    recordedAt: string;
    baseVersion?: number;
    administeredAt?: string;
    notes?: string;
    reason?: string;
    [field: string]: unknown;
  };
  createdAt: number;
  attempts: number;
  state: "pending" | "failed";
  lastError?: { code: string; message: string };
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
