# Decisões provisórias da implementação

Escolhas feitas na Fase 1 para avançar sem bloquear as decisões em aberto da
especificação (seção 15). Cada item pode ser revisto.

## Autenticação (decisão em aberto 1) — **decidida: Firebase Authentication**

O login é feito pelo Firebase Authentication. A API valida o ID token
(assinatura RS256 com as chaves públicas do Google, emissor, audiência igual ao
ID do projeto, validade), e o UID do Firebase vira `app_user.auth_subject`. Não
é preciso credencial de serviço na API. Detalhes, configuração e limitações
(revogação, LGPD) em [`firebase.md`](firebase.md).

## Aplicativo: PWA em vez de Android nativo (Fase 3)

A especificação previa Android (Kotlin, Compose, Room). Adotamos um **PWA**:
uma base de código para Android, iPhone e computador, sem loja e com
atualização imediata. O funcionamento offline é o mesmo da especificação:
IndexedDB no lugar do Room, fila com operações idempotentes e conflitos
preservados.

O preço é que **um PWA não agenda notificações locais**. Os lembretes virão
por push do servidor (Fase 4) e dependem de o celular ter internet na hora da
dose. Se isso se mostrar insuficiente, o mesmo código pode ser empacotado como
app nativo (Capacitor) com notificações locais. Detalhes em
[`pwa.md`](pwa.md).

## Sincronização (Fase 3)

- **Idempotência:** cada registro tem `operationId` gerado no aparelho, único
  por aparelho (`sync_operation`). Reenvios devolvem o estado atual sem
  repetir efeitos.
- **Detecção de divergência pela versão-base:** o aparelho envia a versão da
  dose que o responsável viu ao tocar no botão. Se a dose já foi decidida
  depois disso e os registros não combinam (administrada × administrada,
  administrada × não dada, cancelada × administrada), a dose vai para
  `REVIEW_REQUIRED` e a proposta fica em `sync_conflict_change`. A
  administração válida existente continua valendo até a decisão. Se os
  registros combinam (duas pessoas marcaram "não foi dada"), não há conflito.
- **Decisão humana:** manter o registro atual, adotar uma proposta (que vira
  o registro válido, com a autoria original) ou concluir que não foi dada.
  Tudo com motivo, versão e auditoria.
- **Atualização dos dados:** o app busca de novo ao abrir, ao reconectar e ao
  enviar a fila. O cursor incremental da seção 10.4 fica para quando o volume
  justificar.
- **Tudo é gravado offline** (veja a seção abaixo). Online, uma versão
  desatualizada continua recebendo `409`, com a proposta mantida no formulário.

## Gravação offline em todo o app

Regra do produto: **toda gravação é feita primeiro no aparelho, aparece na
hora e é enviada quando houver conexão.** Antes, só doses, aferições e
sintomas funcionavam assim.

- **Uma fila só.** Cadastros, alterações, exclusões, correções e conferências
  entram na mesma fila das doses, na ordem em que foram feitos. Cada item
  declara o efeito na cópia local (incluir, alterar ou remover numa
  consulta), e as telas mostram o registro com "Aguardando envio".
- **Reenvio seguro para qualquer rota.** Cada gravação leva
  `Idempotency-Key`. O servidor guarda a resposta da primeira execução e
  devolve a mesma resposta nos reenvios (seção 10.1, `client_operation`). Não
  foi preciso tratar a idempotência rota por rota.
- **Ids gerados no aparelho** para família, pessoa, tratamento e lembrete.
  Offline, um tratamento pode ser cadastrado para uma pessoa criada no mesmo
  período sem conexão.
- **Recusa na hora × recusa depois.** Se o servidor recusa com o responsável
  na tela, o erro aparece no formulário, como antes, e a gravação sai da
  fila. Se recusa ao sincronizar mais tarde, a gravação fica visível em
  qualquer tela ("Não foi aceito: …"), para tentar de novo ou descartar.
  Nada é descartado sozinho.
