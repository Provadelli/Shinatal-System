// Tabela oficial da Avaliação de desempenho: cada avaliado tem um avaliador FIXO. Além dele, o
// próprio avaliado escolhe um colega pela página /avaliacao.
//
// A tabela é por nome, como foi definida pela direção. backend/scripts/avaliadores-fixos.mjs
// resolve cada nome para o uid do cadastro (usuarios/{uid}) e grava o resultado em
// configuracoes/avaliadoresFixos, que as regras do Firestore usam para conferir o fixo.
// Para mudar a tabela: edite aqui, rode o script em --simular, confira e rode em --aplicar.
//
// `emailAvaliado` e `emailAvaliador` são opcionais: preencha só se um nome for ambíguo (duas
// pessoas com o mesmo nome), por exemplo { avaliado: "Ana Julia", emailAvaliado: "...", ... }.
export const TABELA_AVALIADORES_FIXOS = [
  { avaliado: "Natalia", avaliador: "Eduardo" },
  { avaliado: "Guido", avaliador: "Marcelo" },
  { avaliado: "Danilo", avaliador: "Dayane" },
  { avaliado: "Pedro Lucas", avaliador: "Eduardo" },
  { avaliado: "Marcelo", avaliador: "Eduardo" },
  { avaliado: "David", avaliador: "Marcelo" },
  { avaliado: "Dayane", avaliador: "Eduardo" },
  { avaliado: "Erickson", avaliador: "Marcelo" },
  { avaliado: "Juliana", avaliador: "Eduardo" },
  { avaliado: "Kleber", avaliador: "Erickson" },
  { avaliado: "Ana Julia", avaliador: "Dayane" }
];

/** Minúsculas, sem acento e com espaços simples: "Ana Júlia " → "ana julia". */
export function normalizarNome(nome) {
  return String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Pessoas cujo nome começa pelas palavras de `nome` ("Pedro Lucas" casa com "Pedro Lucas
 * Souza", mas não com "Pedro Henrique"). Só cadastros ativos.
 */
export function candidatosPorNome(nome, usuarios) {
  const alvo = normalizarNome(nome).split(" ");
  return usuarios.filter((u) => {
    if ((u.status || "ativo") !== "ativo" || u.motivoPerdaIntegral) return false;
    const partes = normalizarNome(u.nome).split(" ");
    return alvo.every((p, i) => partes[i] === p);
  });
}

/**
 * Resolve a tabela para `{ pares: { uidAvaliado: uidAvaliadorFixo } }`. Nunca adivinha: nome
 * sem cadastro ou com mais de um cadastro vira erro, e o script não grava nada.
 * @param {{avaliado:string, avaliador:string, emailAvaliado?:string, emailAvaliador?:string}[]} tabela
 * @param {{uid:string, nome:string, email?:string, role?:string, status?:string}[]} usuarios
 */
export function resolverTabela(tabela, usuarios) {
  const erros = [];
  const linhas = [];
  const resolver = (nome, email) => {
    if (email) {
      const porEmail = usuarios.filter((u) => normalizarNome(u.email) === normalizarNome(email));
      return porEmail.length === 1 ? porEmail[0] : (erros.push(`"${nome}": e-mail informado não encontrado`), null);
    }
    const lista = candidatosPorNome(nome, usuarios);
    if (lista.length === 1) return lista[0];
    erros.push(lista.length === 0
      ? `"${nome}": nenhum cadastro ativo com esse nome`
      : `"${nome}": ${lista.length} cadastros (${lista.map((u) => u.nome).join(", ")}) — informe o e-mail na tabela`);
    return null;
  };

  const pares = {};
  for (const linha of tabela) {
    const avaliado = resolver(linha.avaliado, linha.emailAvaliado);
    const avaliador = resolver(linha.avaliador, linha.emailAvaliador);
    if (!avaliado || !avaliador) continue;
    if (avaliado.uid === avaliador.uid) { erros.push(`"${linha.avaliado}" não pode avaliar a si mesmo`); continue; }
    if (avaliado.role === "presidente") { erros.push(`"${linha.avaliado}" é o Presidente e não é avaliado`); continue; }
    if (pares[avaliado.uid]) { erros.push(`"${linha.avaliado}" aparece duas vezes na tabela`); continue; }
    pares[avaliado.uid] = avaliador.uid;
    linhas.push({ avaliado: avaliado.nome, avaliador: avaliador.nome, papelAvaliador: avaliador.role || "colaborador" });
  }
  return { pares, linhas, erros };
}
