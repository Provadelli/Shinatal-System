# Shinatal

Portal do **Shinatal**, o programa de premiação de fim de ano da Shine Rio Serviços Ltda.
Site 100% estático (HTML/CSS/JS puro, sem build step) hospedado no Firebase Hosting, com
**Firebase Authentication** e **Firestore** como back-end — sem servidor próprio, sem Cloud
Functions, sem plano pago do Firebase.

## Estrutura do repositório

```
frontend/    Site publicado no Firebase Hosting: páginas HTML, css/, js/, assets/.
backend/     Regras de segurança do Firestore e scripts administrativos (Admin SDK).
docs/        Guia de configuração, requisitos e o regulamento interno (PDF).
design/      Referências visuais (mockups) — não faz parte do site publicado.
.github/     Workflows de deploy automático (Firebase Hosting via GitHub Actions).
firebase.json / .firebaserc   Configuração do projeto Firebase (raiz do repositório).
```

## Papéis de usuário

| Papel | Acesso |
|---|---|
| **Presidente** | Acesso total; único que grava contratos/avaliações direto, sem aprovação; aprova ou rejeita as solicitações dos demais gestores. |
| **Admin** | Acesso de gestão completo; contratos/avaliações passam pela fila de aprovação do Presidente. |
| **DP** (Departamento Pessoal) | Lançar falta, atraso, advertência e avaliação (avaliação vai para aprovação). |
| **RH** (Recursos Humanos) | Ativar/encerrar contrato e avaliação (ambos vão para aprovação). |
| **Colaborador** | Vê apenas o próprio perfil, cota estimada, valor do fundo, status de contratos e o simulador de impacto. |

O motor de cálculo da premiação (Seções do Regulamento Interno) vive em
`frontend/js/calculo-shinatal.js`, isolado de I/O — é a peça mais sensível do projeto.

### Avaliação de Conduta (entre colegas)

Aba "Conduta", disponível no dashboard do colaborador e no painel de gestão (dp/rh/admin) —
todo mundo participa, exceto o Presidente (não vota e não pode ser avaliado). Cada um avalia os
colegas que estiverem online (presença por heartbeat, `diretorioPublico/{uid}`), usando os mesmos
4 conceitos da Seção 11 (Excelente/Bom/Regular/Insatisfatório), mas é **puramente social**: os
votos são anônimos (só o autor lê o próprio voto — ver `backend/firestore.rules`) e nunca entram
em `calculo-shinatal.js`, ou seja, não afetam a cota nem o fundo. A função nasce desligada; só
Admin ou Presidente pode ligá-la globalmente (`configuracoes/avaliacaoConduta`). No perfil de cada
colaborador aparece só a contagem de votos por conceito, nunca quem votou.

## Como rodar / publicar

Veja **[docs/SETUP.md](docs/SETUP.md)** (configuração do projeto Firebase, variáveis, deploy)
e **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** (pré-requisitos de ambiente).

## Documentos

- [Regulamento Interno — Shinatal](docs/Regulamento_Interno_Shinatal.pdf) (fonte de verdade das regras de premiação implementadas em `calculo-shinatal.js`).
