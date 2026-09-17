# Requisitos

## Para rodar/editar o frontend

- HTML/CSS/JS puro, sem bundler — o CSS do Tailwind é pré-compilado (não roda mais via CDN no
  navegador) e o arquivo gerado (`frontend/css/tailwind.css`) **já vai commitado no repositório**,
  então só visualizar o site (`npx serve frontend`, Live Server, etc.) funciona sem instalar
  nada — veja a seção 7 de [SETUP.md](SETUP.md). `npm install` na raiz só é necessário se for
  **editar** classes Tailwind/`tailwind.config.js` ou otimizar imagens: instala o Tailwind CLI e
  o `sharp`, e já regenera o CSS (via `postinstall`). Depois de editar, rode `npm run build:css`
  (ou `npm run watch:css` para recompilar a cada salvamento) e commite o CSS atualizado junto —
  o CI também regenera antes do deploy, como uma segunda camada de segurança.
- As páginas usam `<script type="module">`, então precisam ser servidas por HTTP (não abra
  os `.html` direto com `file://`).
- Firebase Web SDK é carregado via CDN (`gstatic.com`) diretamente nos módulos JS — não há
  dependência local para instalar.
- Navegador com suporte a ES Modules e `<script type="module">` (qualquer navegador atual).

## Para rodar os scripts administrativos (`backend/scripts/`)

- **Node.js** (qualquer versão atual com suporte a `require`/CommonJS — os scripts usam
  `firebase-admin`, sem sintaxe recente de linguagem).
- Dependências: `cd backend/scripts && npm install` (instala `firebase-admin`, declarado em
  `backend/scripts/package.json`).
- **Credencial de serviço**: `backend/scripts/service-account.json`, baixada em
  Console Firebase → Configurações do projeto → Contas de serviço → Gerar nova chave privada.
  **Nunca** commitar esse arquivo (já está no `.gitignore`).

## Para publicar (deploy)

- **Firebase CLI**: `npm install -g firebase-tools`.
- Uma conta com acesso de **Editor/Owner** no projeto Firebase (`shinetal-cda20`, ver
  `.firebaserc`), para `firebase login` e `firebase deploy`.
- Deploy automático via GitHub Actions (`.github/workflows/`) precisa dos secrets
  `FIREBASE_SERVICE_ACCOUNT_SHINETAL_CDA20` e `GITHUB_TOKEN` configurados no repositório.

## Serviços do Firebase usados (todos no plano gratuito Spark)

- Firebase Authentication (e-mail/senha)
- Firestore (banco de dados)
- Firebase Hosting

Nenhuma Cloud Function, nenhum Firebase Storage e nenhum plano Blaze são necessários — ver
detalhes e custos em [SETUP.md](SETUP.md#resumo-do-que-é-gratuito-aqui).
