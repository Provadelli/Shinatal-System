// Shinatal — modo leve adaptativo.
// Marca <html> com a classe "modo-leve" em mobile ou quando há sinal de dispositivo/conexão
// fraca, e pausa a deriva do fundo (#bg-pao-acucar) quando a aba fica oculta. Toda a decisão
// visual fica no CSS (mesmo padrão já usado por prefers-reduced-motion em styles.css) — este
// módulo só decide e aplica a classe.
const raiz = document.documentElement;

function dispositivoProvavelmenteFraco() {
  // deviceMemory (GB) e connection só existem em navegadores Chromium — em Safari/Firefox
  // ficam undefined e o site se comporta exatamente como antes deste módulo existir.
  const memoria = navigator.deviceMemory;
  if (typeof memoria === "number" && memoria <= 4) return true;
  const conexao = navigator.connection;
  if (conexao) {
    if (conexao.saveData) return true;
    if (["slow-2g", "2g", "3g"].includes(conexao.effectiveType)) return true;
  }
  return false;
}

if (window.matchMedia("(max-width: 767px)").matches || dispositivoProvavelmenteFraco()) {
  raiz.classList.add("modo-leve");
}

document.addEventListener("visibilitychange", () => {
  const fundo = document.getElementById("bg-pao-acucar");
  if (fundo) fundo.classList.toggle("anim-pausada", document.hidden);
});
