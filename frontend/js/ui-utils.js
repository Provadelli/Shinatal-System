// Shinatal — utilidades de UI compartilhadas entre todas as páginas.
// Sem dependências externas além do DOM. Módulo ES (importado com <script type="module">).

/** Escapa `& < > " '` para uso seguro dentro de innerHTML — usar sempre que um texto vindo do
 * usuário/banco (nome, cargo, motivo, descrição etc.) for interpolado num template HTML, para
 * evitar XSS armazenado. Não é necessário para atribuições a .textContent/.value, que já escapam
 * sozinhas. */
function escaparHTML(valor) {
  const mapa = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(valor ?? "").replace(/[&<>"']/g, (c) => mapa[c]);
}

/** HTML do avatar (foto ou iniciais) de um usuário — usado no "canto" do header. */
function construirAvatarHTML(usuario) {
  const iniciais = (usuario?.nome || "?").trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  return usuario?.fotoBase64
    ? `<img src="${escaparHTML(usuario.fotoBase64)}" alt="${escaparHTML(usuario.nome)}" class="w-full h-full object-cover" />`
    : iniciais;
}

/**
 * Lê um arquivo de imagem, redimensiona (mantendo a proporção, lado maior = tamanhoMax) num
 * <canvas> offscreen e devolve um data URL JPEG comprimido. Necessário porque este projeto não
 * tem Cloud Storage (plano Spark) — fotoBase64 é sempre gravada inline em usuarios/{uid}, e o
 * Firestore limita cada documento a ~1MiB; uma foto de celular sem esse redimensionamento nunca
 * caberia.
 * @param {File} arquivo
 * @param {{tamanhoMax?: number, qualidade?: number}} [opcoes]
 * @returns {Promise<string>} data URL "data:image/jpeg;base64,..."
 */
function redimensionarImagemParaBase64(arquivo, { tamanhoMax = 256, qualidade = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(tamanhoMax / img.width, tamanhoMax / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", qualidade));
      };
      img.onerror = () => reject(new Error("Não foi possível carregar a imagem."));
      img.src = e.target.result;
    };
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

/** Formata um número em Real brasileiro. */
function formatarMoeda(valor) {
  const numero = Number.isFinite(valor) ? valor : 0;
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Converte a carga horária diária salva (8/6/4, ver calculo-shinatal.js) para o texto de
 * jornada semanal exibido em toda a UI (dia × 5 dias úteis). O cálculo do fundo continua em
 * horas diárias — isto é só formatação de exibição. */
function formatarJornadaSemanal(cargaHorariaDiaria) {
  const n = Number(cargaHorariaDiaria);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n * 5}h semanais`;
}

/** Formata uma data ISO (yyyy-mm-dd) para dd/mm/aaaa. */
function formatarData(isoOuData) {
  const d = isoOuData instanceof Date ? isoOuData : new Date(isoOuData + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

/** Formata um mês/ano "aaaa-mm" (ex.: input type="month") para "mm/aaaa". */
function formatarMesAno(mesAno) {
  const [ano, mes] = (mesAno || "").split("-");
  if (!ano || !mes) return "—";
  return `${mes}/${ano}`;
}

/** Formata um Timestamp do Firestore (ou Date/ISO) para "dd/mm/aaaa às HH:mm". */
function formatarDataHora(valor) {
  const d = valor?.toDate ? valor.toDate() : (valor instanceof Date ? valor : new Date(valor));
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Mostra uma notificação "toast" no canto inferior da tela.
 * tipo: 'sucesso' | 'erro' | 'info'
 */
function mostrarToast(mensagem, tipo = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className =
      "fixed z-[9999] bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center w-[calc(100%-2rem)] max-w-sm pointer-events-none";
    document.body.appendChild(container);
  }

  const cores = {
    sucesso: "bg-secondary text-on-secondary",
    erro: "bg-christmas-red text-white",
    info: "bg-primary text-on-primary"
  };
  const icones = { sucesso: "check_circle", erro: "error", info: "info" };

  const toast = document.createElement("div");
  toast.className = `pointer-events-auto w-full shadow-lg rounded-lg px-4 py-3 flex items-center gap-2 font-body text-body-md ${cores[tipo] || cores.info} animate-[toast-in_0.25s_ease-out]`;
  toast.innerHTML = `<span class="material-symbols-outlined text-xl">${icones[tipo] || icones.info}</span><span>${escaparHTML(mensagem)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}

/**
 * Renderiza um widget Cloudflare Turnstile em `containerId` usando a API JS explícita (em vez do
 * modo automático `cf-turnstile`, que depende de timing entre o <script> externo e este módulo
 * ES — a API explícita evita a corrida). Resolve com o id do widget (usado depois para ler o
 * token e para resetar em caso de falha), ou `null` se o Turnstile ainda não foi configurado
 * (site key placeholder — ver turnstile-config.js e SETUP.md).
 */
function montarTurnstile(containerId, siteKey) {
  return new Promise((resolve) => {
    const container = document.getElementById(containerId);
    if (!container || !siteKey || siteKey.startsWith("SUBSTITUA")) {
      resolve(null);
      return;
    }
    (function aguardarScript() {
      if (!window.turnstile) { setTimeout(aguardarScript, 80); return; }
      resolve(window.turnstile.render(container, { sitekey: siteKey, theme: "light" }));
    })();
  });
}

/** Token atual do widget Turnstile (string vazia se ainda não resolvido ou não configurado). */
function tokenTurnstile(widgetId) {
  if (widgetId == null || !window.turnstile) return "";
  return window.turnstile.getResponse(widgetId) || "";
}

/** Reseta o widget Turnstile — chamar após qualquer falha, já que cada token é de uso único. */
function resetarTurnstile(widgetId) {
  if (widgetId != null && window.turnstile) window.turnstile.reset(widgetId);
}

/** Liga o botão "olho" de mostrar/ocultar senha a um input de senha. */
function ligarToggleSenha(botaoId, inputId) {
  const botao = document.getElementById(botaoId);
  const input = document.getElementById(inputId);
  const icone = botao?.querySelector(".material-symbols-outlined");
  if (!botao || !input || !icone) return;
  botao.addEventListener("click", () => {
    // Só troca o glifo do <span> do ícone — nunca o textContent do botão inteiro, que apagaria
    // o <span class="material-symbols-outlined"> e mostraria o nome do ícone como texto puro.
    const senhaFicaVisivel = input.type === "password";
    input.type = senhaFicaVisivel ? "text" : "password";
    icone.textContent = senhaFicaVisivel ? "visibility_off" : "visibility";
    botao.setAttribute("aria-label", senhaFicaVisivel ? "Ocultar senha" : "Mostrar senha");
  });
}

/**
 * Modal de confirmação genérico (substitui window.confirm()). Cria o próprio DOM sob demanda —
 * nenhuma página precisa de markup próprio — e empilha acima de qualquer modal já aberto, com
 * seu próprio backdrop/Esc (não reaproveita o listener genérico de fechar-modal da página, pra
 * não fechar um modal pai por engano).
 * @param {{titulo?: string, mensagem: string, textoConfirmar?: string, textoCancelar?: string, perigo?: boolean}} opcoes
 * @returns {Promise<boolean>}
 */
function confirmarAcao({ titulo = "Confirmar ação", mensagem, textoConfirmar = "Confirmar", textoCancelar = "Cancelar", perigo = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 bg-inverse-surface/40";
    overlay.innerHTML = `
      <div class="glass-card-active !bg-white rounded-xl p-6 w-full max-w-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirmar-acao-titulo">
        <h3 id="confirmar-acao-titulo" class="font-display text-headline-md text-on-surface mb-2">${escaparHTML(titulo)}</h3>
        <p class="font-body text-body-md text-on-surface-variant mb-6">${escaparHTML(mensagem)}</p>
        <div class="flex gap-3">
          <button type="button" data-cancelar class="btn-fantasma flex-1">${textoCancelar}</button>
          <button type="button" data-confirmar class="btn-primario flex-1 ${perigo ? "!bg-christmas-red" : ""}">${textoConfirmar}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function concluir(resultado) {
      document.removeEventListener("keydown", aoTeclar);
      overlay.remove();
      resolve(resultado);
    }
    function aoTeclar(e) {
      if (e.key === "Escape") concluir(false);
    }
    overlay.querySelector("[data-cancelar]").addEventListener("click", () => concluir(false));
    overlay.querySelector("[data-confirmar]").addEventListener("click", () => concluir(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) concluir(false); });
    document.addEventListener("keydown", aoTeclar);
    overlay.querySelector("[data-confirmar]").focus();
  });
}

/** Marca o item ativo da navegação (topo e dock inferior) pelo data-nav. */
function marcarNavAtiva(chave) {
  document.querySelectorAll(`[data-nav]`).forEach((el) => {
    const ativo = el.dataset.nav === chave;
    el.classList.toggle("nav-ativo", ativo);
  });
}

/** Alterna a exibição de um bloco (accordion) e gira o ícone associado. */
function alternarAccordion(conteudoId, iconeId) {
  const conteudo = document.getElementById(conteudoId);
  const icone = document.getElementById(iconeId);
  if (!conteudo) return;
  const abrindo = conteudo.classList.contains("hidden");
  conteudo.classList.toggle("hidden");
  if (icone) icone.style.transform = abrindo ? "rotate(180deg)" : "rotate(0deg)";
}

/** Máscara simples de contador regressivo mm:ss para reenvio de código. */
function iniciarContagemReenvio(botaoId, segundos = 60) {
  const botao = document.getElementById(botaoId);
  if (!botao) return;
  let restante = segundos;
  botao.disabled = true;
  const textoOriginal = botao.dataset.textoOriginal || botao.textContent;
  botao.dataset.textoOriginal = textoOriginal;
  const intervalo = setInterval(() => {
    restante -= 1;
    botao.textContent = `Reenviar em ${restante}s`;
    if (restante <= 0) {
      clearInterval(intervalo);
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  }, 1000);
}

/**
 * Anima um número crescendo de 0 até `valorFinal` (requestAnimationFrame). Se o usuário
 * preferir menos movimento, pula direto para o valor final.
 * @param {HTMLElement} elemento
 * @param {number} valorFinal
 * @param {{duracaoMs?: number, formatador?: (v: number) => string}} opcoes
 */
function animarNumero(elemento, valorFinal, { duracaoMs = 1200, formatador = (v) => Math.round(v).toString() } = {}) {
  if (!elemento) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    elemento.textContent = formatador(valorFinal);
    return;
  }
  const inicio = performance.now();
  function passo(agora) {
    const progresso = Math.min((agora - inicio) / duracaoMs, 1);
    const suavizado = 1 - Math.pow(1 - progresso, 3); // ease-out cúbico
    elemento.textContent = formatador(valorFinal * suavizado);
    if (progresso < 1) requestAnimationFrame(passo);
  }
  requestAnimationFrame(passo);
}

/**
 * Revela com fade + leve subida os elementos que casam com `seletor` conforme entram na tela
 * (usa IntersectionObserver, uma única vez por elemento). Se o usuário preferir menos movimento,
 * mostra tudo de uma vez, sem observar nada.
 */
function ativarRevelacaoAoRolar(seletor = "[data-reveal]") {
  const elementos = document.querySelectorAll(seletor);
  if (!elementos.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    elementos.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entradas, obs) => {
    entradas.forEach((entrada) => {
      if (entrada.isIntersecting) {
        entrada.target.classList.add("is-visible");
        obs.unobserve(entrada.target);
      }
    });
  }, { threshold: 0.15 });

  elementos.forEach((el) => {
    el.classList.add("reveal-on-scroll");
    observer.observe(el);
  });
}

/**
 * Mede a altura real do header fixo (.header-flutuante — só o que estiver de fato visível,
 * desktop ou mobile) e publica como --altura-header no :root, consumida por .pt-header-fixo
 * (styles.css). Sem isso, .pt-header-fixo usa um valor fixo que assume o header sempre com uma
 * linha só — quando a nav quebra em 2 linhas (poucos itens já não cabem, zoom do navegador,
 * fonte maior), o conteúdo da página fica embaixo do header fixo. Roda ao carregar, em resize, e
 * observa o próprio header via ResizeObserver (pega mudanças de altura que não vêm de um resize
 * da janela, como a nav quebrando linha ou a fonte terminando de carregar).
 */
function sincronizarAlturaHeader() {
  const headers = document.querySelectorAll(".header-flutuante");
  if (!headers.length) return;

  const aplicar = () => {
    // offsetParent não serve aqui: é sempre null pra elementos position:fixed (é o próprio caso
    // do header), independente de estarem visíveis. getClientRects().length é o jeito correto de
    // checar "está renderizado" (fica vazio só quando o elemento ou um ancestral tem display:none
    // — exatamente o que as classes hidden/md:flex do Tailwind alternam).
    const altura = [...headers]
      .filter((el) => el.getClientRects().length > 0)
      .reduce((max, el) => Math.max(max, el.getBoundingClientRect().height), 0);
    if (altura > 0) document.documentElement.style.setProperty("--altura-header", `${altura}px`);
  };

  aplicar();
  window.addEventListener("resize", aplicar);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(aplicar);
    headers.forEach((el) => observer.observe(el));
  }
}

/** Atrasa a chamada de fn até `ms` depois da última invocação — usado em buscas locais e em
 * listeners onSnapshot que podem emitir em rajada, pra evitar refazer trabalho de render a cada
 * disparo. */
function debounce(fn, ms) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), ms);
  };
}

export {
  escaparHTML,
  debounce,
  construirAvatarHTML,
  redimensionarImagemParaBase64,
  sincronizarAlturaHeader,
  formatarMoeda,
  formatarJornadaSemanal,
  formatarData,
  formatarMesAno,
  formatarDataHora,
  mostrarToast,
  ligarToggleSenha,
  montarTurnstile,
  tokenTurnstile,
  resetarTurnstile,
  confirmarAcao,
  marcarNavAtiva,
  alternarAccordion,
  iniciarContagemReenvio,
  animarNumero,
  ativarRevelacaoAoRolar
};
