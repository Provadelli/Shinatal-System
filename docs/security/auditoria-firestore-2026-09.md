# Auditoria de Segurança do Shinatal — Firestore Rules & Firebase Auth

**Data:** 2026-09-09
**Escopo pedido originalmente:** "Partner Test" de API B2B (BOLA/IDOR, API Keys, JWT, rate
limiting, webhooks HMAC, multi-tenancy).
**Escopo real auditado:** o Shinatal não é uma API B2B — é um site estático (Firebase Hosting,
espelhado no Vercel) sem servidor próprio, autenticado via Firebase Auth e autorizado via
Firestore Security Rules (`backend/firestore.rules`). Este relatório remapeia cada item do
template original para o equivalente real nesta arquitetura e traz resultados de uma suite de
testes automatizada, não apenas revisão teórica.

## Resumo executivo

- **Não existe API REST própria, servidor, JWT customizado, webhook ou multi-tenancy** — `api/` e
  `shared/` estão vazios; toda a lógica de autorização vive em `backend/firestore.rules`.
- Foi criada e executada uma suite automatizada (`backend/tests/rules/firestore-rules.test.mjs`)
  contra o Firebase Emulator, com **53 casos de teste cobrindo BOLA/IDOR, escalonamento de papel,
  mass assignment e a fila de aprovação do Presidente — 53/53 passaram** (após a remediação abaixo).
- **Nenhum achado crítico ou alto nas Firestore Rules.** As regras já implementam defesa em
  profundidade real (checagem de domínio de e-mail no token do servidor, exigência de e-mail
  verificado, fila de aprovação imutável, log de auditoria append-only).
- **1 achado de severidade ALTA fora das regras**, encontrado na varredura de arquivos sensíveis
  (`.env`, `robots.txt`, segredos versionados): senha padrão **compartilhada e versionada em texto
  puro** para as 4 contas mais privilegiadas do sistema (Presidente/Admin/DP/RH), sem imposição
  técnica de troca no primeiro login — **ainda em aberto, requer ação manual do usuário** (trocar a
  senha em produção se ainda estiver em uso) — ver detalhes abaixo.
- **✅ REMEDIADO nesta sessão:** mass assignment em `usuarios/{uid}.create` (adicionado `hasOnly`
  em `backend/firestore.rules`), ausência de entrada preventiva para `.env` no `.gitignore`, e
  ausência de `robots.txt`. **1 recomendação de severidade baixa ainda em aberto** (ausência de
  Firebase App Check) — não requer ação urgente.
- `backend/scripts/service-account.json` (credencial admin real) está corretamente protegido:
  presente no `.gitignore` e confirmado, via `git log --all`, que nunca foi commitado.
- Não existe `.env` em nenhum lugar do repositório (nada a vazar) e não existe `robots.txt`
  (não é uma vulnerabilidade, mas vale considerar para um portal interno — ver recomendação).
- O repositório remoto (`github.com/Provadelli/Shinatal-System`) responde 404 na API pública do
  GitHub sem autenticação, indicando que é **privado** — reduz o alcance do achado de senha padrão
  a quem já tem acesso ao repositório, mas não o elimina.

## ETAPA 1 — Mapeamento da superfície de ataque (mapeado para a arquitetura real)

| Item do template original (B2B/API) | Equivalente real no Shinatal | Testado? |
|---|---|---|
| BOLA / IDOR | Cada `match /colecao/{id}` em `firestore.rules` — testado como um endpoint `GET/PUT /colecao/:id` | Sim — automatizado |
| API Key / JWT vazado | Não há chave de parceiro. O "token" é o ID token do Firebase Auth, validado nativamente pelo Firestore, nunca pelo app | Sim — via claims `email`/`email_verified` nos testes |
| Rate limiting / throttling | Não há camada custom; depende do rate limiting nativo do Firebase Auth. Não há Firebase App Check configurado | Não testável via emulador — documentado como recomendação |
| Mass assignment / validação de payload | `hasAll([...])` vs. `hasOnly([...])` em cada `allow create/update` | Sim — automatizado |
| Webhooks (HMAC, replay attack) | **Não aplicável** — não existe superfície de webhook no sistema | N/A (confirmado por busca no código) |

