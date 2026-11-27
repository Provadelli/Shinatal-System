// "Baixar meus dados" (LGPD, art. 18) em PDF no papel timbrado da Shine Rio.
// O timbrado (assets/timbrado-shinerio.jpg) é a página A4 inteira do modelo oficial, renderizada
// em 200 dpi; o texto vai por cima, dentro das margens do modelo. jsPDF fica em js/vendor porque o
// CSP só permite scripts do próprio site, e só é carregado quando a pessoa clica no botão.

const URL_JSPDF = "/js/vendor/jspdf-2.5.2.umd.min.js";
const URL_TIMBRADO = "/assets/timbrado-shinerio.jpg";

// Medidas em mm (A4 retrato). Topo e base respeitam o cabeçalho e a linha azul do rodapé.
const PAGINA = { largura: 210, altura: 297 };
const MARGEM = { esquerda: 20, direita: 20, topo: 40, base: 262 };
const LARGURA_UTIL = PAGINA.largura - MARGEM.esquerda - MARGEM.direita;
const COR = { titulo: [31, 45, 77], texto: [40, 48, 66], rotulo: [58, 70, 96], destaque: [28, 150, 236], suave: [110, 118, 135] };

// Rótulos legíveis para as chaves mais comuns; as demais viram "Camel case" → "Camel case".
const ROTULOS = {
  sistema: "Sistema", controladora: "Controladora", encarregado: "Encarregado de dados", geradoEm: "Gerado em",
  observacao: "Observação", identificador: "Identificador", nome: "Nome", email: "E-mail", role: "Perfil de acesso",
  cpf: "CPF", cargo: "Cargo", setor: "Setor", telefone: "Telefone", criadoEm: "Criado em", atualizadoEm: "Atualizado em",
  aceiteTermos: "Aceite dos Termos", aceitoEm: "Aceito em", versao: "Versão", data: "Data", motivo: "Motivo",
  descricao: "Descrição", status: "Situação", nota: "Nota", cnpj: "CNPJ", razaoSocial: "Razão social",
  votosQueVoceDeu: "Votos que você deu", contagemRecebidaAnonima: "Contagem recebida (anônima)", id: "Código",
  uid: "Identificador", avaliadorUid: "Avaliador", avaliadoUid: "Avaliado", fotoBase64: "Foto cadastrada",
  ciclos: "Seus ciclos", respostasRecebidas: "Respostas recebidas", respostasQueVoceDeu: "Avaliações que você fez",
  notas: "Notas (0 a 10)", comentario: "Parecer do avaliador", media: "Média", conceito: "Conceito",
  papel: "Papel do avaliador", perguntas: "Perguntas", okPresidenteEm: "Ok do Presidente em",
  respostasAoPresidente: "Sua resposta ao Presidente", texto: "Texto", respostaEnviadaEm: "Resposta enviada em",
  avaliadorFixoUid: "Avaliador fixo", avaliadorEscolhidoUid: "Colega escolhido", concluidas: "Etapas concluídas",
  fixo: "Avaliador fixo", escolhido: "Colega escolhido"
};

const SECOES = [
  ["perfil", "Perfil"],
  ["faltas", "Faltas"],
  ["atrasos", "Atrasos"],
  ["advertencias", "Advertências"],
  ["avaliacoesDeDesempenho", "Avaliações de desempenho"],
  ["contratosIndividuais", "Contratos individuais"],
  ["processoDeAvaliacao", "Processo de avaliação de desempenho"],
  ["avaliacaoDeConduta", "Avaliação de conduta (histórico, encerrada em 11/2026)"]
];

function rotulo(chave) {
  if (ROTULOS[chave]) return ROTULOS[chave];
  const texto = String(chave).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatarValor(chave, valor) {
  if (chave === "fotoBase64") return valor ? "Sim" : "Não";
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") return valor.toLocaleString("pt-BR");
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor)) {
    const d = new Date(valor);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  return String(valor);
}

function carregarScript(src) {
  if (window.jspdf) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

async function carregarImagemDataUrl(src) {
  const resposta = await fetch(src);
  if (!resposta.ok) throw new Error(`Falha ao carregar ${src}`);
  const blob = await resposta.blob();
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = reject;
    leitor.readAsDataURL(blob);
  });
}

