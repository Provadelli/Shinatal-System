// Shinatal — tela de carregamento ("Carregando" letra a letra), comum a todas as páginas.
// Fica num arquivo (e não inline no HTML) para a Content-Security-Policy poder proibir script
// inline — ver firebase.json. Carregado SEM defer logo depois do #tela-carregamento no <body>.
//
// Some assim que o HTML e o CSS estão prontos (DOMContentLoaded) — não espera fotos, vídeo nem
// fontes, que continuam carregando por trás. Fica pelo menos MINIMO_MS (para não piscar) e no
// máximo MAXIMO_MS. Com "reduzir movimento" ligado no sistema, some na hora.
(function () {
  var MINIMO_MS = 300;
  var MAXIMO_MS = 1000;
  var reduzido = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var texto = document.getElementById("tela-carregamento-texto");
  "Carregando".split("").forEach(function (letra, i) {
    var span = document.createElement("span");
    span.className = "tela-carregamento-letra";
    span.style.animationDelay = (0.05 * i).toFixed(2) + "s";
    span.textContent = letra;
    texto.appendChild(span);
  });

  var el = document.getElementById("tela-carregamento");
  var inicio = Date.now();
  var escondida = false;
  function esconder() {
    if (escondida) return;
    escondida = true;
    var atraso = reduzido ? 0 : Math.max(0, MINIMO_MS - (Date.now() - inicio));
    setTimeout(function () {
      el.classList.add("tela-carregamento-oculta");
      setTimeout(function () { el.style.display = "none"; }, reduzido ? 0 : 300);
    }, atraso);
  }
  if (document.readyState !== "loading") esconder();
  else document.addEventListener("DOMContentLoaded", esconder);
  setTimeout(esconder, MAXIMO_MS); // rede de segurança: nunca fica presa carregando
})();
