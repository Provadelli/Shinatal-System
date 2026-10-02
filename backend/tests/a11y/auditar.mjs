// Auditoria automatizada de acessibilidade do Shinatal — axe-core (o motor do axe DevTools) e
// Lighthouse, rodando no Chrome instalado contra uma cópia local do site.
//
// Nunca toca produção: o site é copiado para uma pasta temporária, com js/firebase-init.js
// apontado para os emuladores de Auth/Firestore (projeto fictício "demo-shinatal") e o Turnstile
// desligado. As firestore.rules reais valem no emulador, então o que se audita é o app de verdade,
// logado, com dados de exemplo — inclusive modais, abas e diálogos de confirmação abertos.
//
// Rodar (a partir desta pasta):  npm install && npm test
// Variáveis opcionais:  CHROME_PATH=<caminho do chrome>   SEM_LIGHTHOUSE=1 (só axe, mais rápido)
//
// Saída: resumo no terminal + relatorio/ultimo.json. Sai com código 1 se o axe achar violação ou
// se alguma página ficar abaixo de 100 em Acessibilidade no Lighthouse.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, "../../..");
const SITE = path.join(os.tmpdir(), "shinatal-a11y-site");
const PORTA = 5055;
const BASE = `http://127.0.0.1:${PORTA}`;
const PROJETO = "demo-shinatal";
const HOST_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const HOST_FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const SENHA = "Auditoria#2026";
const TAGS_AXE = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/* ------------------------------------------------------------------ */
/* 1. Cópia do site apontada para os emuladores                        */
/* ------------------------------------------------------------------ */
function prepararSite() {
  rmSync(SITE, { recursive: true, force: true });
  cpSync(path.join(RAIZ, "frontend"), SITE, { recursive: true });

  const init = path.join(SITE, "js/firebase-init.js");
  const [hostFs, portaFs] = HOST_FIRESTORE.split(":");
  writeFileSync(init, readFileSync(init, "utf8").replace(/projectId: "[^"]*"/, `projectId: "${PROJETO}"`) + `
import { connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
connectAuthEmulator(auth, "http://${HOST_AUTH}", { disableWarnings: true });
connectFirestoreEmulator(db, "${hostFs}", ${Number(portaFs)});
`);

  const turnstile = path.join(SITE, "js/turnstile-config.js");
  writeFileSync(turnstile, readFileSync(turnstile, "utf8")
    .replace(/export const TURNSTILE_SITE_KEY = "[^"]*"/, `export const TURNSTILE_SITE_KEY = "SUBSTITUA_AQUI"`)
    .replace(/export const TURNSTILE_CONFIGURADO =[\s\S]*?;/, "export const TURNSTILE_CONFIGURADO = false;"));
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webp": "image/webp", ".png": "image/png", ".mp4": "video/mp4", ".json": "application/json", ".txt": "text/plain"
};

/** Servidor estático com as mesmas URLs limpas do Firebase Hosting (/gestao -> gestao.html). */
function servir() {
  return http.createServer((req, res) => {
    let caminho = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (caminho === "/") caminho = "/index.html";
    let arquivo = path.join(SITE, caminho);
    if (!path.extname(arquivo) && existsSync(`${arquivo}.html`)) arquivo += ".html";
    let status = 200;
    if (!arquivo.startsWith(SITE) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) {
      arquivo = path.join(SITE, "404.html");
      status = 404;
    }
    res.writeHead(status, { "Content-Type": MIME[path.extname(arquivo)] || "application/octet-stream" });
    createReadStream(arquivo).pipe(res);
  }).listen(PORTA, "127.0.0.1");
}

/* ------------------------------------------------------------------ */
/* 2. Dados de exemplo nos emuladores                                  */
/* ------------------------------------------------------------------ */
const DONO = { "Content-Type": "application/json", Authorization: "Bearer owner" };

async function criarConta(email) {
  const r = await fetch(`http://${HOST_AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: SENHA, returnSecureToken: true })
  });
  const dados = await r.json();
  if (!r.ok) throw new Error(`Falha ao criar ${email}: ${JSON.stringify(dados)}`);
  await fetch(`http://${HOST_AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJETO}/accounts:update`, {
    method: "POST", headers: DONO, body: JSON.stringify({ localId: dados.localId, emailVerified: true })
  });
  return dados.localId;
}

