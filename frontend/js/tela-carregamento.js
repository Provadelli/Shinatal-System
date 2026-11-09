// Shinatal — tela de carregamento minimalista (logo, fio de progresso e rótulo), comum a todas as
// páginas. Fica num arquivo (e não inline no HTML) para a Content-Security-Policy poder proibir
// script inline — ver vercel.json. Carregado SEM defer logo depois do #tela-carregamento no <body>.
//
// Some assim que o HTML e o CSS estão prontos (DOMContentLoaded) — não espera fotos, vídeo nem
// fontes, que continuam carregando por trás. Fica pelo menos MINIMO_MS (para não piscar) e no
// máximo MAXIMO_MS, e sai como uma cortina subindo (CSS). Com "reduzir movimento", some na hora.
(function () {
  var MINIMO_MS = 300;
  var MAXIMO_MS = 1000;
  var SAIDA_MS = 800; // = transição de clip-path em .tela-carregamento (styles.css)
  var reduzido = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var el = document.getElementById("tela-carregamento");
  if (!el) return;

  // Fio de progresso e rótulo "Shine Rio · ano" (decorativos — o anúncio é o aria-label "Carregando").
  var area = document.getElementById("tela-carregamento-texto");
  if (area) {
    area.textContent = "";
    var fio = document.createElement("span");
    fio.className = "tela-carregamento-fio";
    fio.setAttribute("aria-hidden", "true");
    var rotulo = document.createElement("span");
    rotulo.className = "tela-carregamento-rotulo";
    rotulo.setAttribute("aria-hidden", "true");
    rotulo.textContent = "Shine Rio · " + new Date().getFullYear();
    area.appendChild(fio);
    area.appendChild(rotulo);
  }

  var inicio = Date.now();
  var escondida = false;
  function esconder() {
    if (escondida) return;
    escondida = true;
    var atraso = reduzido ? 0 : Math.max(0, MINIMO_MS - (Date.now() - inicio));
    setTimeout(function () {
      el.classList.add("tela-carregamento-oculta");
      setTimeout(function () { el.style.display = "none"; }, reduzido ? 0 : SAIDA_MS);
    }, atraso);
  }
  // Páginas logadas ([data-esperar-login]): fica até o login ser conferido e o cabeçalho montado
  // (evento shinatal:pronto, de cabecalho-sistema.js), com teto de 8 s.
  if (el.hasAttribute("data-esperar-login")) {
    document.addEventListener("shinatal:pronto", esconder);
    setTimeout(esconder, 8000);
    return;
  }
  if (document.readyState !== "loading") esconder();
  else document.addEventListener("DOMContentLoaded", esconder);
  setTimeout(esconder, MAXIMO_MS); // rede de segurança: nunca fica presa carregando
})();
