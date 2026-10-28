# Firebase Authentication

O login fica a cargo do **Firebase Authentication** (Google). O app Android
faz o login no Firebase e envia à API o **ID token** recebido. A API não
guarda senhas: ela apenas confere o token.

```mermaid
sequenceDiagram
    participant App as App Android
    participant FB as Firebase Authentication
    participant API as API Remédios
    participant G as Chaves públicas do Google
    App->>FB: login (Google ou e-mail e senha)
    FB-->>App: ID token (JWT, válido por 1 h)
    App->>API: Authorization: Bearer <ID token>
    API->>G: baixa as chaves (com cache e renovação automática)
    API->>API: confere assinatura, emissor, audiência e validade
    API-->>App: resposta (conta local criada no 1º acesso)
```

## O que a API verifica

| Verificação | Valor esperado |
| --- | --- |
| Assinatura | RS256, com as chaves de `securetoken@system.gserviceaccount.com` |
| Emissor (`iss`) | `https://securetoken.google.com/<FIREBASE_PROJECT_ID>` |
| Audiência (`aud`) | `<FIREBASE_PROJECT_ID>` |
| Validade (`exp`, `iat`) | dentro do prazo |
| Usuário (`sub`) | UID do Firebase → `app_user.auth_subject` |

Tokens de outro projeto Firebase, vencidos ou com assinatura inválida recebem
`401`. Em produção, a API **não sobe** sem `FIREBASE_PROJECT_ID`.

O nome inicial da conta vem da claim `name`, ou de `email`, e pode ser alterado
em `PUT /api/me`.

## Configurando o projeto no Firebase

1. Acesse <https://console.firebase.google.com> e crie um projeto (por exemplo,
   `remedios-familia`). O Google Analytics é opcional.
2. Em **Authentication → Método de login**, ative os provedores desejados:
   - **Google**: o mais simples no Android;
   - **E-mail/senha**: para quem não quer usar conta Google.
3. Em **Configurações do projeto → Geral**, copie o **ID do projeto**.
4. Coloque-o no `.env` da raiz:

   ```bash
   FIREBASE_PROJECT_ID=remedios-familia
   ```

5. Suba o ambiente: `docker compose up -d --build`. O log da API mostra
   `Autenticação via Firebase: emissor …, audiência remedios-familia`.

A API não precisa de credencial de serviço nem de arquivo JSON do Firebase:
as chaves usadas na verificação são públicas.

## No app Android (Fase 2 em diante)

1. No console, em **Configurações do projeto → Seus apps**, adicione um app
   Android com o pacote do aplicativo e a impressão digital SHA-1 da chave de
   assinatura. O login com Google exige a SHA-1.
2. Baixe o `google-services.json` para `android/app/`. Ele identifica o
   projeto, não é segredo, mas convém não publicá-lo em repositório aberto.
3. Use o Firebase Authentication SDK e, para cada chamada à API, obtenha o
   token com `FirebaseAuth.getInstance().currentUser?.getIdToken(false)`. O SDK
   renova o token automaticamente antes de vencer.

## Desenvolvimento sem Firebase

Para usar a API localmente sem um projeto real, há o **modo local**. A API
aceita tokens no formato do Firebase assinados com a chave de **teste** do
repositório.

```bash
# .env
FIREBASE_PROJECT_ID=remedios-local
REMEDIOS_JWT_PUBLICKEY_LOCATION=/run/keys/test-public.pem
```

```bash
docker compose up -d --build
TOKEN=$(scripts/token-local.sh ana "Ana")
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/me
```

Nesse modo, a API registra um aviso no log ao subir. **Nunca use em produção:**
a chave privada de teste está no repositório, e qualquer pessoa poderia gerar
tokens. Os testes automatizados e o CI usam esse mesmo formato de token.

## Limitações conhecidas

- **Revogação:** um ID token continua válido até expirar (no máximo 1 hora),
  mesmo depois de a sessão ser revogada no Firebase. Detectar a revogação na
  hora exige a Admin SDK com credencial de serviço. A remoção de um membro da
  família, porém, vale imediatamente, porque o acesso à família é conferido no
  banco a cada requisição. A revogação de dispositivos (seção 12) fica para a
  Fase 5.
- **Privacidade (LGPD):** o Google processa apenas os dados de identidade
  (nome, e-mail, foto). Dados de saúde (pessoas, tratamentos, doses) ficam só
  no nosso PostgreSQL.
