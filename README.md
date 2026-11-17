# Shinatal

Portal interno do **Shinatal**, o programa de premiação de fim de ano da Shine Rio Serviços Ltda.
Colaboradores acompanham a cota estimada, o fundo arrecadado e o status dos contratos; a gestão
lança faltas, advertências, avaliações e contratos.

**Produção:** [shinatal.shinerio.com](https://shinatal.shinerio.com) (Vercel)

| | |
|---|---|
| Front-end | Página inicial em React + TypeScript (Vite); demais páginas em HTML, Tailwind e JS modular |
| Back-end | Firebase Authentication + Firestore (plano gratuito, sem servidor próprio) |
| Proteção | Firestore Security Rules, App Check (reCAPTCHA), Cloudflare Turnstile, CSP estrita |
| Qualidade | WCAG 2.2 AA — axe-core 0 violações e Lighthouse Acessibilidade 100 |

---

## Sumário

- [Estrutura do repositório](#estrutura-do-repositório)
- [Rodando localmente](#rodando-localmente)
- [Scripts](#scripts)
- [Publicação](#publicação)
- [Papéis de usuário](#papéis-de-usuário)
- [Regras de negócio](#regras-de-negócio)
- [Desempenho, acessibilidade e responsividade](#desempenho-acessibilidade-e-responsividade)
- [Documentação](#documentação)

---

## Estrutura do repositório

```
app/                Página inicial em React + TypeScript (Vite, framer-motion)
  src/components/   Seções da home (Hero, Quem somos, Sobre, Como funciona) e componentes de UI
  src/lib/          Movimento, tipografia e utilitários
frontend/           Demais páginas (login, cadastro, painéis, contratos, gestão, LGPD…)
  css/              styles.css (estilos do sistema) + tailwind-input.css → tailwind.css
  js/               Módulos por página, serviços do Firestore e o motor de cálculo
  assets/           Imagens, vídeos e fontes locais (com hash no nome)
backend/
  firestore.rules   Regras de segurança do Firestore
  cloudflare-worker/  Worker que valida o Turnstile no cadastro
  scripts/          Scripts administrativos (Admin SDK)
  tests/a11y/       Auditoria de acessibilidade, desempenho e responsividade
  tests/rules/      Testes das regras do Firestore
scripts/            Build: cabeçalho/rodapé compartilhados, fonte de ícones, imagens e vídeo
docs/               Configuração, requisitos, LGPD, acessibilidade e o regulamento interno
design/             Referências visuais (mockups) — não vai para o site
dist/               Build publicado (gerado por npm run build, fora do Git)
```

## Rodando localmente

Pré-requisitos e configuração do Firebase: **[docs/SETUP.md](docs/SETUP.md)** e
**[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)**.

```bash
npm ci            # instala e já compila o Tailwind (postinstall)
npm run dev       # servidor do Vite com recarga automática
npm run build     # gera dist/ exatamente como vai para produção
npm run preview   # serve o dist/ localmente
```

A configuração real do Firebase fica em `firebase-config.local.json` (fora do Git) e é embutida
em `frontend/js/firebase-init.js` por `npm run config:firebase`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run build` | Cabeçalho/rodapé compartilhados → Tailwind → checagem de tipos → build do Vite |
| `npm run layout` | Aplica `scripts/partials/` (cabeçalho e rodapé) em todas as páginas |
| `npm run build:css` | Compila `frontend/css/tailwind.css` |
| `npm run icones` | Regera a fonte de ícones só com os ícones usados no site — **rode ao usar um ícone novo** |
| `npm run optimize:images` | Gera as versões WebP responsivas das fotos |
| `npm run optimize:video` | Gera os vídeos do topo (vertical e horizontal) |
| `npm run config:firebase` | Codifica a configuração do Firebase em `firebase-init.js` |

## Publicação

Todo push na `main` é publicado automaticamente pela Vercel (`vercel.json`: `npm run build`,
pasta `dist/`, headers de cache e de segurança). Antes de publicar, rode a auditoria:

```bash
cd backend/tests/a11y
npm install
npm test                  # axe + teclado + larguras + Lighthouse (~6 min)
SEM_LIGHTHOUSE=1 npm test # sem Lighthouse (mais rápido)
```

A auditoria usa os emuladores do Firebase com dados de exemplo — **nunca toca produção**.

## Papéis de usuário

| Papel | Acesso |
|---|---|
| **Presidente** | Acesso total; único que grava contratos/avaliações direto; aprova ou rejeita as solicitações dos demais gestores. |
| **Admin** | Gestão completa; contratos/avaliações passam pela aprovação do Presidente. |
| **DP** (Departamento Pessoal) | Lança falta, atraso, advertência e avaliação (avaliação vai para aprovação). |
| **RH** (Recursos Humanos) | Ativa/encerra contrato e lança avaliação (ambos vão para aprovação). |
| **Colaborador** | Vê o próprio perfil, a cota estimada, o fundo, o status dos contratos e o simulador de impacto. |

## Regras de negócio

**Cálculo da premiação.** Implementa as seções do
[Regulamento Interno](docs/Regulamento_Interno_Shinatal.pdf) em
`frontend/js/calculo-shinatal.js`, isolado de I/O. É a peça mais sensível do projeto: qualquer
mudança ali precisa bater com o regulamento.

**Régua de meses dos contratos (v2, nov/2026).** Toda contagem de meses de contrato empresarial
passa por `contarMesesContabilizados`, a única referência do sistema:

- **Entrada** (início do contrato, entrada de funcionário, retomada de pausa): até o dia 14 o
  mês conta; do dia 15 em diante, conta a partir do mês seguinte.
- **Término previsto e encerramento do contrato:** o mês final sempre conta.
- **Desligamento individual** (e início de pausa): o mês só conta se a pessoa ficou até o
  último dia dele.
- O cálculo é **por lote de funcionários**: crédito antecipado (R$ 12,50/mês, até 12 meses), e
  na saída ou no encerramento cada lote passa a valer só os meses contados. Um desligamento
  nunca altera os demais.
- Nada de valor por contrato fica gravado: tudo é recalculado a partir das datas, então
  contratos antigos e novos seguem a mesma régua. A admissão de colaboradores (avos, Seção 4.1)
  continua na regra do dia 15/16 do regulamento.

Testes: `npm run test:calculo`. Migração auditável dos dados já gravados (histórico e agregados
do fundo): `backend/scripts/recalcular-regra-v2.mjs` (`--simular`, `--aplicar`, `--reverter`).

**Avaliação de Conduta (entre colegas).** Todos participam, exceto o Presidente. Cada um avalia
os colegas online com os 4 conceitos da Seção 11 (Excelente, Bom, Regular, Insatisfatório). É
**puramente social**: os votos são anônimos (só o autor lê o próprio voto — ver
`backend/firestore.rules`) e nunca entram no cálculo da cota nem do fundo. Nasce desligada; só
Admin ou Presidente liga (`configuracoes/avaliacaoConduta`). O perfil mostra apenas a contagem
de votos por conceito, nunca quem votou.

## Desempenho, acessibilidade e responsividade

- **Acessibilidade:** WCAG 2.2 AA, ABNT NBR 17225 e eMAG. Modais com foco preso e Esc, abas
  pelas setas, botão "Pausar animações", contraste recalculado. Detalhes em
  [docs/ACESSIBILIDADE.md](docs/ACESSIBILIDADE.md).
- **Responsividade:** testada de 320 a 1920 px; nenhuma página tem rolagem horizontal ou
  conteúdo cortado (WCAG 1.4.10). Abaixo de 400 px, Entrar/Cadastro ficam dentro do menu.
- **Desempenho:**
  - fontes locais, com a de ícones reduzida aos ícones usados;
  - home com o JavaScript dividido: animações e seções abaixo da primeira tela carregam depois;
  - vídeo só depois do carregamento e nunca com Data Saver ou "reduzir movimento";
  - assets com hash e cache de 1 ano.
- **Movimento:** a faixa de fotos roda sozinha e pode ser arrastada com mouse ou dedo; no
  celular a home rola normalmente (sem o efeito de seção cobrindo o topo).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Configuração do Firebase, Turnstile, variáveis e deploy |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Pré-requisitos de ambiente |
| [docs/ACESSIBILIDADE.md](docs/ACESSIBILIDADE.md) | Critérios WCAG atendidos e como auditar |
| [docs/LGPD.md](docs/LGPD.md) | Tratamento de dados pessoais |
| [docs/security/](docs/security/) | Auditorias de segurança |
| [Regulamento Interno](docs/Regulamento_Interno_Shinatal.pdf) | Fonte de verdade das regras de premiação |
