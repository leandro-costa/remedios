import { Dexie, type EntityTable } from "dexie";

/** Resposta da API guardada para uso offline. */
export interface CacheEntry {
  key: string;
  value: unknown;
  savedAt: number;
}

export type ReportKind = "ADMINISTER" | "NOT_ADMINISTERED";

/**
 * Registro feito neste aparelho e ainda não confirmado pelo servidor.
 * O id é o operationId: o mesmo em todas as tentativas de envio (seção 10.1).
 */
export interface OutboxItem {
  id: string;
  familyId: string;
  occurrenceId: string;
  kind: ReportKind;
  body: {
    deviceId: string;
    baseVersion: number;
    recordedAt: string;
    administeredAt?: string;
    notes?: string;
    reason?: string;
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
