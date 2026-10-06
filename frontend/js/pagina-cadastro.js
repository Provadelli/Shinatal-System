// Shinatal — script da página cadastro.html (antes inline; extraído para a CSP poder proibir
// script inline — ver firebase.json).
import { auth, tokenAppCheck } from "./firebase-init.js";
import { createUserWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { traduzirErroAuth, gravarCadastroPendente } from "./auth.js";
import { mostrarToast, ativarRevelacaoAoRolar, sincronizarAlturaHeader, montarTurnstile, tokenTurnstile, resetarTurnstile } from "./ui-utils.js";
import { TURNSTILE_SITE_KEY, TURNSTILE_WORKER_URL, TURNSTILE_CONFIGURADO } from "./turnstile-config.js";

ativarRevelacaoAoRolar();
sincronizarAlturaHeader();

const widgetTurnstile = await montarTurnstile("turnstile-cadastro", TURNSTILE_SITE_KEY);

let fotoBase64 = null;
const inputFoto = document.getElementById("foto");
const preview = document.getElementById("preview-foto");

inputFoto.addEventListener("change", async () => {
  const arquivo = inputFoto.files[0];
  if (!arquivo) return;
  try {
    fotoBase64 = await comprimirImagem(arquivo, 240, 240, 0.75);
    preview.innerHTML = `<img src="${fotoBase64}" alt="Foto do colaborador" class="w-full h-full object-cover" />`;
  } catch {
    mostrarToast("Não foi possível carregar essa imagem.", "erro");
  }
});

/** Redimensiona e comprime a imagem no próprio navegador (sem Firebase Storage). */
function comprimirImagem(arquivo, larguraMax, alturaMax, qualidade) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(larguraMax / img.width, alturaMax / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * escala;
        canvas.height = img.height * escala;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", qualidade));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

const form = document.getElementById("form-cadastro");
const erroEl = document.getElementById("erro-form");
const btn = document.getElementById("btn-cadastrar");
const btnTexto = document.getElementById("btn-cadastrar-texto");
const spinner = document.getElementById("btn-cadastrar-spinner");

function mostrarErro(msg) {
  erroEl.textContent = msg;
  erroEl.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  erroEl.classList.add("hidden");

  const nome = document.getElementById("nome").value.trim();
  const cargo = document.getElementById("cargo").value.trim();
  const cargaHoraria = Number(document.getElementById("cargaHoraria").value);
  const dataAdmissao = document.getElementById("dataAdmissao").value;
  const email = document.getElementById("email").value.trim().toLowerCase();
  const senha = document.getElementById("senha").value;
  const confirmarSenha = document.getElementById("confirmarSenha").value;

  if (!dataAdmissao) {
    mostrarErro("Informe a data de admissão.");
    return;
  }
  if (dataAdmissao > new Date().toISOString().slice(0, 10)) {
    mostrarErro("A data de admissão não pode ser no futuro.");
    return;
  }
  if (!email.endsWith("@shinerio.com")) {
    mostrarErro("Use seu e-mail institucional (@shinerio.com).");
    return;
  }
  if (senha !== confirmarSenha) {
    mostrarErro("As senhas não coincidem.");
    return;
  }
  if (TURNSTILE_CONFIGURADO && !tokenTurnstile(widgetTurnstile)) {
    mostrarErro("Confirme que você não é um robô.");
    return;
  }

  btn.disabled = true;
  btnTexto.textContent = "Criando conta...";
  spinner.classList.remove("hidden");

  try {
    if (TURNSTILE_CONFIGURADO) {
      // Fluxo protegido: o Worker só cria a conta (Auth + perfil no Firestore) depois de
      // validar o Turnstile — ver backend/cloudflare-worker/src/index.js.
      const resposta = await fetch(`${TURNSTILE_WORKER_URL}/api/turnstile/cadastro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: tokenTurnstile(widgetTurnstile),
          // Repassado pelo Worker ao Firebase (cabeçalho X-Firebase-AppCheck): com o App Check
          // obrigatório, o cadastro só passa vindo do nosso site.
          appCheckToken: await tokenAppCheck(),
          nome, email, cargo, cargaHoraria, dataAdmissao,
          fotoBase64: fotoBase64 || null, senha
        })
      });
      const dados = await resposta.json();
      if (!dados.ok) throw { code: dados.erro === "turnstile" ? "shinatal/turnstile-invalido" : dados.erro };
    } else {
      // Sem Turnstile configurado ainda (setup local) — mesmo fluxo direto de antes, mas o
      // cadastro fica "em espera" (cadastrosPendentes): só vira colaborador de verdade
      // (usuarios/{uid}) no primeiro login, depois de confirmar o e-mail — ver auth.js.
      const cred = await createUserWithEmailAndPassword(auth, email, senha);
      await gravarCadastroPendente(cred.user, { nome, email, cargo, cargaHoraria, dataAdmissao, fotoBase64: fotoBase64 || null });
      await sendEmailVerification(cred.user);
      await signOut(auth);
    }
    mostrarToast("Cadastro criado! Confirme seu e-mail pelo link que enviamos e depois entre para ativar seu acesso.", "sucesso");
    setTimeout(() => (window.location.href = "/login"), 1500);
  } catch (erro) {
    mostrarErro(
      erro?.code === "shinatal/turnstile-invalido"
        ? "Não foi possível confirmar que você não é um robô. Tente novamente."
        : traduzirErroAuth(erro)
    );
    resetarTurnstile(widgetTurnstile);
    btn.disabled = false;
    btnTexto.textContent = "Criar minha conta";
    spinner.classList.add("hidden");
  }
});