function valor(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)])) } };
}

async function gravar(caminho, dados) {
  const r = await fetch(`http://${HOST_FIRESTORE}/v1/projects/${PROJETO}/databases/(default)/documents/${caminho}`, {
    method: "PATCH", headers: DONO, body: JSON.stringify(valor(dados).mapValue)
  });
  if (!r.ok) throw new Error(`Falha ao gravar ${caminho}: ${await r.text()}`);
}

async function semear() {
  const ano = new Date().getFullYear();
  const agora = new Date();
  const perfil = (nome, email, cargo, role) => ({
    nome, email, cargo, cargaHoraria: 8, role, status: "ativo", motivoPerdaIntegral: null,
    fotoBase64: null, dataAdmissao: `${ano - 1}-03-01`, dataDesligamento: null, criadoEm: agora
  });
  const contas = {
    pres: perfil("Paula Presidente", "presidente@shinerio.com", "Presidência", "presidente"),
    dp: perfil("Dora Pessoal", "dp@shinerio.com", "Departamento Pessoal", "dp"),
    ana: perfil("Ana Souza", "ana@shinerio.com", "Operações", "colaborador"),
    bruno: perfil("Bruno Lima", "bruno@shinerio.com", "Financeiro", "colaborador")
  };
  const uid = {};
  for (const [chave, p] of Object.entries(contas)) {
    uid[chave] = await criarConta(p.email);
    await gravar(`usuarios/${uid[chave]}`, p);
    if (p.role !== "presidente") {
      await gravar(`diretorioPublico/${uid[chave]}`, { primeiroNome: p.nome.split(" ")[0], cargo: p.cargo, role: p.role });
    }
  }

  await gravar("faltas/f1", { uid: uid.ana, data: `${ano}-03-10`, justificada: false, tipoJustificativa: null, motivo: "Não compareceu", registradoPor: uid.dp, criadoEm: agora });
  await gravar("faltas/f2", { uid: uid.ana, data: `${ano}-05-02`, justificada: true, tipoJustificativa: "atestado", motivo: "Atestado médico", registradoPor: uid.dp, criadoEm: agora });
  await gravar("atrasos/a1", { uid: uid.ana, mesAno: `${ano}-04`, quantidadeAtrasos: 7, registradoPor: uid.dp, criadoEm: agora });
  await gravar("advertencias/v1", { uid: uid.ana, data: `${ano}-06-15`, tipo: "verbal", motivo: "Uso indevido de equipamento", registradoPor: uid.dp, criadoEm: agora });
  await gravar("avaliacoes/av1", { uid: uid.ana, data: `${ano}-07-01`, ano, conceito: "bom", justificativa: "Bom semestre", validadoRH: true, avaliadoPor: uid.pres, criadoEm: agora });
  await gravar("contratos/c1", { uid: uid.ana, dataAtivacao: `${ano}-02-01`, dataEncerramento: null, valorCredito: 150, status: "ativo", registradoPor: uid.pres, criadoEm: agora });

  const contratoEmp = (nomeEmpresa, cnpj, status) => ({
    nomeEmpresa, cnpj, valorContrato: 12000, dataInicio: `${ano}-01-01`, dataFimPrevista: `${ano}-12-31`,
    dataFimPrevistaOriginal: `${ano}-12-31`, duracaoMesesPrevista: 12, quantidadeFuncionariosIniciais: 10,
    status, dataEncerramentoReal: status === "encerrado" ? `${ano}-08-31` : null,
    saidasIniciais: [{ quantidade: 1, data: `${ano}-05-01`, motivo: "Pedido de demissão" }],
    entradasContrato: [{ quantidade: 2, dataEntrada: `${ano}-04-01`, dataSaida: null, motivo: "Reforço" }],
    pausas: [], pausasQuadroInicial: [], pausasEntradas: [],
    historicoMovimentacoes: [{ tipo: "criacao", descricao: "Crédito inicial lançado: 10 funcionário(s) × 12 meses previstos", fundoAntes: 0, fundoDepois: 1500, data: agora, registradoPor: uid.pres }],
    registradoPor: uid.pres, criadoEm: agora
  });
  await gravar("contratosEmpresariais/e1", contratoEmp("Condomínio Atlântica", "11222333000181", "ativo"));
  await gravar("contratosEmpresariais/e2", contratoEmp("Edifício Guanabara", "44555666000172", "encerrado"));

  await gravar(`fundo/${ano}`, { arrecadado: 3000, estornos: 500, saldoDisponivel: 2500, somaPesos: 4, totalContratosAtivos: 1, totalContratosEncerrados: 1, atualizadoEm: agora, atualizadoPor: uid.pres });
  await gravar("estatisticas/publico", { arrecadado: 3000, colaboradores: 22, colaboradoresAnosAnteriores: 120, atualizadoEm: agora });
  await gravar("configuracoes/avaliacaoConduta", { ativo: true, atualizadoPor: uid.pres, atualizadoEm: agora });
  await gravar("solicitacoes/s1", {
    tipo: "avaliacao", descricao: "Avaliação de desempenho (excelente) para Bruno Lima", alvoUid: uid.bruno, alvoNome: "Bruno Lima",
    dadosAcao: { uid: uid.bruno, data: `${ano}-07-01`, ano, conceito: "excelente", justificativa: "Destaque do semestre", validadoRH: true, avaliadoPor: uid.dp, criadoEm: agora },
    status: "pendente", solicitadoPorUid: uid.dp, solicitadoPorNome: "Dora Pessoal", criadoEm: agora
  });
  await gravar("logs/l1", { tipo: "falta", descricao: `Falta injustificada lançada em ${ano}-03-10`, alvoUid: uid.ana, alvoNome: "Ana Souza", operadorUid: uid.dp, operadorNome: "Dora Pessoal", criadoEm: agora });
  return uid;
}

