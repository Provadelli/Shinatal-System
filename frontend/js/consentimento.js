// Shinatal — aceite obrigatório dos Termos de Uso e da Política de Privacidade (LGPD).
//
// Chamado por exigirAutenticacao() (auth.js) em toda página logada. Quem ainda não aceitou a
// versão vigente (VERSAO_TERMOS) — colaboradores antigos, convidados pelo Admin, ou todos depois
// de uma mudança de versão — vê um diálogo que não fecha com Esc nem clicando fora: só segue
// aceitando ou saindo da conta. O registro fica em usuarios/{uid}.aceiteTermos, com a hora do
// servidor (as firestore.rules recusam qualquer outra data).
import { db } from "./firebase-init.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { prenderFoco } from "./acessibilidade.js";
import { VERSAO_TERMOS } from "./lgpd-config.js";

/** O perfil já aceitou a versão vigente? */
export function aceitouVersaoAtual(perfil) {
  return perfil?.aceiteTermos?.versao === VERSAO_TERMOS;
}

/**
 * Mostra o pedido de aceite e só resolve depois que a pessoa aceitar (com o registro gravado).
 * "Sair" chama `aoSair` (logout) e a Promise nunca resolve — a página não chega a carregar.
 * @param {{uid:string, aceiteTermos?:{versao:string}}} perfil
 * @param {() => Promise<void>} aoSair
 * @returns {Promise<void>}
 */
export function pedirAceite(perfil, aoSair) {
  const jaAceitouAntes = Boolean(perfil?.aceiteTermos?.versao);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-inverse-surface/60";
    overlay.innerHTML = `
      <div class="glass-card-active !bg-white rounded-xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto" role="alertdialog" aria-modal="true"
           aria-labelledby="aceite-titulo" aria-describedby="aceite-texto">
        <span class="material-symbols-outlined text-primary text-3xl" aria-hidden="true">privacy_tip</span>
        <h2 id="aceite-titulo" class="font-display text-headline-md text-on-surface mt-2 mb-2">
          ${jaAceitouAntes ? "Atualizamos nossos termos" : "Antes de continuar"}
        </h2>
        <div id="aceite-texto" class="font-body text-body-md text-on-surface-variant space-y-2">
          <p>${jaAceitouAntes
            ? "Os Termos de Uso e a Política de Privacidade do Shinatal mudaram. Leia e confirme para continuar usando o sistema."
            : "Para usar o Shinatal, leia e aceite os Termos de Uso e a Política de Privacidade. Eles explicam quais dados seus o sistema usa, para quê, e os seus direitos pela LGPD."}</p>
          <p class="flex flex-wrap gap-x-4 gap-y-1">
            <a href="/termos" target="_blank" class="text-primary font-semibold underline underline-offset-2">Termos de Uso<span class="sr-only"> (abre em nova aba)</span></a>
            <a href="/privacidade" target="_blank" class="text-primary font-semibold underline underline-offset-2">Política de Privacidade<span class="sr-only"> (abre em nova aba)</span></a>
          </p>
        </div>
        <div class="flex items-start gap-3 mt-5">
          <input type="checkbox" id="aceite-caixa" class="mt-1 w-5 h-5 accent-primary shrink-0" aria-describedby="aceite-erro" />
          <label for="aceite-caixa" class="font-body text-body-md text-on-surface">
            Li e concordo com os Termos de Uso e declaro ciência da Política de Privacidade.
          </label>
        </div>
        <p id="aceite-erro" class="hidden mt-3 text-christmas-red font-body text-label-sm bg-error-container/50 rounded-lg px-3 py-2" role="alert"></p>
        <div class="flex gap-3 mt-6">
          <button type="button" data-sair class="btn-fantasma flex-1">Sair</button>
          <button type="button" data-aceitar class="btn-primario flex-1">Aceitar e continuar</button>
        </div>
      </div>`;

    // O resto da página fica inerte (nem Tab, nem leitor de tela) enquanto o aceite não sai.
    const inertes = [...document.body.children].filter((el) => !el.inert);
    inertes.forEach((el) => { el.inert = true; });
    document.body.appendChild(overlay);
    const soltarFoco = prenderFoco(overlay);

    const caixa = overlay.querySelector("#aceite-caixa");
    const erro = overlay.querySelector("#aceite-erro");
    const botaoAceitar = overlay.querySelector("[data-aceitar]");
    const mostrarErro = (msg) => {
      erro.textContent = msg;
      erro.classList.remove("hidden");
    };

    caixa.addEventListener("change", () => {
      if (caixa.checked) {
        caixa.removeAttribute("aria-invalid");
        erro.classList.add("hidden");
      }
    });

    botaoAceitar.addEventListener("click", async () => {
      if (!caixa.checked) {
        caixa.setAttribute("aria-invalid", "true");
        mostrarErro("Marque a caixa para confirmar que leu e concorda.");
        caixa.focus();
        return;
      }
      botaoAceitar.disabled = true;
      botaoAceitar.textContent = "Registrando...";
      try {
        await updateDoc(doc(db, "usuarios", perfil.uid), {
          aceiteTermos: { versao: VERSAO_TERMOS, aceitoEm: serverTimestamp() }
        });
        perfil.aceiteTermos = { versao: VERSAO_TERMOS, aceitoEm: new Date() };
        soltarFoco();
        overlay.remove();
        inertes.forEach((el) => { el.inert = false; });
        resolve();
      } catch (e) {
        console.error("[Shinatal] Falha ao registrar o aceite dos termos:", e);
        mostrarErro("Não foi possível registrar o aceite agora. Verifique a conexão e tente de novo.");
        botaoAceitar.disabled = false;
        botaoAceitar.textContent = "Aceitar e continuar";
      }
    });

    overlay.querySelector("[data-sair]").addEventListener("click", () => { aoSair(); });
    caixa.focus();
  });
}
