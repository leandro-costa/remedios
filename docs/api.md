# API

Todas as rotas exigem `Authorization: Bearer <ID token do Firebase>` (veja
[`firebase.md`](firebase.md)). A conta local é criada no primeiro acesso a
partir do UID do Firebase (claim `sub`); o nome inicial vem de `name` ou
`email`. Sem token, ou com token inválido, a resposta é `401`.

Rotas sob `/api/families/{familyId}` exigem participação **ativa** na família.
Para quem não participa, a resposta é `404` — a API não revela se a família
existe. Ações administrativas devolvem `403` a membros comuns.

## Gravações vindas do aparelho (`Idempotency-Key`)

Toda gravação feita pelo app (POST, PUT, DELETE) leva o cabeçalho
`Idempotency-Key` com um UUID gerado no aparelho, o mesmo em todos os
reenvios (seção 10.1). A primeira execução guarda status e corpo da resposta;
um reenvio com a mesma chave recebe exatamente a mesma resposta, com o
cabeçalho `Idempotent-Replay: true`, sem repetir os efeitos. Assim a fila
offline reenvia qualquer operação com segurança.

- A chave vale por conta, por 30 dias.
- Erros de negócio (4xx) também ficam guardados; erros de servidor (5xx), não:
  a operação pode ser tentada de novo.
- A mesma chave em outra rota ou outro método: `422 IDEMPOTENCY_KEY_REUSED`.
  Chave que não é UUID: `400 INVALID_IDEMPOTENCY_KEY`. Operação com a mesma
  chave ainda em execução: `409 OPERATION_IN_PROGRESS`.

Nos cadastros, o app também envia o `id` do novo registro (família, pessoa,
tratamento, lembrete avulso, aferição, sintoma). Isso permite, offline,
cadastrar uma pessoa e logo um tratamento para ela. Um `id` já usado por outro
registro devolve `409 ID_IN_USE`.

## Erros

```json
{ "code": "STALE_VERSION", "message": "…", "details": { "currentVersion": 3 } }
```

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | — | corpo inválido (validação de campos) |
| 413 | — | corpo maior que 256 KB |
| 429 | — | limite de pedidos por endereço (nginx); temporário, o app tenta de novo |
| 403 | `FORBIDDEN` | ação restrita a administradores |
| 404 | `NOT_FOUND` | recurso inexistente ou fora da família do usuário |
| 409 | `STALE_VERSION` | versão-base desatualizada; nada foi aplicado |
| 409 | `LAST_ADMIN` | a operação deixaria a família sem administrador |
| 409 | `ALREADY_MEMBER`, `INVITATION_NOT_PENDING` | convites |
| 409 | `USER_ALREADY_LINKED` | conta já associada a outro perfil da família |
| 409 | `INVALID_STATUS_TRANSITION`, `TREATMENT_ENDED` | ciclo de vida do tratamento |
| 409 | `TREATMENT_IN_REVIEW` | há alteração do tratamento aguardando conferência; `details.conflictId` |
| 409 | `CONFLICT_NOT_OPEN` | conferência de tratamento já concluída |
| 409 | `ID_IN_USE`, `OPERATION_IN_PROGRESS` | gravações vindas do aparelho |
| 422 | `IDEMPOTENCY_KEY_REUSED`, `OFFLINE_OPERATION_INCOMPLETE` | gravações vindas do aparelho |
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
| POST | `/api/families` | qualquer conta | `{id?, name}`: cria a família; o criador vira `ADMIN` |
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

## Exportação dos dados (LGPD)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/export` | só administradores: arquivo JSON com tudo o que a família registrou |

O arquivo traz a família, os padrões e os membros, as pessoas, os
tratamentos e suas versões, as doses até agora com as administrações (inclusive
as invalidadas por correção), as aferições, os sintomas, as linhas de
referência, os lembretes e a trilha de auditoria. Cada exportação fica
registrada na auditoria (`FAMILY_EXPORTED`). Resposta com `Content-Disposition:
attachment` e `Cache-Control: no-store`.

