# Shinatal — Guia de configuração (100% gratuito, plano Spark)

Este projeto é um site estático (HTML/CSS/JS puro, sem build step) que usa apenas
**Firebase Authentication** e **Firestore** — ambos com uso normal dentro do plano
gratuito (Spark) do Firebase. Não é necessário cartão de crédito nem plano Blaze.

## 1. Criar o projeto Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google
.com) e clique em
   **"Criar projeto"**. Dê um nome, ex: `shinatal-shinerio`.
2. Você pode desativar o Google Analytics (opcional, não é usado aqui).
3. Dentro do projeto, clique no ícone **`</>`** ("Web") para registrar um app web.
   Dê um apelido (ex: "Shinatal Web") e **não** marque Firebase Hosting ainda (fazemos isso no passo 6).
4. O console vai mostrar um objeto `firebaseConfig`. Copie os valores.

## 2. Colar as credenciais no projeto

Abra `frontend/js/firebase-init.js` e substitua os valores `"SUBSTITUA_AQUI"` pelos valores
reais copiados no passo anterior (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
`messagingSenderId`, `appId`).

> Esses valores são **públicos por design** do Firebase (todo app web os expõe). A
> segurança de verdade vem do Firebase Authentication e das regras em `firestore.rules`.

## 3. Ativar o Authentication

No console: **Build > Authentication > Get started > Sign-in method** → ative o provedor
**"E-mail/senha"**.

### Personalizar o e-mail de redefinição de senha (opcional, recomendado)
Em **Authentication > Templates > Password reset**, edite o remetente/assunto para algo como
"Shinatal — Shine Rio" para o e-mail chegar reconhecível aos colaboradores.

## 4. Ativar o Firestore

**Build > Firestore Database > Create database** → escolha uma região próxima (ex:
`southamerica-east1` – São Paulo) → inicie em modo de produção (as regras deste projeto
já cobrem a segurança).

## 5. Publicar as regras de segurança

Com o [Firebase CLI](https://firebase.google.com/docs/cli) instalado (`npm install -g
firebase-tools`):

```bash
firebase login
# edite .firebaserc e troque SUBSTITUA_PELO_ID_DO_SEU_PROJETO pelo Project ID do console
firebase deploy --only firestore:rules
```

## 6. Criar os 4 usuários especiais (Presidente / Admin / DP / RH)

1. No console: **Configurações do projeto > Contas de serviço > Gerar nova chave privada**.
   Salve o arquivo JSON baixado como `backend/scripts/service-account.json`
   (**nunca** suba esse arquivo ao GitHub — já está no `.gitignore`).
2. No terminal:
   ```bash
   cd backend/scripts
   npm install
   npm run seed
   ```
3. Isso cria, com senha padrão **Shine@2026**:
   - `shinerio@shinerio.com` (Presidente — acima do Admin, aprova solicitações)
   - `ti@shinerio.com` (Admin — acesso total, sem aprovação)
   - `dp@shinerio.com` (Departamento Pessoal)
   - `rh@shinerio.com` (Recursos Humanos)

   Oriente cada um a trocar a senha assim que possível, usando "Esqueci minha senha" na
   tela de login. **Atenção:** rodar `npm run seed` de novo reescreve `dataAdmissao`/`status`/
   `cargo` dessas 4 contas (usa `merge` com o payload completo) — se alguma já estiver em uso
   com dados próprios editados, ajuste o script antes de rodar de novo, ou crie manualmente
   só a conta que falta.

## 7. Rodar localmente

Como as páginas usam `<script type="module">`, é preciso servir os arquivos por HTTP (abrir
o `index.html` direto com `file://` não funciona por causa da política de módulos ES).
Sirva a pasta `frontend/` (é ela que vira o site), por exemplo:

```bash
npx serve frontend
# ou
python -m http.server 5500 --directory frontend
```

Depois acesse `http://localhost:5500` (ou a porta indicada).

## 8. Publicar (Firebase Hosting, opcional e também gratuito)

O `firebase.json` (na raiz do repositório) já está configurado com `"public": "frontend"` e a
página inicial é `index.html` (landing page pública — a tela de login fica em `login.html`).
Rode o deploy a partir da raiz do repositório:

```bash
firebase deploy --only hosting
```

> Não rode `firebase init hosting` de novo por cima deste projeto — ele pode sobrescrever o
> `firebase.json` e voltar a apontar para a raiz do repositório em vez de `frontend/` (era o
> que estava acontecendo antes: o site publicado ficava só com a página padrão do Firebase).
> Tudo que fica em `backend/` (regras, scripts, `service-account.json`) já está fora de
> `frontend/`, então nunca é publicado — não depende mais de uma lista de exclusão.

## Resumo do que é gratuito aqui

| Recurso                              | Uso no Shinatal                                | Custo   |
|---------------------------------------|------------------------------------------------|---------|
| Firebase Authentication               | Login, cadastro, link de redefinição de senha   | Grátis  |
| Firestore                             | Usuários, faltas, atrasos, advertências, fundo  | Grátis  |
| Firebase Hosting (opcional)           | Publicar o site                                 | Grátis  |
| Foto do colaborador                   | Base64 dentro do Firestore (sem Storage)        | Grátis  |

Nenhuma Cloud Function, nenhum Firebase Storage e nenhum plano Blaze são necessários.
