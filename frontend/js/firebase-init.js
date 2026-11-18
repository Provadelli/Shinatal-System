// Shinatal — inicialização do Firebase (SDK modular v10, via CDN, sem build step).
// Plano 100% gratuito (Spark): apenas Authentication + Firestore (+ App Check, também gratuito).
//
// A configuração do projeto NÃO fica em texto puro aqui: CONFIG_CODIFICADA é gerada por
// scripts/codificar-config-firebase.mjs (npm run config:firebase) a partir de
// firebase-config.local.json, que fica fora do git. Nunca edite a linha à mão.
//
// O que protege o sistema de verdade não é esconder a chave (o navegador precisa dela, e ela
// aparece no DevTools), e sim:
//   1. App Check + reCAPTCHA (Fraud Defense/Enterprise) — o Firebase só aceita requisições do nosso site;
//   2. as Firestore Security Rules (backend/firestore.rules);
//   3. as restrições da chave no Google Cloud (só Auth/Firestore).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-check.js";

import { firebaseConfig, recaptchaSiteKey } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);

/**
 * Liga o App Check num app do Firebase (o principal, e também os apps secundários que a gestão
 * cria para convidar colaboradores — com o App Check obrigatório no console, um app sem ele
 * teria as requisições recusadas). Sem recaptchaSiteKey (setup local/emuladores), não faz nada.
 */
export function ativarAppCheck(appAlvo) {
  if (!recaptchaSiteKey) return null;
  return initializeAppCheck(appAlvo, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}
const appCheck = ativarAppCheck(app);

/** Token do App Check para chamadas fora do SDK (o Worker do cadastro) — null se desligado. */
export async function tokenAppCheck() {
  if (!appCheck) return null;
  try {
    return (await getToken(appCheck)).token;
  } catch {
    return null;
  }
}

// initializeAuth em vez de getAuth: mesma persistência padrão do getAuth, mas SEM o
// popupRedirectResolver — o site não usa login com popup/redirect (Google etc.), e esse resolver
// baixa apis.google.com/js/api.js em toda página, que a CSP bloqueia (erro no console e download
// à toa). Se um dia entrar login social, passe `popupRedirectResolver: browserPopupRedirectResolver`.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]
});
export const db = getFirestore(app);

export { firebaseConfig };
export const APP_CHECK_ATIVO = Boolean(appCheck);
// Considera configurado sempre que a configuração codificada trouxer uma apiKey.
export const CONFIGURADO = Boolean(firebaseConfig.apiKey);

if (!CONFIGURADO) {
  console.warn(
    "[Shinatal] Firebase ainda não configurado. Preencha firebase-config.local.json e rode " +
    "npm run config:firebase (veja docs/guias/SETUP.md)."
  );
}
