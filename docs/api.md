# API

Todas as rotas exigem `Authorization: Bearer <ID token do Firebase>` (veja
[`firebase.md`](firebase.md)). A conta local é criada no primeiro acesso a
partir do UID do Firebase (claim `sub`); o nome inicial vem de `name` ou
`email`. Sem token, ou com token inválido, a resposta é `401`.

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
| 422 | `INVALID_SCHEDULE`, `SCHEDULE_REQUIRED` | agenda do tratamento |
| 409 | `ALREADY_ADMINISTERED` | a dose já foi registrada; `details` traz quem registrou e o horário |
| 409 | `ALREADY_RECORDED`, `OCCURRENCE_CANCELLED`, `REVIEW_REQUIRED`, `NOTHING_TO_CORRECT` | desfechos de dose |
| 409 | `DEVICE_REVOKED`, `DEVICE_ID_IN_USE` | aparelhos |
| 409 | `OPERATION_ID_IN_USE`, `NO_CONFLICT` | sincronização e conferência |
| 422 | `INVALID_PROPOSAL` | conferência de conflito |
| 422 | `DEVICE_NOT_REGISTERED`, `ADMINISTERED_AT_IN_FUTURE`, `OCCURRENCE_TOO_EARLY`, `NO_CHANGE`, `INVALID_RANGE` | registro e consulta de doses |

## Conta

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/me` | conta atual |
| PUT | `/api/me` | `{displayName}` |
| GET | `/api/me/devices` | aparelhos da conta |
| PUT | `/api/me/devices/{deviceId}` | registra o aparelho `{platform: WEB \| ANDROID, name?}`; o id (UUID) é gerado no aparelho e a chamada é idempotente |
| DELETE | `/api/me/devices/{deviceId}` | desconecta o aparelho (não pode mais registrar doses) |
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

Criação (`schedule` é opcional no rascunho e obrigatória para ativar):

```json
{
  "personId": "…",
  "name": "Medicamento A",
  "kind": "CONTINUOUS",
  "prescribedDose": "5 ml",
  "route": "oral",
  "instructions": "Conforme prescrição",
  "startAt": "2026-10-23T11:00:00Z",
  "endAt": null,
  "schedule": {
    "type": "DAILY",
    "timezone": "America/Sao_Paulo",
    "times": ["08:00", "20:00"]
  }
}
```

Ciclo de vida: `DRAFT → ACTIVE | ENDED`, `ACTIVE ↔ SUSPENDED`,
`ACTIVE | SUSPENDED → ENDED`. `ENDED` é final.

Cada alteração aceita incrementa `version` e grava, na mesma transação, a
revisão, o evento de auditoria (antes/depois) e um evento de outbox contendo
apenas identificadores. Se `baseVersion` não for a versão atual, a resposta é
`409 STALE_VERSION` com `details.currentVersion`, e nada é alterado. Enviar o
mesmo conteúdo não cria versão nova.

### Agenda (`schedule`)

| `type` | Campos | Significado |
| --- | --- | --- |
| `DAILY` | `times`, `everyDays` (padrão 1) | horários fixos a cada N dias, contados do dia de início |
| `WEEKLY` | `times`, `daysOfWeek` (`MONDAY`…`SUNDAY`) | horários fixos nos dias escolhidos |
| `INTERVAL` | `everyHours`, `firstDoseAt` | a cada N horas corridas, a partir do horário da 1ª dose no dia de início |

Todos exigem `timezone` (IANA). Horários repetidos em `times` são doses
distintas no mesmo horário. `reminders` (opcional) ajusta, só para este
tratamento, `reminderBeforeMinutes`, `repeatIntervalMinutes`, `repeatLimit` e
`lateToleranceMinutes`; o que faltar vem dos padrões da família no momento da
ativação.

Efeitos na agenda:

- **Ativar** gera as doses a partir de `effectiveFrom` até o horizonte de 14
  dias, estendido automaticamente a cada hora. Um rascunho pode ser ativado com
  `effectiveFrom` até 24 h no passado, para registrar doses do mesmo dia.
- **Alterar** a agenda, o início ou o término de um tratamento ativo cancela as
  doses **futuras em aberto** a partir de `effectiveFrom` e gera as novas. Doses
  passadas e doses já registradas não mudam. Alterar só nome, dose ou
  instruções não mexe na agenda.
- **Suspender** ou **encerrar** cancela as doses futuras em aberto.
  **Reativar** gera de novo a partir da reativação.

## Doses

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/occurrences?from=&to=&personId=&treatmentId=` | doses previstas no período (máx. 62 dias), em ordem de horário; a tela **Hoje** usa o dia local do aparelho |
| GET | `/api/families/{f}/occurrences/{o}` | dose + todos os registros (inclusive invalidados) + trilha de auditoria |
| POST | `/api/families/{f}/occurrences/{o}/administration` | `{deviceId, administeredAt?, notes?, operationId?, baseVersion?, recordedAt?}` |
| POST | `/api/families/{f}/occurrences/{o}/not-administered` | `{reason?, deviceId?, operationId?, baseVersion?, recordedAt?}` |
| POST | `/api/families/{f}/occurrences/{o}/resolution` | conferência de conflito: `{baseVersion, status, reason, proposalId?, administeredAt?, deviceId?}` |
| GET | `/api/families/{f}/conflicts` | doses aguardando conferência, com as propostas |
| POST | `/api/families/{f}/occurrences/{o}/correction` | `{baseVersion, status, reason, administeredAt?, notes?, deviceId?}` |
| GET | `/api/families/{f}/history?from=&to=&personId=&treatmentId=&recordedBy=&limit=` | doses com desfecho (administrada ou não), mais recentes primeiro |