/* ------------------------------------------------------------------ */
/* 3. Navegador                                                        */
/* ------------------------------------------------------------------ */
function caminhoDoChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"
  ].filter(Boolean);
  const achado = candidatos.find((c) => existsSync(c));
  if (!achado) throw new Error("Chrome não encontrado — defina CHROME_PATH.");
  return achado;
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a página assentar: splash escondida, revelações ao rolar disparadas, animações no fim. */
async function assentar(pagina) {
  await pagina.waitForFunction(() => {
    const s = document.getElementById("tela-carregamento");
    return !s || getComputedStyle(s).display === "none";
  }, { timeout: 8000 }).catch(() => {});
  await pagina.evaluate(async () => {
    const passo = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += passo) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await pausa(1100);
}

const relatorio = { axe: [], teclado: [], lighthouse: [] };

async function axe(pagina, rotulo) {
  await pagina.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const r = await pagina.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
    const resumir = (lista) => lista.map((v) => ({
      id: v.id, impacto: v.impact, ajuda: v.help, nos: v.nodes.length,
      exemplos: v.nodes.slice(0, 4).map((n) => ({ alvo: n.target.join(" "), html: n.html.slice(0, 160), resumo: (n.failureSummary || "").replace(/\s+/g, " ").slice(0, 260) }))
    }));
    return { violacoes: resumir(res.violations), incompletos: resumir(res.incomplete), aprovados: res.passes.length };
  }, TAGS_AXE);
  relatorio.axe.push({ estado: rotulo, ...r });
  if (process.env.CAPTURAS) {
    const pasta = path.join(__dirname, "relatorio/capturas");
    mkdirSync(pasta, { recursive: true });
    const nome = rotulo.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    await pagina.screenshot({ path: path.join(pasta, `${nome}.png`) });
  }
  const n = r.violacoes.reduce((s, v) => s + v.nos, 0);
  console.log(`  axe  ${n === 0 ? "ok " : "FALHA"}  ${rotulo}${n ? `  — ${r.violacoes.map((v) => `${v.id}(${v.nos})`).join(", ")}` : ""}`);
}

