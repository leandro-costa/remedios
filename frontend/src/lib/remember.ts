import { useCallback, useState } from "react";
import type { PersonView } from "../api/types";

/**
 * Última escolha de cada tela (pessoa, visão, período, situação…), guardada
 * neste aparelho e por família: ao voltar, a tela abre como foi deixada.
 * "Todos" é uma escolha como as outras (fica guardada se foi a última), mas
 * não é o padrão: sem escolha guardada, a tela abre na pessoa de quem usa o
 * app (ou na primeira).
 */
const PREFIX = "remedios.escolha";

/** Valor guardado para "Todos" (diferente de "nada guardado"). */
export const ALL = "todos";

function storageKey(familyId: string, screen: string) {
  return `${PREFIX}:${familyId}:${screen}`;
}

export function recall(familyId: string, screen: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(familyId, screen)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function remember(familyId: string, screen: string, patch: Record<string, string>) {
  try {
    localStorage.setItem(storageKey(familyId, screen), JSON.stringify({ ...recall(familyId, screen), ...patch }));
  } catch {
    // sem armazenamento: a escolha vale só enquanto a tela estiver aberta
  }
}

/** Estado guardado: começa com a última escolha da tela e guarda cada mudança. */
export function useRemembered(familyId: string, screen: string, field: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => recall(familyId, screen)[field] ?? fallback);
  const set = useCallback((next: string) => {
    setValue(next);
    remember(familyId, screen, { [field]: next });
  }, [familyId, screen, field]);
  return [value, set];
}

/** Pessoa padrão quando não há escolha guardada: quem usa o app, se for acompanhado; senão a primeira. */
export function defaultPerson(persons: PersonView[] | undefined, meId: string | undefined): string | null {
  if (!persons?.length) return null;
  return (persons.find((p) => p.userId && p.userId === meId) ?? persons[0]).id;
}

/**
 * Pessoa escolhida numa tela com "Todos": a guardada (se ainda existe), senão
 * a padrão. null quer dizer "Todos".
 */
export function resolvePerson(saved: string | undefined, persons: PersonView[] | undefined, meId: string | undefined): string | null {
  if (saved === ALL) return null;
  if (saved && (!persons || persons.some((p) => p.id === saved))) return saved;
  return defaultPerson(persons, meId);
}
