// Shinatal — página "Avaliação de desempenho" (todos os papéis).
//
// Três blocos, cada um só para quem precisa dele:
//   - Avisos: o que a pessoa tem de fazer como avaliadora (Presidente, RH ou colega escolhido) e,
//     para o Presidente, os pareceres esperando o "ok".
//   - Meu processo: a linha do tempo da própria avaliação (não existe para o Presidente).
//   - Gestão (Presidente): abrir/fechar o ciclo, situação de cada colaborador e respostas.
//   - Perguntas (Presidente e Admin): o texto das 5 perguntas.
// As permissões de verdade estão em backend/firestore.rules; aqui só se monta a tela.
import { db } from "../firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao } from "../auth.js";
import { escaparHTML, mostrarToast, debounce, confirmarAcao, animarNumero, ativarRevelacaoAoRolar } from "../ui-utils.js";
import { sincronizarDiretorio, assinarDiretorio } from "../diretorio-service.js";
import {
  PERGUNTAS_PADRAO, ROTULOS_PAPEL_AVALIADOR, ROTULOS_CONCEITO, PERCENTUAL_CONCEITO, COMENTARIO_MINIMO,
  calcularMedia, conceitoPorMedia, formatarNota, avaliacoesConcluidas, passosDoCiclo, progressoDosPassos,
  calcularPendencias, assinarConfig, salvarConfig, assinarMeuCiclo, assinarCiclosVisiveis, escolherAvaliador,
  enviarResposta, buscarRespostas, enviarParecer, dispensarRH, darOk
} from "../avaliacao-service.js";

const perfil = await exigirAutenticacao(null);
const papel = document.documentElement.dataset.papel || perfil.role;
const EH_PRESIDENTE = papel === "presidente";
const PODE_EDITAR_PERGUNTAS = papel === "presidente" || papel === "admin";
const ANO_CORRENTE = new Date().getFullYear();
const reduzMovimento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const el = (id) => document.getElementById(id);
// Ícones trocados por JS ficam neste objeto para scripts/fonte-icones.mjs incluí-los na fonte.
const icones = { ok: "task_alt", avaliar: "rate_review", fechar: "lock", abrir: "lock_open", feito: "check_circle", pendente: "schedule", espera: "hourglass_empty", ninguem: "group_off", erro: "error" };

const estado = {
  config: undefined,      // undefined = carregando; null = nunca configurado
  meuCiclo: undefined,    // undefined = carregando; null = ainda sem escolha
  ciclos: [],             // ciclos que esta pessoa enxerga (todos, para Presidente e RH)
  diretorio: [],
  usuarios: new Map(),    // só gestores leem usuarios/{uid} (nome completo)
  respostasMeuCiclo: null,
  anoAssinado: null,
  trocandoAvaliador: false,
  avaliacaoAberta: null   // { ciclo, papel } no modal
};
let cancelarMeuCiclo = () => {};
let cancelarCiclos = () => {};

sincronizarDiretorio(perfil);
ativarRevelacaoAoRolar();

/* ------------------------------------------------------------------ */
/* Dados                                                               */
/* ------------------------------------------------------------------ */

const anoDoCiclo = () => estado.config?.ano ?? ANO_CORRENTE;
const cicloAberto = () => !!estado.config?.ativo && estado.config.ano === anoDoCiclo();
const perguntasAtuais = () => estado.config?.perguntas?.length === 5 ? estado.config.perguntas : PERGUNTAS_PADRAO;

function nomeDe(uid, { completo = true } = {}) {
  const u = estado.usuarios.get(uid);
  if (u?.nome) return completo ? u.nome : u.nome.split(" ")[0];
  const d = estado.diretorio.find((x) => x.uid === uid);
  return d?.primeiroNome || "Colaborador";
}

assinarDiretorio((lista) => { estado.diretorio = lista; renderTudo(); });

if (papel !== "colaborador") {
  try {
    const snap = await getDocs(collection(db, "usuarios"));
    snap.docs.forEach((d) => estado.usuarios.set(d.id, { uid: d.id, ...d.data() }));
  } catch (erro) {
    console.error("[Shinatal] Falha ao carregar colaboradores:", erro);
  }
}

assinarConfig((config) => {
  estado.config = config;
  const ano = anoDoCiclo();
  if (ano !== estado.anoAssinado) {
    estado.anoAssinado = ano;
    estado.respostasMeuCiclo = null;
    cancelarMeuCiclo();
    cancelarCiclos();
    if (!EH_PRESIDENTE) {
      cancelarMeuCiclo = assinarMeuCiclo(ano, perfil.uid, (ciclo) => {
        const mudouEtapa = JSON.stringify(passosDoCiclo(ciclo)) !== JSON.stringify(passosDoCiclo(estado.meuCiclo));
        estado.meuCiclo = ciclo;
        if (mudouEtapa) estado.respostasMeuCiclo = null;
        renderProcesso();
      });
    }
    cancelarCiclos = assinarCiclosVisiveis(ano, papel, perfil.uid, (ciclos) => {
      estado.ciclos = ciclos;
      renderAvisos();
      renderGestao();
    });
  }
  renderTudo();
});

