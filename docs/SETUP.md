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

O CSS do Tailwind já vem pré-compilado e commitado (`frontend/css/tailwind.css`), então só para
visualizar o site **não precisa instalar nada** — pule direto para o bloco `npx serve` abaixo.

`npm install` na raiz só é necessário se for **editar** classes Tailwind, `tailwind.config.js`,
ou rodar o script de otimização de imagens:

```bash
npm install
```

Isso instala o Tailwind CLI e o `sharp`. Depois de editar, rode `npm run build:css` (ou `npm run
watch:css` para recompilar a cada salvamento) e **commite o `tailwind.css` atualizado junto** —
sem isso, quem não rodar `npm install` continua vendo a versão antiga do CSS.

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

## 9. Configurar Cloudflare Turnstile (anti-bot em cadastro, login e recuperação de senha)

O Shinatal usa o [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) (o
"CAPTCHA" da Cloudflare) para reduzir automação/bots nos três formulários públicos. Como o
site não tem servidor próprio, a verificação de verdade roda num **Cloudflare Worker**
separado (`backend/cloudflare-worker/`) — sem ele, os formulários continuam funcionando
normalmente, só sem a proteção (fallback automático, ver `frontend/js/turnstile-config.js`).

### 9.1. Criar o widget no painel da Cloudflare

1. Acesse [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile** → **Add widget**.
2. Domínio: adicione o(s) domínio(s) de produção (ex.: `shinetal-cda20.web.app`,
   `shinetal-cda20.firebaseapp.com`, e/ou seu domínio na Vercel) — e também `localhost` se
   for testar localmente.
3. Modo: **Managed** (recomendado).
4. Copie a **Site Key** (pública) e a **Secret Key** (nunca cole em código nem no chat — só vai
   no Worker, no passo 9.3).

### 9.2. Publicar o Cloudflare Worker

```bash
cd backend/cloudflare-worker
npm install
npx wrangler login          # abre o navegador para autenticar com a SUA conta Cloudflare
```

Antes do deploy, edite `wrangler.toml`:
- `ALLOWED_ORIGINS`: troque pelos domínios reais de produção (e mantenha os `localhost` para
  testar localmente) — sem o domínio certo aqui, o navegador bloqueia a resposta por CORS.
- `FIREBASE_PROJECT_ID`/`FIREBASE_API_KEY`: já vêm preenchidos com os valores públicos deste
  projeto; só troque se você criou um projeto Firebase próprio no passo 1.

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY   # cole a Secret Key do passo 9.1 quando pedido
npx wrangler deploy
```

O comando final imprime a URL do Worker publicado (algo como
`https://shinatal-turnstile.SEU-SUBDOMINIO.workers.dev`).

### 9.3. Ligar o front-end ao widget e ao Worker

Abra `frontend/js/turnstile-config.js` e substitua os dois placeholders:

```js
export const TURNSTILE_SITE_KEY = "a Site Key copiada no passo 9.1";
export const TURNSTILE_WORKER_URL = "a URL impressa pelo wrangler deploy no passo 9.2";
```

Pronto — os três formulários (cadastro, login, recuperar senha) passam a exigir o Turnstile
automaticamente (`TURNSTILE_CONFIGURADO` vira `true`). Sem editar este arquivo, o site
continua funcionando exatamente como antes (sem a proteção).

> **Importante sobre o alcance real desta proteção:** no **cadastro**, o Worker é quem cria a
> conta (Firebase Auth + perfil no Firestore) — só chama o Firebase depois de validar o
> Turnstile, então essa é uma barreira de verdade. Já no **login** e na **recuperação de
> senha**, o Worker só verifica o token *antes* do navegador chamar o Firebase Auth
> diretamente — é uma barreira eficaz contra bots simples, mas não é uma garantia
> criptográfica, porque esses dois são endpoints públicos do Firebase Auth que continuam
> alcançáveis diretamente (o plano gratuito Spark não tem Cloud Functions/Blocking Functions
> para fechar essa brecha no servidor). Ver comentários em `login.html` e
> `recuperar-senha.html`.

## Resumo do que é gratuito aqui

| Recurso                              | Uso no Shinatal                                | Custo   |
|---------------------------------------|------------------------------------------------|---------|
| Firebase Authentication               | Login, cadastro, link de redefinição de senha   | Grátis  |
| Firestore                             | Usuários, faltas, atrasos, advertências, fundo  | Grátis  |
| Firebase Hosting (opcional)           | Publicar o site                                 | Grátis  |
| Foto do colaborador                   | Base64 dentro do Firestore (sem Storage)        | Grátis  |
| Cloudflare Turnstile + Worker (opcional) | Anti-bot em cadastro/login/recuperar senha   | Grátis  |

Nenhuma Cloud Function, nenhum Firebase Storage e nenhum plano Blaze são necessários.