- **Alteração de tratamento sobre versão antiga (seção 10.2).** Vinda da fila,
  ela não é aplicada nem perdida: vira proposta num conflito do tratamento e
  avisa a família. O tratamento não muda até alguém conferir: manter a versão
  atual ou aplicar a proposta, sempre com motivo. Se ele mudar durante a
  conferência, é preciso conferir de novo.
- **Vigência.** Uma alteração de tratamento ativo feita offline vale a partir
  do envio. O período sem conexão não é reescrito, pela mesma regra de nunca
  alterar o passado registrado.
- **Outras versões desatualizadas** (padrões da família, sintoma, dose
  corrigida): o servidor recusa e o responsável decide de novo. São dados de
  baixo risco, e a recusa fica visível.
- **O que continua exigindo conexão**, por natureza:
  - entrar na conta;
  - criar ou entrar numa família: o convite é conferido pelo servidor, e a
    família precisa existir lá para os outros entrarem;
  - gerar convite: o código só vale depois de registrado;
  - sair da família;
  - ativar ou testar notificações;
  - "Estou cuidando desta dose": é um aviso em tempo real; enviado depois,
    não teria efeito.

  Essas telas dizem claramente por que precisam de internet.

## Doses anteriores à ativação

- Um rascunho pode ser ativado com início até **30 dias** no passado (antes
  eram 24 h), para cadastrar um tratamento já em andamento.
- Se há doses previstas antes de agora, o app **pergunta, sem resposta
  marcada**:
  - todas foram dadas: cada uma é registrada no horário previsto, com nota
    "informada ao cadastrar o tratamento" e auditoria;
  - não sei ou nem todas: ficam em aberto, para registrar uma a uma;
  - ignorar: a agenda começa agora.
- O sistema não presume administração: só registra o que o responsável
  afirmou (seção 1).
- A família recebe um único aviso de tratamento ativado, não um por dose.

## Saúde: aferições e sintomas

- **Registro, não interpretação.** O app não marca "febre" nem sugere conduta.
  A linha de referência é definida pela família, por pessoa ou para todos,
  conforme a orientação profissional, e serve só como marca visual.
- **Faixas de digitação** por tipo (ex.: temperatura de 30 a 45 °C) evitam
  erros como 380 no lugar de 38,0. Não são faixas clínicas.
- **Imutáveis como as doses:** corrigir cria outro registro (`replaces_id`) e
  invalida o original; excluir exige motivo. Tudo auditado.
- **Offline sem conflito:** aferições e sintomas só se acumulam (duas pessoas
  medindo a temperatura não é divergência). O id gerado no aparelho torna o
  reenvio idempotente.
- **Sintomas** têm início, fim opcional ("em andamento") e, opcionalmente, o
  tratamento suspeito ("possível reação"). Registrar uma reação não substitui
  avisar o profissional de saúde.

## Notificações (fase 4)

- **Web Push padrão com VAPID** em vez do Firebase Cloud Messaging: serve a
  todos os navegadores (inclusive Safari no iPhone) sem SDK extra, e a cifra
  RFC 8291 é implementada só com o JDK, conferida com o vetor oficial da RFC.
- **Lembretes calculados a cada minuto**, a partir das doses em aberto e dos
  parâmetros da agenda. Não há fila de lembretes futuros a manter em
  sincronia com mudanças de tratamento. O envio é reservado em `reminder_log`
  (idempotente entre instâncias).
- **Só o lembrete mais recente vencido** é enviado, e nunca com mais de 15
  minutos de atraso: depois de uma parada, o servidor não dispara avisos
  acumulados.
- **Substituição em vez de cancelamento:** o Web Push não permite apagar um
  aviso remotamente sem mostrar outro, então o lembrete é trocado por "Dose
  registrada" com a mesma `tag`, em silêncio.
- **Privacidade por padrão:** avisos sem pessoa nem medicamento, a menos que o
  responsável ligue "Mostrar pessoa e medicamento no aviso".
