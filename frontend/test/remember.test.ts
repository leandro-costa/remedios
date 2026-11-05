import { describe, expect, it } from "vitest";
import type { PersonView } from "../src/api/types";
import { ALL, resolvePerson, shownPerson } from "../src/lib/remember";

const p = (id: string, userId: string | null = null) => ({ id, displayName: id, userId }) as unknown as PersonView;
const persons = [p("ana"), p("bia", "u-bia")];

describe("escolha de pessoa nas telas com filtro", () => {
  it("usa a escolha guardada quando a pessoa existe", () => {
    expect(shownPerson(resolvePerson("ana", persons, "u-x"), persons)).toBe("ana");
  });

  it("\"Todos\" guardado continua Todos", () => {
    expect(shownPerson(resolvePerson(ALL, persons, "u-x"), persons)).toBeNull();
  });

  it("sem escolha guardada, abre em quem usa o app (ou na primeira pessoa)", () => {
    expect(shownPerson(resolvePerson(undefined, persons, "u-bia"), persons)).toBe("bia");
    expect(shownPerson(resolvePerson(undefined, persons, "u-x"), persons)).toBe("ana");
  });

  it("pessoa guardada que não existe mais: volta para o padrão", () => {
    expect(shownPerson(resolvePerson("removida", persons, "u-x"), persons)).toBe("ana");
  });

  it("lista de pessoas sem carregar: mostra Todos, nunca filtra por quem não aparece", () => {
    expect(shownPerson(resolvePerson("ana", undefined, "u-x"), undefined)).toBeNull();
    expect(shownPerson(resolvePerson("ana", [], "u-x"), [])).toBeNull();
  });
});