Cada dose traz:

```json
{
  "id": "…",
  "scheduledAt": "2026-10-23T11:00:00Z",
  "status": "PENDING",
  "late": true,
  "version": 1,
  "person": { "id": "…", "displayName": "Gabriel" },
  "treatment": { "id": "…", "name": "Medicamento A", "prescribedDose": "5 ml", "route": "oral" },
  "administration": null,
  "statusReason": null,
  "statusChangedBy": null,
  "statusChangedAt": null
}
```

- `status`: `SCHEDULED` (antes do horário), `PENDING` (horário alcançado, sem
  registro), `ADMINISTERED`, `NOT_ADMINISTERED`, `CANCELLED` ou
  `REVIEW_REQUIRED` (Fase 3).
- `late`: em aberto além da tolerância da agenda. É uma classificação
  operacional, não orientação clínica.
- `administration`: o registro válido. `administeredAt` é o horário informado
  pelo responsável, `recordedAt` é quando ele registrou e `receivedAt` é quando
  o servidor recebeu.

Regras do registro:

- Só doses em aberto aceitam registro. Uma dose já registrada devolve
  `409 ALREADY_ADMINISTERED`, com quem registrou: no máximo uma administração
  válida por dose, inclusive com dois responsáveis ao mesmo tempo.
- `administeredAt` é preenchido com o horário atual e não pode estar no futuro.
- Doses previstas para daqui a mais de 6 horas não aceitam registro
  (`OCCURRENCE_TOO_EARLY`), para evitar marcar a dose de outro dia por engano.
- O registro exige um aparelho ativo da própria conta (`deviceId`).
- "Não foi dada" nunca conta como administração, e o sistema não sugere dose
  substituta.

Correções (`status`: `ADMINISTERED`, `NOT_ADMINISTERED` ou `OPEN`) exigem
motivo e a `version` atual da dose (`409 STALE_VERSION` se outra pessoa mexeu
antes). O registro anterior é **invalidado e preservado** (`voidedAt`,
`voidedBy`, `voidReason`), e um novo registro é criado quando o resultado é uma
administração. `OPEN` devolve a dose ao estado em aberto.

## Saúde: aferições, sintomas e linhas de referência

