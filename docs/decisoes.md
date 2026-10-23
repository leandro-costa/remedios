# Decisões provisórias da implementação

Escolhas feitas na Fase 1 para avançar sem bloquear as decisões em aberto da
especificação (seção 15). Cada item pode ser revisto.

## Autenticação (decisão em aberto 1)

A API valida JWT RS256 de **qualquer** provedor OIDC (Keycloak, Auth0,
Firebase Auth, Google…), configurado por emissor e chave/JWKS. A claim `sub`
vira `app_user.auth_subject`, e a conta local é criada no primeiro acesso. A
escolha do provedor fica em aberto sem afetar o domínio.

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
