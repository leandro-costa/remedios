# Especificação do Aplicativo Familiar de Medicamentos

**Documento de requisitos, arquitetura, modelo de dados, sincronização e
protótipos de telas**

-   **Versão:** 1.0 --- especificação inicial
-   **Status:** planejamento funcional e técnico; não implementado
-   **Plataforma inicial:** Android
-   **Idioma da interface:** português do Brasil
-   **Usuários principais:** dois ou mais responsáveis autorizados
-   **Pacientes:** crianças e adultos, incluindo os próprios usuários

------------------------------------------------------------------------

## 1. Visão geral

O aplicativo tem como objetivo ajudar uma família a organizar
tratamentos medicamentosos, lembrar horários, registrar administrações e
compartilhar o histórico entre responsáveis. Deve funcionar com internet
e também permitir registros offline, sincronizando-os quando a conexão
voltar.

O sistema é um **organizador de informações e lembretes**, não um
sistema de prescrição nem um substituto para orientação médica. Não deve
calcular doses pediátricas, recomendar doses extras, alterar posologias
por conta própria ou inferir que um medicamento foi administrado apenas
porque um lembrete foi descartado.

### 1.1 Objetivos

1.  Reduzir esquecimentos e dúvidas sobre quem administrou cada dose.
2.  Compartilhar agenda e histórico entre os responsáveis.
3.  Registrar quem fez cada ação e quando.
4.  Suportar tratamentos contínuos e ocasionais.
5.  Operar offline, mantendo visível o estado de sincronização.
6.  Preservar alterações, correções e conflitos para auditoria.
7.  Permitir que adultos e crianças sejam acompanhados no mesmo espaço
    familiar.

### 1.2 Princípios do produto

-   **Segurança antes da conveniência:** estados ambíguos não são
    tratados automaticamente como confirmados.
-   **Uma administração válida por ocorrência:** impedir duplicidades
    acidentais.
-   **Histórico preservado:** correções não apagam silenciosamente o
    passado.
-   **Transparência offline:** mostrar quando os dados compartilhados
    podem estar desatualizados.
-   **Compartilhamento controlado:** todos os membros autorizados da
    família podem ver os tratamentos familiares, inclusive os dos
    adultos, conforme decisão do usuário.
-   **Preferências separadas das regras médicas:** cada usuário
    configura como recebe notificações, mas não altera unilateralmente o
    significado da prescrição.

------------------------------------------------------------------------

## 2. Escopo funcional

### 2.1 Incluído no MVP

-   Cadastro e autenticação de usuários.
-   Criação de um espaço familiar e convite de responsáveis.
-   Cadastro de pessoas acompanhadas: crianças e adultos.
-   Um usuário adulto pode estar associado a um perfil de pessoa em
    tratamento.
-   Cadastro de tratamentos contínuos e ocasionais.
-   Cadastro de horários, recorrência, início, término e instruções
    transcritas da prescrição.
-   Geração de ocorrências de doses previstas.
-   Registro de administração, dose não administrada e cancelamento de
    ocorrência, conforme regras definidas.
-   Histórico por pessoa, tratamento, período e responsável.
-   Lembretes locais no Android.
-   Notificações de atualização, conflito e sincronização conforme
    preferências.
-   Banco local e fila de sincronização offline.
-   Auditoria de alterações e correções.
-   Resolução manual de conflitos concorrentes.
-   Configurações de família e configurações pessoais de notificações.

### 2.2 Recursos posteriores

-   Estoque, quantidade restante e validade.
-   Foto da receita e documentos anexos.
-   Registro de sintomas e possíveis reações.
-   Relatório para consulta com profissional de saúde.
-   Exportação de histórico.
-   Mais opções de permissões familiares e administração de membros.
-   Painel web, se houver necessidade.

### 2.3 Fora do escopo

-   Diagnosticar doenças.
-   Recomendar medicamentos.
-   Calcular ou ajustar doses.
-   Recomendar compensação de dose esquecida.
-   Confirmar automaticamente que a administração física ocorreu.
-   Substituir bula, prescrição ou orientação profissional.
-   Garantir entrega de notificações em todos os cenários do Android.

------------------------------------------------------------------------

## 3. Atores e permissões

### 3.1 Entidades humanas

-   **Usuário:** conta autenticada que acessa o aplicativo.
-   **Membro da família:** associação entre um usuário e um espaço
    familiar, com papel e situação.
