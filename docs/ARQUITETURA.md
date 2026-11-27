# Arquitetura do Shinatal

Referência técnica do portal: como as peças se encaixam, onde cada regra mora e por que foi feito assim.
Para instalar e configurar, veja o [guia de setup](guias/SETUP.md). Para a visão de produto, o [README](../README.md).

## Sumário

1. [Visão de contexto](#1-visão-de-contexto)
2. [Camadas e dependências](#2-camadas-e-dependências)
3. [Estrutura do repositório](#3-estrutura-do-repositório)
4. [Modelo de dados](#4-modelo-de-dados)
5. [Motor de cálculo](#5-motor-de-cálculo)
6. [Fluxos principais](#6-fluxos-principais)
7. [Segurança](#7-segurança)
8. [Manutenção de dados](#8-manutenção-de-dados)
9. [Build, deploy e cache](#9-build-deploy-e-cache)
10. [Testes](#10-testes)
11. [Decisões de arquitetura](#11-decisões-de-arquitetura)

---

## 1. Visão de contexto

O Shinatal não tem servidor próprio. O navegador fala direto com o Firebase, protegido por regras de segurança, App Check e um Worker da Cloudflare no cadastro.

```mermaid
flowchart LR
  colab(["Colaborador"])
  gestao(["Gestão: Admin, DP, RH"])
  pres(["Presidente"])
  visit(["Visitante"])

  subgraph web["Portal Shinatal (Vercel)"]
    home["Página inicial<br/>React + Vite"]
    portal["Portal<br/>HTML + módulos JS"]
  end

  subgraph fb["Firebase (plano Spark)"]
    auth["Authentication"]
    fs[("Firestore")]
    ac["App Check<br/>reCAPTCHA Enterprise"]
  end

  worker["Cloudflare Worker<br/>Turnstile + criação de conta"]
  cnpj["BrasilAPI<br/>consulta de CNPJ"]
  admin["Scripts Admin SDK<br/>execução local"]

  visit --> home
  colab --> portal
  gestao --> portal
  pres --> portal
  home -- "lê estatisticas/publico" --> fs
  portal --> auth
  portal --> fs
  portal -. "token" .-> ac
  portal -- "cadastro" --> worker
  worker --> auth
  worker --> fs
  portal -- "cadastro de contrato" --> cnpj
  admin -- "manutenção auditável" --> fs
```

## 2. Camadas e dependências

Cada página tem um módulo próprio. Os módulos usam serviços para falar com o Firestore, e todos os números saem de um único motor puro.

```mermaid
flowchart TB
  subgraph apresentacao["Apresentação"]
    paginas["Páginas HTML<br/>frontend/*.html"]
    modulos["Módulos de página<br/>contratos.js, gestao.js, dashboard.js, perfil.js, paginas/*.js"]
    ui["UI compartilhada<br/>ui-utils.js, cabecalho-sistema.js, acessibilidade.js"]
  end

  subgraph servicos["Serviços (I/O)"]
    authsvc["auth.js"]
    fundo["fundo-service.js"]
    solic["solicitacoes-service.js"]
    logsvc["log-service.js"]
    cnpjsvc["cnpj-service.js"]
    init["firebase-init.js"]
  end

  subgraph dominio["Domínio (sem I/O)"]
    motor["calculo-shinatal.js<br/>régua de meses, contratos, fundo, cota"]
  end

  paginas --> modulos
  modulos --> ui
  modulos --> servicos
  modulos --> motor
  fundo --> motor
  servicos --> init
  scripts["backend/scripts<br/>(Node, Admin SDK)"] --> motor
  testes["backend/tests/calculo"] --> motor
```

**Regra de dependência:** `calculo-shinatal.js` não importa nada e não faz I/O. As telas, o publicador do fundo, os scripts de manutenção e os testes importam o mesmo arquivo. Por isso o número da tela é sempre o mesmo número gravado no banco.

## 3. Estrutura do repositório

```text
.
├── app/                       Página inicial pública (React + TypeScript + Vite)
│   └── src/components/        Seções da home e componentes de UI
├── frontend/                  Portal (HTML + Tailwind + módulos ES)
│   ├── *.html                 Uma página por tela (login, painel, gestão, contratos, ...)
│   ├── js/                    Módulos de página, serviços e o motor de cálculo
│   │   ├── calculo-shinatal.js   Motor de cálculo (fonte única das regras)
│   │   └── paginas/           Módulos das telas de lançamento e solicitações
│   ├── css/                   Estilos do sistema e Tailwind compilado
│   └── assets/                Imagens, vídeos e fontes
├── backend/
│   ├── firestore.rules        Regras de segurança (schema, papéis, campos travados)
│   ├── cloudflare-worker/     Worker do Turnstile e da criação de conta
│   ├── scripts/               Manutenção com Admin SDK (simular, aplicar, reverter)
│   │   ├── dados/             Cópia versionada da planilha de controle
│   │   ├── lib/               Lógica pura dos scripts (testável)
│   │   └── legado/            Motor antigo congelado, só para comparação
│   └── tests/                 Cálculo, regras do Firestore e acessibilidade
├── scripts/                   Build: cabeçalho e rodapé, ícones, imagens, vídeo
├── docs/                      Documentação (índice em docs/README.md)
└── design/                    Referências visuais (não vai para o site)
```

## 4. Modelo de dados

Coleções do Firestore, conforme `backend/firestore.rules`. Nenhum valor em reais por contrato fica gravado. Os agregados `fundo/{ano}` e `estatisticas/publico` são só um cache publicado do que o motor calcula.

```mermaid
erDiagram
  USUARIOS ||--o{ FALTAS : "recebe"
  USUARIOS ||--o{ ATRASOS : "recebe"
  USUARIOS ||--o{ ADVERTENCIAS : "recebe"
  USUARIOS ||--o{ AVALIACOES : "recebe"
  USUARIOS ||--o{ CONTRATOS : "tem"
  USUARIOS ||--|| DIRETORIO_PUBLICO : "espelha"
  USUARIOS ||--o{ SOLICITACOES : "abre"
  USUARIOS ||--o{ CICLOS_AVALIACAO : "é avaliado (1 por ano)"
  CICLOS_AVALIACAO ||--|{ RESPOSTAS_AVALIACAO : "fixo e escolhido"
  CICLOS_AVALIACAO ||--o| RESPOSTAS_AO_PRESIDENTE : "resposta do avaliado"
  CICLOS_AVALIACAO ||--o| AVALIACOES : "gera no ok do Presidente"
  CADASTROS_PENDENTES ||--o| USUARIOS : "vira, após confirmar o e-mail"
  CONTRATOS_EMPRESARIAIS }o--|| FUNDO : "alimenta (calculado)"
  FUNDO ||--|| ESTATISTICAS_PUBLICO : "resume"

  USUARIOS {
    string uid PK
    string nome
    string role "colaborador, dp, rh, admin, presidente"
    string status "ativo, aviso_previo, demitido, afastado"
    string dataAdmissao
    number cargaHoraria "8, 6 ou 4"
  }
  CONTRATOS_EMPRESARIAIS {
    string id PK
    string nomeEmpresa
    string cnpj "travado após criar"
    string dataInicio "travado após criar"
    int quantidadeFuncionariosIniciais "travado após criar"
    bool prazoIndeterminado
    string dataFimPrevista
    string status "ativo, pausado, encerrado"
    array saidasIniciais
    array entradasContrato
    array pausas
    array historicoMovimentacoes "trilha de auditoria"
  }
  FALTAS {
    string uid FK
    string data
    bool justificada
  }
  ATRASOS {
    string uid FK
    string mesAno
    int quantidadeAtrasos
  }
  ADVERTENCIAS {
    string uid FK
    string data
    string tipo "verbal até suspensao3"
  }
  AVALIACOES {
    string uid FK
    int ano
    string conceito
    bool validadoRH
  }
  SOLICITACOES {
    string tipo
    string status "pendente, aceita, rejeitada"
    map dadosAcao
    string solicitadoPorUid FK
  }
  FUNDO {
    string ano PK
    number arrecadado
    number estornos
    number saldoDisponivel
    number somaPesos
    number somaPesosAjustados
  }
  ESTATISTICAS_PUBLICO {
    number arrecadado
    int colaboradores
  }
```

Também existem `logs` (trilha das ações de RH, só leitura para Admin e Presidente), `contratos` (contrato individual do colaborador, informativo) e `cadastrosPendentes` (dados do cadastro até a confirmação do e-mail).

## 5. Motor de cálculo

`frontend/js/calculo-shinatal.js` implementa o [Regulamento Interno](regras/Regulamento_Interno_Shinatal.pdf). As regras detalhadas, com exemplos, estão em [Regras de Cálculo](regras/Regras_de_Calculo_Shinatal.pdf).

### 5.1 Régua de meses (v2, nov/2026)

Toda contagem de meses de contrato passa por uma única função, `contarMesesContabilizados`. Ela trabalha só com datas de calendário (sem fuso horário) e trata ano bissexto.

| Evento | Regra | Exemplo |
|---|---|---|
| Entrada (início, entrada de funcionário, retomada de pausa) | Até o dia 14 o mês conta; do dia 15 em diante, começa no mês seguinte | 14/03 conta março; 15/03 começa em abril |
| Término previsto e encerramento do contrato | O mês final sempre conta | Encerrado em 01/09: setembro conta |
| Desligamento individual (e início de pausa) | O mês só conta se a pessoa ficou até o último dia | Saída em 16/09: setembro não conta; saída em 30/09: conta |

### 5.2 Do contrato ao fundo

O dinheiro é calculado **por lote de funcionários**: o quadro inicial, cada saída e cada entrada. Cada lote recebe R$ 12,50 por mês, até 12 meses (R$ 150,00). No prazo indeterminado, os 12 meses entram antecipados. Na saída, o lote passa a valer só os meses contados, e a diferença é descontada. Um desligamento nunca altera os outros lotes.

```mermaid
flowchart LR
  datas["Datas e quantidades<br/>do contrato"] --> regua["contarMesesContabilizados<br/>(régua v2)"]
  regua --> lote["calcularLote<br/>crédito, meses contados,<br/>desconto"]
  lote --> resumo["calcularResumoContratoEmpresarial<br/>movimentos datados"]
  ajuste{"Ajuste manual<br/>no histórico?"} -. "zera a contribuição" .-> resumo
  resumo --> ano["calcularContribuicaoNoAno"]
  ano --> fundo["calcularFundo<br/>arrecadado, estornos, saldo"]
  resumo --> semestre["calcularVisaoSemestral<br/>positivo e negativo por semestre"]
  fundo --> agreg["montarAgregadosFundo"]
  agreg --> pub[("fundo/{ano}<br/>estatisticas/publico")]
  fundo --> cota["calcularCotaColaborador<br/>peso, redutores, bônus"]
```

- **Exercício:** o crédito inicial pertence ao ano do mês de referência da implantação. Saídas e entradas pertencem ao ano da própria data. Um contrato de 2025 com saída em 2026 só desconta em 2026.
- **Ajuste manual:** uma entrada `{tipo: "ajuste_manual", efeito: "contribuicao_zero", motivo}` em `historicoMovimentacoes` faz o contrato contribuir com R$ 0,00. A régua não muda, e o card mostra quanto ela daria. Uma entrada `reversao_ajuste_manual` desfaz a exceção.
- **Cota do colaborador:** peso = avos trabalhados ÷ 12 × percentual da jornada (Seções 4 e 6). Depois vêm no máximo dois redutores percentuais (Seção 16), o desconto de faltas (Seção 7) e os adicionais (Seções 10 e 11). **Rateio:** o fundo é um valor fechado. Cada um tem um peso ajustado (peso × redutores × faltas × adicionais) e recebe saldo × peso ajustado ÷ soma dos pesos ajustados; os centavos do arredondamento vão para os maiores restos (`calcularDistribuicaoFundo`). A soma das cotas é exatamente o saldo. `fundo/{ano}` guarda `somaPesosAjustados` para a tela de cada colaborador calcular a própria cota, e o `fundo-service` republica sozinho quando muda contrato, colaborador, falta, atraso, advertência ou avaliação.
- **Avaliação de desempenho** (Seção 11, página `/avaliacao`): cada colaborador da tabela de avaliadores fixos (`configuracoes/avaliadoresFixos`, gravada só por `backend/scripts/avaliadores-fixos.mjs`) é avaliado pelo fixo e por um colega que ele escolhe. Cada um dá 5 notas de 0 a 5 e um parecer. O avaliado lê as duas avaliações e envia uma resposta que só o Presidente lê. No ok do Presidente, as regras recalculam a média (10 notas, 1 casa) e conferem a faixa do conceito; o ok cria `avaliacoes/desempenho_{ano}_{uid}`, que o motor de cálculo já usa. A antiga avaliação de conduta (votos anônimos) foi desativada em 11/2026; os dados ficam só para leitura do titular.

## 6. Fluxos principais

### 6.1 Cadastro de colaborador

```mermaid
sequenceDiagram
  autonumber
  actor U as Colaborador
  participant P as cadastro.html
  participant W as Cloudflare Worker
  participant A as Firebase Auth
  participant F as Firestore

  U->>P: Preenche o cadastro (e-mail @shinerio.com)
  P->>W: Dados + token do Turnstile
  W->>W: Valida o Turnstile e a origem
  W->>A: Cria a conta (REST)
  W->>F: Grava cadastrosPendentes/{uid} (passa pelas mesmas rules)
  A-->>U: E-mail de verificação
  U->>P: Primeiro login com o e-mail confirmado
  P->>F: Cria usuarios/{uid} a partir do pendente
```

### 6.2 Movimentação de contrato

```mermaid
sequenceDiagram
  autonumber
  actor G as Admin, DP ou RH
  actor Pr as Presidente
  participant T as contratos.html
  participant M as Motor de cálculo
  participant F as Firestore

  G->>T: Registra entrada, saída, pausa ou novo contrato
  T->>M: Calcula o impacto no fundo (antes e depois)
  T->>F: Cria solicitacoes/{id} (pendente)
  Pr->>T: Aprova a solicitação
  T->>F: Grava o contrato + entrada em historicoMovimentacoes
  T->>M: montarAgregadosFundo
  T->>F: Republica fundo/{ano} e estatisticas/publico
  Note over Pr,F: O Presidente também pode gravar direto, sem solicitação
```

### 6.3 Página pública

A home lê `estatisticas/publico` pela API REST do Firestore, sem login e sem cache (`no-store`), e atualiza a cada 60 segundos. Ela nunca calcula: mostra o que o motor publicou.

## 7. Segurança

```mermaid
flowchart TB
  req["Requisição do navegador"] --> csp["CSP estrita<br/>scripts só de origens fixas, worker-src none"]
  csp --> appcheck["App Check<br/>reCAPTCHA Enterprise"]
  appcheck --> rules["Firestore Rules"]
  rules --> r1["E-mail verificado e vínculo ativo"]
  rules --> r2["Papel do usuário<br/>colaborador, dp, rh, admin, presidente"]
  rules --> r3["Schema fechado (hasOnly)<br/>e campos travados após criar"]
  rules --> r4["Escrita de contrato só pelo Presidente;<br/>os demais passam por solicitação"]
  cad["Cadastro"] --> turn["Turnstile validado no Worker"]
  adm["Scripts Admin SDK"] --> local["Só na máquina do responsável<br/>service-account.json fora do Git"]
```

- **Segredos:** nenhuma credencial fica no Git. A configuração web do Firebase é pública por natureza e fica protegida pelas rules e pelo App Check. As chaves do Turnstile e da conta de serviço ficam fora do repositório (`wrangler secret`, `.gitignore`).
- **Limites conhecidos do plano gratuito:** login e recuperação de senha chamam o Firebase Auth direto (não há Cloud Functions para interceptar). O valor do fundo publicado depende do cálculo no cliente; as rules só validam o formato.
- Política de segurança e como reportar: [SECURITY.md](../SECURITY.md). Auditorias: [docs/seguranca/](seguranca/).

## 8. Manutenção de dados

Mudanças em massa no banco (nova régua, reconciliação com a planilha) nunca são feitas à mão. Elas usam scripts com Admin SDK que seguem sempre o mesmo ciclo:

```mermaid
stateDiagram-v2
  [*] --> Simular
  Simular: --simular
  Simular: só leitura, gera backup.json, plano.json e relatorio.csv
  Simular --> Revisar
  Revisar --> Aplicar: totais conferidos
  Aplicar: --aplicar pasta
  Aplicar: recusa se o banco mudou, se há solicitação pendente ou se o total não bate
  Aplicar: grava em transação e acrescenta auditoria no histórico
  Aplicar --> Validar
  Validar: republica fundo e confere os agregados
  Validar --> [*]
  Validar --> Reverter: se necessário
  Reverter: --reverter pasta
  Reverter: devolve o estado do backup sem apagar o histórico
  Reverter --> [*]
```

| Script | Para quê |
|---|---|
| `backend/scripts/recalcular-regra-v2.mjs` | Migração da régua de meses v1 para v2, contrato a contrato |
| `backend/scripts/importar-planilha-controle.mjs` | Reconciliação com a planilha de controle (`dados/planilha-controle-2026.json`, exercício 2026: R$ 8.800,00) |

Os dois são **idempotentes**: rodar de novo não duplica contratos nem lançamentos. Os backups ficam em `backend/scripts/out/`, que está fora do Git.

## 9. Build, deploy e cache

```mermaid
flowchart LR
  push["git push main"] --> vercel["Vercel"]
  vercel --> build["npm run build"]
  build --> layout["layout<br/>cabeçalho e rodapé"]
  layout --> css["build:css<br/>Tailwind"]
  css --> tsc["tsc --noEmit"]
  tsc --> vite["vite build"]
  vite --> dist[("dist/")]
  dist --> cdn["shinatal.shinerio.com"]
```

| Recurso | Cache |
|---|---|
| `/assets/*` (nomes com hash) | 1 ano, `immutable` |
| `/js/*` e `/css/*` | 300 s, `must-revalidate` |
| Páginas HTML | sem cache |
| Motor de cálculo | sufixo `?v=` nos imports, trocado a cada mudança de regra |

As regras do Firestore são publicadas à parte, com `firebase deploy --only firestore:rules`. O Worker é publicado com `wrangler deploy`.

## 10. Testes

| Suíte | Onde | Como rodar | Cobre |
|---|---|---|---|
| Cálculo | `backend/tests/calculo/` | `npm run test:calculo` | Régua v2, contratos, fundo, migração e cada linha da planilha de controle |
| Regras do Firestore | `backend/tests/rules/` | `cd backend/tests/rules && npm test` (emulador) | Papéis, schema, campos travados, tentativas de abuso |
| Acessibilidade e desempenho | `backend/tests/a11y/` | `cd backend/tests/a11y && npm test` (emulador) | axe-core, teclado, larguras de 320 a 1920 px e Lighthouse |

Nenhuma suíte toca produção: as duas últimas usam os emuladores do Firebase com dados fictícios.

## 11. Decisões de arquitetura

| # | Decisão | Por quê |
|---|---|---|
| 1 | Firebase sem servidor próprio (plano Spark) | Custo zero e menos peças para manter; a segurança fica nas rules, no App Check e no Worker |
| 2 | Motor de cálculo puro e único | Tela, banco, scripts e testes usam o mesmo código, então os números nunca divergem |
| 3 | Valores sempre recalculados, nunca gravados por contrato | Uma mudança de regra vale para contratos antigos e novos, sem migração de valores |
| 4 | Exceções e auditoria no `historicoMovimentacoes` | Toda decisão fica rastreável no próprio contrato, sem campo novo nas rules |
| 5 | Cadastro criado pelo Worker | O Firebase só é tocado depois que o Turnstile aprovou de verdade |
| 6 | Home em React, portal em HTML com módulos ES | A home precisa de animação e desempenho; o portal precisa ser simples de manter |
| 7 | Manutenção por scripts simular, aplicar, reverter | Mudanças em massa sempre com backup, conferência de totais e volta segura |