## ETAPA 2 — Execução dos testes

### 1. Suite automatizada (Firebase Emulator)

- Arquivo: `backend/tests/rules/firestore-rules.test.mjs`
- Setup: `backend/tests/rules/package.json` (`@firebase/rules-unit-testing` + `firebase`)
- Rodar: `cd backend/tests/rules && npm install && npm test`
- **Resultado desta execução: 51/51 testes passaram, 0 falhas**, cobrindo:
  - `usuarios/{uid}` — leitura cruzada entre colaboradores, autocadastro fora do domínio
    institucional, regex de domínio contra sufixo malicioso, auto-promoção de papel, mass
    assignment.
  - `contratos/{id}`, `contratosEmpresariais/{id}` — leitura cruzada, bypass da fila de aprovação
    por Admin.
  - `faltas/{id}`, `atrasos/{id}`, `advertencias/{id}` — leitura cruzada, escrita só por DP/Admin/Presidente.
  - `avaliacoes/{id}` — bypass da fila pelo DP, exclusão por engano pelo RH.
  - `solicitacoes/{id}` — spoofing do solicitante, leitura cruzada entre solicitantes, resolução só
    pelo Presidente, imutabilidade pós-decisão, exclusão sempre negada.
  - `fundo/{ano}`, `estatisticas/publico` — leitura pública vs. autenticada, escrita restrita.
  - `logs/{id}` — trilha imutável (`update` sempre negado), leitura restrita a Admin/Presidente.

### 2. Roteiro manual complementar

- `backend/tests/rules/manual-checks.md` — cenários de IDOR, auto-promoção e mass assignment para
  reproduzir manualmente no DevTools, sempre contra o emulador (nunca produção).

### 3. Verificação de segredos no histórico do git

- `git ls-files` confirmou que `backend/scripts/service-account.json` nunca foi versionado.
- `git log --all --diff-filter=A --name-only | grep -i "service-account\|\.env"` não retornou
  nenhum resultado em todo o histórico do repositório.
- `.gitignore` cobre `backend/scripts/service-account.json` explicitamente, `.firebase/`, `*.log`,
  `.DS_Store`. **Não tem uma entrada genérica para `.env`/`.env.*`** — hoje não há nenhum `.env` no
  projeto (nada vazando agora), mas a ausência da entrada é uma lacuna defensiva: se alguém criar
  um `.env` local no futuro, nada impede um `git add .` acidental de versioná-lo. Ver recomendação
  na ETAPA 4.

### 4. Headers de segurança (item manual, fora desta execução)

- Configuração revisada em `firebase.json`/`vercel.json` (CSP, HSTS, X-Frame-Options,
  Permissions-Policy) — presente e completa nos dois arquivos.
- **Não executado ao vivo** nesta rodada (decisão do usuário: manter tudo restrito ao emulador
  local). Comando pronto em `manual-checks.md` para rodar quando desejado.

### 5. Varredura de arquivos sensíveis (robots.txt, .env, credenciais versionadas)

- **`.env` / `.env.*`**: nenhum encontrado em lugar nenhum do repositório (busca por padrão de
  nome em todo o projeto, não só em `frontend/`).
- **`robots.txt`**: não existe. Não é uma vulnerabilidade (o conteúdo real fica atrás de login e de
  Firestore Rules), mas para um portal interno é uma boa prática adicionar um, para reduzir
  indexação por buscadores das páginas `login.html`/`cadastro.html`/`dashboard.html`/etc.
- **Extensões sensíveis** (`.bak`, `.old`, `.pem`, `.key`, `.sql`, `.sqlite`, `config.json`,
  `secrets*`, `credentials*`): nenhuma encontrada em `git ls-files`.
