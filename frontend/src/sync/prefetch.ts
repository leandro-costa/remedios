import type { FamilyView, PersonView, TreatmentView } from "../api/types";
import { cached } from "../db/cache";
import { db } from "../db/db";
import { HEALTH_DEFAULT_HOURS, HISTORY_DEFAULT_DAYS, queries, type Query } from "../lib/queries";
import { recall, resolvePerson } from "../lib/remember";
import { startOfDay } from "../lib/time";
import { flush } from "./outbox";

/** Intervalo mínimo entre dois pré-carregamentos completos. */
const EVERY_MS = 10 * 60_000;
/** Hora do último pré-carregamento, guardada no aparelho (vale também ao reabrir o app). */
const LAST = "remedios.prefetch.last";
let running: Promise<void> | null = null;

function lastRun(familyId: string): number {
  try {
    return Number(localStorage.getItem(`${LAST}:${familyId}`) ?? 0);
  } catch {
    return 0;
  }
}

function markRun(familyId: string) {
  try {
    localStorage.setItem(`${LAST}:${familyId}`, String(Date.now()));
  } catch {
    // sem armazenamento: pode repetir antes dos 10 minutos, sem outro efeito
  }
}

/**
 * Guarda no aparelho os dados de todas as telas, não só das que foram
 * abertas: assim, sem conexão, qualquer tela mostra a última cópia. Roda ao
 * abrir o app, ao reconectar e de tempos em tempos; cada consulta usa a
 * mesma chave da tela (lib/queries.ts). Falhas são ignoradas: a tela tenta
 * de novo quando for aberta.
 */
export function prefetch(family: FamilyView, userId: string | null, force = false): Promise<void> {
  if (!navigator.onLine) return Promise.resolve();
  if (running) return running;
  if (!force && Date.now() - lastRun(family.id) < EVERY_MS) return Promise.resolve();
  markRun(family.id);
  running = run(family, userId).finally(() => {
    running = null;
  });
  return running;
}

/**
 * Poucas consultas por vez e com pausa: no máximo ~6 por segundo, longe do
 * limite do servidor (que vale por endereço, e a família em casa compartilha
 * um) e sem disputar a conexão com o que a pessoa está fazendo.
 */
const PARALLEL = 2;
const PAUSE_MS = 300;
let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await work();
  } finally {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    active--;
    waiting.shift()?.();
  }
}

async function run(family: FamilyView, userId: string | null) {
  const f = family.id;
  // Primeiro o que está na fila: a cópia guardada já vem com os registros enviados.
  await flush();
  const get = async <T>(query: Query<T>): Promise<T | undefined> => {
    if (!navigator.onLine) return undefined;
    try {
      return (await slot(() => cached(query.key, query.fetch))).data;
    } catch {
      return undefined;
    }
  };

  const [persons, treatments, medications] = await Promise.all([
    get<PersonView[]>(queries.persons(f)),
    get<TreatmentView[]>(queries.treatments(f)),
    get(queries.medications(f)),
    get(queries.personsAll(f)),
    get(queries.members(f)),
    get(queries.prescriptions(f)),
    get(queries.treatmentProgress(f)),
    get(queries.treatmentConflicts(f)),
    get(queries.conflicts(f)),
    get(queries.settings(f)),
    get(queries.referenceLines(f)),
    get(queries.agenda(f, startOfDay(new Date()))),
    get(queries.recipients(f)),
    get(queries.devices()),
    ...(userId ? [get(queries.notificationPrefs(userId))] : []),
    ...(family.myRole === "ADMIN" ? [get(queries.invitations(f))] : []),
  ]);

  // Cada tratamento já veio na lista: a tela do tratamento usa a mesma versão.
  const savedAt = Date.now();
  await db.cache.bulkPut((treatments ?? []).map((t) => ({ key: queries.treatment(f, t.id).key, value: t, savedAt })));

  const now = Date.now();
  // Histórico e Saúde com a última escolha de cada tela (pessoa, período…),
  // a mesma chave que a tela vai procurar sem conexão.
  const hist = recall(f, "historico");
  const days = Number(hist.dias) || HISTORY_DEFAULT_DAYS;
  const histPerson = resolvePerson(hist.pessoa || undefined, persons, userId ?? undefined) ?? "";
  const hours = [...new Set([HEALTH_DEFAULT_HOURS, Number(recall(f, "saude").horas) || HEALTH_DEFAULT_HOURS])];
  const more: Query<unknown>[] = [
    queries.history(f, days, histPerson, hist.medicamento ?? "", hist.responsavel ?? ""),
    ...(persons ?? []).flatMap((p) => [
      ...hours.flatMap((h) => [
        queries.measurements(f, p.id, h, now),
        queries.symptoms(f, p.id, h, now),
        queries.healthDoses(f, p.id, h, now),
      ]),
      queries.reminders(f, p.id),
    ]),
    ...(treatments ?? []).filter((t) => t.status !== "ENDED").flatMap((t) => [
      queries.revisions(f, t.id),
      ...(t.kind === "AS_NEEDED" ? [queries.asNeeded(f, t)] : []),
    ]),
    ...(medications ?? []).map((m) => queries.medicationHistory(f, m.id)),
  ];
  await Promise.all(more.map(get));
}