-   **Pessoa:** paciente acompanhado; pode ser criança sem conta ou
    adulto associado a uma conta.
-   **Responsável que registra:** usuário autenticado que confirma,
    corrige ou altera dados.

### 3.2 Regras de acesso

Todos os membros autorizados da família podem, no padrão inicial:

-   visualizar as pessoas, os tratamentos e o histórico;
-   cadastrar tratamentos;
-   registrar administrações;
-   alterar tratamentos, com auditoria;
-   corrigir registros, informando motivo;
-   consultar e resolver conflitos.

Somente membros com permissão administrativa devem poder convidar ou
remover membros e alterar configurações gerais de acesso.

A visibilidade compartilhada não significa acesso público: todas as
leituras e escritas devem validar a associação ativa do usuário à
família.

### 3.3 Associação usuário--pessoa

A entidade `Person` não deve ser exclusiva de crianças. Um adulto pode
possuir conta e perfil de pessoa em tratamento. Uma criança pode ter
perfil sem conta.

Na primeira versão, cada perfil pessoal poderá estar associado a no
máximo uma conta. A implementação deverá verificar a consistência da
associação e impedir vínculo indevido entre pessoas, contas e famílias.

------------------------------------------------------------------------

## 4. Fluxos de uso

### 4.1 Configuração inicial

1.  Um responsável cria uma conta e uma família.
2.  Convida o outro responsável.
3.  O convidado aceita e passa a integrar a família.
4.  Os responsáveis cadastram os perfis das pessoas acompanhadas.
5.  Cadastram os tratamentos conforme a prescrição.
6.  Conferem os horários e as instruções antes de ativar a agenda.

### 4.2 Registrar uma administração

1.  Abrir a tela **Hoje**.
2.  Selecionar a ocorrência pendente.
3.  Conferir pessoa, medicamento, dose registrada na prescrição e
    horário.
4.  Selecionar **Registrar administração**.
5.  Confirmar o horário efetivo (preenchido com o horário atual,
    editável quando necessário).
6.  Salvar; o aplicativo registra usuário, horário de administração
    informado, horário do registro e dispositivo de origem.
7.  Atualizar a interface local imediatamente.
8.  Sincronizar com o servidor quando houver conexão.
9.  Atualizar o outro celular quando a informação chegar ao servidor e
    ao dispositivo.

O registro significa que o responsável informou que administrou o
medicamento; não é uma verificação física da administração.

### 4.3 Dose não administrada

O responsável pode registrar que a dose não foi administrada, com motivo
opcional. O sistema não deve marcar esse evento como administração e não
deve sugerir automaticamente uma dose substituta.

### 4.4 Corrigir registro

1.  Abrir o histórico da ocorrência.
2.  Selecionar **Solicitar correção** ou **Corrigir registro**.
3.  Informar o motivo e os dados corrigidos.
4.  Preservar o registro original e criar um evento de auditoria.
5.  Sincronizar a correção e notificar o outro responsável conforme as
    preferências.

### 4.5 Alterar tratamento

1.  Editar os campos necessários.
2.  Informar a partir de quando a mudança vale.
3.  Conferir o resumo das alterações.
4.  Salvar uma nova versão.
5.  Recalcular somente ocorrências futuras elegíveis; preservar o
    histórico.
6.  Registrar auditoria e gerar evento de notificação.
7.  Se a versão-base estiver desatualizada, preservar a proposta e
    exigir revisão manual.

------------------------------------------------------------------------

## 5. Estados e transições

### 5.1 Estado da ocorrência de dose

Estados conceituais:

-   `SCHEDULED`: prevista, antes do horário.
-   `PENDING`: chegou ao horário e não há administração válida
    conhecida.
-   `ADMINISTERED`: administração registrada e aceita.
-   `NOT_ADMINISTERED`: responsável informou que não foi administrada.
-   `CANCELLED`: ocorrência cancelada por alteração válida do
    tratamento.
-   `REVIEW_REQUIRED`: estado ambíguo ou conflito que exige conferência.

"Atrasada" deve ser uma classificação calculada com base no horário
previsto e na tolerância configurada, não necessariamente um estado
persistido. A tolerância é operacional e não deve ser interpretada como
orientação clínica.

### 5.2 Diagrama de estados