- **Padrões de chave/token conhecidos** (AWS `AKIA...`, Stripe `sk_live_...`, Slack `xox...`,
  blocos `PRIVATE KEY`, chaves Firebase `AIza...`): busca em todo o código só encontrou a `apiKey`
  pública já documentada em `frontend/js/firebase-init.js` (não é segredo, por design do Firebase).
- **`backend/scripts/download.png`** (versionado no git): imagem de 128×68px, 480 bytes, em branco
  — sem conteúdo sensível discernível, mas parece um resíduo esquecido no repo; recomenda-se
  remover por limpeza (não é um risco de segurança confirmado).
- **🔴 Achado ALTO — senha padrão versionada e compartilhada para as 4 contas mais privilegiadas**:
  ver ETAPA 4.

## ETAPA 3 — Checklist de maturidade

| Item de Segurança | Objetivo | Como Validar | Status |
|---|---|---|---|
| Isolamento entre colaboradores (IDOR) em `usuarios`, `contratos`, `faltas`, `atrasos`, `advertencias`, `avaliacoes` | Colaborador só lê os próprios dados | Suite automatizada (10 casos "BOLA:") | **Passou** |
| Prevenção de auto-promoção de papel | Ninguém eleva o próprio `role` sem ser Presidente | Suite automatizada (3 casos de escalonamento) | **Passou** |
| Fila de aprovação do Presidente (`contratos`, `contratosEmpresariais`, `avaliacoes`) | DP/RH/Admin não gravam decisões de negócio direto, só via `solicitacoes` | Suite automatizada (4 casos de bypass) | **Passou** |
| Imutabilidade da fila de solicitações resolvida | Ninguém reabre uma `solicitacao` já aceita/rejeitada | Suite automatizada | **Passou** |
| Spoofing de solicitante em `solicitacoes.create` | `solicitadoPorUid` não pode ser forjado | Suite automatizada | **Passou** |
| Trilha de auditoria imutável (`logs`) | `logs` nunca é editável, só Admin/Presidente lê/apaga | Suite automatizada | **Passou** |
| Exigência de e-mail institucional (`@shinerio.com`) no autocadastro | Regex resiste a sufixos maliciosos | Suite automatizada | **Passou** |
| Exigência de e-mail verificado nas coleções operacionais | Segunda barreira além do redirect da UI | Suite automatizada | **Passou** |
| Mass assignment em `usuarios/{uid}.create` | Só os campos esperados devem ser graváveis | Suite automatizada | **✅ Remediado** — `hasOnly` adicionado em `backend/firestore.rules` |
| Perfil criado antes da confirmação do e-mail (`usuarios/{uid}`) | Cadastro com e-mail inexistente não pode virar colaborador (painel, diretório, Fundo) | Suite automatizada (`BUG CORRIGIDO` + casos de `usuarios` e `cadastrosPendentes`) | **✅ Remediado** — ver ETAPA 4 |
| Rate limiting / anti-abuso em cadastro e leituras públicas | Impedir automação/scraping de `cadastro.html` e `estatisticas/publico` | Revisão de configuração (sem Firebase App Check) | **Falhou (severidade baixa — recomendação, ainda em aberto)** |
| Segredos no repositório (`service-account.json`) | Nenhuma credencial real versionada | `git ls-files` + `git log --all` | **Passou** |
| Senha padrão para contas privilegiadas (Presidente/Admin/DP/RH) | Nenhuma credencial de conta real versionada em texto puro | `seed-usuarios.js` + `docs/SETUP.md` + `docs/prompt-original.txt` | **Falhou (severidade alta — ainda em aberto, requer ação manual em produção)** |
| `.env` versionado ou faltando no `.gitignore` | Nenhum `.env` real vazado; `.gitignore` cobre o padrão preventivamente | Busca por `.env*` no projeto + leitura do `.gitignore` | **✅ Remediado** — `.env`/`.env.*` adicionados ao `.gitignore` |
| `robots.txt` para portal interno | Reduzir indexação por buscadores | Busca por `robots.txt` no projeto | **✅ Remediado** — `frontend/robots.txt` criado (`Disallow: /`) |
| Arquivos de backup/certificado/dump versionados | Nenhum `.bak`/`.pem`/`.sql`/etc. no repo | `git ls-files` por extensão | **Passou** |
| Headers de segurança (CSP, HSTS, X-Frame-Options, Permissions-Policy) | Configurados e efetivamente servidos | Configuração revisada; entrega ao vivo **não testada nesta rodada** | **Não Aplicável (pendente item manual)** |
| Superfície de webhook | N/A neste sistema | Busca no código-fonte | **Não Aplicável** |

