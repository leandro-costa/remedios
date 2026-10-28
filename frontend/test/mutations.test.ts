import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { applyLocal, clearLocalData, isPending } from "../src/db/cache";
import { db, type OutboxItem } from "../src/db/db";
import { flush, mutate, pendingFor, retry } from "../src/sync/outbox";

function respond(status: number, body?: unknown) {
  return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

const offline = () => Promise.reject(new TypeError("offline"));

function item(effects: OutboxItem["effects"], state: OutboxItem["state"] = "pending"): OutboxItem {
  return { id: crypto.randomUUID(), familyId: "f1", kind: "MUTATION", path: "/x", body: {}, effects, createdAt: 1, attempts: 0, state };
}

describe("cópia local com gravações pendentes", () => {
  const people = [{ id: "p1", displayName: "Ana" }, { id: "p2", displayName: "Bia" }];

  it("acrescenta, altera e remove itens de uma lista", () => {
    const items = [
      item([{ key: "persons:f1", op: "upsert", value: { id: "p3", displayName: "Gabriel" } }]),
      item([{ key: "persons:f1", op: "merge", id: "p1", value: { displayName: "Ana Souza" } }]),
      item([{ key: "persons:f1", op: "remove", id: "p2" }]),
    ];
    const result = applyLocal("persons:f1", people, items)!;
    expect(result.map((p) => p.displayName)).toEqual(["Ana Souza", "Gabriel"]);
    expect(result.every(isPending)).toBe(true);
  });

  it("ignora outras consultas, gravações recusadas e respeita prefixos", () => {
    const items = [
      item([{ key: "persons:f2", op: "upsert", value: { id: "x" } }]),
      item([{ key: "persons:f1", op: "upsert", value: { id: "y" } }], "failed"),
      item([{ key: "reminders:f1:", prefix: true, op: "upsert", value: { id: "r1" }, list: true }]),
    ];
    expect(applyLocal("persons:f1", people, items)).toEqual(people);
    expect(applyLocal("reminders:f1:p1", undefined, items)).toEqual([{ id: "r1", _pending: true }]);
  });

  it("cria a consulta de um registro feito offline que nunca foi baixado", () => {
    const items = [item([{ key: "treatment:t1", op: "upsert", value: { id: "t1", name: "Amoxicilina" } }])];
    expect(applyLocal("treatment:t1", undefined, items)).toEqual({ id: "t1", name: "Amoxicilina", _pending: true });
    expect(applyLocal("persons:f1", undefined, items)).toBeUndefined();
  });
});

describe("gravações pela fila", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(async () => {
    vi.stubGlobal("location", { origin: "http://app.local" });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await db.outbox.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const create = {
    familyId: "f1", method: "POST" as const, path: "/families/f1/persons", body: { id: "p3", displayName: "Gabriel" },
    label: "Nova pessoa: Gabriel", effects: [{ key: "persons:f1", op: "upsert" as const, value: { id: "p3" } }],
  };

  it("online: envia com a chave da operação e devolve a resposta", async () => {
    fetchMock.mockImplementation(() => respond(201, { id: "p3" }));
    expect(await mutate(create)).toEqual({ queued: false, data: { id: "p3" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await pendingFor("f1")).toHaveLength(0);
  });

  it("offline: fica na fila e é enviado depois com a mesma chave e os campos de fila", async () => {
    fetchMock.mockImplementation(offline);
    expect(await mutate({ ...create, queuedBody: { preserveConflict: true } })).toEqual({ queued: true });
    const [queued] = await pendingFor("f1");
    expect(queued.label).toBe("Nova pessoa: Gabriel");

    fetchMock.mockReset();
    fetchMock.mockImplementation(() => respond(201, { id: "p3" }));
    await flush();
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(queued.id);
    expect(JSON.parse(String(init?.body))).toEqual({ id: "p3", displayName: "Gabriel", preserveConflict: true });
    expect(await pendingFor("f1")).toHaveLength(0);
  });

  it("recusa imediata chega à tela como erro e não fica na fila", async () => {
    fetchMock.mockImplementation(() => respond(409, { code: "STALE_VERSION", message: "Mudou.", details: { currentVersion: 4 } }));
    const error = (await mutate(create).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.details).toEqual({ currentVersion: 4 });
    expect(await pendingFor("f1")).toHaveLength(0);
  });

  it("recusa ao sincronizar fica visível para tentar de novo", async () => {
    fetchMock.mockImplementation(offline);
    await mutate(create);
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => respond(422, { code: "PERSON_INACTIVE", message: "Perfil inativo." }));
    await flush();
    const [failed] = await pendingFor("f1");
    expect(failed.state).toBe("failed");
    expect(failed.lastError?.message).toBe("Perfil inativo.");

    fetchMock.mockImplementation(() => respond(201, { id: "p3" }));
    await retry(failed.id);
    expect(await pendingFor("f1")).toHaveLength(0);
  });

  it("exclusão sem corpo", async () => {
    fetchMock.mockImplementation(() => respond(204));
    await mutate({ familyId: "f1", method: "DELETE", path: "/families/f1/reminders/r1", label: "Cancelar lembrete" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
  });
});

describe("sair da conta", () => {
  it("apaga a cópia offline e a fila do aparelho", async () => {
    await db.cache.put({ key: "persons:f1", value: [{ id: "p1" }], savedAt: Date.now() });
    await db.outbox.add(item([]));
    await clearLocalData();
    expect(await db.cache.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