``` mermaid
stateDiagram-v2
    [*] --> SCHEDULED
    SCHEDULED --> PENDING: horário previsto alcançado
    SCHEDULED --> CANCELLED: agenda alterada antes da dose
    PENDING --> ADMINISTERED: administração confirmada
    PENDING --> NOT_ADMINISTERED: não realizada
    PENDING --> CANCELLED: cancelamento válido
    PENDING --> REVIEW_REQUIRED: conflito ou incerteza
    ADMINISTERED --> REVIEW_REQUIRED: conflito posterior detectado
    NOT_ADMINISTERED --> REVIEW_REQUIRED: revisão necessária
    REVIEW_REQUIRED --> ADMINISTERED: conferência confirma administração
    REVIEW_REQUIRED --> NOT_ADMINISTERED: conferência confirma não administração
    REVIEW_REQUIRED --> CANCELLED: resolução justificada
```

As transições finais devem ser implementadas com regras de negócio
explícitas. Uma correção não deve apagar a trilha histórica da transição
anterior.

### 5.3 Administração válida

A regra adotada é **no máximo um `AdministrationRecord` válido por
`DoseOccurrence`**. A restrição `UNIQUE(dose_occurrence_id)` é
necessária, mas insuficiente para resolver conflitos offline. O backend
deve detectar operações concorrentes, preservar as propostas e exigir
revisão quando a situação for ambígua.

------------------------------------------------------------------------

## 6. Notificações

### 6.1 Preferências iniciais acordadas

-   Lembrete antecipado: **10 minutos antes**.
-   Repetição: **a cada 15 minutos** enquanto pendente, sujeita a limite
    máximo.
-   Confirmação ao outro responsável: **somente eventos importantes ou
    conflitos**.
-   Alertas de atraso: ativados.
-   Horário de silêncio: desativado.
-   Som e vibração: configuráveis individualmente.
-   Avisos de conflito e sincronização: configuráveis na apresentação,
    sem esconder o estado na interface.

Os intervalos são valores de configuração do produto, não recomendações
médicas.

### 6.2 Regras

1.  Ambos recebem lembretes para ocorrências pendentes, respeitando suas
    preferências pessoais e as capacidades do Android.
2.  Um lembrete antecipado é emitido 10 minutos antes, se habilitado.
3.  No horário previsto, emitir lembrete principal se a ocorrência
    continuar pendente.
4.  Repetir a cada 15 minutos enquanto pendente, até o limite
    configurado.
5.  A tolerância para classificar atraso é independente do intervalo de
    repetição.
6.  Ao registrar a administração localmente, cancelar os avisos daquela
    ocorrência no próprio dispositivo.
7.  Após sincronização, atualizar os demais dispositivos e cancelar
    avisos que deixaram de ser válidos.
8.  A notificação de confirmação ao outro responsável não é emitida para
    cada administração rotineira por padrão.
9.  Conflitos devem gerar aviso aos responsáveis autorizados e
    permanecer visíveis na aplicação.
10. Falhas de conectividade podem impedir o cancelamento imediato de
    avisos em outro aparelho.
11. O sistema não deve presumir que descartar um aviso significa
    administrar o medicamento.
12. O aplicativo não deve recomendar dose extra ou compensação de
    atraso.

### 6.3 Reduzir avisos redundantes

Pode existir a ação **"Estou cuidando desta dose"**, que indica
responsabilidade temporária. Ela não equivale à administração. O outro
dispositivo pode reduzir lembretes comuns por um intervalo configurável
quando houver comunicação com o servidor. Offline, essa redução não pode
ser garantida no aparelho remoto.

### 6.4 Preferências por camada

**Padrões da família** - antecedência padrão; - intervalo e limite
padrão de repetição; - padrão de confirmação; - parâmetros iniciais para
novos tratamentos.

**Preferências pessoais** - som e vibração; - receber lembrete
antecipado; - frequência de avisos recebidos; - notificação adicional de
confirmação; - horário de silêncio; - apresentação de avisos de
sincronização.

**Regras do tratamento** - horários e recorrência; - início, término e
suspensão; - instruções da prescrição; - intervalo e limite de repetição
específicos; - tolerância para classificação de atraso.

Mudanças nos padrões da família não devem alterar automaticamente
tratamentos já cadastrados sem ação explícita. A dose, a frequência e as
instruções médicas são dados do tratamento, não preferências pessoais.

