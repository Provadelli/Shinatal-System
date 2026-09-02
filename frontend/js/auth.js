// Shinatal — autenticação e controle de acesso por papel (role).
import { auth, db, app, CONFIGURADO } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/** Painel de destino de cada papel após o login. */
export const PAGINA_POR_ROLE = {
  admin: "/gestao",
  dp: "/gestao",
  rh: "/gestao",
  presidente: "/gestao",
  colaborador: "/dashboard"
};

/** Busca o perfil (doc `usuarios/{uid}`) do usuário autenticado. */
export async function obterPerfil(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

/**
 * Faz login e devolve o perfil (com role) para a página decidir o redirecionamento.
 * Bloqueia contas com e-mail ainda não confirmado (link enviado no cadastro) — nesse caso
 * reenvia o link de verificação automaticamente e lança um erro com `code:
 * "shinatal/email-nao-verificado"` para a tela de login mostrar a mensagem certa.
 */
export async function fazerLogin(email, senha) {
  const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), senha);

  if (!cred.user.emailVerified) {
    try {
      await sendEmailVerification(cred.user);
    } catch {
      // Se o Firebase já limitou o reenvio (auth/too-many-requests), seguimos mesmo assim —
      // o usuário já deve ter recebido o link do cadastro ou de uma tentativa anterior.
    }
    await signOut(auth);
    const erro = new Error("Confirme seu e-mail antes de entrar. Acabamos de reenviar o link de verificação.");
    erro.code = "shinatal/email-nao-verificado";
    throw erro;
  }

  const perfil = await obterPerfil(cred.user.uid);
  if (!perfil) {
    await signOut(auth);
    throw new Error("Este login não possui um cadastro de perfil associado. Contate o DP/RH.");
  }
  return perfil;
}

export async function fazerLogout() {
  await signOut(auth);
  window.location.href = "/login";
}

/** Envia o e-mail de redefinição de senha nativo do Firebase (gratuito, sem Cloud Functions). */
export async function enviarLinkRedefinicaoSenha(email) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

/**
 * Protege uma página: exige sessão ativa e, opcionalmente, uma lista de roles permitidos.
 * Redireciona para login.html se não autenticado, ou para a página correta do papel do
 * usuário se ele não tiver permissão para a página atual.
 * @param {string[]|null} rolesPermitidos
 * @returns {Promise<{uid:string,[key:string]:any}>} perfil do usuário autenticado
 */
export function exigirAutenticacao(rolesPermitidos = null) {
  return new Promise((resolve) => {
    if (!CONFIGURADO) {
      mostrarAvisoConfiguracao();
    }
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "/login";
        return;
      }
      // Segunda camada de defesa: as firestore.rules já exigem e-mail confirmado para qualquer
      // leitura/escrita operacional — sem este check, uma sessão nessa situação carregaria a
      // página e só travaria depois, em erros de permissão confusos, em vez de um redirecionamento
      // claro (mesma regra já aplicada em fazerLogin()).
      if (!user.emailVerified) {
        await signOut(auth);
        window.location.href = "/login?motivo=nao-verificado";
        return;
      }
      const perfil = await obterPerfil(user.uid);
      if (!perfil) {
        await signOut(auth);
        window.location.href = "/login";
        return;
      }
      if (rolesPermitidos && !rolesPermitidos.includes(perfil.role)) {
        window.location.href = PAGINA_POR_ROLE[perfil.role] || "/login";
        return;
      }
      resolve(perfil);
    });
  });
}

function mostrarAvisoConfiguracao() {
  const aviso = document.createElement("div");
  aviso.className =
    "fixed top-0 inset-x-0 z-[9999] bg-christmas-red text-white text-center text-sm py-2 px-4 font-body";
  aviso.textContent =
    "⚠ Firebase ainda não configurado — edite js/firebase-init.js com as credenciais do projeto (veja SETUP.md).";
  document.body.prepend(aviso);
}

/** Traduz os códigos de erro mais comuns do Firebase Auth para mensagens em português. */
export function traduzirErroAuth(erro) {
  const codigo = erro?.code || "";
  const mapa = {
    "shinatal/email-nao-verificado": "Confirme seu e-mail antes de entrar. Reenviamos o link de verificação — confira sua caixa de entrada (e o spam).",
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-disabled": "Este usuário está desativado.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    "auth/email-already-in-use": "Já existe uma conta com este e-mail.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres."
  };
  return mapa[codigo] || "Ocorreu um erro. Tente novamente em instantes.";
}