function conferir(rotulo, ok, detalhe = "") {
  relatorio.teclado.push({ verificacao: rotulo, ok, detalhe });
  console.log(`  tecl ${ok ? "ok " : "FALHA"}  ${rotulo}${ok ? "" : `  — ${detalhe}`}`);
}

async function entrar(pagina, email) {
  await pagina.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await pagina.evaluate(() => new Promise((ok) => { const r = indexedDB.deleteDatabase("firebaseLocalStorageDb"); r.onsuccess = r.onerror = r.onblocked = () => ok(); }));
  await pagina.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await pagina.type("#email", email);
  await pagina.type("#senha", SENHA);
  await Promise.all([
    pagina.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
    pagina.click("#btn-entrar")
  ]);
}

/** Clica no primeiro elemento VISÍVEL que casa com o seletor (desktop e mobile têm botões duplicados). */
async function clicarVisivel(pagina, seletor) {
  const ok = await pagina.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0);
    if (!el) return false;
    el.focus();
    el.click();
    return true;
  }, seletor);
  if (!ok) throw new Error(`Nenhum elemento visível para ${seletor}`);
  await pausa(500);
}

/** Abre um modal, audita com axe e confere o comportamento de teclado (foco dentro, Esc, foco de volta). */
async function auditarModal(pagina, rotulo, seletorGatilho, idModal) {
  await clicarVisivel(pagina, seletorGatilho);
  await pagina.waitForFunction((id) => !document.getElementById(id).classList.contains("hidden"), { timeout: 5000 }, idModal);
  await pausa(450);
  await axe(pagina, rotulo);
  const focoDentro = await pagina.evaluate((id) => document.getElementById(id).contains(document.activeElement), idModal);
  conferir(`${rotulo}: foco entra no diálogo`, focoDentro);
  // Tab muitas vezes: o foco nunca pode escapar para a página atrás do diálogo.
  let escapou = false;
  for (let i = 0; i < 25 && !escapou; i++) {
    await pagina.keyboard.press("Tab");
    escapou = !(await pagina.evaluate((id) => document.getElementById(id).contains(document.activeElement), idModal));
  }
  conferir(`${rotulo}: Tab fica preso no diálogo`, !escapou);
  await pagina.keyboard.press("Escape");
  await pausa(250);
  const r = await pagina.evaluate((id, sel) => ({
    fechado: document.getElementById(id).classList.contains("hidden"),
    focoVoltou: [...document.querySelectorAll(sel)].includes(document.activeElement)
  }), idModal, seletorGatilho);
  conferir(`${rotulo}: Esc fecha`, r.fechado);
  conferir(`${rotulo}: foco volta para quem abriu`, r.focoVoltou);
}