------------------------------------------------------------------------

## 7. Protótipos de telas

Os protótipos abaixo são wireframes textuais para orientar a interface.
Não são telas implementadas nem representam o visual final.

### 7.1 Tela inicial --- Hoje

``` text
┌──────────────────────────────────┐
│ Minha Família              ⚙     │
│ Hoje · Qui, 22 out.               │
│ ● Sincronizado                    │
├──────────────────────────────────┤
│ PESSOAS                           │
│ [Todos] [Gabriel] [Isabela] [Eu]  │
├──────────────────────────────────┤
│ PRÓXIMAS DOSES                    │
│                                  │
│ 08:00  Gabriel                    │
│        Medicamento A              │
│        Dose conforme prescrição   │
│        [Registrar]                │
│                                  │
│ 14:00  Isabela                    │
│        Medicamento B              │
│        [Pendente]                 │
│                                  │
│ 20:00  Você                       │
│        Medicamento C              │
│        [Pendente]                 │
├──────────────────────────────────┤
│ Hoje | Tratamentos | Histórico    │
│ Família | Configurações           │
└──────────────────────────────────┘
```

**Requisitos:** filtros por pessoa, estado de sincronização visível,
estado das doses claramente identificado e acesso rápido à ação
principal. Não exibir dose prescrita sem origem confirmada no cadastro.

### 7.2 Detalhe e confirmação de administração

``` text
┌──────────────────────────────────┐
│ ← Dose                            │
├──────────────────────────────────┤
│ Pessoa: Gabriel                  │
│ Medicamento: Medicamento A       │
│ Horário previsto: 08:00          │
│ Dose: conforme prescrição        │
│ Via: conforme cadastro            │
├──────────────────────────────────┤
│ Registrar administração          │
│ Horário efetivo: [08:05       ]  │
│ Observações: [opcional         ] │
│                                  │
│ [Confirmar administração]        │
│ [Registrar que não foi dada]     │
│ [Voltar]                         │
├──────────────────────────────────┤
│ Ao confirmar, o registro ficará  │
│ associado ao seu usuário.        │
└──────────────────────────────────┘
```

**Requisitos:** mostrar claramente pessoa e medicamento antes de
confirmar; não sugerir dose extra; permitir informar horário efetivo;
não confundir horário previsto com horário de administração.

### 7.3 Lista de tratamentos

