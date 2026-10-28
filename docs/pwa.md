# Aplicativo (PWA)

O aplicativo é um **PWA** (Progressive Web App): roda no navegador e pode ser
instalado na tela inicial do Android, do iPhone ou do computador. Fica em
`frontend/` e é feito com React, Vite e TypeScript.

## Telas (seção 7 da especificação)

| Tela | Rota | O que faz |
| --- | --- | --- |
| Hoje | `/` | doses do dia por pessoa, estado de sincronização, atalho para registrar |
| Dose | `/doses/:id` | conferir e registrar administração (com atalho "No horário previsto") ou "não foi dada", "Lembrar daqui a pouco", atalho para mudar os horários do tratamento, corrigir, revisar conflitos, trilha |
| Tratamentos | `/tratamentos` | lista por pessoa e situação; cadastro e alteração com editor de agenda e conferência |
| Histórico | `/historico` | filtros por pessoa, tratamento, período e responsável |
| Família | `/familia` | membros e convites, pessoas, padrões da família, preferências, aparelhos, conta |
| Para conferir | `/conflitos` | doses com registros divergentes |
| Saúde | `/saude` | aferições em gráfico (com linha de referência e doses dadas), sintomas em andamento, linha do tempo |
| Nova aferição / sintoma | `/saude/aferir`, `/saude/sintoma` | registro rápido, inclusive offline |

| Hoje | Dose | Offline | Conferência |
| --- | --- | --- | --- |
| ![Hoje](telas/1-hoje.png) | ![Dose](telas/2-dose.png) | ![Registro offline](telas/4-offline.png) | ![Conferência de conflito](telas/5-conferencia.png) |

| Gráfico de temperatura | Saúde | Pessoa cadastrada offline | Doses anteriores |
| --- | --- | --- | --- |
| ![Gráfico com referência e dose](telas/6-grafico-temperatura.png) | ![Sintomas e gráfico](telas/7-saude.png) | ![Pessoa aguardando envio](telas/9-pessoa-offline.png) | ![Pergunta das doses anteriores](telas/10-doses-anteriores.png) |

| Lembrar daqui a pouco | Dada no horário | Família | Tratamentos |
| --- | --- | --- | --- |
| ![Lembrete adiado, aguardando envio](telas/12-lembrar-depois.png) | ![Confirmação de dose dada no horário](telas/13-dada-no-horario.png) | ![Família com avatares e doses do dia](telas/14-familia.png) | ![Tratamentos por pessoa](telas/15-tratamentos.png) |

| Histórico | Entrar | Hoje (tema escuro) |
| --- | --- | --- |
| ![Histórico de registros](telas/16-historico.png) | ![Tela de entrada](telas/17-entrar.png) | ![Hoje no tema escuro](telas/18-hoje-escuro.png) |

**Dada no horário:** na tela Hoje, a dose em aberto cujo horário já chegou
tem o botão **Dada no horário** (no cartão "Próxima dose" e na lista). Ele
abre uma confirmação com pessoa, medicamento, dose e horário; ao confirmar,
registra a administração com o horário previsto, como qualquer registro de
dose (offline, fica "Aguardando envio"). Se foi em outro horário, abra a dose.

Ao ativar um tratamento que começou no passado, o app pergunta se as doses
anteriores foram dadas, sem resposta marcada: registrar todas no horário
previsto, deixar em aberto para registrar uma a uma, ou começar a agenda agora.

O gráfico mostra a série no tempo, a linha de referência da família
(tracejada), as doses dadas no mesmo eixo (▲) e, ao tocar num ponto, o valor e
a última dose antes dele. "Ver valores" abre a mesma informação em tabela.

As capturas são geradas pelo teste de ponta a ponta (`E2E_SCREENSHOTS=pasta npm run e2e`).

## Funcionamento offline

```mermaid
flowchart LR
    UI[Telas] -->|lê| C[(IndexedDB: cópia dos dados)]
    UI -->|registra dose| Q[(IndexedDB: fila)]
    Q -->|envia com operationId| API[API]
    API -->|respostas| C
    SW[Service worker] -->|abre o app sem rede| UI
```

- **O app abre sem internet.** O service worker guarda o código do app, e as
  telas mostram a última cópia dos dados guardada no aparelho (IndexedDB),
  sempre com o aviso "Offline · dados de há N min".
- **Doses registradas sem internet** vão para uma fila no aparelho, aparecem
  como "Aguardando envio" e são enviadas assim que a conexão volta: ao
  reconectar, ao reabrir o app e a cada 30 segundos.