/** Monta o PDF timbrado a partir do mesmo objeto que antes ia para o JSON e devolve um Blob. */
export async function gerarPdfMeusDados(exportacao) {
  const [, timbrado] = await Promise.all([carregarScript(URL_JSPDF), carregarImagemDataUrl(URL_TIMBRADO)]);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const nomeTitular = exportacao.perfil?.nome || exportacao.perfil?.email || "";

  pdf.setProperties({
    title: "Meus dados no Shinatal",
    subject: "Cópia dos dados pessoais do titular (LGPD, art. 18)",
    author: "Shine Rio Serviços Ltda.",
    creator: "Shinatal",
    keywords: "LGPD, dados pessoais, Shinatal"
  });
  pdf.setLanguage("pt-BR");

  const fundo = () => pdf.addImage(timbrado, "JPEG", 0, 0, PAGINA.largura, PAGINA.altura, "timbrado", "FAST");
  fundo();
  let y = MARGEM.topo;

  const novaPagina = () => { pdf.addPage(); fundo(); y = MARGEM.topo; };
  const garantirEspaco = (altura) => { if (y + altura > MARGEM.base) novaPagina(); };

  const escrever = (texto, { tamanho = 10, estilo = "normal", cor = COR.texto, x = MARGEM.esquerda, largura = LARGURA_UTIL, depois = 1.5 } = {}) => {
    pdf.setFont("helvetica", estilo);
    pdf.setFontSize(tamanho);
    pdf.setTextColor(...cor);
    const alturaLinha = tamanho * 0.3528 * 1.35;
    for (const linha of pdf.splitTextToSize(String(texto), largura)) {
      garantirEspaco(alturaLinha);
      pdf.text(linha, x, y + alturaLinha * 0.75);
      y += alturaLinha;
    }
    y += depois;
  };

  const titulo = (texto) => {
    garantirEspaco(14);
    y += 3;
    escrever(texto, { tamanho: 13, estilo: "bold", cor: COR.titulo, depois: 0.5 });
    pdf.setDrawColor(...COR.destaque);
    pdf.setLineWidth(0.4);
    pdf.line(MARGEM.esquerda, y, MARGEM.esquerda + 30, y);
    y += 3;
  };

  // Par rótulo: valor; objetos e listas descem um nível, recuados.
  const escreverCampo = (chave, valor, nivel = 0) => {
    const x = MARGEM.esquerda + nivel * 5;
    const largura = LARGURA_UTIL - nivel * 5;
    if (Array.isArray(valor)) {
      escrever(`${rotulo(chave)}:`, { estilo: "bold", cor: COR.rotulo, x, largura, depois: 0.5 });
      if (!valor.length) escrever("Nenhum registro.", { cor: COR.suave, x: x + 5, largura: largura - 5 });
      valor.forEach((item, i) => escreverItem(item, i, nivel + 1));
      return;
    }
    if (valor && typeof valor === "object") {
      escrever(`${rotulo(chave)}:`, { estilo: "bold", cor: COR.rotulo, x, largura, depois: 0.5 });
      const entradas = Object.entries(valor);
      if (!entradas.length) escrever("—", { x: x + 5, largura: largura - 5 });
      entradas.forEach(([k, v]) => escreverCampo(k, v, nivel + 1));
      return;
    }
    escrever(`${rotulo(chave)}: ${formatarValor(chave, valor)}`, { x, largura, depois: 0.8 });
  };

  const escreverItem = (item, indice, nivel) => {
    const x = MARGEM.esquerda + nivel * 5;
    if (item && typeof item === "object") {
      garantirEspaco(14); // título do registro não fica sozinho no pé da página
      escrever(`Registro ${indice + 1}`, { estilo: "bold", cor: COR.destaque, x, largura: LARGURA_UTIL - nivel * 5, depois: 0.5 });
      Object.entries(item).forEach(([k, v]) => escreverCampo(k, v, nivel + 1));
      y += 1.5;
    } else {
      escrever(`• ${formatarValor("", item)}`, { x, largura: LARGURA_UTIL - nivel * 5, depois: 0.5 });
    }
  };

  const escreverSecao = (nome, valor) => {
    titulo(nome);
    if (Array.isArray(valor)) {
      if (!valor.length) escrever("Nenhum registro.", { cor: COR.suave });
      valor.forEach((item, i) => escreverItem(item, i, 0));
    } else if (valor && typeof valor === "object") {
      Object.entries(valor).forEach(([k, v]) => escreverCampo(k, v, 0));
    } else {
      escrever(valor == null ? "Nenhum registro." : formatarValor("", valor), { cor: valor == null ? COR.suave : COR.texto });
    }
  };

  // Abertura
  escrever("Meus dados no Shinatal", { tamanho: 18, estilo: "bold", cor: COR.titulo, depois: 1 });
  if (nomeTitular) escrever(`Titular: ${nomeTitular}`, { tamanho: 11, cor: COR.rotulo, depois: 0.5 });
  escrever(`Gerado em ${formatarValor("", exportacao.sobre?.geradoEm)}`, { tamanho: 9, cor: COR.suave, depois: 3 });

  titulo("Sobre este documento");
  Object.entries(exportacao.sobre || {}).forEach(([k, v]) => escreverCampo(k, v, 0));
  escreverCampo("identificador", exportacao.identificador, 0);

  for (const [chave, nome] of SECOES) escreverSecao(nome, exportacao[chave]);

  // Numeração no canto, logo acima da linha do rodapé.
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...COR.suave);
    pdf.text(`Página ${p} de ${total}`, PAGINA.largura - MARGEM.direita, 267, { align: "right" });
  }

  return pdf.output("blob");
}