``` text
┌──────────────────────────────────┐
│ Tratamentos                 [+]  │
├──────────────────────────────────┤
│ [Todos] [Ativos] [Encerrados]    │
│                                  │
│ Gabriel                          │
│ ┌──────────────────────────────┐ │
│ │ Medicamento A                │ │
│ │ Ativo · próximos horários    │ │
│ │ [Detalhes] [Editar]          │ │
│ └──────────────────────────────┘ │
│                                  │
│ Você                             │
│ ┌──────────────────────────────┐ │
│ │ Medicamento C                │ │
│ │ Ativo · rotina recorrente    │ │
│ │ [Detalhes] [Editar]          │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**Requisitos:** distinguir tratamentos ativos, suspensos e encerrados;
mostrar a pessoa associada; não permitir alteração silenciosa da
prescrição; confirmar alterações de agenda antes de aplicar.

### 7.4 Histórico

``` text
┌──────────────────────────────────┐
│ Histórico                        │
├──────────────────────────────────┤
│ Pessoa: [Todas             ▼]    │
│ Tratamento: [Todos         ▼]    │
│ Período: [Últimos 7 dias   ▼]    │
├──────────────────────────────────┤
│ Hoje · 08:05                     │
│ Gabriel · Medicamento A          │
│ Registrado por: Responsável 1    │
│ Estado: Sincronizado             │
│ [Detalhes]                       │
│                                  │
│ Ontem · 20:10                    │
│ Você · Medicamento C             │
│ Registrado por: Responsável 2    │
│ [Detalhes]                       │
└──────────────────────────────────┘
```

**Requisitos:** filtrar por pessoa, tratamento, período e responsável;
mostrar horário efetivo, horário de registro e situação de
sincronização; disponibilizar trilha de correções.

### 7.5 Família e configurações

``` text
┌──────────────────────────────────┐
│ Família e configurações          │
├──────────────────────────────────┤
│ Membros                          │
│ • Responsável 1 · Administrador  │
│ • Responsável 2 · Membro         │
│ [Convidar responsável]           │
├──────────────────────────────────┤
│ Preferências deste celular       │
│ Som e vibração             [On]  │
│ Lembrete antecipado        [On]  │
│ Repetição                   15m  │
│ Notificação de confirmação [Off] │
│ Horário de silêncio        [Off] │
├──────────────────────────────────┤
│ Padrões da família               │
│ Antecedência                 10m │
│ Repetição                   15m  │
│ Limite de repetição        [N]   │
│ [Editar padrões]                 │
└──────────────────────────────────┘
```

**Requisitos:** distinguir preferências pessoais dos padrões familiares;
explicar quais alterações afetam todos; proteger ações administrativas.

### 7.6 Tratamento com conflito

``` text
┌──────────────────────────────────┐
│ Alteração pendente de revisão    │
├──────────────────────────────────┤
│ Tratamento: Medicamento A        │
│ Estado: Conflito offline         │
│                                  │
│ Versão compartilhada: 4          │
│ Proposta do responsável 1        │
│ • Horário: 08:00                 │
│                                  │
│ Proposta do responsável 2        │
│ • Horário: 08:30                 │
│                                  │
│ Nenhuma proposta foi aplicada    │
│ automaticamente.                │
│                                  │
│ [Revisar propostas]              │
│ [Registrar resolução]            │
└──────────────────────────────────┘
```

**Requisitos:** mostrar versão-base, autoria e diferenças; preservar
ambas as propostas; registrar a resolução como nova revisão; não aplicar
silenciosamente a alteração mais recente.

------------------------------------------------------------------------

## 8. Arquitetura técnica

### 8.1 Componentes

-   **Android:** Kotlin, Jetpack Compose, Room/SQLite, WorkManager e
    mecanismos de alarmes compatíveis com as permissões do sistema.
-   **API:** Java com Quarkus REST.
-   **Banco central:** PostgreSQL.
-   **Sincronização:** REST para envio e consulta, com WebSocket ou
    mecanismo equivalente para atualizações rápidas quando conectado.
-   **Notificações remotas:** Firebase Cloud Messaging, como mecanismo
    auxiliar, sem presumir entrega garantida.
-   **Eventos confiáveis:** padrão transactional outbox para publicar
    notificações e eventos após confirmação da transação.

### 8.2 Diagrama de arquitetura

``` mermaid
flowchart TD
    A[Android responsável 1] --> L1[Room / SQLite]
    B[Android responsável 2] --> L2[Room / SQLite]
    L1 --> Q1[Fila de operações offline]
    L2 --> Q2[Fila de operações offline]
    Q1 --> API[API REST Quarkus]
    Q2 --> API
    API --> AUTH[Autenticação e autorização]
    API --> SVC[Serviços de domínio]
    SVC --> PG[(PostgreSQL)]
    SVC --> OUT[Transactional Outbox]
    OUT --> PUSH[Serviço de notificações]
    PUSH --> A
    PUSH --> B
    API --> RT[Canal de atualização em tempo real]
    RT --> A
    RT --> B
