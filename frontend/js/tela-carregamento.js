// Shinatal — tela de carregamento ("Carregando" letra a letra), comum a todas as páginas.
// Fica num arquivo (e não inline no HTML) para a Content-Security-Policy poder proibir script
// inline — ver firebase.json. Carregado SEM defer logo depois do #tela-carregamento no <body>.
(function () {
  var texto = document.getElementById("tela-carregamento-texto");
  "Carregando".split("").forEach(function (letra, i) {
    var span = document.createElement("span");
    span.className = "tela-carregamento-letra";
    span.style.animationDelay = (0.08 * i).toFixed(2) + "s";
    span.textContent = letra;
    texto.appendChild(span);
  });

  var el = document.getElementById("tela-carregamento");
  var inicio = Date.now();
  var minimoMs = 650;
  var escondida = false;
  function esconder() {
    if (escondida) return;
    escondida = true;
    var atraso = Math.max(0, minimoMs - (Date.now() - inicio));
    setTimeout(function () {
      el.classList.add("tela-carregamento-oculta");
      setTimeout(function () { el.style.display = "none"; }, 550);
    }, atraso);
  }
  if (document.readyState === "complete") esconder();
  else window.addEventListener("load", esconder);
  setTimeout(esconder, 3000); // rede de segurança: nunca fica presa carregando
})();
