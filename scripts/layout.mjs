// Shinatal — aplica as partes de layout compartilhadas (cabeçalho e rodapé) em todas as páginas,
// inclusive a página inicial em React (app/index.html, que só recebe o rodapé: o cabeçalho dela é
// o componente Cabecalho.tsx).
//
// Dois cabeçalhos, uma fonte cada (scripts/partials/):
//   - cabecalho-publico.html: páginas abertas (login, cadastro, termos...). Mesmo desenho do
//     cabeçalho da home: logo, links em mono e os botões vazados "Entrar" e "Cadastro".
//   - cabecalho-sistema.html: páginas logadas. Traz TODOS os itens de todos os papéis, marcados
//     com data-papeis; js/cabecalho-sistema.js remove o que o papel de quem entrou não usa. Assim
//     nenhum item "some" de uma página para outra: o cabeçalho é literalmente o mesmo em todas.
// O item da página atual ganha aria-current="page" aqui, na hora de gravar (sem JS).
//
// Dois rodapés: o COMPLETO (chamada, navegação, contato) só nas páginas públicas de conteúdo; o
// COMPACTO (uma linha: ©, links institucionais, versão) no login, no cadastro e nas páginas
// internas — lá a pessoa está trabalhando, e um rodapé grande só distrai.
//
// O HTML não é montado por JS em tempo de execução (atrasaria a página e sumiria sem JS): este
// script grava o bloco em cada arquivo, entre os marcadores <!-- cabecalho:inicio/fim --> e
// <!-- rodape:inicio/fim -->. Roda sozinho no `npm run build`; rode `npm run layout` ao editar
// um partial durante o desenvolvimento.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSAO = "v3.0";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = path.join(RAIZ, "frontend");
const hoje = new Date();
const valores = {
  ANO: String(hoje.getFullYear()),
  VERSAO,
  ATUALIZADO: hoje.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
};

const partial = (nome) =>
  readFileSync(path.join(RAIZ, "scripts", "partials", `${nome}.html`), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\{\{(\w+)\}\}/g, (_, chave) => valores[chave] ?? "")
    .trimEnd();

const PAGINAS_RODAPE_COMPLETO = new Set(["index.html", "termos.html", "privacidade.html"]);
const PAGINAS_SEM_RODAPE = new Set(["login.html", "cadastro.html", "recuperar-senha.html"]);
const rodapes = { completo: partial("rodape"), compacto: partial("rodape-compacto") };
const cabecalhos = { publico: partial("cabecalho-publico"), sistema: partial("cabecalho-sistema") };

/** Página → cabeçalho e item marcado como atual. Página fora daqui não recebe cabeçalho. */
const CABECALHO_POR_PAGINA = {
  "login.html": ["publico", "login"],
  "cadastro.html": ["publico", "cadastro"],
  "recuperar-senha.html": ["publico", "login"],
  "termos.html": ["publico", "termos"],
  "privacidade.html": ["publico", "privacidade"],
  "404.html": ["publico", null],
  "dashboard.html": ["sistema", "dashboard"],
  "faltas.html": ["sistema", "faltas"],
  "advertencias.html": ["sistema", "advertencias"],
  "gestao.html": ["sistema", "gestao"],
  "contratos.html": ["sistema", "contratos"],
  "atividade.html": ["sistema", "atividade"],
  "solicitacoes.html": ["sistema", "solicitacoes"],
  "conduta.html": ["sistema", "conduta"],
  "regulamento.html": ["sistema", "regulamento"],
  "perfil.html": ["sistema", "perfil"]
};

const BLOCO_RODAPE = /<!-- rodape:inicio -->[\s\S]*?<!-- rodape:fim -->/;
const FOOTER_ANTIGO = /<footer\b[\s\S]*?<\/footer>/;
const BLOCO_CABECALHO = /<!-- cabecalho:inicio -->[\s\S]*?<!-- cabecalho:fim -->/;

function marcarAtual(html, item) {
  if (!item) return html;
  return html.replaceAll(`data-item="${item}"`, `data-item="${item}" aria-current="page"`);
}

const paginas = [
  ...readdirSync(FRONT).filter((f) => f.endsWith(".html")).map((f) => path.join(FRONT, f)),
  path.join(RAIZ, "app", "index.html")
];

let alteradas = 0;
for (const caminho of paginas) {
  const arquivo = path.basename(caminho);
  const original = readFileSync(caminho, "utf8");
  const crlf = original.includes("\r\n");
  let texto = original.replace(/\r\n/g, "\n");

  // Sem rodapé nas telas de acesso e nas páginas logadas: lá a pessoa está trabalhando.
  const semRodape = PAGINAS_SEM_RODAPE.has(arquivo) || CABECALHO_POR_PAGINA[arquivo]?.[0] === "sistema";
  const rodape = rodapes[PAGINAS_RODAPE_COMPLETO.has(arquivo) ? "completo" : "compacto"];
  const novoRodape = semRodape
    ? "<!-- rodape:inicio -->\n<!-- rodape:fim -->"
    : `<!-- rodape:inicio -->\n${rodape}\n<!-- rodape:fim -->`;
  if (BLOCO_RODAPE.test(texto)) texto = texto.replace(BLOCO_RODAPE, () => novoRodape);
  else if (FOOTER_ANTIGO.test(texto)) texto = texto.replace(FOOTER_ANTIGO, () => novoRodape);
  else console.warn(`[layout] ${arquivo}: sem <footer> nem marcadores de rodapé.`);

  const config = CABECALHO_POR_PAGINA[arquivo];
  if (config) {
    const [tipo, item] = config;
    const novoCabecalho = `<!-- cabecalho:inicio -->\n${marcarAtual(cabecalhos[tipo], item)}\n<!-- cabecalho:fim -->`;
    if (BLOCO_CABECALHO.test(texto)) texto = texto.replace(BLOCO_CABECALHO, () => novoCabecalho);
    else console.warn(`[layout] ${arquivo}: sem marcadores <!-- cabecalho:inicio/fim -->.`);
  }

  const saida = crlf ? texto.replace(/\n/g, "\r\n") : texto;
  if (saida !== original) { writeFileSync(caminho, saida); alteradas++; }
}
console.log(`[layout] cabeçalhos e rodapés ${VERSAO} aplicados (${alteradas} página(s) alterada(s)).`);