```

### 8.3 Responsabilidades

**Android** - exibir a agenda local; - permitir registros offline; -
armazenar operações pendentes; - agendar notificações locais; - indicar
sincronização e conflitos; - nunca declarar sincronizado um evento antes
da confirmação do servidor.

**Quarkus** - autenticar e autorizar; - validar operações; - aplicar
regras de negócio e transações; - garantir idempotência; - resolver
concorrência e preservar conflitos; - produzir eventos de auditoria e
outbox.

**PostgreSQL** - armazenar o estado compartilhado; - aplicar chaves
estrangeiras e restrições de unicidade; - preservar versões, auditoria e
operações processadas; - oferecer transações atômicas.

------------------------------------------------------------------------

## 9. Modelo relacional proposto

### 9.1 Tabelas principais

  Tabela                         Finalidade
  ------------------------------ ---------------------------------------------
  `family`                       Espaço familiar
  `app_user`                     Conta autenticada
  `family_member`                Participação e papel na família
  `person`                       Criança ou adulto acompanhado
  `family_settings`              Padrões compartilhados
  `user_notification_settings`   Preferências pessoais
  `medication`                   Catálogo opcional
  `treatment`                    Tratamento associado à pessoa
  `treatment_schedule`           Regras de recorrência
  `treatment_revision`           Histórico de versões do tratamento
  `dose_occurrence`              Dose prevista para data e horário concretos
  `administration_record`        Administração válida registrada
  `audit_event`                  Histórico de alterações e correções
  `device`                       Dispositivo autorizado
  `sync_operation`               Operações recebidas e idempotência
  `sync_conflict`                Conflitos aguardando resolução
  `sync_conflict_change`         Propostas preservadas
  `sync_cursor`                  Progresso da sincronização por dispositivo
  `outbox_event`                 Eventos a publicar após commit

### 9.2 Campos e integridade

**`family`** - `id UUID PRIMARY KEY` - `name` - `created_at`

**`app_user`** - `id UUID PRIMARY KEY` - `auth_subject UNIQUE` -
`display_name` - `created_at`

**`family_member`** - `id UUID PRIMARY KEY` - `family_id FK` -
`user_id FK` - `role` - `status` - `joined_at` -
`UNIQUE(family_id, user_id)`

**`person`** - `id UUID PRIMARY KEY` - `family_id FK` -
`user_id NULLABLE FK` - `display_name` - `birth_date NULLABLE` -
`active` - associação usuário--pessoa única, se houver; - consistência
entre família, usuário e perfil validada pelo backend e, quando
possível, reforçada por restrições.

**`treatment`** - `id UUID PRIMARY KEY` - `person_id FK` -
`medication_id NULLABLE FK` - `name` - `prescribed_dose` - `route` -
`instructions` - `status` - `start_at` - `end_at` - `version` -
`created_by` - `updated_at`

**`treatment_schedule`** - `id UUID PRIMARY KEY` - `treatment_id FK` -
`recurrence_rule` - `timezone` - `reminder_before_minutes` -
`repeat_interval_minutes` - `repeat_limit` - `late_tolerance_minutes` -
`version`

**`treatment_revision`** - `id UUID PRIMARY KEY` - `treatment_id FK` -
`version` - `base_version` - `snapshot JSONB` - `created_by` -
`created_at` - `UNIQUE(treatment_id, version)`

**`dose_occurrence`** - `id UUID PRIMARY KEY` - `treatment_id FK` -
`schedule_id FK` - `scheduled_at` - `schedule_version` - `status` -
`created_at` - restrição para evitar a mesma ocorrência lógica
duplicada, sem proibir duas doses legítimas em horários iguais.

**`administration_record`** - `id UUID PRIMARY KEY` -
`dose_occurrence_id FK UNIQUE` - `recorded_by FK` - `device_id FK` -
`administered_at` - `recorded_at` - `notes`

**`audit_event`** - `id UUID PRIMARY KEY` - `family_id FK` -
`actor_id FK` - `entity_type` - `entity_id` - `event_type` -
`before_data JSONB` - `after_data JSONB` - `occurred_at` - `received_at`

**`sync_operation`** - `id UUID PRIMARY KEY` - `family_id FK` -
`device_id FK` - `actor_id FK` - `operation_key` - `entity_type` -
`entity_id` - `base_version` - `payload JSONB` - `status` -
`received_at` - `processed_at` - chave idempotente única por
dispositivo.

**`sync_conflict`** - `id UUID PRIMARY KEY` - `family_id FK` -
`entity_type` - `entity_id` - `status` - `reason` - `created_at` -
`resolved_by` - `resolved_at`

**`sync_conflict_change`** - `id UUID PRIMARY KEY` - `conflict_id FK` -
`operation_id FK` - `base_version` - `proposed_data JSONB` -
`created_at` - `UNIQUE(conflict_id, operation_id)`

**`device`** - `id UUID PRIMARY KEY` - `user_id FK` - `platform` -
`last_seen_at` - estado de autorização e identificação do dispositivo.

**`sync_cursor`** - `id UUID PRIMARY KEY` - `device_id FK` -
`family_id FK` - `last_received_sequence BIGINT` - `updated_at` -
`UNIQUE(device_id, family_id)`

**`outbox_event`** - `id UUID PRIMARY KEY` - `family_id FK` -
`event_type` - `payload JSONB` - `created_at` - `published_at` - número
de tentativas e estado de publicação.

### 9.3 Índices prioritários

-   `family_member(user_id, status)`
-   `person(family_id, active)`
-   `treatment(person_id, status)`
-   `dose_occurrence(treatment_id, scheduled_at)`
-   índice para consultar ocorrências pendentes no escopo da família;
-   `audit_event(family_id, occurred_at)`
-   chave idempotente de `sync_operation`;
-   `outbox_event` para localizar eventos ainda não publicados.

Os índices finais devem ser validados com as consultas reais e os planos
de execução do PostgreSQL.

------------------------------------------------------------------------

## 10. Sincronização offline e conflitos

### 10.1 Identidade das operações

Cada operação criada no dispositivo recebe um UUID estável. O mesmo
identificador deve ser usado em todas as tentativas de envio daquela
operação.

O servidor registra o resultado da operação. Se receber a mesma operação
novamente, retorna o resultado anterior em vez de executar os efeitos
novamente.

### 10.2 Alterações de tratamento

-   Se a versão-base ainda for a atual, validar e aplicar a alteração em
    uma transação.
-   Se a versão-base estiver desatualizada, preservar a proposta como
    conflito.
-   Não alterar a versão compartilhada enquanto o conflito estiver
    pendente.
-   Permitir que um responsável autorizado revise as propostas.
-   A resolução cria nova revisão e evento de auditoria.
-   Se a versão mudar durante a revisão, rejeitar a resolução e
    solicitar nova conferência.

### 10.3 Administração concorrente

Se dois dispositivos offline registrarem a mesma ocorrência:

1.  Preservar as operações originais.
2.  Não criar duas administrações válidas.
3.  Não descartar automaticamente uma das informações.
4.  Sinalizar o conflito.
5.  Exigir revisão humana para estabelecer o estado compartilhado.
6.  Preservar a resolução na auditoria.

A restrição de unicidade no banco é uma barreira de integridade, não a
política completa de resolução.

### 10.4 Cursor e paginação

Cada dispositivo acompanha a sequência de eventos já recebidos. O
servidor precisa garantir que o cursor avance apenas quando os eventos
anteriores tiverem sido entregues de forma consistente. Repetir uma
consulta de sincronização não deve causar duplicidade de efeitos no
dispositivo.

------------------------------------------------------------------------

## 11. Regras transacionais

### 11.1 Alteração de tratamento

Dentro de uma transação: 1. validar o usuário e a associação ativa à
família; 2. validar a versão-base; 3. gravar a nova revisão ou preservar
o conflito; 4. gravar auditoria; 5. gravar eventos de outbox; 6.
confirmar o commit.

### 11.2 Administração

Dentro de uma transação: 1. validar acesso à família; 2. validar a
ocorrência e seu estado; 3. verificar idempotência; 4. inserir
administração se ainda não existir uma válida; 5. se houver concorrência
incompatível, preservar o evento e abrir conflito; 6. gravar auditoria e
outbox; 7. confirmar o commit.

### 11.3 Publicação de notificações

O backend não deve depender de enviar uma notificação antes do commit. O
evento é gravado na outbox na mesma transação e publicado por um
processo separado, com tentativas repetidas e identificador estável.

A entrega de push não pode ser garantida. O estado compartilhado
permanece no servidor e será recuperado pelo aplicativo na próxima
sincronização.

------------------------------------------------------------------------

## 12. Segurança, privacidade e LGPD

Os dados de saúde de crianças e adultos exigem proteção especial.

Requisitos mínimos:

-   HTTPS para comunicação;
-   autenticação robusta;
-   autorização no servidor por família;
-   armazenamento local protegido pelo sistema operacional;
-   controle de sessão e revogação de dispositivos;
-   registros de auditoria sem exposição desnecessária de dados;
-   política de retenção e exclusão documentada;
-   cópias de segurança e testes de restauração;
-   notificações na tela bloqueada sem detalhes sensíveis por padrão;
-   avaliação de requisitos legais aplicáveis, incluindo LGPD e proteção
    de dados de crianças.

A implementação deve definir como tratar exclusão de conta, remoção de
membro, exportação e retenção do histórico. Esses aspectos precisam ser
decididos antes da produção.

------------------------------------------------------------------------

## 13. Critérios de aceitação do MVP

### Família e pessoas

-   [ ] Dois responsáveis podem acessar a mesma família.
-   [ ] Crianças podem ser cadastradas sem conta.
-   [ ] Adultos podem ter conta e perfil de pessoa em tratamento.
-   [ ] Tratamentos são compartilhados com os membros autorizados.

### Tratamentos e doses

-   [ ] Tratamentos contínuos e ocasionais podem ser cadastrados.
-   [ ] Ocorrências são geradas sem duplicidade lógica.
-   [ ] Uma ocorrência admite no máximo uma administração válida.
-   [ ] Correções preservam o histórico original.
-   [ ] Alterações não reescrevem administrações passadas.

### Notificações

-   [ ] Lembrete antecipado configurável, padrão de 10 minutos.
-   [ ] Repetição configurável, padrão de 15 minutos e com limite.
-   [ ] Alertas de atraso independentes da repetição.
-   [ ] Confirmação adicional ao outro responsável restrita a eventos
    importantes por padrão.
-   [ ] Preferências pessoais não alteram a agenda compartilhada.
-   [ ] Limitações de conectividade e do Android são informadas.

### Offline e conflitos

-   [ ] É possível consultar dados previamente sincronizados sem
    internet.
-   [ ] É possível registrar uma administração offline.
-   [ ] Operações pendentes ficam identificadas.
-   [ ] Reenvios não duplicam efeitos.
-   [ ] Alterações concorrentes são preservadas.
-   [ ] Conflitos exigem revisão manual.
-   [ ] A sincronização atualiza ambos os celulares sem apagar
    histórico.

### Segurança

-   [ ] Usuários não acessam famílias sem autorização.
-   [ ] Alterações relevantes são auditadas.
-   [ ] Sessões e dispositivos podem ser revogados.
-   [ ] Há testes de recuperação do banco de dados.

------------------------------------------------------------------------

## 14. Plano de desenvolvimento sugerido

### Fase 1 --- Fundação

-   definir contratos de API;
-   criar esquema PostgreSQL;
-   implementar autenticação e associação familiar;
-   implementar cadastro de pessoas e tratamentos.

### Fase 2 --- Agenda

-   implementar regras de recorrência;
-   gerar ocorrências;
-   implementar tela Hoje e detalhes do tratamento;
-   registrar administrações e histórico.

### Fase 3 --- Offline

-   criar persistência Room;
-   criar fila idempotente;
-   implementar sincronização incremental;
-   implementar versões e resolução manual de conflitos.

### Fase 4 --- Notificações

-   programar notificações locais;
-   implementar preferências pessoais;
-   integrar outbox e push;
-   tratar cancelamento e atualização dos lembretes.

### Fase 5 --- Qualidade e segurança

-   testar concorrência;
-   testar aparelhos offline;
-   testar restauração de backup;
-   revisar privacidade e segurança;
-   validar acessibilidade e usabilidade.

------------------------------------------------------------------------

## 15. Decisões em aberto

As seguintes questões precisam ser resolvidas antes da implementação
definitiva:

1.  Provedor de autenticação e estratégia de convite.
2.  Política de retenção e exclusão dos dados.
3.  Horizonte de geração antecipada das ocorrências.
4.  Regra exata para revisão de conflitos de administração.
5.  Limite máximo de repetição dos lembretes.
6.  Tratamento das alterações de fuso horário e horário de verão.
7.  Estratégia de backup, restauração e migração do banco local.
8.  Política de acesso e revogação quando um membro sai da família.
9.  Como tratar prescrições anexadas e dados sensíveis em notificações.
10. Estratégia de testes e monitoramento em produção.

------------------------------------------------------------------------

## 16. Resumo executivo

O aplicativo será uma aplicação Android compartilhada, com
Kotlin/Jetpack Compose, Room/SQLite, backend Java/Quarkus e PostgreSQL.
Seu modelo contempla adultos e crianças como pessoas acompanhadas,
tratamentos contínuos e ocasionais, agenda, lembretes, administrações e
auditoria.

O diferencial de confiabilidade é a separação entre ocorrência prevista,
administração registrada, estado de sincronização e histórico de
alterações. Operações offline terão identificadores estáveis e
processamento idempotente. Alterações concorrentes serão preservadas
para revisão manual, sem sobrescrita silenciosa.

Este documento serve como especificação inicial para orientar o desenho
técnico, os protótipos e o desenvolvimento. Antes da implementação, as
decisões em aberto devem ser resolvidas e as regras de segurança e
privacidade validadas.
