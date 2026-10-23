# Decisões provisórias da implementação

Escolhas feitas na Fase 1 para avançar sem bloquear as decisões em aberto da
especificação (seção 15). Cada item pode ser revisto.

## Autenticação (decisão em aberto 1) — **decidida: Firebase Authentication**

O login é feito pelo Firebase Authentication. A API valida o ID token
(assinatura RS256 com as chaves públicas do Google, emissor, audiência igual ao
ID do projeto, validade), e o UID do Firebase vira `app_user.auth_subject`. Não
é preciso credencial de serviço na API. Detalhes, configuração e limitações
(revogação, LGPD) em [`firebase.md`](firebase.md).

## Convites (decisão em aberto 1)

Código aleatório de 24 bytes (base64url), uso único, validade de 7 dias, com
apenas o hash guardado. O administrador compartilha o código pelo canal que
preferir. Nova tabela: `family_invitation` (não constava da seção 9.1). Um
membro removido pode voltar com um novo convite; a linha de `family_member` é
reativada, e o histórico continua apontando para ela.

## Remoção de membros (decisão em aberto 8)

A remoção é lógica (`status = REMOVED`) e bloqueia o acesso imediatamente.
Auditoria e autoria são preservadas. A família mantém sempre ao menos um
administrador. O que fazer com os dados pessoais de quem saiu continua em
aberto (LGPD).

## Alterações concorrentes de tratamento (seções 4.5 e 10.2)

Na API online, uma versão-base desatualizada é **rejeitada** (`409`) sem
aplicar nada, e o cliente revisa a versão atual. A preservação da proposta
como `sync_conflict`, prevista para operações offline, entra na Fase 3 junto
com `sync_operation`. As tabelas já existem no esquema.

## Vigência das alterações

Toda alteração informa `effectiveFrom`, gravado na revisão. Em tratamentos já
ativados, ela não pode ficar no passado (tolerância de 5 minutos para o
relógio do dispositivo). O recálculo de ocorrências futuras a partir dessa data
é da Fase 2.

## Ciclo de vida do tratamento

A especificação menciona tratamentos ativos, suspensos e encerrados, além da
conferência antes de ativar a agenda. Adotamos `DRAFT`, `ACTIVE`, `SUSPENDED`
e `ENDED`. A coluna `kind` (`CONTINUOUS`/`OCCASIONAL`) foi acrescentada para
distinguir os dois tipos de tratamento da seção 2.1.

## Padrões numéricos

| Parâmetro | Valor | Origem |
| --- | --- | --- |
| Lembrete antecipado | 10 min | seção 6.1 |
| Intervalo de repetição | 15 min | seção 6.1 |
| Limite de repetição | 4 | **provisório** (decisão em aberto 5) |
| Tolerância para atraso | 30 min | **provisório** (seção 5.1 não define) |
| Confirmação ao outro responsável | só eventos importantes | seção 6.1 |

São parâmetros operacionais, não orientação clínica.

## Agenda (Fase 2)

- **Regra estruturada em vez de RRULE.** `DAILY`, `WEEKLY` e `INTERVAL`
  (veja [`api.md`](api.md)) cobrem as prescrições comuns e são simples de validar. Uma
  RRULE não expressa, por exemplo, 08:00 e 20:30 na mesma regra. A coluna
  `recurrence_rule` da V1 foi substituída por `rule jsonb` na V2.
- **Versões de agenda com vigência.** A regra desejada fica no tratamento
  (versionada nas revisões). `treatment_schedule` guarda versões materializadas
  com `valid_from`/`valid_until`. Sempre que a geração precisa recomeçar
  (agenda, início ou término alterados, suspensão e reativação), a versão atual
  é encerrada, as doses futuras em aberto são canceladas e outra versão começa.
  Doses passadas continuam ligadas à versão que as gerou.
- **Horizonte de 14 dias** (decisão em aberto 3), estendido por um job a cada
  hora e idempotente (`UNIQUE(schedule_id, slot_key)` + `ON CONFLICT DO
  NOTHING`). Configurável em `remedios.schedule.horizon`.
- **Fuso e horário de verão** (decisão em aberto 6): horários de `DAILY` e
  `WEEKLY` seguem o relógio local do `timezone` da agenda. Um horário
  inexistente (relógio adiantado) passa para depois do salto; um ambíguo
  (relógio atrasado) usa a primeira ocorrência. `INTERVAL` conta horas
  corridas, independentes do relógio.
- **`PENDING` e "atrasada" são calculados** na leitura. O banco guarda
  `SCHEDULED` até haver desfecho, sem job para trocar estados.
- **Ativação retroativa limitada a 24 h**, para registrar doses do mesmo dia
  dadas antes do cadastro. Tratamentos ativos só mudam do presente em diante.
- **Uso "se necessário" (sob demanda)** ainda não é suportado: toda dose
  pertence a uma agenda.

## Registro de doses (Fase 2)

- **Antecedência máxima de 6 h** para registrar uma dose
  (`remedios.administration.max-advance`), para evitar marcar a dose de outro
  dia. Não há limite para registrar com atraso.
- **Correção invalida e substitui.** Em vez de editar ou apagar,
  `administration_record` ganha `voided_at`/`voided_by`/`void_reason`, e a
  unicidade passa a valer só para o registro válido (índice parcial). O
  histórico de uma dose mostra todos os registros.
- **Registro online concorrente.** A linha da dose é bloqueada na transação, e
  o segundo responsável recebe `409 ALREADY_ADMINISTERED` com quem registrou. O
  conflito de registros offline (seção 10.3) é da Fase 3.
- **Aparelhos.** O registro exige um aparelho ativo da conta, com id (UUID)
  gerado no aparelho, já preparando a fila offline. Um aparelho desconectado
  não volta com o mesmo id.

## Ocorrências duplicadas (seção 9.2)

`dose_occurrence` tem `slot_key`, uma chave lógica gerada pela regra de
recorrência, com `UNIQUE(schedule_id, slot_key)`. Isso impede gerar a mesma
ocorrência duas vezes e ainda permite duas doses legítimas no mesmo horário,
com sufixos distintos.

## Integridade no banco

Além das validações da API, o PostgreSQL garante por conta própria:

- o perfil associado a uma conta pertence à mesma família da conta (FK composta
  `person(family_id, user_id) → family_member`);
- o tratamento e a ocorrência pertencem à mesma família da pessoa (FKs
  compostas);
- no máximo uma administração por ocorrência;
- um único conflito aberto por entidade;
- estados e enumerações válidos (`CHECK`).

## Privacidade

Eventos de outbox carregam apenas identificadores, nunca nome do medicamento
ou dose. As preferências pessoais começam com `lock_screen_details = false`
(seção 12).

## Pendências conhecidas para a Fase 3

- O cursor de sincronização (seção 10.4) precisa de uma sequência de mudanças
  confiável por família. Uma coluna identity em `audit_event` não basta, porque
  a ordem de commit difere da ordem de alocação. A solução, uma tabela de
  sequência por família bloqueada na transação, será definida com a
  sincronização.
- `administration_record.device_id` é obrigatório. Registros feitos fora de um
  dispositivo cadastrado vão exigir um dispositivo lógico ou uma migração.