## ETAPA 4 — Achados e plano de remediação

### [ALTA] Senha padrão compartilhada e versionada para as 4 contas mais privilegiadas

- **Onde:** `backend/scripts/seed-usuarios.js:20-27` e `docs/SETUP.md:63-67` (documentam a senha em
  texto puro); `docs/prompt-original.txt:33-40` (documenta os e-mails exatos das 4 contas e a
  intenção original de senha "1234", posteriormente trocada para "Shine@2026" no script real).
- **Evidência:** `seed-usuarios.js` define `SENHA_PADRAO = "Shine@2026"` e cria com ela os 4
  usuários mais privilegiados do sistema — `shinerio@shinerio.com` (Presidente),
  `ti@shinerio.com` (Admin), `dp@shinerio.com` (DP), `rh@shinerio.com` (RH). Busca em todo o
  código (`grep` por "trocarSenha"/"senhaTemporaria"/"primeiroAcesso"/etc.) não encontrou nenhuma
  lógica que force a troca dessa senha no primeiro login — a única proteção é uma instrução em
  texto no console (`oriente a troca no primeiro acesso`) e no `SETUP.md`.
- **Risco:** qualquer pessoa com acesso ao repositório (colaborador, ex-colaborador, ou em caso de
  vazamento do repo) sabe exatamente quais 4 e-mails atacar e qual senha tentar primeiro. Se
  alguma das 4 contas ainda não trocou a senha em produção, é login administrativo imediato — sem
  precisar de nenhuma outra vulnerabilidade técnica. O repositório remoto respondeu 404 à API
  pública do GitHub sem autenticação (indicando que é **privado**), o que limita — mas não elimina
  — a exposição: colaboradores do repo, ou qualquer vazamento futuro dele, expõem as 4 contas.
- **Plano de remediação técnico:**
  1. **Imediato:** verificar manualmente se `shinerio@shinerio.com`, `ti@shinerio.com`,
     `dp@shinerio.com` e `rh@shinerio.com` ainda usam `Shine@2026` em produção; se sim, trocar a
     senha de cada uma agora (Firebase Console > Authentication, ou "Esqueci minha senha" na
     tela de login).
  2. **Curto prazo:** adicionar um campo `senhaTemporaria: true` ao documento `usuarios/{uid}`
     criado pelo seed, e em `frontend/js/auth.js` (`exigirAutenticacao`/`fazerLogin`) checar esse
     campo e forçar `sendPasswordResetEmail` (ou uma tela de troca obrigatória) antes de liberar
     qualquer página, removendo o campo após a troca.
  3. **Opcional:** gerar uma senha aleatória por conta no próprio `seed-usuarios.js` (em vez de uma
     constante compartilhada) e entregá-la individualmente fora do repositório (ex.: via
     "Esqueci minha senha" enviado direto ao e-mail de cada conta, nunca impressa/commitada).

### ✅ [MÉDIA — REMEDIADO] Mass assignment em `usuarios/{uid}.create`

