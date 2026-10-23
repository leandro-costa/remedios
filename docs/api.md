# API — Fase 1

Todas as rotas exigem `Authorization: Bearer <jwt>`. A conta local é criada no
primeiro acesso a partir da claim `sub` (nome inicial: `name`,
`preferred_username` ou `email`).

Rotas sob `/api/families/{familyId}` exigem participação **ativa** na família.
Para quem não participa, a resposta é `404` — a API não revela se a família
existe. Ações administrativas devolvem `403` a membros comuns.

## Erros

```json
{ "code": "STALE_VERSION", "message": "…", "details": { "currentVersion": 3 } }
```

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | — | corpo inválido (validação de campos) |
| 403 | `FORBIDDEN` | ação restrita a administradores |
| 404 | `NOT_FOUND` | recurso inexistente ou fora da família do usuário |
| 409 | `STALE_VERSION` | versão-base desatualizada; nada foi aplicado |
| 409 | `LAST_ADMIN` | a operação deixaria a família sem administrador |
| 409 | `ALREADY_MEMBER`, `INVITATION_NOT_PENDING` | convites |
| 409 | `USER_ALREADY_LINKED` | conta já associada a outro perfil da família |
| 409 | `INVALID_STATUS_TRANSITION`, `TREATMENT_ENDED` | ciclo de vida do tratamento |
| 422 | `USER_NOT_MEMBER`, `INVALID_BIRTH_DATE` | pessoas |
| 422 | `PERSON_NOT_FOUND`, `PERSON_INACTIVE`, `INVALID_PERIOD`, `EFFECTIVE_FROM_IN_PAST` | tratamentos |
| 422 | `QUIET_HOURS_INCOMPLETE` | preferências pessoais |

## Conta

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/me` | conta atual |
| PUT | `/api/me` | `{displayName}` |
| GET / PUT | `/api/me/notification-settings` | preferências pessoais (som, vibração, lembrete antecipado, repetição, confirmação, horário de silêncio, avisos de sincronização, detalhes na tela bloqueada) |

## Família

| Método | Rota | Quem | Descrição |
| --- | --- | --- | --- |
| POST | `/api/families` | qualquer conta | cria a família; o criador vira `ADMIN` |
| GET | `/api/families` | — | famílias de que participo, com meu papel |
| GET | `/api/families/{f}` | membro | |
| PUT | `/api/families/{f}` | admin | renomear `{name}` |
| GET | `/api/families/{f}/members` | membro | membros ativos |
| PUT | `/api/families/{f}/members/{userId}/role` | admin | `{role: ADMIN|MEMBER}` |
| DELETE | `/api/families/{f}/members/{userId}` | admin, ou o próprio membro | remove (o histórico é mantido) |
| POST | `/api/families/{f}/invitations` | admin | `{role?}` → `{id, code, role, expiresAt}` |
| GET | `/api/families/{f}/invitations` | admin | convites pendentes (sem o código) |
| DELETE | `/api/families/{f}/invitations/{id}` | admin | revoga |
| POST | `/api/invitations/accept` | convidado | `{code}` → `{familyId, role}` |
| GET | `/api/families/{f}/settings` | membro | padrões da família |
| PUT | `/api/families/{f}/settings` | admin | padrões + `baseVersion` |

O código do convite só é devolvido na criação; o servidor guarda apenas seu
hash SHA-256. Convites são de uso único e expiram em 7 dias
(`remedios.invitation.ttl`).

## Pessoas

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/persons?active=` | lista |
| POST | `/api/families/{f}/persons` | `{displayName, birthDate?, userId?, active?}` |
| GET | `/api/families/{f}/persons/{p}` | |
| PUT | `/api/families/{f}/persons/{p}` | substitui os dados |

`userId` associa o perfil a uma conta, que precisa participar da família. Cada
conta se associa a no máximo um perfil por família.

## Tratamentos

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/treatments?personId=&status=` | lista |
| POST | `/api/families/{f}/treatments` | cria em `DRAFT`, versão 1 |
| GET | `/api/families/{f}/treatments/{t}` | |
| PUT | `/api/families/{f}/treatments/{t}` | altera o conteúdo; exige `baseVersion` e `effectiveFrom` |
| POST | `/api/families/{f}/treatments/{t}/status` | `{status, baseVersion, effectiveFrom?, reason?}` |
| GET | `/api/families/{f}/treatments/{t}/revisions` | todas as versões, com fotografia e autoria |

Criação:

```json
{
  "personId": "…",
  "name": "Medicamento A",
  "kind": "CONTINUOUS",
  "prescribedDose": "5 ml",
  "route": "oral",
  "instructions": "Conforme prescrição",
  "startAt": "2026-10-23T11:00:00Z",
  "endAt": null
}
```

Ciclo de vida: `DRAFT → ACTIVE | ENDED`, `ACTIVE ↔ SUSPENDED`,
`ACTIVE | SUSPENDED → ENDED`. `ENDED` é final.

Cada alteração aceita incrementa `version` e grava, na mesma transação, a
revisão, o evento de auditoria (antes/depois) e um evento de outbox contendo
apenas identificadores. Se `baseVersion` não for a versão atual, a resposta é
`409 STALE_VERSION` com `details.currentVersion`, e nada é alterado. Enviar o
mesmo conteúdo não cria versão nova.
