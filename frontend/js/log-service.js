// Shinatal — registro no log de atividade (coleção `logs`), compartilhado pelas páginas de gestão.
import { db } from "./firebase-init.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/** Grava uma entrada imutável no log. Falha aqui nunca interrompe a ação que a originou. */
export async function registrarLog(operador, tipo, descricao, alvoUid = null, alvoNome = null) {
  try {
    await addDoc(collection(db, "logs"), {
      tipo, descricao, alvoUid, alvoNome,
      operadorUid: operador.uid, operadorNome: operador.nome || operador.email,
      criadoEm: serverTimestamp()
    });
  } catch (erro) {
    console.error("[Shinatal] Falha ao registrar log:", erro);
  }
}