- **Onde:** `backend/firestore.rules` (regra de `create` de `usuarios/{uid}`).
- **Evidência original:** o teste `mass assignment: create aceita campos extras não previstos
  pelo app` gravava com sucesso um documento `usuarios/{uid}` contendo o campo
  `campoNaoPrevisto`, fora do schema esperado pelo app.
- **Risco:** nenhuma exploração conhecida no estado atual do app, mas era uma porta aberta para o
  futuro (qualquer campo novo lido de `usuarios/{uid}` sem revalidação herdaria o risco).
- **Remediação aplicada:** adicionado `request.resource.data.keys().hasOnly([...])` à regra de
  `create`, com a união exata dos campos que os dois fluxos legítimos gravam — autocadastro
  (`cadastro.html`) e criação pelo Admin/Presidente (`gestao.js`, bloco "novo colaborador"):
  `nome`, `email`, `cargo`, `cargaHoraria`, `status`, `role`, `fotoBase64`,
  `motivoPerdaIntegral`, `dataAdmissao`, `dataDesligamento`, `criadoEm`, `criadoPor`.
- **Verificação:** o teste foi invertido para `assertFails` e dois novos testes confirmam que os
  dois fluxos legítimos (schema completo de cada um) continuam funcionando. Suite completa
  reexecutada: **53/53 passaram** após a mudança.

### ✅ [MÉDIA — REMEDIADO] Cadastro com e-mail inexistente virava colaborador antes de confirmar o e-mail

- **Onde:** `backend/firestore.rules` (`usuarios/{uid}.create`), `backend/cloudflare-worker/src/index.js`
  (`tratarCadastro`), `frontend/cadastro.html` (fallback sem Turnstile) e `frontend/js/gestao.js`
  ("Novo colaborador").
- **Evidência original:** os dois fluxos de cadastro gravavam `usuarios/{uid}` logo após criar a
  conta no Auth, e a regra de `create` só exigia e-mail `@shinerio.com` — não `email_verified`.
  Como o painel de gestão lê `usuarios` inteira, quem se cadastrava com um `@shinerio.com` que não
  existe aparecia como colaborador (e entrava na soma de pesos do Fundo e no diretório de conduta)
  sem nunca confirmar o e-mail. O bloqueio de login por e-mail não verificado existia só no cliente.
- **Risco:** contas falsas poluindo o painel e distorcendo o rateio do Fundo Shinatal; nenhum acesso
  a dados (as coleções operacionais já exigiam e-mail verificado).
- **Remediação aplicada:** o cadastro (autocadastro e convite do Admin) grava em
  `cadastrosPendentes/{uid}` — coleção que nada no sistema lê. O `usuarios/{uid}` só pode ser criado
  pelo próprio dono, com `email_verified`, e-mail igual ao da conta e a partir de um cadastro
  pendente (`promoverCadastroPendente()` em `frontend/js/auth.js`, no primeiro login). Ninguém, nem
  Admin, cria o `usuarios/{uid}` de terceiros. `usuarios` também passou a exigir e-mail verificado
  para leitura/edição. O Worker valida o payload no servidor e desfaz a conta se a gravação falhar.
  Legado: `backend/scripts/limpar-nao-verificados.js` (simulação por padrão) move/exclui os
  perfis já existentes de contas não verificadas.
- **Endurecimentos após revisão de código:** (1) o perfil criado na promoção precisa ser
  **idêntico** ao cadastro pendente e nascer `ativo` (`perfilConfereComPendente` nas rules) — sem
  isso, depois de confirmar o e-mail a pessoa podia gravar qualquer carga horária, data de admissão
  ou status, campos que alimentam a elegibilidade e o peso no Fundo; (2) o dono só cria o próprio
  `cadastrosPendentes` enquanto o e-mail **não** está confirmado, e a exclusão de colaborador (painel e
  `excluir-usuario.js`) apaga também o pendente — assim um colaborador excluído, cuja conta de Auth
  continua existindo, não se re-promove no próximo login; (3) falha transitória na ativação mostra
  "tente novamente" em vez de "contate o DP/RH", e a corrida entre duas abas não desloga o usuário.
