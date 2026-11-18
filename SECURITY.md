# Política de segurança

O Shinatal guarda dados de colaboradores da Shine Rio. Esta página resume como o projeto se protege e o que cada pessoa que mexe no código precisa respeitar.

## Como reportar uma vulnerabilidade

Não abra issue pública. Fale direto com a equipe de TI da Shine Rio pelo canal interno, descrevendo:

1. o que encontrou e onde (página, arquivo ou regra);
2. como reproduzir;
3. o impacto que você imagina.

Vamos confirmar o recebimento e combinar o prazo de correção.

## Nunca versionar

| Item | Onde fica |
|---|---|
| Chave da conta de serviço (`service-account.json`) | Só na máquina de quem roda os scripts, em `backend/scripts/` (ignorado pelo Git) |
| Configuração real do Firebase (`firebase-config.local.json`) | Local; é embutida no build por `npm run config:firebase` |
| Secret Key do Turnstile e `FIREBASE_API_KEY` do Worker | `wrangler secret put` (nunca em arquivo) |
| Script de criação das contas especiais (`seed-usuarios.js`) | Local (ignorado pelo Git) |
| Backups e relatórios dos scripts (`backend/scripts/out/`) | Local (ignorado pelo Git); contêm dados reais |
| Arquivos `.env`, `.dev.vars`, logs de depuração | Local (ignorado pelo Git) |
| Prompts, rascunhos e anotações internas | `.privado/` (ignorado pelo Git) |
| Senhas, tokens, e-mails de contas privilegiadas, CPF ou dados pessoais reais | Em lugar nenhum do repositório, inclusive na documentação e nos testes |

A configuração web do Firebase (`apiKey`, `projectId`) é pública por natureza. Quem protege os dados são as regras do Firestore e o App Check, não o sigilo dessa configuração.

## Camadas de proteção

- **Firestore Rules** (`backend/firestore.rules`): e-mail verificado, papel do usuário, schema fechado, campos de contrato travados após a criação e escrita de contrato só pelo Presidente.
- **App Check** com reCAPTCHA Enterprise: só o próprio site consegue usar o Firebase do projeto.
- **Cloudflare Turnstile** no cadastro, validado e executado no Worker.
- **CSP estrita** e headers de segurança em `vercel.json` e `firebase.json`.
- **Scripts com Admin SDK** só rodam localmente, sempre com simulação, backup e auditoria antes de gravar.

Detalhes e diagramas em [docs/ARQUITETURA.md](docs/ARQUITETURA.md#7-segurança). Auditorias em [docs/seguranca/](docs/seguranca/).

## Antes de cada commit

```bash
git status                     # nada de service-account, .env, out/ ou .privado/
git diff --cached | grep -iE "senha|password|secret|private_key|token" # deve vir vazio
npm run test:calculo
```