- **Limite de repetições padrão: 4** (decisão em aberto 5, mantida como
  provisória).

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
  O corte vale para **todas** as versões a partir da vigência da alteração,
  não só a mais recente: uma versão programada para começar depois fica
  substituída, e as doses em aberto do tratamento a partir dali são canceladas.
  Antes, uma alteração com vigência anterior ao início de outra ainda não
  iniciada deixava doses em duplicidade; a migração V8 cancelou as que já
  existiam (só doses em aberto de versões substituídas).
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
- **Ativação retroativa limitada a 30 dias** (eram 24 h; veja "Doses
  anteriores à ativação"). Tratamentos ativos só mudam do presente em diante,
  com uma exceção: **mudar o início** reavalia as doses. Adiado, as doses em
  aberto antes do novo início são canceladas; antecipado, as do período
  acrescentado (até 30 dias, numa versão de agenda já encerrada) são criadas,
  e o responsável diz se já foram dadas, como na ativação. Doses registradas
  nunca mudam.
- **Uso "se necessário" (sob demanda)**: tratamento `AS_NEEDED`, sem agenda.
  Cada dose registrada vira uma ocorrência já administrada, sem versão de
  agenda (`schedule_id` nulo, chave `prn:<id>`), e aparece no histórico como
  as outras. O app mostra a última dose, quem deu, quantas nas últimas 24 h e
  a orientação da receita como texto; **nunca** diz quando a próxima pode ser
  dada nem avisa "ainda não pode" (seria sugerir dose). Os outros responsáveis
  são avisados a cada dose, com a contagem de 24 h. Um registro errado é
  desfeito pela correção "Registrada por engano" (`CANCELLED`), preservando o
  original. Uma dose enviada depois de o tratamento ser suspenso ou encerrado
  é aceita: foi dada e não pode se perder.

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

## "Lembrar daqui a pouco" e mudança de horários

- **Adiar é só do lembrete, e só de quem pede.** A dose não é reagendada: ela
  continua no horário previsto, fica atrasada depois da tolerância e a
  trilha não muda. Reagendar uma dose deslocaria o histórico e poderia
  sugerir compensação de atraso, o que a especificação proíbe (6.2, item 12).
- **As próximas doses não mudam.** Quem precisa mudar os horários de vez usa
  o atalho **Mudar horários do tratamento**, que abre a alteração do
  tratamento com conferência, data de vigência e motivo.
- **Funciona offline:** a hora do lembrete é calculada no aparelho e vai pela
  fila. Se chegar ao servidor depois da hora escolhida, ou com a dose já
  decidida, não há o que adiar e nada muda.
- **Limite de 12 horas** por adiamento.

## Término por número de doses

- **A receita fala em doses** ("por 5 dias, 2 vezes ao dia" = 10). O término
  pode ser **sem término**, **até uma data**, **por N dias** ou **por N doses**.
  "Por N dias" vira número de doses pela agenda (os horários em
  [primeira dose, primeira dose + N dias)), feito no aparelho e mostrado na
  conferência; o tratamento guarda só `dose_count` (V9).
- **O início é a primeira dose de fato.** Começou às 20h: a dose das 8h daquele
  dia nunca existiu, e as 10 doses terminam no 6º dia às 8h. Tratamento já em
  andamento: as doses que já passaram entram na pergunta da ativação ("foram
  dadas?") e contam no total. "A primeira ainda não foi dada" desloca o
  tratamento inteiro, mantendo o total.
- **Dose não dada conta e não é reposta.** O app mostra o andamento (dadas, não
  dadas, sem registro, a dar) e a última dose prevista, mas não estende o
  tratamento sozinho: seria compensação de atraso (seção 6.2, item 12).
- **Alteração no meio mantém o total:** as doses canceladas pela alteração não
  contam, e a nova agenda gera as que faltam.
- **Conferência sempre mostra o plano:** "10 doses · 5 dias · primeira … ·
  última …", também no término por data (onde fica visível quando as datas
  cortam uma dose).