/* ------------------------------------------------------------------ */
/* Peças de interface reaproveitadas                                    */
/* ------------------------------------------------------------------ */

function vazio(icone, titulo, texto = "") {
  return `<div class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">${icone}</span><p class="estado-vazio-titulo">${titulo}</p>${texto ? `<p>${texto}</p>` : ""}</div>`;
}

function avatar(uid) {
  return `<span class="avatar w-10 h-10 text-sm" aria-hidden="true">${escaparHTML(nomeDe(uid).slice(0, 1).toUpperCase() || "?")}</span>`;
}

/** Bloco com as notas de um avaliador: barra por pergunta (só transform) e o comentário. */
function blocoResposta(papelAvaliador, resposta, ciclo) {
  const quem = papelAvaliador === "par" ? `${ROTULOS_PAPEL_AVALIADOR.par} · ${escaparHTML(nomeDe(ciclo.avaliadorUid, { completo: false }))}` : ROTULOS_PAPEL_AVALIADOR[papelAvaliador];
  if (!resposta) {
    return `<article class="resposta-avaliacao resposta-avaliacao--pendente">
      <header class="resposta-avaliacao-cabecalho"><p class="registro-titulo">${quem}</p><span class="badge badge-neutro">Pendente</span></header>
    </article>`;
  }
  const media = calcularMedia([resposta]);
  return `<article class="resposta-avaliacao">
    <header class="resposta-avaliacao-cabecalho">
      <p class="registro-titulo">${quem}</p>
      <p class="resposta-avaliacao-media"><span class="sr-only">Média desta avaliação: </span>${formatarNota(media)}</p>
    </header>
    <ol class="notas-lista">
      ${resposta.perguntas.map((pergunta, i) => `
        <li class="nota-item">
          <span class="nota-pergunta">${escaparHTML(pergunta)}</span>
          <span class="nota-barra" aria-hidden="true"><span style="--nota:${resposta.notas[i] / 10}"></span></span>
          <span class="nota-valor"><span class="sr-only">Nota </span>${resposta.notas[i]}</span>
        </li>`).join("")}
    </ol>
    ${resposta.comentario ? `<blockquote class="resposta-comentario">${escaparHTML(resposta.comentario)}</blockquote>` : ""}
  </article>`;
}

function blocoMedia(media, conceito, { final = false } = {}) {
  return `<div class="media-avaliacao">
    <div>
      <p class="rotulo-secao">${final ? "Média final" : "Média das avaliações"}</p>
      <p class="media-avaliacao-valor" data-media="${media}">${formatarNota(media)}</p>
    </div>
    <div class="media-avaliacao-conceito">
      <span class="badge ${conceito === "excelente" || conceito === "bom" ? "badge-sucesso" : conceito === "regular" ? "badge-atencao" : "badge-perigo"}">${ROTULOS_CONCEITO[conceito]}</span>
      <p class="registro-detalhe">${PERCENTUAL_CONCEITO[conceito]} no Shinatal${final ? "" : " após o ok do Presidente"}</p>
    </div>
  </div>`;
}

function animarMedias(raiz) {
  raiz.querySelectorAll("[data-media]").forEach((n) => {
    animarNumero(n, Number(n.dataset.media), { duracaoMs: 900, formatador: (v) => formatarNota(v) });
  });
}

function etapaDoCiclo(ciclo) {
  if (!ciclo) return { rotulo: "Aguardando escolha", classe: "badge-neutro" };
  if (ciclo.okPresidenteEm) return { rotulo: "Finalizada", classe: "badge-sucesso" };
  if (ciclo.parecer) return { rotulo: "Aguardando seu ok", classe: "badge-atencao" };
  if (avaliacoesConcluidas(ciclo)) return { rotulo: "Aguardando parecer", classe: "badge-info" };
  const c = ciclo.concluidas || {};
  const total = ciclo.rhDispensado ? 2 : 3;
  const feitas = [c.presidente, c.par, !ciclo.rhDispensado && c.rh].filter(Boolean).length;
  return { rotulo: `Em avaliação (${feitas}/${total})`, classe: "badge-info" };
}

function traduzirErro(erro, padrao) {
  if (erro?.code === "permission-denied") return `${padrao} O ciclo pode ter sido fechado ou a etapa já mudou. Recarregue a página.`;
  return padrao;
}

/* ------------------------------------------------------------------ */
/* Selo do ciclo                                                        */
/* ------------------------------------------------------------------ */

function renderSelo() {
  const selo = el("selo-ciclo");
  if (estado.config === undefined) return;
  selo.hidden = false;
  selo.className = `badge ${cicloAberto() ? "badge-sucesso" : "badge-neutro"}`;
  selo.textContent = cicloAberto() ? `Ciclo ${anoDoCiclo()} aberto` : `Ciclo ${anoDoCiclo()} fechado`;
}