async function rodarLighthouse(navegador, caminho, rotulo) {
  if (process.env.SEM_LIGHTHOUSE) return;
  const { default: lighthouse } = await import("lighthouse");
  const resultado = await lighthouse(`${BASE}${caminho}`, {
    port: Number(new URL(navegador.wsEndpoint()).port),
    output: "json", logLevel: "error",
    onlyCategories: ["accessibility", "best-practices", "seo"],
    disableStorageReset: true // mantém a sessão do Firebase Auth (IndexedDB) nas páginas logadas
  });
  const { categories, audits } = resultado.lhr;
  const nota = (c) => Math.round((categories[c]?.score ?? 0) * 100);
  const reprovados = categories.accessibility.auditRefs
    .map((ref) => audits[ref.id])
    .filter((a) => a.score !== null && a.score < 1)
    .map((a) => ({ id: a.id, titulo: a.title, itens: (a.details?.items || []).slice(0, 4).map((i) => i.node?.snippet || i.node?.selector || "").filter(Boolean) }));
  // Só informativo (não reprova a auditoria): o que tirou ponto em Boas práticas e SEO.
  const outros = ["best-practices", "seo"].flatMap((c) => categories[c].auditRefs
    .map((ref) => audits[ref.id]).filter((a) => a.score !== null && a.score < 1).map((a) => `${c}: ${a.id}`));
  relatorio.lighthouse.push({ pagina: rotulo, acessibilidade: nota("accessibility"), boasPraticas: nota("best-practices"), seo: nota("seo"), reprovados, outros });
  console.log(`  LH   ${nota("accessibility") === 100 ? "ok " : "FALHA"}  ${rotulo}  — acessibilidade ${nota("accessibility")}, boas práticas ${nota("best-practices")}, SEO ${nota("seo")}${reprovados.length ? `  [${reprovados.map((a) => a.id).join(", ")}]` : ""}`);
}

/* ------------------------------------------------------------------ */
/* 4. Roteiro                                                          */
/* ------------------------------------------------------------------ */
const DESKTOP = { width: 1366, height: 900 };
const CELULAR = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function visitar(pagina, caminho, rotulo, viewport = DESKTOP) {
  await pagina.setViewport(viewport);
  await pagina.goto(`${BASE}${caminho}`, { waitUntil: "networkidle2", timeout: 30000 });
  await assentar(pagina);
  await axe(pagina, rotulo);
}

