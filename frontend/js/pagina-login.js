// Shinatal — script da página login.html (antes inline; extraído para a CSP poder proibir
// script inline — ver firebase.json).
import { fazerLogin, traduzirErroAuth, PAGINA_POR_ROLE } from "./auth.js";
import { ligarToggleSenha, mostrarToast, ativarRevelacaoAoRolar, sincronizarAlturaHeader, montarTurnstile, tokenTurnstile, resetarTurnstile } from "./ui-utils.js";
import { TURNSTILE_SITE_KEY, TURNSTILE_WORKER_URL, TURNSTILE_CONFIGURADO } from "./turnstile-config.js";

ligarToggleSenha("btn-toggle-senha", "senha");
ativarRevelacaoAoRolar();
sincronizarAlturaHeader();

const widgetTurnstile = await montarTurnstile("turnstile-login", TURNSTILE_SITE_KEY);

// Redirecionado aqui por exigirAutenticacao() (auth.js) por causa de uma sessão com e-mail
// ainda não confirmado — mesma mensagem já usada em fazerLogin().
const motivoRedirect = new URLSearchParams(location.search).get("motivo");
if (motivoRedirect === "nao-verificado") {
  mostrarToast(traduzirErroAuth({ code: "shinatal/email-nao-verificado" }), "erro");
  history.replaceState(null, "", "/login");
} else if (motivoRedirect === "ativacao-falhou") {
  mostrarToast(traduzirErroAuth({ code: "shinatal/ativacao-falhou" }), "erro");
  history.replaceState(null, "", "/login");
}

const form = document.getElementById("form-login");
const btn = document.getElementById("btn-entrar");
const btnTexto = document.getElementById("btn-entrar-texto");
const spinner = document.getElementById("btn-entrar-spinner");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  if (TURNSTILE_CONFIGURADO && !tokenTurnstile(widgetTurnstile)) {
    mostrarToast("Confirme que você não é um robô.", "erro");
    return;
  }

  btn.disabled = true;
  btnTexto.textContent = "Entrando...";
  spinner.classList.remove("hidden");

  try {
    // Barreira contra bots simples de força bruta/credential stuffing — o Worker verifica o
    // Turnstile ANTES do navegador tentar o login. Não é uma garantia criptográfica (o
    // signInWithEmailAndPassword abaixo é uma chamada pública do Firebase Auth que um atacante
    // decidido poderia chamar direto, pulando esta checagem): o Spark (plano gratuito) não tem
    // Cloud Functions/Blocking Functions para exigir isso no servidor. Ver nota em SETUP.md.
    if (TURNSTILE_CONFIGURADO) {
      const resposta = await fetch(`${TURNSTILE_WORKER_URL}/api/turnstile/verificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenTurnstile(widgetTurnstile) })
      });
      const dados = await resposta.json();
      if (!dados.ok) throw { code: "shinatal/turnstile-invalido" };
    }

    const perfil = await fazerLogin(email, senha);
    mostrarToast(`Bem-vindo(a), ${perfil.nome?.split(" ")[0] || ""}!`, "sucesso");
    setTimeout(() => {
      window.location.href = PAGINA_POR_ROLE[perfil.role] || "/dashboard";
    }, 500);
  } catch (erro) {
    mostrarToast(
      erro?.code === "shinatal/turnstile-invalido"
        ? "Não foi possível confirmar que você não é um robô. Tente novamente."
        : traduzirErroAuth(erro),
      "erro"
    );
    resetarTurnstile(widgetTurnstile);
    btn.disabled = false;
    btnTexto.textContent = "Acessar Shinatal";
    spinner.classList.add("hidden");
  }
});