## Pessoas

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/persons?active=` | lista |
| POST | `/api/families/{f}/persons` | `{id?, displayName, birthDate?, userId?, active?}` |
| GET | `/api/families/{f}/persons/{p}` | |
| PUT | `/api/families/{f}/persons/{p}` | substitui os dados |

`userId` associa o perfil a uma conta, que precisa participar da família. Cada
conta se associa a no máximo um perfil por família.

## Medicamentos

Cadastro da família, reaproveitado entre tratamentos. O nome é o que a família
usa (comercial ou genérico); cada medicamento tem as substâncias (princípios
ativos) com a concentração do rótulo, a forma farmacêutica e o fabricante. O
app guarda e mostra: não compara doses nem sugere troca.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/medications` | lista |
| POST | `/api/families/{f}/medications` | `{id?, name, form?, manufacturer?, category?, notes?, substances: [{substance, concentration?}]}`; `201`. Substância repetida: `422 DUPLICATE_SUBSTANCE` |
| GET | `/api/families/{f}/medications/{m}` | um medicamento |
| PUT | `/api/families/{f}/medications/{m}` | altera (mesmos campos) |

O tratamento aceita `medicationId` (da família; outro: `422 UNKNOWN_MEDICATION`).
Sem ele, o tratamento fica ligado ao medicamento da família com o mesmo nome,
criado se não existir; assim um aparelho que só manda o nome continua
funcionando.

### Catálogo da ANVISA

`GET /api/catalog/medications` devolve `{version, importedAt, items}`, com
`items` = `[nome, substâncias separadas por vírgula, fabricante, categoria]`,
dos medicamentos com registro **ativo** nos dados abertos da ANVISA (sem
repetição de nome + substâncias + fabricante). O aparelho guarda o catálogo e
envia `If-None-Match` com a versão que tem; sem mudança, `304`. O servidor
importa o arquivo (`REMEDIOS_ANVISA_URL`, padrão
`https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv`; aceita
`file:`) logo depois de subir, se ainda não houver catálogo, e de novo a cada
30 dias. O arquivo não traz concentração nem forma: essas a pessoa informa.