async function principal() {
  prepararSite();
  const servidor = servir();
  await semear();
  const navegador = await puppeteer.launch({ executablePath: caminhoDoChrome(), headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const pagina = await navegador.newPage();
  pagina.on("pageerror", (e) => console.log(`  [erro de script na página] ${e.message}`));

  try {
    console.log("\n== Páginas públicas");
    for (const [caminho, rotulo] of [["/", "home"], ["/login", "login"], ["/cadastro", "cadastro"], ["/recuperar-senha", "recuperar senha"], ["/privacidade", "privacidade"], ["/pagina-que-nao-existe", "404"]]) {
      await visitar(pagina, caminho, `${rotulo} (desktop)`);
    }
    await visitar(pagina, "/", "home (celular)", CELULAR);
    await visitar(pagina, "/login", "login (celular)", CELULAR);

    // Controle de movimento da home (WCAG 2.2.2).
    await pagina.setViewport(DESKTOP);
    await pagina.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await assentar(pagina);
    await clicarVisivel(pagina, "[data-pausar-movimento]");
    const pausado = await pagina.evaluate(() => ({
      classe: document.documentElement.classList.contains("movimento-pausado"),
      video: document.getElementById("video-hero").paused,
      faixa: getComputedStyle(document.querySelector(".faixa-fotos-pista")).animationPlayState,
      aria: document.querySelector("[data-pausar-movimento]").getAttribute("aria-pressed")
    }));
    conferir("home: botão pausa o vídeo e as faixas", pausado.classe && pausado.video && pausado.faixa === "paused" && pausado.aria === "true", JSON.stringify(pausado));
    await clicarVisivel(pagina, "[data-pausar-movimento]");
    // "Pular para o conteúdo": primeiro Tab da página, e Enter leva o foco ao <main>.
    await pagina.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await assentar(pagina);
    await pagina.keyboard.press("Tab");
    const primeiro = await pagina.evaluate(() => document.activeElement?.className || "");
    await pagina.keyboard.press("Enter");
    const noMain = await pagina.evaluate(() => document.activeElement?.tagName === "MAIN");
    conferir("login: primeiro Tab é 'Pular para o conteúdo' e Enter leva o foco ao <main>", primeiro.includes("pular-conteudo") && noMain, `primeiro=${primeiro} main=${noMain}`);

    for (const [caminho, rotulo] of [["/", "home"], ["/login", "login"], ["/cadastro", "cadastro"], ["/recuperar-senha", "recuperar senha"], ["/privacidade", "privacidade"]]) {
      await rodarLighthouse(navegador, caminho, rotulo);
    }

    console.log("\n== Colaborador (Ana)");
    await pagina.setViewport(DESKTOP);
    await entrar(pagina, "ana@shinerio.com");
    await visitar(pagina, "/dashboard", "painel do colaborador (desktop)");
    for (const m of ["faltas", "advertencias", "regras", "conduta"]) {
      await auditarModal(pagina, `painel do colaborador · modal ${m}`, `[data-abrir-modal="modal-${m}"]`, `modal-${m}`);
    }
    await clicarVisivel(pagina, "[aria-controls='conteudo-regras-resumo']");
    const sanfona = await pagina.evaluate(() => document.querySelector("[aria-controls='conteudo-regras-resumo']").getAttribute("aria-expanded"));
    conferir("painel do colaborador: sanfona das regras informa aria-expanded", sanfona === "true", sanfona);
    await axe(pagina, "painel do colaborador · regras expandidas");
    await visitar(pagina, "/dashboard", "painel do colaborador (celular)", CELULAR);
    await visitar(pagina, "/perfil", "meu perfil (desktop)");
    await rodarLighthouse(navegador, "/dashboard", "painel do colaborador");
    await rodarLighthouse(navegador, "/perfil", "meu perfil");

    console.log("\n== Presidente (Paula)");
    await pagina.setViewport(DESKTOP);
    await entrar(pagina, "presidente@shinerio.com");
    await visitar(pagina, "/gestao", "painel de gestão (desktop)");
    await auditarModal(pagina, "gestão · modal nova ação", `[data-nova-acao="falta"]`, "modal-nova-acao");
    await auditarModal(pagina, "gestão · modal novo colaborador", `[data-abrir-modal="modal-novo-colaborador"]`, "modal-novo-colaborador");
    await auditarModal(pagina, "gestão · modal log", `[data-abrir-modal="modal-log"]`, "modal-log");
    await auditarModal(pagina, "gestão · modal solicitações", `[data-abrir-modal="modal-solicitacoes"]`, "modal-solicitacoes");
    await auditarModal(pagina, "gestão · modal conduta", `[data-abrir-modal="modal-conduta"]`, "modal-conduta");
    await auditarModal(pagina, "gestão · modal perfil", `[data-ver-perfil-uid]`, "modal-perfil");
    await auditarModal(pagina, "gestão · modal editar colaborador", `[data-editar-uid]`, "modal-editar-colaborador");
    await auditarModal(pagina, "gestão · modal colaboradores anteriores", `[data-abrir-modal="modal-colaboradores-anteriores"]`, "modal-colaboradores-anteriores");

    // Diálogo de confirmação (confirmarAcao): foco em "Cancelar" numa ação destrutiva, Esc cancela.
    await clicarVisivel(pagina, "[data-excluir-uid]");
    await pausa(300);
    await axe(pagina, "gestão · diálogo de confirmação");
    const conf = await pagina.evaluate(() => ({ aberto: !!document.querySelector('[role="alertdialog"]'), foco: document.activeElement?.hasAttribute("data-cancelar") }));
    conferir("gestão · confirmação: abre com foco em Cancelar", conf.aberto && conf.foco, JSON.stringify(conf));
    await pagina.keyboard.press("Escape");
    await pausa(200);
    const conf2 = await pagina.evaluate(() => ({ fechado: !document.querySelector('[role="alertdialog"]'), foco: document.activeElement?.hasAttribute("data-excluir-uid") }));
    conferir("gestão · confirmação: Esc cancela e devolve o foco", conf2.fechado && conf2.foco, JSON.stringify(conf2));

    await visitar(pagina, "/gestao", "painel de gestão (celular)", CELULAR);

    await visitar(pagina, "/contratos", "contratos (desktop)");
    await clicarVisivel(pagina, "[data-editar-contrato]");
    await pausa(500);
    await axe(pagina, "contratos · modal, aba dados");
    // Abas pelo teclado: seta para a direita muda de aba e de painel.
    await pagina.focus("#tab-btn-dados");
    await pagina.keyboard.press("ArrowRight");
    await pausa(250);
    const aba = await pagina.evaluate(() => ({
      selecionada: document.getElementById("tab-btn-funcionarios").getAttribute("aria-selected"),
      painelVisivel: !document.getElementById("painel-funcionarios").classList.contains("hidden"),
      foco: document.activeElement?.id
    }));
    conferir("contratos: seta → troca de aba (aria-selected, painel e foco)", aba.selecionada === "true" && aba.painelVisivel && aba.foco === "tab-btn-funcionarios", JSON.stringify(aba));
    await axe(pagina, "contratos · modal, aba funcionários");
    await pagina.keyboard.press("ArrowRight");
    await pausa(250);
    await axe(pagina, "contratos · modal, aba histórico");
    await pagina.keyboard.press("Escape");
    await visitar(pagina, "/contratos", "contratos (celular)", CELULAR);
    await rodarLighthouse(navegador, "/gestao", "painel de gestão");
    await rodarLighthouse(navegador, "/contratos", "contratos");
  } finally {
    await navegador.close();
    servidor.close();
  }

  /* ---------------- resumo ---------------- */
  const violacoes = relatorio.axe.flatMap((e) => e.violacoes.map((v) => ({ estado: e.estado, ...v })));
  const porRegra = {};
  for (const v of violacoes) (porRegra[v.id] ||= { impacto: v.impacto, ajuda: v.ajuda, nos: 0, estados: [], exemplos: v.exemplos }).nos += v.nos, porRegra[v.id].estados.push(v.estado);
  const incompletos = {};
  for (const e of relatorio.axe) for (const v of e.incompletos) incompletos[v.id] = (incompletos[v.id] || 0) + v.nos;
  const tecladoFalhas = relatorio.teclado.filter((t) => !t.ok);
  const lhFalhas = relatorio.lighthouse.filter((l) => l.acessibilidade < 100 || l.reprovados.length);

  console.log("\n================ RESUMO ================");
  console.log(`axe-core: ${relatorio.axe.length} estados auditados, ${violacoes.reduce((s, v) => s + v.nos, 0)} violações em ${Object.keys(porRegra).length} regra(s)`);
  for (const [id, r] of Object.entries(porRegra)) {
    console.log(`  [${r.impacto}] ${id} — ${r.ajuda} (${r.nos} nó(s); ex.: ${[...new Set(r.estados)].slice(0, 3).join(" | ")})`);
    for (const ex of r.exemplos.slice(0, 2)) console.log(`      ${ex.alvo}\n      ${ex.resumo}`);
  }
  console.log(`axe "precisa de revisão manual": ${Object.entries(incompletos).map(([k, n]) => `${k}(${n})`).join(", ") || "nada"}`);
  console.log(`teclado: ${relatorio.teclado.length - tecladoFalhas.length}/${relatorio.teclado.length} verificações ok`);
  for (const l of relatorio.lighthouse) console.log(`Lighthouse ${l.pagina}: acessibilidade ${l.acessibilidade} · boas práticas ${l.boasPraticas} · SEO ${l.seo}`);
  const outros = [...new Set(relatorio.lighthouse.flatMap((l) => l.outros))];
  if (outros.length) console.log(`Lighthouse, fora de acessibilidade (informativo): ${outros.join(", ")}`);
  for (const l of relatorio.lighthouse) for (const a of l.reprovados) console.log(`  ${l.pagina}: ${a.id} — ${a.titulo}\n      ${a.itens.join("\n      ")}`);

  mkdirSync(path.join(__dirname, "relatorio"), { recursive: true });
  writeFileSync(path.join(__dirname, "relatorio/ultimo.json"), JSON.stringify(relatorio, null, 2));
  process.exitCode = violacoes.length || tecladoFalhas.length || lhFalhas.length ? 1 : 0;
}

await principal();
