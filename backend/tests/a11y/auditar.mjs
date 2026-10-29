// Auditoria automatizada de acessibilidade do Shinatal — axe-core (o motor do axe DevTools) e
// Lighthouse, rodando no Chrome instalado contra uma cópia local do site.
//
// Nunca toca produção: o site é copiado para uma pasta temporária, com js/firebase-config.js
// apontado para os emuladores de Auth/Firestore (projeto fictício "demo-shinatal") e o Turnstile
// desligado. As firestore.rules reais valem no emulador, então o que se audita é o app de verdade,
// logado, com dados de exemplo — inclusive modais, abas e diálogos de confirmação abertos.
//
// Rodar (a partir desta pasta):  npm install && npm test
// Variáveis opcionais:  CHROME_PATH=<caminho do chrome>   SEM_LIGHTHOUSE=1 (só axe, mais rápido)
// Performance (celular em todas as páginas, desktop nas públicas) sai no relatório, mas não reprova.
//
// A Content-Security-Policy de produção (firebase.json) também é servida aqui — só com os
// emuladores acrescentados ao connect-src —, e qualquer bloqueio dela conta como falha: assim a
// CSP é provada contra o app inteiro logado, não só a página inicial.
//
// Saída: resumo no terminal + relatorio/ultimo.json. Sai com código 1 se o axe achar violação ou
// se alguma página ficar abaixo de 100 em Acessibilidade no Lighthouse.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } from "node:fs";
import { createRequire } from "node:module";
import { createGzip } from "node:zlib";
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
// Versão vigente dos Termos/Política (frontend/js/lgpd-config.js) — as contas de teste nascem com ela.
const VERSAO_TERMOS = readFileSync(path.join(RAIZ, "frontend/js/lgpd-config.js"), "utf8").match(/VERSAO_TERMOS = "([^"]+)"/)[1];
const TAGS_AXE = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/* ------------------------------------------------------------------ */
/* 1. Cópia do site apontada para os emuladores                        */
/* ------------------------------------------------------------------ */
function prepararSite() {
  rmSync(SITE, { recursive: true, force: true });
  cpSync(path.join(RAIZ, "frontend"), SITE, { recursive: true });

  const init = path.join(SITE, "js/firebase-init.js");
  const config = path.join(SITE, "js/firebase-config.js");
  const [hostFs, portaFs] = HOST_FIRESTORE.split(":");
  // A configuração real vem codificada (CONFIG_CODIFICADA, em firebase-config.js); aqui ela é trocada
  // por uma fictícia do projeto demo, sem reCAPTCHA (App Check desligado), e a API REST que a home
  // usa passa a apontar para o emulador. O script falha se alguma dessas linhas mudar de forma.
  const LINHA_CONFIG = "const { recaptchaSiteKey, ...firebaseConfig } = decodificar(CONFIG_CODIFICADA);";
  const LINHA_REST = 'export const FIRESTORE_REST = "https://firestore.googleapis.com/v1";';
  const fonteConfig = readFileSync(config, "utf8");
  if (!fonteConfig.includes(LINHA_CONFIG) || !fonteConfig.includes(LINHA_REST)) {
    throw new Error("firebase-config.js mudou: não achei a linha da configuração ou da API REST.");
  }
  const configDemo = { apiKey: "demo-api-key", authDomain: `${PROJETO}.firebaseapp.com`, projectId: PROJETO, appId: "demo-app" };
  writeFileSync(config, fonteConfig
    .replace(LINHA_CONFIG, `const recaptchaSiteKey = ""; const firebaseConfig = ${JSON.stringify(configDemo)};`)
    .replace(LINHA_REST, `export const FIRESTORE_REST = "http://${HOST_FIRESTORE}/v1";`));
  const fonteInit = readFileSync(init, "utf8");
  writeFileSync(init, fonteInit + `
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

/** CSP de produção (firebase.json), com os emuladores locais liberados no connect-src. */
function cspLocal() {
  const fb = JSON.parse(readFileSync(path.join(RAIZ, "firebase.json"), "utf8"));
  const csp = fb.hosting.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
  return csp
    .split(/;\s*/)
    .filter((d) => d !== "upgrade-insecure-requests") // o servidor local é http
    .map((d) => (d.startsWith("connect-src ")
      // emuladores + fonts.googleapis.com, que o próprio axe-core baixa via fetch para analisar o CSS
      ? `${d} http://${HOST_AUTH} http://${HOST_FIRESTORE} https://fonts.googleapis.com`
      : d))
    .join("; ");
}
const CSP_LOCAL = cspLocal();
const bloqueiosCsp = [];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webp": "image/webp", ".png": "image/png", ".mp4": "video/mp4", ".json": "application/json", ".txt": "text/plain",
  ".woff2": "font/woff2"
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
    const cabecalhos = { "Content-Type": MIME[path.extname(arquivo)] || "application/octet-stream" };
    if (arquivo.endsWith(".html")) cabecalhos["Content-Security-Policy"] = CSP_LOCAL;
    // Texto comprimido como no Firebase Hosting — senão o Lighthouse mede um site mais pesado que o real.
    const comprimir = /\.(html|js|css|json|txt)$/.test(arquivo) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (comprimir) cabecalhos["Content-Encoding"] = "gzip";
    res.writeHead(status, cabecalhos);
    const leitura = createReadStream(arquivo);
    (comprimir ? leitura.pipe(createGzip()) : leitura).pipe(res);
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
  // Contas de teste já com o aceite dos termos na versão vigente (senão o diálogo de aceite da
  // LGPD cobriria todas as páginas logadas). A Carla fica SEM aceite, para auditar esse diálogo.
  const perfil = (nome, email, cargo, role, aceite = true) => ({
    nome, email, cargo, cargaHoraria: 8, role, status: "ativo", motivoPerdaIntegral: null,
    fotoBase64: null, dataAdmissao: `${ano - 1}-03-01`, dataDesligamento: null, criadoEm: agora,
    ...(aceite ? { aceiteTermos: { versao: VERSAO_TERMOS, aceitoEm: agora } } : {})
  });
  const contas = {
    pres: perfil("Paula Presidente", "presidente@shinerio.com", "Presidência", "presidente"),
    dp: perfil("Dora Pessoal", "dp@shinerio.com", "Departamento Pessoal", "dp"),
    ana: perfil("Ana Souza", "ana@shinerio.com", "Operações", "colaborador"),
    bruno: perfil("Bruno Lima", "bruno@shinerio.com", "Financeiro", "colaborador"),
    carla: perfil("Carla Nunes", "carla@shinerio.com", "Operações", "colaborador", false)
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

const relatorio = { axe: [], teclado: [], lighthouse: [], performance: [], icones: [] };

/** Com CAPTURAS=1, salva a tela atual em relatorio/capturas/<rotulo>.png (conferência visual). */
async function capturar(pagina, rotulo) {
  if (!process.env.CAPTURAS) return;
  const pasta = path.join(__dirname, "relatorio/capturas");
  mkdirSync(pasta, { recursive: true });
  const nome = rotulo.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  await pagina.screenshot({ path: path.join(pasta, `${nome}.png`) });
}

const FONTE_AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

async function axe(pagina, rotulo) {
  // Injetado via CDP (evaluate), não como <script>: a CSP do site proíbe script inline e deve
  // continuar valendo durante a auditoria.
  await pagina.evaluate(FONTE_AXE);
  const r = await pagina.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
    const resumir = (lista) => lista.map((v) => ({
      id: v.id, impacto: v.impact, ajuda: v.help, nos: v.nodes.length,
      exemplos: v.nodes.slice(0, 4).map((n) => ({ alvo: n.target.join(" "), html: n.html.slice(0, 160), resumo: (n.failureSummary || "").replace(/\s+/g, " ").slice(0, 260) }))
    }));
    return { violacoes: resumir(res.violations), incompletos: resumir(res.incomplete), aprovados: res.passes.length };
  }, TAGS_AXE);
  relatorio.axe.push({ estado: rotulo, ...r });
  // A fonte de ícones vem só com os ícones listados (scripts/fonte-icones.mjs). Um ícone fora da
  // lista aparece como o nome escrito ("visibility_off"), bem mais largo que o próprio tamanho.
  const semDesenho = await pagina.evaluate(async () => {
    await document.fonts.ready;
    return [...document.querySelectorAll(".material-symbols-outlined")]
      .filter((el) => el.getClientRects().length && el.textContent.trim().length > 2)
      .filter((el) => el.scrollWidth > parseFloat(getComputedStyle(el).fontSize) * 1.6)
      .map((el) => el.textContent.trim());
  });
  for (const nome of new Set(semDesenho)) relatorio.icones.push({ estado: rotulo, nome });
  if (semDesenho.length) console.log(`  icon FALHA  ${rotulo} — sem desenho: ${[...new Set(semDesenho)].join(", ")} (rode npm run icones)`);
  await capturar(pagina, rotulo);
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