## Tratamentos

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/families/{f}/treatments?personId=&status=` | lista |
| POST | `/api/families/{f}/treatments` | cria em `DRAFT`, versão 1 |
| GET | `/api/families/{f}/treatments/{t}` | |
| POST | `/api/families/{f}/treatments/{t}/deletion` | exclui um tratamento cadastrado por engano, em qualquer situação: `{baseVersion, reason}`; só administradores (`403`). Nada é apagado: some das listas, de Hoje, do histórico e das contagens (consultas dele e das doses dão `404`), cancela as doses em aberto e fecha conferências pendentes; fica na auditoria e na exportação. `204` |
| PUT | `/api/families/{f}/treatments/{t}` | altera o conteúdo; exige `baseVersion` e `effectiveFrom`. Início alterado num tratamento ativo reavalia as doses: as em aberto antes do novo início são canceladas; se antecipado, as do período acrescentado (até 30 dias) são criadas, em aberto ou, com `pastDoses: "ADMINISTERED"` e `deviceId`, registradas nos horários previstos |
| POST | `/api/families/{f}/treatments/{t}/status` | `{status, baseVersion, effectiveFrom?, reason?, pastDoses?, deviceId?}` |
| GET | `/api/families/{f}/treatments/{t}/revisions` | todas as versões, com fotografia e autoria |
| GET | `/api/families/{f}/treatments/conflicts` | alterações feitas offline aguardando conferência |
| POST | `/api/families/{f}/treatments/{t}/conflict/resolution` | `{conflictId, choice, proposalId?, baseVersion, reason}` |

Criação (`schedule` é opcional no rascunho e obrigatória para ativar; `id`
é opcional):

```json
{
  "id": "…",
  "personId": "…",
  "name": "Medicamento A",
  "kind": "CONTINUOUS",
  "prescribedDose": "5 ml",
  "route": "oral",
  "instructions": "Conforme prescrição",
  "startAt": "2026-10-23T11:00:00Z",
  "endAt": null,
  "doseCount": 10,
  "schedule": {
    "type": "DAILY",
    "timezone": "America/Sao_Paulo",
    "times": ["08:00", "20:00"]
  }
}
```

`startAt` é a **primeira dose** (data e hora). Término: `endAt` (data) **ou**
`doseCount` (número de doses, 1 a 2000), nunca os dois (`422 END_OR_COUNT`).
Com `doseCount`, a agenda gera doses a partir da primeira até completar o
total: canceladas não contam; dose não dada conta e não é reposta.

`GET /api/families/{f}/treatments/progress`: andamento de cada tratamento,
`{treatmentId, total, administered, notAdministered, unrecorded, review,
upcoming, firstAt, lastAt}`. `total`, `upcoming` e `lastAt` são nulos quando
o tratamento não tem término; `unrecorded` são doses cujo horário passou sem
registro.

**Se necessário** (`kind: "AS_NEEDED"`): sem `schedule` e sem `doseCount`
(`422 AS_NEEDED_WITHOUT_SCHEDULE`); `endAt` é opcional. Ativar não gera doses.
Cada dose é registrada quando é dada:

`POST /api/families/{f}/treatments/{t}/doses` com
`{id?, deviceId, administeredAt?, notes?, recordedAt?}` cria uma dose já
administrada (`scheduledAt` = horário da administração) e devolve a dose.
`id` vem do aparelho (`409 ID_IN_USE` se repetido; reenvios usam
`Idempotency-Key`). Recusas: `422 NOT_AS_NEEDED` (tratamento com horários),
`409 TREATMENT_NOT_ACTIVE` (rascunho), `422 ADMINISTERED_AT_IN_FUTURE`. Uma
dose dada é aceita mesmo com o tratamento suspenso ou encerrado depois (envio
atrasado de um aparelho offline). A correção aceita `status: "ADMINISTERED"`
(novo horário) ou `"CANCELLED"` (registrada por engano); `OPEN` e
`NOT_ADMINISTERED` não valem para essas doses (`422 AS_NEEDED_CORRECTION`).
Os outros responsáveis recebem um aviso a cada dose, com quantas foram dadas
nas últimas 24 h (salvo política de confirmação `NONE`). Um tratamento ativado
não muda entre "se necessário" e com horários (`422 KIND_CHANGE`).

Ciclo de vida: `DRAFT → ACTIVE | ENDED`, `ACTIVE ↔ SUSPENDED`,
`ACTIVE | SUSPENDED → ENDED`. `ENDED` é final.

Cada alteração aceita incrementa `version` e grava, na mesma transação, a
revisão, o evento de auditoria (antes/depois) e um evento de outbox contendo
apenas identificadores. Se `baseVersion` não for a versão atual, a resposta é
`409 STALE_VERSION` com `details.currentVersion`, e nada é alterado. Enviar o
mesmo conteúdo não cria versão nova. `TreatmentView.conflictId` indica uma
alteração aguardando conferência.

### Alterações feitas offline (seção 10.2)

Na fila offline, `PUT` e `status` levam `preserveConflict: true` e `deviceId`
(além do `Idempotency-Key`). Se a versão-base estiver desatualizada, ou se já
houver conferência pendente, a alteração **não é aplicada nem descartada**:

- vira proposta num conflito do tratamento;
- a resposta é `202` com `{status: "IN_REVIEW", conflictId, treatment}`;
- a família recebe um aviso.

Enquanto o conflito está aberto, o tratamento não muda: alterações online
recebem `409 TREATMENT_IN_REVIEW`.

Na conferência, `choice` decide o que acontece:

- `KEEP_CURRENT` mantém a versão atual.
- `ADOPT` aplica a proposta `proposalId` sobre a versão atual, como nova
  revisão.

As duas opções exigem `reason` e ficam na auditoria. Se o tratamento mudou
durante a conferência (`baseVersion` diferente), a resposta é
`409 STALE_VERSION`, e é preciso conferir de novo.

Uma alteração offline sem conflito, de um tratamento já ativo, vale a partir
do envio. O que foi pedido para "a partir de agora" no aparelho não reescreve
o período em que ele estava sem conexão.

### Doses anteriores à ativação

Um rascunho pode ser ativado com `effectiveFrom` até 30 dias no passado, para
um tratamento que já estava em andamento. As doses anteriores a agora seguem
`pastDoses`:

| `pastDoses` | Efeito |
| --- | --- |
| `OPEN` (padrão) | ficam em aberto (atrasadas), para registrar uma a uma |
| `ADMINISTERED` | o responsável informou que **todas foram dadas**: cada uma é registrada no horário previsto, com nota e auditoria; exige `deviceId` |

O app sempre pergunta, sem resposta marcada. O sistema não presume
administração (seção 1).

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
  `effectiveFrom` até 30 dias no passado (veja acima).
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
| POST | `/api/families/{f}/occurrences/{o}/correction` | `{baseVersion, status, reason, administeredAt?, notes?, deviceId?}`; `status`: `ADMINISTERED`, `NOT_ADMINISTERED`, `OPEN` ou, só para "se necessário", `CANCELLED` |
| GET | `/api/families/{f}/history?from=&to=&personId=&treatmentId=&medicationId=&recordedBy=&limit=` | doses com desfecho (administrada ou não), mais recentes primeiro. Com `medicationId`, **consolidado por medicamento**: as doses dele em todos os tratamentos (receitas e uso eventual). Cada dose traz `treatment.medicationId` e `treatment.medicationName` |

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

## Notificações

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/push/config` | `{enabled, publicKey}`: chave VAPID para o navegador se inscrever |
| PUT | `/api/me/devices/{d}/push` | `{endpoint, p256dh, auth, timezone}`: inscrição deste aparelho (HTTPS); substitui a anterior |
| DELETE | `/api/me/devices/{d}/push` | desativa as notificações do aparelho |
| POST | `/api/me/push/test?deviceId=` | envia um aviso de teste a todos os aparelhos do usuário, ou só a `deviceId`: `{sent, failed}` |
| POST | `/api/families/{f}/occurrences/{o}/claim` | "estou cuidando desta dose" (20 min); `409 ALREADY_CLAIMED` se outra pessoa já está |
| DELETE | `/api/families/{f}/occurrences/{o}/claim` | libera |
| PUT | `/api/families/{f}/occurrences/{o}/snooze` | "lembrar daqui a pouco": `{remindAt}` (até 12 h; `422 SNOOZE_TOO_LONG`). Adia só os lembretes de quem pede; o horário da dose não muda. Com a dose já decidida ou a hora já passada (envio tardio da fila), nada muda |
| DELETE | `/api/families/{f}/occurrences/{o}/snooze` | cancela o adiamento: os lembretes da agenda seguem |
| GET | `/api/families/{f}/persons/{p}/reminders` | lembretes avulsos pendentes |
| POST | `/api/families/{f}/persons/{p}/reminders` | `{id?, message, remindAt, notifyEveryone?}` (até 30 dias) |
| DELETE | `/api/families/{f}/reminders/{id}` | cancela |

As doses trazem `claimedBy` e `claimedUntil` enquanto alguém estiver cuidando,
e `remindAt` quando quem consulta adiou o próprio lembrete.
Sem chaves VAPID, as rotas de inscrição respondem `503 PUSH_NOT_CONFIGURED`.
Funcionamento e preferências em [`notificacoes.md`](notificacoes.md).

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
