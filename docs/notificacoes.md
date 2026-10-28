# Notificações (fase 4)

Lembretes de dose e avisos importantes chegam por **Web Push**, o padrão dos
navegadores: Chrome e Edge (Android e computador), Firefox e Safari no iPhone
com o app **instalado na tela inicial** (iOS 16.4 ou mais recente). Não há
dependência do Firebase Cloud Messaging: o servidor fala diretamente com o
serviço de push de cada navegador.

```mermaid
sequenceDiagram
    participant App as PWA (aparelho)
    participant API as API Remédios
    participant SP as Serviço de push do navegador
    App->>API: inscrição (endpoint + chaves do navegador)
    loop a cada minuto
        API->>API: doses em aberto com lembrete vencido
        API->>SP: mensagem cifrada (RFC 8291) + assinatura VAPID
        SP-->>App: entrega (quando o aparelho estiver conectado)
    end
    App->>App: service worker mostra o aviso; tocar abre a dose
```

## Lembretes de dose (seções 6.1 e 6.2)

| Momento | Título | Observação |
| --- | --- | --- |
| *antecedência* antes do horário (padrão 10 min) | "Dose em 10 min" | só para quem deixou "Lembrete antes do horário" ligado |
| no horário | "Hora da dose" | |
| a cada *intervalo* (padrão 15 min), até o *limite* (padrão 4) | "Dose pendente" / "Dose atrasada" | "atrasada" depois da tolerância da agenda |

- Os parâmetros vêm da agenda do tratamento; o intervalo de repetição pode ser
  trocado por responsável nas preferências pessoais.
- **Param assim que a dose é decidida** (administrada, não dada, cancelada). O
  aviso já mostrado é **substituído** por "Dose registrada por Ana" (mesma
  `tag`), em silêncio, para não ficar um lembrete vencido na tela.
- **Nada é presumido:** descartar ou ignorar um aviso não registra a dose.
  Tocar nele só abre a tela da dose.
- **"Estou cuidando desta dose"** (seção 6.3): silencia os lembretes dos outros
  responsáveis por 20 minutos (`remedios.reminders.claim`). Não é
  administração e é liberado ao registrar a dose.
- **"Lembrar daqui a pouco"** (tela da dose: 15 min, 30 min ou 1 hora): adia
  só os lembretes de quem pediu. Até a hora escolhida, nenhum lembrete da
  agenda vai para essa pessoa; na hora, chega um "Lembrete da dose" (ou "Dose
  atrasada"), e depois a agenda segue no horário original. **A dose não muda
  de horário**, fica atrasada depois da tolerância como sempre, e as próximas
  doses não mudam. Funciona offline (a hora é calculada no aparelho e vai pela
  fila). Para mudar os horários de vez, a tela da dose leva a **Mudar horários
  do tratamento** (alteração com vigência e motivo).
- **Sem avisos fora de hora:** se o servidor ficou parado, um lembrete com mais
  de 15 minutos de atraso (`remedios.reminders.max-delay`) não é enviado.
- **Várias instâncias da API** não duplicam lembretes: cada envio é reservado
  em `reminder_log` antes de sair.

## Avisos de eventos (publicador da outbox, seção 11.3)

| Evento | Quem recebe |
| --- | --- |
| Conflito de registros | **todos**, sempre, com urgência alta |
| Dose não dada, registro corrigido, conferência concluída | os demais, se a política da família não for "nenhum" |
| Tratamento cadastrado, alterado, ativado, suspenso ou encerrado | os demais, idem |
| Membro entrou ou saiu | os demais, idem |
| Dose registrada (rotina) | só quem pediu ("Avisar a cada dose registrada") ou se a política for "todas" |

A política da família é o padrão "Confirmação ao outro responsável" (seção
6.1): **só eventos importantes e conflitos**.

## Lembretes avulsos

Na aba **Saúde**, "+ Lembrete" agenda um aviso para um horário, por exemplo
"medir a temperatura de novo em 1 h". Ele vai para quem criou ou para todos os
responsáveis.

## Preferências pessoais (seção 6.4)

| Preferência | Efeito |
| --- | --- |
| Lembrete antes do horário | liga ou desliga o aviso antecipado |
| Repetir lembrete de dose pendente | intervalo próprio, ou o do tratamento |
| Som / Vibração | avisos silenciosos e/ou sem vibrar |
| Avisar a cada dose registrada | confirmação de rotina |
| Mostrar pessoa e medicamento no aviso | **desligado por padrão** (seção 12): o aviso diz só "Dose prevista para as 08:00" |
| Horário de silêncio | sem lembretes de dose nem avisos comuns nesse intervalo, no fuso do aparelho; conflitos e lembretes avulsos continuam |

## Configuração

1. Gere as chaves VAPID e acrescente ao `.env`:

   ```bash
   scripts/vapid-keys.sh >> .env
   ```

   Ajuste `REMEDIOS_VAPID_SUBJECT` para um contato real (`mailto:`), exigido
   pelos serviços de push. A chave privada é segredo. Trocá-la invalida as
   inscrições: cada aparelho precisa ativar as notificações de novo.
2. `docker compose up -d --build`. Sem as chaves, a API sobe com as
   notificações desligadas (aviso no log), e o app explica isso na aba
   Família.
3. Em cada aparelho: **Família → Notificações neste aparelho → Ativar
   notificações** e, para conferir, **Enviar aviso de teste**.

Produção exige **HTTPS** (service worker e push só funcionam em origem
segura).

## Limitações

- **Sem internet, sem lembrete.** O aviso depende de o aparelho estar
  conectado. Os serviços de push guardam a mensagem por um tempo (TTL de 30
  min para lembretes) e a entregam quando a conexão volta, mas a entrega não é
  garantida (seção 2.3). A tela Hoje continua sendo a referência.
- **iPhone:** só com o app instalado na tela inicial. Sem som personalizado.
- **Modo de economia de bateria** do Android pode atrasar avisos.
- Se lembrar sem internet for indispensável, o mesmo app pode ser empacotado
  como nativo (Capacitor), com notificações agendadas no aparelho.

## Como foi testado

- **Cifra:** implementada só com o JDK (ECDH P-256, HKDF, AES-128-GCM) e
  conferida com o exemplo oficial do Apêndice A da RFC 8291. A assinatura
  VAPID (ES256, RFC 8292) também é verificada.
- **Integração:** um **serviço de push falso** recebe as mensagens, confere a
  assinatura VAPID e as decifra com as chaves de um "navegador" de teste.
  Os testes cobrem:
  - lembretes antecipado, no horário, repetições e limite;
  - substituição ao registrar;
  - confirmação só para quem pediu;
  - "estou cuidando";
  - horário de silêncio;
  - inscrição expirada (410);
  - aparelho desconectado;
  - conflitos;
  - lembretes avulsos;
  - privacidade da tela bloqueada.
