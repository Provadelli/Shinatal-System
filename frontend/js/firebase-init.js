// Shinatal — inicialização do Firebase (SDK modular v10, via CDN, sem build step).
// Plano 100% gratuito (Spark): apenas Authentication + Firestore.


// >>> SUBSTITUA os valores abaixo pelas credenciais do SEU projeto Firebase. <<<
// Veja o passo a passo completo em SETUP.md ("1. Criar o projeto Firebase").
// Estes valores (apiKey, authDomain, etc.) são PÚBLICOS por design do Firebase — a
// segurança real vem das Firestore Security Rules (firestore.rules) e do Firebase
// Authentication, nunca deste arquivo.
const firebaseConfig = {
  apiKey: "AIzaSyDlJ9A33891xJhxQ96SU-7oNmNNeFai3JI",
  authDomain: "shinetal-cda20.firebaseapp.com",
  projectId: "shinetal-cda20",
  storageBucket: "shinetal-cda20.firebasestorage.app",
  messagingSenderId: "175040322576",
  appId: "1:175040322576:web:cc35403207177679487e95"
  
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export { firebaseConfig };
// Considera configurado sempre que houver uma apiKey real (não o texto de placeholder do template).
export const CONFIGURADO = Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.includes("SUBSTITUA");

if (!CONFIGURADO) {
  console.warn(
    "[Shinatal] Firebase ainda não configurado. Edite js/firebase-init.js com as credenciais " +
    "do seu projeto (veja SETUP.md)."
  );
}
