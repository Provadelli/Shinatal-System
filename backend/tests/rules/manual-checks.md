# Roteiro manual complementar — Firestore Rules

Complementa `firestore-rules.test.mjs` para cenários mais fáceis de inspecionar visualmente que de
automatizar (ex.: o que a UI mostra vs. o que a regra realmente permite). **Sempre contra o Firebase
Emulator** (`firebase emulators:start --only firestore,auth`), nunca contra produção
(`shinetal-cda20`).

## Como preparar

1. `firebase emulators:start --only firestore,auth` na raiz do repositório.
2. Abrir a Emulator UI (URL impressa no terminal, normalmente `http://127.0.0.1:4000`) para
   inspecionar dados gravados e forçar o app a usar o emulador: em
   `frontend/js/firebase-init.js`, adicionar temporariamente (nunca commitar):
   ```js
   import { connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
   import { connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
   connectFirestoreEmulator(db, "127.0.0.1", 8080);
   connectAuthEmulator(auth, "http://127.0.0.1:9099");
   ```
3. Servir `frontend/` localmente (ex.: `npx serve frontend`) e criar 2-3 contas de teste via
   `cadastro.html` com e-mails `@shinerio.com` (o emulador não envia e-mail real; use a Emulator UI
   para "verificar" o e-mail manualmente em Authentication > usuário > marcar como verificado).

## Cenários a reproduzir manualmente

Para cada um, abra o DevTools do navegador logado como o papel indicado e rode no console (o app já
importou `db`/`doc`/`getDoc` no escopo do módulo — use `import()` dinâmico se precisar):

1. **IDOR entre colaboradores** — logado como colaborador A, tente:
   ```js
   const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
   const { db } = await import("/js/firebase-init.js");
   await getDoc(doc(db, "usuarios", "<uid-do-colaborador-B>"));
   ```
   Esperado: `permission-denied`. (Coberto também pelo teste automatizado.)

2. **Auto-promoção de papel via DevTools** — tentar `updateDoc` no próprio doc `usuarios/{uid}`
   setando `role: "admin"`. Esperado: `permission-denied`, mesmo que a UI não ofereça esse botão.

3. **Flash de conteúdo protegido antes do redirect** — abrir `gestao.html` deslogado (ou como
   colaborador) diretamente pela URL e observar se algum dado aparece na tela por um instante antes
   do `exigirAutenticacao()` redirecionar. Esperado: nenhum dado sensível renderizado antes do
   redirect (`frontend/js/auth.js:75-107`).

4. **Mass assignment confirmado** — repetir o `setDoc` com campo extra do teste automatizado
   `mass assignment: create aceita campos extras` e conferir na Emulator UI que o campo extra foi
   persistido. Decidir com o time se vale adicionar `hasOnly([...])` na regra de `usuarios.create`.

## Item fora do escopo desta execução (fazer manualmente quando quiser)

**Headers de segurança em produção** — confirmar que o que está em `firebase.json`/`vercel.json`
realmente chega ao navegador:
```
curl -sI https://<url-de-producao> | grep -iE "content-security-policy|strict-transport-security|x-frame-options|permissions-policy"
```