/** Métricas de Performance (Core Web Vitals) de um resultado do Lighthouse — só informativo. */
function metricasPerformance(lhr) {
  const a = lhr.audits;
  const ms = (id) => Math.round(a[id]?.numericValue ?? 0);
  return {
    nota: Math.round((lhr.categories.performance?.score ?? 0) * 100),
    fcp: ms("first-contentful-paint"), lcp: ms("largest-contentful-paint"), tbt: ms("total-blocking-time"),
    si: ms("speed-index"), cls: Number((a["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
    peso: Math.round((a["total-byte-weight"]?.numericValue ?? 0) / 1024),
    oportunidades: Object.values(a)
      .filter((x) => x.score !== null && x.score < 1 && (x.details?.overallSavingsMs > 100 || x.details?.overallSavingsBytes > 20000))
      .map((x) => `${x.id} (${Math.round(x.details.overallSavingsMs || 0)} ms, ${Math.round((x.details.overallSavingsBytes || 0) / 1024)} KB)`),
    // Diagnóstico: de onde vem o tempo de CPU (TBT) e o que se desloca (CLS).
    scriptsPesados: (a["bootup-time"]?.details?.items || []).slice(0, 4)
      .map((i) => `${String(i.url).replace(BASE, "").slice(-70)} ${Math.round(i.scripting)} ms`),
    trabalhoPrincipal: (a["mainthread-work-breakdown"]?.details?.items || []).slice(0, 4)
      .map((i) => `${i.groupLabel || i.group} ${Math.round(i.duration)} ms`),
    deslocamentos: (a["layout-shifts"]?.details?.items || a["layout-shift-elements"]?.details?.items || []).slice(0, 3)
      .map((i) => `${i.node?.selector || i.node?.snippet || "?"} (${Number(i.score ?? 0).toFixed(3)})`),
    maioresArquivos: (a["network-requests"]?.details?.items || [])
      .sort((x, y) => (y.transferSize || 0) - (x.transferSize || 0)).slice(0, 4)
      .map((i) => `${String(i.url).replace(BASE, "").slice(-60)} ${Math.round((i.transferSize || 0) / 1024)} KB`)
  };
}

/** Performance em desktop (só páginas públicas) — o run principal já mede o celular. */
async function rodarLighthouseDesktop(navegador, caminho, rotulo) {
  if (process.env.SEM_LIGHTHOUSE) return;
  const { default: lighthouse } = await import("lighthouse");
  const { default: configDesktop } = await import("lighthouse/core/config/desktop-config.js");
  const r = await lighthouse(`${BASE}${caminho}`, {
    port: Number(new URL(navegador.wsEndpoint()).port), output: "json", logLevel: "error",
    onlyCategories: ["performance"], disableStorageReset: true
  }, configDesktop);
  const p = metricasPerformance(r.lhr);
  relatorio.performance.push({ pagina: rotulo, dispositivo: "desktop", ...p });
  console.log(`  PERF desktop  ${rotulo} — ${p.nota} (LCP ${p.lcp} ms, CLS ${p.cls}, TBT ${p.tbt} ms, ${p.peso} KB)`);
}

async function rodarLighthouse(navegador, caminho, rotulo) {
  if (process.env.SEM_LIGHTHOUSE) return;
  const { default: lighthouse } = await import("lighthouse");
  const resultado = await lighthouse(`${BASE}${caminho}`, {
    port: Number(new URL(navegador.wsEndpoint()).port),
    output: "json", logLevel: "error",
    onlyCategories: ["accessibility", "best-practices", "seo", "performance"],
    disableStorageReset: true // mantém a sessão do Firebase Auth (IndexedDB) nas páginas logadas
  });
  // Performance é só informativa (não reprova): no servidor local os números variam a cada rodada.
  const perf = metricasPerformance(resultado.lhr);
  relatorio.performance.push({ pagina: rotulo, dispositivo: "celular", ...perf });
  console.log(`  PERF celular  ${rotulo} — ${perf.nota} (LCP ${perf.lcp} ms, CLS ${perf.cls}, TBT ${perf.tbt} ms, ${perf.peso} KB)`);
  const { categories, audits } = resultado.lhr;
  const nota = (c) => Math.round((categories[c]?.score ?? 0) * 100);
  const reprovados = categories.accessibility.auditRefs
    .map((ref) => audits[ref.id])
    .filter((a) => a.score !== null && a.score < 1)
    .map((a) => ({ id: a.id, titulo: a.title, itens: (a.details?.items || []).slice(0, 4).map((i) => i.node?.snippet || i.node?.selector || "").filter(Boolean) }));
  // Só informativo (não reprova a auditoria): o que tirou ponto em Boas práticas e SEO.
  const outros = ["best-practices", "seo"].flatMap((c) => categories[c].auditRefs
    .map((ref) => audits[ref.id]).filter((a) => a.score !== null && a.score < 1).map((a) => `${c}: ${a.id}`));
  if (process.env.DIAGNOSTICO) {
    for (const id of ["errors-in-console", "inspector-issues", "image-aspect-ratio"]) {
      const itens = audits[id]?.score === 1 ? [] : (audits[id]?.details?.items || []);
      for (const i of itens.slice(0, 4)) {
        console.log(`    [${id}] ${rotulo}: ${String(i.description || i.issueType || i.url || i.node?.snippet || JSON.stringify(i.subItems?.items?.[0] || i)).slice(0, 220)}`);
      }
    }
  }
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
  // Sem isto, o resultado depende do Windows/macOS da máquina: com as animações do sistema
  // desligadas, o Chrome reporta prefers-reduced-motion e o botão "Pausar animações" some.
  await pagina.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  pagina.on("pageerror", (e) => console.log(`  [erro de script na página] ${e.message}`));
  pagina.on("console", (m) => {
    if (!/Content Security Policy/i.test(m.text())) return;
    bloqueiosCsp.push({ url: pagina.url(), texto: m.text() });
    console.log(`  [CSP bloqueou] ${m.text()}`);
  });

  try {
    console.log("\n== Páginas públicas");
    for (const [caminho, rotulo] of [["/", "home"], ["/login", "login"], ["/cadastro", "cadastro"], ["/recuperar-senha", "recuperar senha"], ["/privacidade", "privacidade"], ["/termos", "termos de uso"], ["/pagina-que-nao-existe", "404"]]) {
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

    // Footer compacto (mesmas cores e hovers do completo) — só captura.
    await pagina.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pausa(400);
    await capturar(pagina, "login · footer compacto");

    // Footer da home.
    await pagina.setViewport(DESKTOP);
    await pagina.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await assentar(pagina);
    await pagina.evaluate(() => document.querySelector("footer").scrollIntoView({ block: "end", behavior: "instant" }));
    await pausa(900);
    await capturar(pagina, "home · footer em repouso");
    await axe(pagina, "home · footer");
    // Hover do "fio dourado" num link do rodapé e num botão — só captura.
    await pagina.hover(".footer-nav-link");
    await pausa(500);
    await capturar(pagina, "home · footer, hover em link");

    // Header: no desktop as opções são só texto; no celular, botão "Menu".
    await pagina.evaluate(() => window.scrollTo(0, 0));
    await pagina.mouse.move(5, 300);
    await pausa(400);
    await pagina.hover(".nav-link");
    await pausa(450);
    await capturar(pagina, "home · header desktop, hover");
    await pagina.setViewport(CELULAR);
    await pagina.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await assentar(pagina);
    await clicarVisivel(pagina, "[data-menu-alternar]");
    const menu = await pagina.evaluate(() => ({
      expandido: document.querySelector("[data-menu-alternar]").getAttribute("aria-expanded"),
      visivel: !document.getElementById("menu-celular").hidden,
      semIcone: !document.querySelector(".header-flutuante .material-symbols-outlined")
    }));
    conferir("home (celular): Menu abre o painel, informa aria-expanded, e o header não tem ícones", menu.expandido === "true" && menu.visivel && menu.semIcone, JSON.stringify(menu));
    await axe(pagina, "home (celular) · menu aberto");
    await pagina.keyboard.press("Escape");
    await pausa(200);
    const menu2 = await pagina.evaluate(() => ({
      fechado: document.getElementById("menu-celular").hidden,
      foco: document.activeElement?.hasAttribute("data-menu-alternar"),
      expandido: document.querySelector("[data-menu-alternar]").getAttribute("aria-expanded")
    }));
    conferir("home (celular): Esc fecha o menu e devolve o foco ao botão", menu2.fechado && menu2.foco && menu2.expandido === "false", JSON.stringify(menu2));
    await pagina.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pausa(500);
    await capturar(pagina, "home (celular) · footer");
    await pagina.setViewport(DESKTOP);

    for (const [caminho, rotulo] of [["/", "home"], ["/login", "login"], ["/cadastro", "cadastro"], ["/recuperar-senha", "recuperar senha"], ["/privacidade", "privacidade"], ["/termos", "termos de uso"]]) {
      await rodarLighthouse(navegador, caminho, rotulo);
      await rodarLighthouseDesktop(navegador, caminho, rotulo);
    }

    // LGPD — caixa de aceite do cadastro: sem marcar, o erro aparece e o foco vai para a caixa.
    console.log("\n== LGPD");
    await pagina.goto(`${BASE}/cadastro`, { waitUntil: "networkidle2" });
    await assentar(pagina);
    await pagina.type("#nome", "Teste Aceite");
    await pagina.type("#cargo", "Operações");
    await pagina.evaluate(() => { document.getElementById("dataAdmissao").value = "2025-01-10"; });
    await pagina.type("#email", "teste.aceite@shinerio.com");
    await pagina.type("#senha", SENHA);
    await pagina.type("#confirmarSenha", SENHA);
    await pagina.click("#btn-cadastrar");
    await pausa(300);
    const semAceite = await pagina.evaluate(() => ({
      erro: !document.getElementById("erro-form").classList.contains("hidden"),
      foco: document.activeElement?.id,
      invalido: document.getElementById("aceiteTermos").getAttribute("aria-invalid")
    }));
    conferir("cadastro: sem marcar o aceite, mostra erro e leva o foco à caixa", semAceite.erro && semAceite.foco === "aceiteTermos" && semAceite.invalido === "true", JSON.stringify(semAceite));
    await axe(pagina, "cadastro · erro do aceite dos termos");

    // LGPD — conta sem aceite (Carla): o diálogo bloqueia a página até aceitar.
    await entrar(pagina, "carla@shinerio.com");
    await pagina.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
    await pausa(400);
    await axe(pagina, "diálogo de aceite dos termos (1º acesso)");
    const dialogo = () => pagina.evaluate(() => {
      const d = document.querySelector('[role="alertdialog"]');
      return { aberto: Boolean(d), focoDentro: Boolean(d && d.contains(document.activeElement)) };
    });
    conferir("aceite: foco começa dentro do diálogo", (await dialogo()).focoDentro);
    for (let i = 0; i < 8; i++) await pagina.keyboard.press("Tab");
    conferir("aceite: Tab fica preso no diálogo", (await dialogo()).focoDentro);
    await pagina.keyboard.press("Escape");
    await pausa(200);
    conferir("aceite: Esc NÃO fecha (o aceite é obrigatório)", (await dialogo()).aberto);
    await pagina.click("[data-aceitar]");
    await pausa(300);
    const semMarcar = await pagina.evaluate(() => ({
      erro: !document.getElementById("aceite-erro").classList.contains("hidden"),
      foco: document.activeElement?.id
    }));
    conferir("aceite: sem marcar a caixa, mostra erro e foca a caixa", semMarcar.erro && semMarcar.foco === "aceite-caixa", JSON.stringify(semMarcar));
    await axe(pagina, "diálogo de aceite · erro");
    await pagina.click("#aceite-caixa");
    await pagina.click("[data-aceitar]");
    await pagina.waitForFunction(() => !document.querySelector('[role="alertdialog"]'), { timeout: 10000 }).catch(() => {});
    const liberado = await pagina.evaluate(() => ({
      fechou: !document.querySelector('[role="alertdialog"]'),
      inerte: [...document.body.children].some((el) => el.inert)
    }));
    conferir("aceite: aceitar grava o registro e libera a página", liberado.fechou && !liberado.inerte, JSON.stringify(liberado));
    await pagina.reload({ waitUntil: "networkidle2" });
    await pausa(1500);
    conferir("aceite: depois de aceitar, não pergunta de novo", !(await dialogo()).aberto);

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
    // Hovers do painel (fio dourado no cartão de ação e na linha da tabela) — só captura.
    await pagina.hover('[data-nova-acao="advertencia"]');
    await pausa(500);
    await capturar(pagina, "gestão · hover em ação rápida");
    await pagina.hover("#corpo-diretorio tr");
    await pausa(400);
    await capturar(pagina, "gestão · hover em linha da tabela");
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
  console.log(`CSP: ${bloqueiosCsp.length} bloqueio(s)${bloqueiosCsp.length ? " — " + [...new Set(bloqueiosCsp.map((b) => b.texto.slice(0, 160)))].join(" | ") : ""}`);
  console.log(`teclado: ${relatorio.teclado.length - tecladoFalhas.length}/${relatorio.teclado.length} verificações ok`);
  for (const l of relatorio.lighthouse) console.log(`Lighthouse ${l.pagina}: acessibilidade ${l.acessibilidade} · boas práticas ${l.boasPraticas} · SEO ${l.seo}`);
  const outros = [...new Set(relatorio.lighthouse.flatMap((l) => l.outros))];
  if (outros.length) console.log(`Lighthouse, fora de acessibilidade (informativo): ${outros.join(", ")}`);
  for (const p of relatorio.performance) {
    console.log(`Performance ${p.pagina} (${p.dispositivo}): ${p.nota} · LCP ${p.lcp} ms · FCP ${p.fcp} ms · CLS ${p.cls} · TBT ${p.tbt} ms · ${p.peso} KB`);
    if (p.oportunidades.length) console.log(`    oportunidades: ${p.oportunidades.join(", ")}`);
    if (process.env.DIAGNOSTICO) {
      console.log(`    CPU: ${p.trabalhoPrincipal.join(" · ")}\n    scripts: ${p.scriptsPesados.join(" · ")}`);
      console.log(`    maiores: ${p.maioresArquivos.join(" · ")}${p.deslocamentos.length ? `\n    deslocamentos: ${p.deslocamentos.join(" · ")}` : ""}`);
    }
  }
  for (const l of relatorio.lighthouse) for (const a of l.reprovados) console.log(`  ${l.pagina}: ${a.id} — ${a.titulo}\n      ${a.itens.join("\n      ")}`);

  mkdirSync(path.join(__dirname, "relatorio"), { recursive: true });
  writeFileSync(path.join(__dirname, "relatorio/ultimo.json"), JSON.stringify({ ...relatorio, csp: bloqueiosCsp }, null, 2));
  console.log(`ícones: ${relatorio.icones.length ? relatorio.icones.map((i) => `${i.nome} (${i.estado})`).join(", ") + " sem desenho" : "todos desenhados"}`);
  process.exitCode = violacoes.length || tecladoFalhas.length || lhFalhas.length || bloqueiosCsp.length || relatorio.icones.length ? 1 : 0;
}

await principal();
