# Segurança e privacidade (revisão da fase 5)

Revisão dos requisitos da seção 12 da especificação. Para cada item: o que
existe, como é verificado e o que falta decidir antes da produção.

## Situação por requisito

| Requisito (seção 12) | Situação | Verificação |
| --- | --- | --- |
| HTTPS | O app só funciona completo em origem segura (service worker, Web Crypto, push). O nginx envia HSTS. O certificado fica no servidor de produção (veja "Pendências"). | cabeçalhos conferidos no e2e |
| Autenticação robusta | ID token do Firebase validado na API: assinatura RS256 com as chaves do Google, emissor, audiência e validade. O modo local usa uma chave de teste que nunca entra no build de produção. | `SecurityTest`: sem token, token de outro projeto, expirado ou malformado → `401` em todas as rotas; CI confere o build |
| Autorização no servidor por família | Toda rota de família confere a participação ativa e devolve `404` a quem é de fora, sem revelar se a família existe. Ações de administrador devolvem `403` a membros comuns. Ids de outra família não funcionam nem dentro da própria. | `SecurityTest`: matriz com todas as rotas (54), verificando também que nada mudou |
| Armazenamento local protegido pelo sistema | Cópia offline e fila no IndexedDB do navegador, isolado por origem e protegido pelo bloqueio do aparelho. Ao sair da conta, tudo é apagado. | teste unitário de `clearLocalData` |
| Sessão e revogação de aparelhos | Aparelhos podem ser desconectados (`DELETE /api/me/devices/{id}`); um aparelho revogado não registra doses nem recebe avisos. O id de um aparelho não pode ser tomado por outra conta. | `SecurityTest`, `NotificationTest` |
| Auditoria sem exposição desnecessária | Auditoria com antes/depois só para a família. Eventos de outbox e logs levam apenas identificadores, sem nome de medicamento, dose ou medida. | `AdministrationTest.outboxCarriesOnlyIdentifiers`; revisão dos logs |
| Retenção e exclusão documentadas | **Pendente de decisão** (abaixo). Hoje nada de saúde é apagado automaticamente; só os resultados de reenvio (`client_operation`) somem após 30 dias. | — |
| Cópias de segurança e teste de restauração | `scripts/backup.sh`, `restore.sh` e `restore-test.sh`. O CI restaura a cada mudança e compara tabela por tabela ([`operacao.md`](operacao.md)). | job `e2e` do CI |
| Tela bloqueada sem detalhes | Padrão: aviso sem pessoa nem medicamento; o responsável pode ligar os detalhes. | `NotificationTest` |
| LGPD e dados de crianças | Exportação completa da família (acesso e portabilidade), só para administradores e registrada na auditoria. Demais pontos: **pendentes** (abaixo). | `ExportTest` |

## Proteções acrescentadas na revisão

- **Política de conteúdo (CSP) e cabeçalhos** em todas as respostas do app
  (`frontend/security-headers.conf`):
  - só scripts e estilos do próprio app, sem nada inline; o login do Firebase
    usa domínios do Google;
  - `frame-ancestors 'none'` e `X-Frame-Options`, contra clickjacking;
  - HSTS, `Permissions-Policy` sem câmera, microfone e localização,
    `nosniff`, `Referrer-Policy`.
- **Limites:**
  - corpo de até 256 KB, no nginx e na API;
  - 50 pedidos/s por IP na API, com folga para rajadas; resposta `429`, que
    o app trata como temporária: a fila tenta de novo, nada é perdido.
- **Banco e API publicados só em `127.0.0.1`** no `compose.yaml`; de fora,
  só o app (que repassa `/api`).
- **Dependências:** o CI falha com vulnerabilidade alta ou crítica nas
  dependências do app (`npm audit`). O Dependabot propõe atualizações toda
  semana.
  - Uma vulnerabilidade do `@grpc/grpc-js`, trazido pelo pacote `firebase`
    mas não usado pelo app, foi corrigida forçando a versão segura
    (`overrides`).
  - Restam só avisos de severidade baixa em ferramentas de build, que não
    entram no app publicado.
- **Concorrência:** rajadas simultâneas de registros, reenvios e alterações
  não duplicam nem perdem nada (`ConcurrencyTest`).

## Limitações conhecidas

- **Login do Google sob a CSP:** os testes automáticos usam o modo local.
  Confira o login com o Google no ambiente real. Se o Firebase mudar de
  domínio, acrescente-o em `security-headers.conf` (`script-src`,
  `connect-src`, `frame-src`).
- **IndexedDB não é cifrado pelo app.** A proteção é a do sistema: bloqueio
  de tela e perfil do navegador. Em aparelho compartilhado, oriente a sair da
  conta.
- **Limite de pedidos por IP:** atrás de um proxy reverso, todos os pedidos
  podem chegar com o mesmo IP. Configure `real_ip` no nginx ou ajuste o
  limite. Só 127.0.0.1 e ::1 (quem roda dentro do próprio contêiner `web`, como os
  testes de ponta a ponta) fica fora do limite; um cliente de fora nunca
  chega com esse endereço.
- **Revogação de sessão do Firebase:** um token já emitido vale até expirar
  (1 h). Veja [`firebase.md`](firebase.md).
- **Respostas guardadas para reenvio** (`client_operation`) contêm os mesmos
  dados das respostas da API, por 30 dias, com a mesma proteção do banco.

## Pendências: decisões antes da produção

A seção 12 pede que estes pontos sejam decididos antes da produção. São
decisões de produto e jurídicas; o sistema já está preparado para
implementá-las.

1. **Exclusão de conta.** Ao sair do app de vez, o que acontece com o que a
   pessoa registrou? Proposta: anonimizar a autoria ("responsável removido")
   e manter os registros de saúde da família, porque o histórico de doses de
   uma criança não deve sumir porque um dos responsáveis saiu.
2. **Membro removido.** Hoje a remoção bloqueia o acesso e preserva a autoria.
   Manter assim ou anonimizar depois de um prazo?
3. **Retenção.** Por quanto tempo guardar o histórico de doses e saúde de um
   tratamento encerrado? Proposta: enquanto a família existir, com exclusão
   da família inteira sob pedido de um administrador.
4. **Exclusão da família.** Quem pode pedir (todos os administradores?) e com
   que prazo de arrependimento.
5. **Base legal e consentimento.** Dados de saúde de crianças (LGPD, art. 11
   e 14): consentimento específico de um responsável legal no cadastro,
   política de privacidade e encarregado (DPO).
6. **Infraestrutura de produção:**
   - certificado HTTPS;
   - onde ficam as cópias de segurança e como são cifradas
     ([`operacao.md`](operacao.md));
   - acesso administrativo ao servidor.