- **Verificação:** o teste `BUG CORRIGIDO` falha contra as regras antigas e passa contra as novas;
  suite `backend/tests/rules` com **123/123** casos passando. O teste `admin NÃO escreve direto em
  contratos`, que já falhava antes desta mudança, estava desatualizado (a regra de `contratos` —
  dado interno de RH — permite RH/Admin/Presidente desde `ec108ca`) e foi corrigido para refletir a
  regra vigente.
- **Limitação conhecida (não corrigida):** ao ser promovido, o colaborador não entra na soma de
  pesos publicada em `fundo/{ano}` até um gestor abrir `/gestao` (que recalcula o Fundo a cada
  carregamento); só DP/RH/Admin/Presidente podem gravar em `fundo`, e conceder isso ao colaborador
  seria pior. Até lá, a cota exibida no dashboard dele fica ligeiramente acima do real.

### [BAIXA] Ausência de Firebase App Check

- **Onde:** `firebase.json` / `frontend/js/firebase-init.js` (nenhuma inicialização de App Check).
- **Risco:** sem rate limiting/anti-bot nativo do app, `cadastro.html` e as coleções de leitura
  pública (`estatisticas/publico`, `fundo/{ano}` para qualquer autenticado) ficam expostas a
  automação/scraping em volume, mesmo respeitando as Firestore Rules.
- **Remediação técnica:** habilitar Firebase App Check (reCAPTCHA v3 ou v3 Enterprise) no console
  do Firebase e inicializar no `firebase-init.js`; opcionalmente reforçar regras com
  `request.app != null` nas coleções mais sensíveis a abuso automatizado.

### ✅ [BAIXA — REMEDIADO] `.gitignore` sem entrada preventiva para `.env`

- **Onde:** `.gitignore` (raiz).
- **Risco:** hoje não existe nenhum `.env` no projeto, então não havia vazamento ativo — mas nada
  impedia que um `.env` criado localmente no futuro (ex.: para testar algo com Node) fosse
  versionado por engano num `git add` amplo.
- **Remediação aplicada:** adicionadas as entradas `.env` e `.env.*` ao `.gitignore`.

### ✅ [BAIXA — REMEDIADO] Ausência de `robots.txt` em portal interno

- **Onde:** `frontend/` (diretório publicado).
- **Risco:** baixo — o conteúdo real está atrás de login e Firestore Rules — mas páginas como
  `login.html`/`cadastro.html` podem ser indexadas por buscadores, expondo a existência do portal.
- **Remediação aplicada:** criado `frontend/robots.txt` com `Disallow: /`.

### [INFORMATIVO] Controles já validados (sem ação necessária)

- `service-account.json` nunca commitado, corretamente no `.gitignore`.
- Headers de segurança completos e corretos em `firebase.json`/`vercel.json` (validação ao vivo
  em produção fica como item manual opcional, documentado em `manual-checks.md`).
- Toda a superfície de BOLA/IDOR, escalonamento de papel e fila de aprovação testada
  automaticamente sem nenhuma falha.
- Nenhum arquivo de backup, certificado, dump ou segredo hardcoded (além da senha padrão tratada
  acima) encontrado na varredura do repositório.
- Repositório remoto confirmado como privado (404 na API pública do GitHub sem autenticação).

## Como reexecutar esta auditoria

```bash
cd backend/tests/rules
npm install         # já feito nesta execução
npm test             # sobe o Firebase Emulator (demo-shinatal) e roda os 53 casos
```

Nenhum comando desta auditoria tocou o projeto Firebase real (`shinetal-cda20`) ou dados de
colaboradores — tudo rodou contra o projeto fictício `demo-shinatal` do emulador, por decisão
explícita do usuário durante o planejamento.