O sistema **guarda e mostra** os valores; não os interpreta, não diagnostica e
não sugere medicamentos.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/persons/{p}/measurements?type=&from=&to=` | aferições válidas do período (máx. 400 dias), em ordem de horário |
| POST | `/api/families/{f}/persons/{p}/measurements` | `{id, deviceId, type, value, value2?, unit?, label?, method?, measuredAt, notes?, recordedAt?}` |
| GET | `/api/families/{f}/measurements/{m}` | uma aferição (inclusive invalidada) |
| POST | `/api/families/{f}/measurements/{m}/correction` | `{deviceId, value, value2?, method?, measuredAt, notes?, reason}`: cria outra aferição (`replacesId`) e invalida a original |
| POST | `/api/families/{f}/measurements/{m}/void` | `{reason}`: exclui (invalida, sem apagar) |
| GET | `/api/families/{f}/persons/{p}/symptoms?from=&to=` | sintomas presentes em algum momento do período |
| POST | `/api/families/{f}/persons/{p}/symptoms` | `{id, deviceId, description, intensity?, startedAt, endedAt?, treatmentId?, notes?, recordedAt?}` |
| PUT | `/api/families/{f}/symptoms/{s}` | altera (ex.: registrar o fim) com `baseVersion` |
| POST | `/api/families/{f}/symptoms/{s}/void` | `{reason}` |
| GET | `/api/families/{f}/reference-lines` | linhas de referência da família |
| PUT | `/api/families/{f}/reference-lines` | `{personId?, type, value, value2?, label}`: cria ou substitui |
| DELETE | `/api/families/{f}/reference-lines/{id}` | remove |

O `id` de aferições e sintomas é gerado no aparelho. Reenviar o mesmo `id` não
duplica o registro, o que torna o envio da fila offline seguro.

| `type` | Unidade | Faixa aceita | `method` |
| --- | --- | --- | --- |
| `TEMPERATURE` | °C | 30–45 | `AXILLARY`, `ORAL`, `RECTAL`, `EAR`, `FOREHEAD` |
| `HEART_RATE` | bpm | 20–250 | — |
| `BLOOD_PRESSURE` | mmHg | sistólica 50–260, diastólica 30–160 (`value2`), sistólica maior que a diastólica | — |
| `OXYGEN_SATURATION` | % | 50–100 | — |
| `BLOOD_GLUCOSE` | mg/dL | 10–800 | `FASTING`, `BEFORE_MEAL`, `AFTER_MEAL`, `RANDOM` |
| `WEIGHT` | kg | 0,3–400 | — |
| `OTHER` | `unit` informada | — | — (exige `label`) |

As faixas servem só para pegar erros de digitação (como 380 no lugar de 38,0)
e não têm significado clínico. Erros: `422 INVALID_MEASUREMENT`,
`INVALID_SYMPTOM`, `INVALID_REFERENCE`, `REASON_REQUIRED`; `409 ID_IN_USE`,
`ALREADY_VOIDED`, `STALE_VERSION`.

A **linha de referência** é definida pela família conforme a orientação de um
profissional de saúde. A da pessoa prevalece sobre a da família
(`personId: null`). É apenas uma marca no gráfico: não classifica valores nem
gera alertas.

### Registros vindos do app (fila offline)

O app envia todo registro com três campos extras:

| Campo | Significado |
| --- | --- |
| `operationId` | UUID gerado no aparelho, o mesmo em todos os reenvios. Repetir a chamada devolve o estado atual sem novos efeitos. Exige `deviceId`. |
| `baseVersion` | `version` da dose que o responsável via ao tocar no botão |
| `recordedAt` | quando ele tocou (pode ser bem antes do envio, se estava offline); vale para a regra das 6 horas |

Se a dose já foi decidida depois de `baseVersion`:

| Já registrado | Recebido | Resultado |
| --- | --- | --- |
| administrada | administrada | `REVIEW_REQUIRED` |
| administrada | não dada | `REVIEW_REQUIRED` |
| não dada | administrada | `REVIEW_REQUIRED` |
| cancelada | administrada | `REVIEW_REQUIRED` |
| não dada ou cancelada | não dada | nada muda (os registros combinam) |
| em revisão | qualquer | a proposta entra no conflito aberto |

A resposta é `200` com a dose. Nada é descartado: a administração válida
existente continua valendo, e o registro recebido fica preservado como
proposta (`conflict.proposals` no detalhe da dose). Sem `operationId` e
`baseVersion`, uma dose já decidida devolve `409` como antes.

### Conferência (`resolution`)

| `status` | Efeito |
| --- | --- |
| `ADMINISTERED` sem `proposalId` | mantém a administração atual (ou cria uma, com `deviceId` e `administeredAt`) |
| `ADMINISTERED` com `proposalId` | a proposta escolhida vira a administração válida, com a autoria e o horário originais; a anterior é invalidada e preservada |
| `NOT_ADMINISTERED` | invalida a administração atual, se houver |
| `CANCELLED` | idem, marcando a dose como cancelada |

Exige `reason` e a `version` atual da dose. O conflito é encerrado com a
decisão registrada na auditoria.
