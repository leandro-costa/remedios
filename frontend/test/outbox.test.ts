import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db/db";
import { cached } from "../src/db/cache";
import { flush, pendingFor, retry, submitReport, type NewReport } from "../src/sync/outbox";
import { api } from "../src/api/client";


const report: NewReport = {
  familyId: "f1",
  occurrenceId: "o1",
  kind: "ADMINISTER",
  deviceId: "d1",
  baseVersion: 1,
  administeredAt: "2026-10-23T11:00:00.000Z",
};

function respond(status: number, body?: unknown) {
  return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

describe("fila de registros", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(async () => {
    vi.stubGlobal("location", { origin: "http://app.local" });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await db.outbox.clear();
    await db.cache.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("envia na hora quando há conexão", async () => {
    fetchMock.mockImplementation(() => respond(200, { id: "o1", status: "ADMINISTERED" }));
    const result = await submitReport(report);

    expect(result.state).toBe("synced");
    expect(await pendingFor("f1")).toHaveLength(0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://app.local/api/families/f1/occurrences/o1/administration");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ deviceId: "d1", baseVersion: 1, administeredAt: report.administeredAt });
    expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.recordedAt).toBeTruthy();
  });

  it("guarda offline e reenvia depois com o mesmo operationId", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const result = await submitReport(report);
    expect(result.state).toBe("queued");
    const [queued] = await pendingFor("f1");
    expect(queued.state).toBe("pending");

    fetchMock.mockReset();
    fetchMock.mockImplementation(() => respond(200, { id: "o1", status: "ADMINISTERED" }));
    await flush();

    expect(await pendingFor("f1")).toHaveLength(0);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).operationId).toBe(queued.id);
  });

  it("servidor fora do ar conta como offline", async () => {
    fetchMock.mockImplementation(() => respond(503));
    expect((await submitReport(report)).state).toBe("queued");
  });

  it("erro de negócio fica marcado, sem ser descartado", async () => {
    fetchMock.mockImplementation(() =>
      respond(422, { code: "OCCURRENCE_TOO_EARLY", message: "Esta dose está prevista para daqui a mais de 6 horas." }));
    const result = await submitReport(report);

    expect(result).toEqual({ state: "failed", error: { code: "OCCURRENCE_TOO_EARLY", message: expect.stringMatching(/6 horas/) } });
    const [failed] = await pendingFor("f1");
    expect(failed.state).toBe("failed");

    fetchMock.mockImplementation(() => respond(200, { id: "o1", status: "ADMINISTERED" }));
    await retry(failed.id);
    expect(await pendingFor("f1")).toHaveLength(0);
  });

  it("envia na ordem em que os registros foram feitos e para ao perder a conexão", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("offline")));
    await submitReport({ ...report, occurrenceId: "o1" });
    await submitReport({ ...report, occurrenceId: "o2", kind: "NOT_ADMINISTERED", administeredAt: undefined, reason: "dormindo" });

    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(() => respond(200, {}))
      .mockImplementationOnce(() => Promise.reject(new TypeError("offline")));
    await flush();

    expect(fetchMock.mock.calls.map(([url]) => String(url).split("/").slice(-2).join("/")))
      .toEqual(["o1/administration", "o2/not-administered"]);
    const left = await pendingFor("f1");
    expect(left.map((i) => i.occurrenceId)).toEqual(["o2"]);
  });
});

describe("cópia offline", () => {
  beforeEach(async () => {
    vi.stubGlobal("location", { origin: "http://app.local" });
    await db.cache.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("usa a última resposta guardada quando não há conexão", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond(200, [{ id: "o1" }])));
    const online = await cached("agenda", () => api<unknown[]>("/x"));
    expect(online).toMatchObject({ fresh: true, data: [{ id: "o1" }] });

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    const offline = await cached("agenda", () => api<unknown[]>("/x"));
    expect(offline).toMatchObject({ fresh: false, data: [{ id: "o1" }] });
  });

  it("sem cópia guardada, o erro chega à tela", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    await expect(cached("nada", () => api("/x"))).rejects.toThrow("Sem conexão");
  });
});
