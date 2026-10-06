// Shinatal — script da página recuperar-senha.html (antes inline; extraído para a CSP poder proibir
// script inline — ver firebase.json).
import { enviarLinkRedefinicaoSenha } from "./auth.js";
import { mostrarToast, ativarRevelacaoAoRolar, sincronizarAlturaHeader, montarTurnstile, tokenTurnstile, resetarTurnstile } from "./ui-utils.js";
import { TURNSTILE_SITE_KEY, TURNSTILE_WORKER_URL, TURNSTILE_CONFIGURADO } from "./turnstile-config.js";

ativarRevelacaoAoRolar();
sincronizarAlturaHeader();

const widgetTurnstile = await montarTurnstile("turnstile-recuperar", TURNSTILE_SITE_KEY);

const form = document.getElementById("form-recuperar");
const btn = document.getElementById("btn-enviar");
const btnTexto = document.getElementById("btn-enviar-texto");
const spinner = document.getElementById("btn-enviar-spinner");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();

  if (TURNSTILE_CONFIGURADO && !tokenTurnstile(widgetTurnstile)) {
    mostrarToast("Confirme que você não é um robô.", "erro");
    return;
  }

  btn.disabled = true;
  btnTexto.textContent = "Enviando...";
  spinner.classList.remove("hidden");

  try {
    // Mesma barreira best-effort do login (ver comentário em login.html): evita que scripts
    // simples fiquem disparando e-mails de redefinição em massa para inboxes de terceiros.
    if (TURNSTILE_CONFIGURADO) {
      const resposta = await fetch(`${TURNSTILE_WORKER_URL}/api/turnstile/verificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenTurnstile(widgetTurnstile) })
      });
      const dados = await resposta.json();
      if (!dados.ok) {
        mostrarToast("Não foi possível confirmar que você não é um robô. Tente novamente.", "erro");
        resetarTurnstile(widgetTurnstile);
        btn.disabled = false;
        btnTexto.textContent = "Enviar link de redefinição";
        spinner.classList.add("hidden");
        return;
      }
    }
    await enviarLinkRedefinicaoSenha(email);
  } catch (erro) {
    // Por segurança não revelamos se o e-mail existe ou não — seguimos para a tela de sucesso.
    console.warn("Falha ao enviar redefinição:", erro?.code);
  }

  form.classList.add("hidden");
  document.getElementById("bloco-sucesso").classList.remove("hidden");
});
