// Shinatal — efeitos de interface que dependem do ponteiro.
//
// Um único ouvinte de pointermove para a página inteira (delegação), agrupado por
// requestAnimationFrame: no máximo uma escrita de estilo por quadro, só no elemento sob o cursor.
// Ele grava a posição do ponteiro em --mx/--my (botões) e --luz-x/--luz-y (vidro interativo); o
// desenho do brilho fica todo no CSS (styles.css, "Botões" e "Vidro líquido").
// Só em aparelhos com mouse e sem "reduzir movimento" — no toque não há ponteiro pairando.

const SELETOR = ".btn-primario, .btn-fantasma, .btn-perigo, .btn-vidro, .vidro-interativo";
const podeAnimar =
  window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (podeAnimar) {
  let alvo = null;
  let x = 0;
  let y = 0;
  let agendado = false;

  function aplicar() {
    agendado = false;
    if (!alvo) return;
    const caixa = alvo.getBoundingClientRect();
    const px = `${x - caixa.left}px`;
    const py = `${y - caixa.top}px`;
    if (alvo.classList.contains("vidro-interativo")) {
      alvo.style.setProperty("--luz-x", px);
      alvo.style.setProperty("--luz-y", py);
    } else {
      alvo.style.setProperty("--mx", px);
      alvo.style.setProperty("--my", py);
    }
  }

  document.addEventListener("pointermove", (e) => {
    alvo = e.target instanceof Element ? e.target.closest(SELETOR) : null;
    if (!alvo) return;
    x = e.clientX;
    y = e.clientY;
    if (!agendado) {
      agendado = true;
      requestAnimationFrame(aplicar);
    }
  }, { passive: true });
}