- **Reenviar é seguro.** Cada registro tem um `operationId` gerado no aparelho;
  o servidor reconhece reenvios e não repete os efeitos (seção 10.1).
- **Registros divergentes são preservados.** Se outra pessoa registrou a mesma
  dose enquanto o aparelho estava offline, nada é descartado: a dose vai para
  "Conferir" e um responsável decide (seção 10.3).
- **O app nunca mostra "Sincronizado"** enquanto houver registro sem
  confirmação do servidor. Um registro recusado (por exemplo, a dose de outro
  dia) fica visível em Hoje até o responsável tentar de novo ou descartar.
- **Tudo é gravado offline:** pessoas, tratamentos (cadastro, alteração,
  ativação, suspensão), padrões e preferências, correções, conferências,
  aferições, sintomas, linhas de referência e lembretes. O registro aparece na
  hora com "Aguardando envio", e o topo de todas as telas mostra quantos
  faltam enviar. Cada gravação leva uma chave de operação; reenviar não repete
  efeitos.
- **Recusado ao sincronizar** (por exemplo, a dose mudou enquanto o aparelho
  estava offline): aparece em qualquer tela como "Não foi aceito", com
  "Tentar de novo" e "Descartar".
- **Tratamento alterado em dois aparelhos:** a alteração que chegar sobre uma
  versão antiga vai para "Para conferir". O tratamento não muda até alguém
  decidir (seção 10.2).
- **Precisam de conexão, por natureza:**
  - entrar na conta;
  - criar ou entrar numa família;
  - gerar convite;
  - ativar notificações;
  - "Estou cuidando desta dose", que é um aviso em tempo real.

  Veja [`decisoes.md`](decisoes.md).

## Instalar no celular

- **Android (Chrome):** abra o endereço do app e toque em **Instalar app**, ou
  em ⋮ → **Adicionar à tela inicial**.
- **iPhone (Safari):** toque em **Compartilhar** → **Adicionar à Tela de
  Início**. No iPhone, as notificações (fase 4) só funcionam com o app
  instalado.

Em produção, o app precisa de **HTTPS**: o service worker só funciona em
origem segura (ou em `localhost`).

## Desenvolvimento

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173, com /api repassado para :8010
npm test           # testes unitários (Vitest)
npm run typecheck
npm run e2e        # ponta a ponta (Playwright), veja abaixo
```

### Modo local (sem Firebase)

Com `VITE_AUTH_MODE=local`, a tela de login pede só um nome e gera tokens no
formato do Firebase, assinados com a chave de **teste** do repositório. A API
precisa estar no modo local (veja [`firebase.md`](firebase.md)).

```bash
# .env da raiz
FIREBASE_PROJECT_ID=remedios-local
REMEDIOS_JWT_PUBLICKEY_LOCATION=/run/keys/test-public.pem
VITE_AUTH_MODE=local

docker compose up -d --build       # app em http://localhost:8000
```

O código do modo local só entra no pacote quando `VITE_AUTH_MODE=local`. O CI
confere que o build de produção não contém a chave.

### Testes de ponta a ponta

`e2e/offline.spec.ts` cadastra uma pessoa e um tratamento sem conexão,
ativa o tratamento (com as doses anteriores informadas como dadas) e confere
que tudo chega ao servidor na ordem quando a conexão volta.

`e2e/fluxo.spec.ts` simula dois responsáveis em celulares:

1. cadastro da família, da pessoa e do tratamento com agenda;
2. registro online;
3. convite para o segundo responsável;
4. o app aberto sem rede;
5. registro offline;
6. a mesma dose registrada pelo outro responsável;
7. a volta da conexão, com a dose indo para conferência;
8. a decisão humana sobre o conflito.

```bash
docker compose run --rm e2e        # com o compose no modo local (acima)
```

## Lembretes e notificações

Veja [`notificacoes.md`](notificacoes.md). O service worker do app
(`src/sw.ts`) guarda o app para uso offline e mostra os avisos de push;
tocar num aviso abre a dose.

## Lembretes (histórico da decisão)

Um PWA não consegue agendar notificações no próprio aparelho. Os lembretes
virão por **notificação push** enviada pelo servidor (fase 4), por isso
dependem de o celular ter internet na hora da dose. Os outros avisos
(conflitos, registros importantes) já dependem do servidor de qualquer forma.
Se lembrar sem internet se mostrar indispensável, o mesmo código pode ser
empacotado como app nativo (Capacitor) com notificações locais.