/* ------------------------------------------------------------------ */
/* Avisos                                                               */
/* ------------------------------------------------------------------ */

function renderAvisos() {
  const pendencias = calcularPendencias(papel, perfil.uid, estado.ciclos)
    .filter((p) => p.tipo === "ok" || cicloAberto());
  const secao = el("secao-avisos");
  secao.hidden = !pendencias.length;
  if (!pendencias.length) return;
  el("avisos-total").textContent = pendencias.length === 1 ? "1 pendência" : `${pendencias.length} pendências`;
  el("lista-avisos").innerHTML = pendencias.map((p, i) => {
    const nome = escaparHTML(nomeDe(p.ciclo.uid));
    const [titulo, texto, botao, icone] = p.tipo === "ok"
      ? [`${nome} enviou o parecer`, "Leia a resposta e dê o ok para finalizar a avaliação.", "Revisar e dar ok", icones.ok]
      : p.papel === "par"
        ? [`Avalie ${nome}`, `Você foi escolhido(a) para avaliar ${escaparHTML(nomeDe(p.ciclo.uid, { completo: false }))} no ciclo ${p.ciclo.ano}.`, "Avaliar", icones.avaliar]
        : [`Avaliação de ${nome}`, `Como ${ROTULOS_PAPEL_AVALIADOR[p.papel]}, sua avaliação é obrigatória e precisa de comentário.`, "Avaliar", icones.avaliar];
    return `<li class="aviso-item" style="--i:${i}">
      <div class="flex items-start gap-3 min-w-0">
        <span class="aviso-icone" aria-hidden="true"><span class="material-symbols-outlined">${icone}</span></span>
        <div class="min-w-0">
          <p class="registro-titulo">${titulo}</p>
          <p class="registro-detalhe">${texto}</p>
        </div>
      </div>
      <button type="button" class="btn-pilula btn-pilula--solido btn-pilula--compacto shrink-0" data-aviso="${i}">${botao}</button>
    </li>`;
  }).join("");
  el("lista-avisos").querySelectorAll("[data-aviso]").forEach((b) => {
    b.addEventListener("click", () => {
      const p = pendencias[Number(b.dataset.aviso)];
      if (p.tipo === "ok") abrirRespostas(p.ciclo.uid);
      else abrirAvaliacao(p.ciclo, p.papel);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Meu processo                                                         */
/* ------------------------------------------------------------------ */

function renderLinhaDoTempo(ciclo) {
  const lista = el("linha-processo");
  const passos = passosDoCiclo(ciclo);
  const atual = passos.findIndex((p) => !p.feito);
  lista.innerHTML = passos.map((p, i) => {
    const situacao = p.feito ? "feito" : i === atual ? "atual" : "pendente";
    const leitura = p.feito ? "concluída" : i === atual ? "em andamento" : "pendente";
    return `<li class="linha-processo-passo" data-estado="${situacao}"${i === atual ? ' aria-current="step"' : ""}>
      <span class="linha-processo-marco" aria-hidden="true">${p.feito ? '<span class="material-symbols-outlined">check</span>' : i + 1}</span>
      <span class="linha-processo-rotulo">${p.rotulo}<span class="sr-only">: ${leitura}</span></span>
    </li>`;
  }).join("");
  // O fio é um único pseudo-elemento escalado (transform): só compositor, sem relayout. Dois
  // quadros de espera para a primeira pintura sair com 0 e a transição desenhar o avanço.
  const progresso = progressoDosPassos(passos);
  const aplicar = () => lista.style.setProperty("--progresso", String(progresso));
  if (reduzMovimento()) aplicar();
  else requestAnimationFrame(() => requestAnimationFrame(aplicar));
}

function opcoesDeColegas(selecionado = "") {
  const colegas = estado.diretorio
    .filter((u) => u.uid !== perfil.uid && !["presidente", "rh"].includes(u.role))
    .sort((a, b) => (a.primeiroNome || "").localeCompare(b.primeiroNome || "", "pt-BR"));
  return `<option value="">Selecione um colega</option>` + colegas.map((u) =>
    `<option value="${escaparHTML(u.uid)}" ${u.uid === selecionado ? "selected" : ""}>${escaparHTML(u.primeiroNome || "Colega")}${u.cargo ? ` · ${escaparHTML(u.cargo)}` : ""}</option>`
  ).join("");
}

function formEscolha(ciclo) {
  return `<form id="form-escolha" class="escolha-avaliador" novalidate>
    <label for="escolha-colega" class="label-shinatal">${ciclo ? "Trocar o colega que vai avaliar você" : "Quem vai avaliar você?"}</label>
    <div class="flex flex-col sm:flex-row gap-3">
      <select id="escolha-colega" required class="input-shinatal !pl-3 flex-1">${opcoesDeColegas(ciclo?.avaliadorUid)}</select>
      <button type="submit" class="btn-pilula btn-pilula--solido shrink-0">${ciclo ? "Salvar troca" : "Confirmar escolha"}</button>
    </div>
    <p class="registro-detalhe">Qualquer colaborador pode ser escolhido, menos o Presidente e o RH, que já avaliam todo mundo. Dá para trocar enquanto o colega ainda não avaliou.</p>
  </form>`;
}

function resumoAvaliadores(ciclo) {
  const c = ciclo.concluidas || {};
  const linha = (rotulo, feito, extra = "") => `<li class="resumo-avaliador">
      <span class="material-symbols-outlined ${feito ? "text-[var(--natal-pinheiro)]" : "text-on-surface-variant"}" aria-hidden="true">${feito ? icones.feito : icones.pendente}</span>
      <span class="flex-1 min-w-0">${rotulo}${extra}</span>
      <span class="badge ${feito ? "badge-sucesso" : "badge-neutro"}">${feito ? "Avaliou" : "Pendente"}</span>
    </li>`;
  return `<ul class="resumo-avaliadores">
    ${linha("Presidente", c.presidente)}
    ${ciclo.rhDispensado ? "" : linha("RH", c.rh)}
    ${linha(`Colega: <strong>${escaparHTML(nomeDe(ciclo.avaliadorUid, { completo: false }))}</strong>`, c.par,
      !c.par && cicloAberto() ? ` <button type="button" id="btn-trocar-colega" class="link-trocar">trocar</button>` : "")}
  </ul>`;
}

async function renderProcesso() {
  const secao = el("secao-processo");
  if (EH_PRESIDENTE) { secao.hidden = true; return; }
  if (estado.config === undefined || estado.meuCiclo === undefined) return;
  secao.hidden = false;
  const ciclo = estado.meuCiclo;
  const conteudo = el("processo-conteudo");
  el("processo-ano").textContent = `Ciclo ${anoDoCiclo()}`;
  renderLinhaDoTempo(ciclo);

  if (!ciclo) {
    conteudo.innerHTML = cicloAberto()
      ? formEscolha(null)
      : vazio(icones.espera, "A avaliação ainda não foi aberta", "Quando o Presidente abrir o ciclo do ano, você escolhe aqui quem vai avaliar você.");
    ligarFormEscolha(null);
    return;
  }

  if (!avaliacoesConcluidas(ciclo)) {
    conteudo.innerHTML = `<p class="registro-titulo">Suas avaliações estão em andamento</p>
      <p class="registro-detalhe">As respostas aparecem aqui assim que os três avaliadores terminarem.</p>
      ${resumoAvaliadores(ciclo)}
      ${estado.trocandoAvaliador ? formEscolha(ciclo) : ""}`;
    el("btn-trocar-colega")?.addEventListener("click", () => { estado.trocandoAvaliador = true; renderProcesso(); el("escolha-colega")?.focus(); });
    ligarFormEscolha(ciclo);
    return;
  }

  // Avaliações concluídas: busca as respostas uma vez (são imutáveis).
  if (!estado.respostasMeuCiclo) {
    conteudo.innerHTML = `<div class="skeleton h-24 w-full"></div>`;
    try {
      estado.respostasMeuCiclo = await buscarRespostas(ciclo);
    } catch (erro) {
      console.error(erro);
      conteudo.innerHTML = vazio(icones.erro, "Não foi possível carregar as respostas", "Recarregue a página para tentar de novo.");
      return;
    }
    if (estado.meuCiclo !== ciclo) return; // chegou um estado mais novo enquanto buscava
  }
  const respostas = estado.respostasMeuCiclo;
  const media = ciclo.okPresidenteEm ? ciclo.media : calcularMedia(Object.values(respostas));
  const conceito = ciclo.okPresidenteEm ? ciclo.conceito : conceitoPorMedia(media);
  const blocos = ["presidente", "rh", "par"]
    .filter((p) => !(p === "rh" && ciclo.rhDispensado))
    .map((p) => blocoResposta(p, respostas[p], ciclo)).join("");

  let rodape;
  if (!ciclo.parecer) {
    rodape = `<form id="form-parecer" class="parecer" novalidate>
      <label for="parecer-texto" class="label-shinatal">Seu parecer sobre a avaliação do Presidente</label>
      <p class="registro-detalhe !mt-0 mb-2">Leia o comentário do Presidente acima e responda. Depois do envio, o Presidente dá o ok e a avaliação é finalizada.</p>
      <textarea id="parecer-texto" required minlength="1" maxlength="2000" rows="4" class="input-shinatal !pl-3"></textarea>
      <div class="flex justify-end mt-3"><button type="submit" class="btn-pilula btn-pilula--solido"><span class="material-symbols-outlined" aria-hidden="true">send</span>Enviar parecer</button></div>
    </form>`;
  } else {
    rodape = `<div class="parecer parecer--enviado">
      <p class="rotulo-secao">Seu parecer</p>
      <blockquote class="resposta-comentario">${escaparHTML(ciclo.parecer)}</blockquote>
      ${ciclo.okPresidenteEm
        ? `<p class="registro-detalhe flex items-center gap-1.5"><span class="material-symbols-outlined text-base text-[var(--natal-pinheiro)]" aria-hidden="true">verified</span>Avaliação finalizada pelo Presidente.</p>`
        : `<p class="registro-detalhe">Aguardando o ok do Presidente.</p>`}
    </div>`;
  }

  conteudo.innerHTML = `${blocoMedia(media, conceito, { final: !!ciclo.okPresidenteEm })}
    <div class="respostas-grade">${blocos}</div>
    ${rodape}`;
  animarMedias(conteudo);

  el("form-parecer")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = el("parecer-texto").value.trim();
    if (!texto) { mostrarToast("Escreva o seu parecer antes de enviar.", "erro"); el("parecer-texto").focus(); return; }
    const ok = await confirmarAcao({ titulo: "Enviar parecer", mensagem: "Depois de enviado, o parecer não pode ser alterado.", textoConfirmar: "Enviar" });
    if (!ok) return;
    const botao = e.submitter || e.currentTarget.querySelector("[type=submit]");
    botao.disabled = true;
    try {
      await enviarParecer(ciclo, texto);
      mostrarToast("Parecer enviado. Agora é com o Presidente.", "sucesso");
    } catch (erro) {
      console.error(erro);
      mostrarToast(traduzirErro(erro, "Não foi possível enviar o parecer."), "erro");
      botao.disabled = false;
    }
  });
}

function ligarFormEscolha(ciclo) {
  const form = el("form-escolha");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const avaliadorUid = el("escolha-colega").value;
    if (!avaliadorUid) { mostrarToast("Escolha um colega.", "erro"); el("escolha-colega").focus(); return; }
    if (ciclo && avaliadorUid === ciclo.avaliadorUid) { estado.trocandoAvaliador = false; renderProcesso(); return; }
    const botao = form.querySelector("[type=submit]");
    botao.disabled = true;
    try {
      await escolherAvaliador({ ano: anoDoCiclo(), uid: perfil.uid, avaliadorUid, cicloExiste: !!ciclo });
      estado.trocandoAvaliador = false;
      mostrarToast(`${nomeDe(avaliadorUid, { completo: false })} vai avaliar você.`, "sucesso");
    } catch (erro) {
      console.error(erro);
      mostrarToast(traduzirErro(erro, "Não foi possível salvar a escolha. Confira se o colega está ativo."), "erro");
      botao.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Modal: responder                                                     */
/* ------------------------------------------------------------------ */

function abrirModal(id) { const m = el(id); m.classList.remove("hidden"); m.classList.add("flex"); }
function fecharModal(id) { const m = el(id); m.classList.add("hidden"); m.classList.remove("flex"); }

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-fechar-modal]")) {
    const modal = e.target.closest('[role="dialog"]');
    if (modal) fecharModal(modal.id);
  } else if (e.target.matches('[role="dialog"][id^="modal-"]')) {
    fecharModal(e.target.id); // clique no fundo escurecido
  }
});

function abrirAvaliacao(ciclo, papelAvaliador) {
  estado.avaliacaoAberta = { ciclo, papel: papelAvaliador };
  const obrigatorio = papelAvaliador !== "par";
  el("avaliar-papel").innerHTML = `<span class="rotulo-numero" aria-hidden="true">${String(ciclo.ano).slice(-2)}</span><span class="fio-natal" aria-hidden="true"></span><span>Você avalia como ${escaparHTML(ROTULOS_PAPEL_AVALIADOR[papelAvaliador])}</span>`;
  el("avaliar-titulo").textContent = `Avaliação de ${nomeDe(ciclo.uid)}`;
  el("avaliar-perguntas").innerHTML = perguntasAtuais().map((pergunta, i) => `
    <fieldset class="pergunta-avaliacao">
      <legend><span class="pergunta-numero">${String(i + 1).padStart(2, "0")}</span>${escaparHTML(pergunta)}</legend>
      <div class="escala-nota">
        ${Array.from({ length: 11 }, (_, n) => `
          <label class="escala-opcao">
            <input type="radio" name="nota-${i}" value="${n}" class="sr-only" />
            <span>${n}</span>
          </label>`).join("")}
      </div>
      <div class="escala-legenda" aria-hidden="true"><span>Muito abaixo</span><span>Excelente</span></div>
    </fieldset>`).join("");
  const comentario = el("avaliar-comentario");
  comentario.value = "";
  comentario.required = obrigatorio;
  comentario.minLength = obrigatorio ? COMENTARIO_MINIMO : 0;
  el("avaliar-comentario-rotulo").textContent = obrigatorio ? "Comentário (obrigatório)" : "Comentário (opcional)";
  el("avaliar-comentario-ajuda").textContent = obrigatorio
    ? `Mínimo de ${COMENTARIO_MINIMO} caracteres. ${papelAvaliador === "presidente" ? "O colaborador vai ler e responder a este texto." : "O colaborador vai ler este texto."}`
    : "Se quiser, complemente as notas com um comentário. O colaborador vai ler.";
  atualizarPrevia();
  el("form-avaliar").querySelector("[type=submit]").disabled = false;
  abrirModal("modal-avaliar");
}

function notasDoFormulario() {
  return perguntasAtuais().map((_, i) => {
    const marcado = el("form-avaliar").querySelector(`input[name="nota-${i}"]:checked`);
    return marcado ? Number(marcado.value) : null;
  });
}

function atualizarPrevia() {
  const notas = notasDoFormulario();
  const respondidas = notas.filter((n) => n !== null);
  el("avaliar-media-previa").textContent = respondidas.length
    ? `${respondidas.length} de 5 respondidas · média ${formatarNota(calcularMedia([{ notas: respondidas }]))}`
    : "Escolha uma nota de 0 a 10 para cada pergunta.";
}
el("form-avaliar").addEventListener("change", (e) => {
  if (e.target.matches('input[type="radio"]')) {
    e.target.closest("fieldset")?.removeAttribute("data-invalida");
    atualizarPrevia();
  }
});

el("form-avaliar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const aberta = estado.avaliacaoAberta;
  if (!aberta) return;
  const notas = notasDoFormulario();
  const faltando = notas.findIndex((n) => n === null);
  if (faltando >= 0) {
    const campo = el("avaliar-perguntas").querySelectorAll("fieldset")[faltando];
    campo.setAttribute("data-invalida", "");
    campo.querySelector("input").focus();
    mostrarToast(`Falta a nota da pergunta ${faltando + 1}.`, "erro");
    return;
  }
  const comentario = el("avaliar-comentario").value.trim();
  if (aberta.papel !== "par" && comentario.length < COMENTARIO_MINIMO) {
    el("avaliar-comentario").setAttribute("aria-invalid", "true");
    el("avaliar-comentario").focus();
    mostrarToast(`O comentário é obrigatório (mínimo de ${COMENTARIO_MINIMO} caracteres).`, "erro");
    return;
  }
  const ok = await confirmarAcao({
    titulo: "Enviar avaliação",
    mensagem: `Média ${formatarNota(calcularMedia([{ notas }]))}. Depois de enviada, a avaliação não pode ser alterada.`,
    textoConfirmar: "Enviar"
  });
  if (!ok) return;
  const botao = e.currentTarget.querySelector("[type=submit]");
  botao.disabled = true;
  try {
    await enviarResposta({ ciclo: aberta.ciclo, papel: aberta.papel, avaliadorUid: perfil.uid, perguntas: perguntasAtuais(), notas, comentario });
    fecharModal("modal-avaliar");
    estado.avaliacaoAberta = null;
    mostrarToast("Avaliação enviada. Obrigado!", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast(traduzirErro(erro, "Não foi possível enviar a avaliação."), "erro");
    botao.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Gestão (Presidente)                                                  */
/* ------------------------------------------------------------------ */

function avaliaveis() {
  return [...estado.usuarios.values()]
    .filter((u) => u.role !== "presidente" && (u.status || "ativo") === "ativo" && !u.motivoPerdaIntegral)
    .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
}

function renderGestao() {
  const secao = el("secao-gestao");
  if (!EH_PRESIDENTE || estado.config === undefined) { secao.hidden = true; return; }
  secao.hidden = false;
  const ano = anoDoCiclo();
  const pessoas = avaliaveis();
  const porUid = new Map(estado.ciclos.map((c) => [c.uid, c]));
  const escolheram = pessoas.filter((u) => porUid.has(u.uid)).length;
  const finalizadas = pessoas.filter((u) => porUid.get(u.uid)?.okPresidenteEm).length;

  el("gestao-ciclo").innerHTML = `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="gestao-numeros">
        <div><p class="stat-rotulo">Colaboradores</p><p class="stat-valor">${pessoas.length}</p></div>
        <div><p class="stat-rotulo">Escolheram o avaliador</p><p class="stat-valor">${escolheram}</p></div>
        <div><p class="stat-rotulo">Finalizadas</p><p class="stat-valor">${finalizadas}</p></div>
      </div>
      <button type="button" id="btn-ciclo" class="btn-pilula ${cicloAberto() ? "btn-pilula--vidro" : "btn-pilula--solido"} btn-pilula--compacto shrink-0">
        <span class="material-symbols-outlined" aria-hidden="true">${cicloAberto() ? icones.fechar : icones.abrir}</span>${cicloAberto() ? `Fechar ciclo ${ano}` : `Abrir ciclo ${ANO_CORRENTE}`}
      </button>
    </div>`;
  el("btn-ciclo").addEventListener("click", alternarCiclo);

  const termo = el("busca-gestao").value.trim().toLowerCase();
  const linhas = pessoas.filter((u) => !termo || `${u.nome} ${u.cargo || ""}`.toLowerCase().includes(termo));
  el("corpo-gestao").innerHTML = linhas.length ? linhas.map((u) => {
    const ciclo = porUid.get(u.uid);
    const etapa = etapaDoCiclo(ciclo);
    const media = ciclo?.okPresidenteEm ? formatarNota(ciclo.media) : "—";
    const presidentePendente = ciclo && !ciclo.concluidas?.presidente && cicloAberto();
    return `<tr>
      <td class="celula-principal" data-rotulo="Colaborador">
        <div class="flex items-center gap-3 min-w-0">${avatar(u.uid)}
          <div class="min-w-0"><p class="registro-titulo truncate">${escaparHTML(u.nome)}</p><p class="registro-detalhe truncate">${escaparHTML(u.cargo || "Sem cargo")}</p></div>
        </div>
      </td>
      <td data-rotulo="Etapa"><span class="badge ${etapa.classe}">${etapa.rotulo}</span></td>
      <td class="num" data-rotulo="Média">${media}</td>
      <td class="celula-acoes">
        <div class="flex justify-end gap-2">
          ${presidentePendente ? `<button type="button" class="btn-pilula btn-pilula--solido btn-pilula--compacto" data-avaliar="${escaparHTML(u.uid)}">Avaliar</button>` : ""}
          ${ciclo ? `<button type="button" class="btn-pilula btn-pilula--vidro btn-pilula--compacto" data-respostas="${escaparHTML(u.uid)}">Ver respostas</button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="4">${vazio(icones.ninguem, termo ? "Ninguém encontrado" : "Nenhum colaborador ativo")}</td></tr>`;
}

el("busca-gestao").addEventListener("input", debounce(renderGestao, 150));
el("corpo-gestao").addEventListener("click", (e) => {
  const avaliar = e.target.closest("[data-avaliar]");
  if (avaliar) {
    const ciclo = estado.ciclos.find((c) => c.uid === avaliar.dataset.avaliar);
    if (ciclo) abrirAvaliacao(ciclo, "presidente");
    return;
  }
  const ver = e.target.closest("[data-respostas]");
  if (ver) abrirRespostas(ver.dataset.respostas);
});

async function alternarCiclo(e) {
  const abrir = !cicloAberto();
  const ano = abrir ? ANO_CORRENTE : anoDoCiclo();
  const ok = await confirmarAcao(abrir
    ? { titulo: `Abrir ciclo ${ano}`, mensagem: "Todos os colaboradores poderão escolher o avaliador, e as avaliações ficam liberadas.", textoConfirmar: "Abrir ciclo" }
    : { titulo: `Fechar ciclo ${ano}`, mensagem: "Novas escolhas e avaliações ficam bloqueadas. Pareceres e oks continuam possíveis.", textoConfirmar: "Fechar ciclo", perigo: true });
  if (!ok) return;
  const botao = e.currentTarget;
  botao.disabled = true;
  try {
    await salvarConfig({ ativo: abrir, ano, perguntas: perguntasAtuais() }, perfil.uid);
    mostrarToast(abrir ? `Ciclo ${ano} aberto.` : `Ciclo ${ano} fechado.`, "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível atualizar o ciclo.", "erro");
    botao.disabled = false;
  }
}

async function abrirRespostas(uid) {
  const ciclo = estado.ciclos.find((c) => c.uid === uid);
  if (!ciclo) return;
  el("respostas-titulo").textContent = `Avaliação de ${nomeDe(uid)}`;
  const corpo = el("respostas-corpo");
  const rodape = el("respostas-rodape");
  corpo.innerHTML = `<div class="skeleton h-24 w-full"></div>`;
  rodape.hidden = true;
  abrirModal("modal-respostas");
  let respostas;
  try {
    respostas = await buscarRespostas(ciclo);
  } catch (erro) {
    console.error(erro);
    corpo.innerHTML = vazio(icones.erro, "Não foi possível carregar as respostas");
    return;
  }
  const existentes = Object.values(respostas).filter(Boolean);
  const media = ciclo.okPresidenteEm ? ciclo.media : calcularMedia(existentes);
  const etapa = etapaDoCiclo(ciclo);
  corpo.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <span class="badge ${etapa.classe}">${etapa.rotulo}</span>
      <span class="registro-detalhe !mt-0">Colega escolhido: <strong>${escaparHTML(nomeDe(ciclo.avaliadorUid))}</strong></span>
    </div>
    ${media !== null ? blocoMedia(media, ciclo.okPresidenteEm ? ciclo.conceito : conceitoPorMedia(media), { final: !!ciclo.okPresidenteEm }) : ""}
    ${!avaliacoesConcluidas(ciclo) && media !== null ? `<p class="registro-detalhe mb-4">Média parcial: ainda faltam avaliações.</p>` : ""}
    <div class="respostas-grade">
      ${["presidente", "rh", "par"].filter((p) => !(p === "rh" && ciclo.rhDispensado)).map((p) => blocoResposta(p, respostas[p], ciclo)).join("")}
    </div>
    <div class="parecer parecer--enviado">
      <p class="rotulo-secao">Parecer do colaborador</p>
      ${ciclo.parecer ? `<blockquote class="resposta-comentario">${escaparHTML(ciclo.parecer)}</blockquote>` : `<p class="registro-detalhe">Ainda não enviado.</p>`}
    </div>`;
  animarMedias(corpo);

  const acoes = [];
  const avaliadoEhRh = estado.usuarios.get(uid)?.role === "rh";
  if (avaliadoEhRh && !ciclo.concluidas?.rh && !ciclo.rhDispensado) {
    acoes.push(`<button type="button" id="btn-dispensar-rh" class="btn-pilula btn-pilula--vidro">Dispensar etapa do RH</button>`);
  }
  if (ciclo.parecer && !ciclo.okPresidenteEm) {
    acoes.push(`<button type="button" id="btn-dar-ok" class="btn-pilula btn-pilula--solido"><span class="material-symbols-outlined" aria-hidden="true">task_alt</span>Dar ok e finalizar</button>`);
  }
  rodape.hidden = !acoes.length;
  rodape.innerHTML = acoes.join("");

  el("btn-dar-ok")?.addEventListener("click", async (e) => {
    const conceito = conceitoPorMedia(media);
    const ok = await confirmarAcao({
      titulo: "Finalizar avaliação",
      mensagem: `Média ${formatarNota(media)}: conceito ${ROTULOS_CONCEITO[conceito]} (${PERCENTUAL_CONCEITO[conceito]} no Shinatal). Esta ação não pode ser desfeita.`,
      textoConfirmar: "Dar ok"
    });
    if (!ok) return;
    e.currentTarget.disabled = true;
    try {
      const resultado = await darOk(ciclo, perfil, nomeDe(uid));
      mostrarToast(`Avaliação finalizada: ${ROTULOS_CONCEITO[resultado.conceito]} (${formatarNota(resultado.media)}).`, "sucesso");
      fecharModal("modal-respostas");
    } catch (erro) {
      console.error(erro);
      mostrarToast(traduzirErro(erro, "Não foi possível finalizar a avaliação."), "erro");
      e.currentTarget.disabled = false;
    }
  });
  el("btn-dispensar-rh")?.addEventListener("click", async (e) => {
    const ok = await confirmarAcao({
      titulo: "Dispensar etapa do RH",
      mensagem: "Use só quando não houver outra pessoa no RH para avaliar este colaborador. A média passa a usar duas avaliações.",
      textoConfirmar: "Dispensar"
    });
    if (!ok) return;
    e.currentTarget.disabled = true;
    try {
      await dispensarRH(ciclo);
      mostrarToast("Etapa do RH dispensada.", "sucesso");
      fecharModal("modal-respostas");
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível dispensar a etapa.", "erro");
      e.currentTarget.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Perguntas (Presidente e Admin)                                       */
/* ------------------------------------------------------------------ */

let perguntasRenderizadas = false;
function renderPerguntas() {
  const secao = el("secao-perguntas");
  if (!PODE_EDITAR_PERGUNTAS || estado.config === undefined) { secao.hidden = true; return; }
  secao.hidden = false;
  // Não reescreve os campos a cada atualização do Firestore: apagaria o que a pessoa digita.
  if (perguntasRenderizadas && el("form-perguntas").contains(document.activeElement)) return;
  perguntasRenderizadas = true;
  el("lista-perguntas").innerHTML = perguntasAtuais().map((p, i) => `
    <li>
      <label for="pergunta-${i}" class="label-shinatal">Pergunta ${i + 1}</label>
      <input id="pergunta-${i}" required minlength="3" maxlength="300" class="input-shinatal !pl-3" type="text" value="${escaparHTML(p)}" />
    </li>`).join("");
}

el("form-perguntas").addEventListener("submit", async (e) => {
  e.preventDefault();
  const perguntas = perguntasAtuais().map((_, i) => el(`pergunta-${i}`).value.trim());
  const invalida = perguntas.findIndex((p) => p.length < 3);
  if (invalida >= 0) {
    el(`pergunta-${invalida}`).focus();
    mostrarToast("Cada pergunta precisa de pelo menos 3 caracteres.", "erro");
    return;
  }
  const botao = e.currentTarget.querySelector("[type=submit]");
  botao.disabled = true;
  try {
    await salvarConfig({ ativo: !!estado.config?.ativo, ano: anoDoCiclo(), perguntas }, perfil.uid);
    mostrarToast("Perguntas salvas.", "sucesso");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar as perguntas.", "erro");
  } finally {
    botao.disabled = false;
  }
});

/* ------------------------------------------------------------------ */

function renderTudo() {
  renderSelo();
  renderAvisos();
  renderProcesso();
  renderGestao();
  renderPerguntas();
}
renderTudo();
