// Shinatal — autenticação e controle de acesso por papel (role).
import { auth, db, app, CONFIGURADO } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
 * Transforma o cadastro em espera (`cadastrosPendentes/{uid}`) no perfil real (`usuarios/{uid}`).
 * Só roda com o e-mail JÁ confirmado (as firestore.rules recusam o create caso contrário) — é isso
 * que impede um cadastro com e-mail inexistente de aparecer como colaborador no painel: sem clicar
 * no link do e-mail, esta função nunca é alcançada com sucesso.
 * Devolve o perfil criado, ou `null` se não há cadastro pendente para este usuário.
 */
async function promoverCadastroPendente(user) {
  const refPendente = doc(db, "cadastrosPendentes", user.uid);
  const snap = await getDoc(refPendente);
  // Sem pendente: ou nunca houve cadastro, ou outra aba/login acabou de promovê-lo (e apagou o
  // pendente) — reler o perfil cobre os dois casos (devolve null no primeiro).
  if (!snap.exists()) return obterPerfil(user.uid);

  const p = snap.data();
  // As firestore.rules exigem que o perfil seja IDÊNTICO ao pendente (perfilConfereComPendente) —
  // por isso os valores vêm todos dele, nunca do formulário. Campos ausentes (pendentes migrados
  // de perfis antigos incompletos) são omitidos: o Firestore recusa `undefined`.
  const perfilNovo = Object.fromEntries(Object.entries({
    nome: p.nome,
    email: p.email,
    cargo: p.cargo,
    cargaHoraria: p.cargaHoraria,
    fotoBase64: p.fotoBase64 ?? null,
    role: "colaborador",
    status: "ativo",
    motivoPerdaIntegral: null,
    dataAdmissao: p.dataAdmissao,
    dataDesligamento: null,
    // criadoPor só existe quando um Admin/Presidente cadastrou a pessoa pelo painel.
    criadoPor: p.criadoPor || undefined
  }).filter(([, valor]) => valor !== undefined));
  try {
    await setDoc(doc(db, "usuarios", user.uid), { ...perfilNovo, criadoEm: serverTimestamp() });
  } catch (erro) {
    // Duas abas/logins simultâneos: a outra já promoveu — o perfil existe, basta usá-lo.
    const existente = await obterPerfil(user.uid).catch(() => null);
    if (existente) return existente;
    throw erro;
  }

  try {
    await deleteDoc(refPendente);
  } catch {
    // Sobra inofensiva (nada lê cadastrosPendentes) — a limpeza periódica remove.
  }
  return obterPerfil(user.uid);
}

/** Perfil do usuário autenticado; se ainda não existir, tenta promover o cadastro pendente dele. */
async function obterOuCriarPerfil(user) {
  const existente = await obterPerfil(user.uid);
  if (existente) return existente;
  try {
    return await promoverCadastroPendente(user);
  } catch (erro) {
    // Falha real (rede, regra) — NÃO é "sem cadastro": quem chama desloga com uma mensagem que
    // manda tentar de novo, em vez de mandar a pessoa "contatar o DP/RH" por um erro passageiro.
    console.error("[Shinatal] Falha ao ativar o cadastro pendente:", erro);
    const falha = new Error("Não foi possível ativar seu cadastro agora. Tente novamente em instantes.");
    falha.code = "shinatal/ativacao-falhou";
    throw falha;
  }
}

/**
 * Grava o cadastro em espera (`cadastrosPendentes/{uid}`) de uma conta recém-criada — usado pelo
 * fallback de cadastro.html (sem Worker) e pelo "Novo colaborador" de gestao.js, para os dois
 * gravarem exatamente o mesmo schema (o das firestore.rules). Se a gravação falhar, apaga a conta
 * de Auth para não deixar uma órfã que bloquearia o e-mail ("já existe uma conta").
 * @param {import("firebase/auth").User} usuarioAuth conta recém-criada (ainda logada no seu app)
 * @param {{nome:string,email:string,cargo:string,cargaHoraria:number,dataAdmissao:string,
 *   fotoBase64?:string|null,criadoPor?:string}} dados `criadoPor` só quando Admin/Presidente cadastra
 */
export async function gravarCadastroPendente(usuarioAuth, { nome, email, cargo, cargaHoraria, dataAdmissao, fotoBase64 = null, criadoPor }) {
  try {
    await setDoc(doc(db, "cadastrosPendentes", usuarioAuth.uid), {
      nome, email, cargo, cargaHoraria, dataAdmissao, fotoBase64,
      ...(criadoPor ? { criadoPor } : {}),
      criadoEm: serverTimestamp()
    });
  } catch (erro) {
    await deleteUser(usuarioAuth).catch(() => {});
    throw erro;
  }
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

  let perfil;
  try {
    perfil = await obterOuCriarPerfil(cred.user);
  } catch (erro) {
    await signOut(auth);
    throw erro;
  }
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
      let perfil;
      try {
        perfil = await obterOuCriarPerfil(user);
      } catch (erro) {
        if (erro?.code !== "shinatal/ativacao-falhou") throw erro;
        await signOut(auth);
        window.location.href = "/login?motivo=ativacao-falhou";
        return;
      }
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
    "shinatal/ativacao-falhou": "Não foi possível ativar seu cadastro agora. Tente novamente em instantes.",
    "shinatal/dados-invalidos": "Confira os dados: nome (até 120 caracteres), cargo (até 80), tempo de trabalho, data de admissão válida (não futura) e senha com pelo menos 6 caracteres.",
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
