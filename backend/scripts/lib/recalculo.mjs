// Shinatal — lógica pura da migração da régua de cálculo (sem Firebase, testável).
// Compara o motor antigo (backend/scripts/legado/calculo-shinatal-v1.mjs) com o motor atual
// (frontend/js/calculo-shinatal.js) contrato a contrato e monta as entradas de auditoria.

export const TOLERANCIA = 0.005; // meio centavo
export const AUTOR_SCRIPT = "script:recalculo-regra-v2";

const difere = (a, b) => Math.abs((a || 0) - (b || 0)) >= TOLERANCIA;
const arred = (v) => Math.round((v || 0) * 100) / 100;

export function formatarReais(valor) {
  return (valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Situação de migração de um contrato para uma versão de regra: a última entrada de
 * `recalculo_regra`/`reversao_regra` daquela versão decide. Base da idempotência.
 */
export function jaMigrado(contrato, versaoRegra) {
  let migrado = false;
  for (const h of (contrato.historicoMovimentacoes || [])) {
    if (h?.versaoRegra !== versaoRegra) continue;
    if (h.tipo === "recalculo_regra") migrado = true;
    if (h.tipo === "reversao_regra") migrado = false;
  }
  return migrado;
}

/**
 * Compara um contrato entre os dois motores.
 * @param {object} contrato documento de contratosEmpresariais (com `id`)
 * @param {object} antigo módulo do motor anterior
 * @param {object} novo módulo do motor atual
 * @param {number[]} anos exercícios a comparar
 * @param {string} hojeISO data de referência fixa (mesma para os dois motores)
 */
export function compararContrato(contrato, antigo, novo, anos, hojeISO) {
  const rAntigo = antigo.calcularResumoContratoEmpresarial(contrato, hojeISO);
  const rNovo = novo.calcularResumoContratoEmpresarial(contrato, hojeISO);
  const porAno = {};
  for (const ano of anos) {
    const a = antigo.calcularContribuicaoNoAno(contrato, ano, hojeISO).liquido;
    const d = novo.calcularContribuicaoNoAno(contrato, ano, hojeISO).liquido;
    if (difere(a, d)) porAno[ano] = { antes: arred(a), depois: arred(d), diferenca: arred(d - a) };
  }
  const antes = arred(rAntigo.totalCreditadoFundo);
  const depois = arred(rNovo.totalCreditadoFundo);
  const alterado = difere(antes, depois) || Object.keys(porAno).length > 0;
  return {
    id: contrato.id,
    nomeEmpresa: contrato.nomeEmpresa || "",
    cnpj: contrato.cnpj || "",
    status: contrato.status,
    prazoIndeterminado: !!contrato.prazoIndeterminado,
    antes, depois, diferenca: arred(depois - antes),
    // Estorno projetado ("se encerrasse hoje") — só informativo para contratos ativos.
    estornoProjetadoAntes: arred(rAntigo.estorno),
    estornoProjetadoDepois: arred(rNovo.estorno),
    porAno,
    lotes: (rNovo.lotes || []).map((l) => ({
      origem: l.origem, entrada: l.entrada, saida: l.saida, quantidade: l.quantidade,
      mesesCreditados: l.mesesCreditados, mesesContados: l.mesesContados,
      credito: arred(l.credito), desconto: arred(l.desconto), estornoProjetado: arred(l.estornoProjetado)
    })),
    alterado
  };
}

/** Entrada imutável acrescentada ao histórico do contrato quando o valor muda. */
export function montarEntradaAuditoria(comparacao, versaoRegra, data) {
  const anos = Object.entries(comparacao.porAno)
    .map(([ano, v]) => `${ano}: ${v.diferenca > 0 ? "+" : "−"}${formatarReais(Math.abs(v.diferenca))}`)
    .join("; ");
  return {
    tipo: "recalculo_regra",
    versaoRegra,
    descricao: `Recálculo pela nova régua de meses (${versaoRegra}): valor creditado ao fundo de `
      + `${formatarReais(comparacao.antes)} para ${formatarReais(comparacao.depois)}`
      + (anos ? ` — por exercício: ${anos}` : ""),
    motivo: "Atualização global da base de cálculo (entrada até o dia 14, desligamento só com meses completos, estorno por funcionário).",
    fundoAntes: comparacao.antes,
    fundoDepois: comparacao.depois,
    diferenca: comparacao.diferenca,
    porAno: Object.fromEntries(Object.entries(comparacao.porAno).map(([k, v]) => [String(k), v])),
    data,
    registradoPor: AUTOR_SCRIPT
  };
}

/** Entrada de reversão (nunca apaga a de recálculo — acrescenta uma nova). */
export function montarEntradaReversao(contrato, versaoRegra, data, valorAtual) {
  return {
    tipo: "reversao_regra",
    versaoRegra,
    descricao: `Reversão da régua ${versaoRegra}: valor creditado ao fundo recalculado em ${formatarReais(valorAtual)}`,
    motivo: "Reversão controlada da atualização da base de cálculo.",
    fundoAntes: valorAtual,
    fundoDepois: valorAtual,
    diferenca: 0,
    data,
    registradoPor: AUTOR_SCRIPT
  };
}

/**
 * Plano de migração completo (o que `--simular` mostra e `--aplicar` executa).
 * @returns {{analisados:number, comparacoes:object[], aAtualizar:object[], jaMigrados:string[], anos:number[]}}
 */
export function planejarMigracao(contratos, antigo, novo, versaoRegra, hojeISO) {
  const anos = [...new Set([
    ...antigo.anosComMovimento?.(contratos, hojeISO) ?? anosLegado(contratos, antigo, hojeISO),
    ...novo.anosComMovimento(contratos, hojeISO)
  ])].sort((a, b) => a - b);
  const comparacoes = contratos.map((c) => compararContrato(c, antigo, novo, anos, hojeISO));
  const jaMigrados = contratos.filter((c) => jaMigrado(c, versaoRegra)).map((c) => c.id);
  const aAtualizar = comparacoes.filter((c) => c.alterado && !jaMigrados.includes(c.id));
  return { analisados: contratos.length, comparacoes, aAtualizar, jaMigrados, anos };
}

/** O motor antigo não exporta `anosComMovimento`: deriva os anos dos próprios movimentos. */
function anosLegado(contratos, antigo, hojeISO) {
  const anos = new Set();
  for (const c of contratos) {
    for (const m of antigo.calcularResumoContratoEmpresarial(c, hojeISO).movimentos || []) {
      if (!m.data || !m.valor) continue;
      anos.add(m.tipo === "credito_inicial"
        ? antigo.calcularMesReferenciaImplantacao(m.data).ano
        : Number(String(m.data).slice(0, 4)));
    }
  }
  return [...anos];
}

/** Relatório CSV (separador ";" para abrir direto no Excel em pt-BR). */
export function relatorioCSV(comparacoes) {
  const linhas = [["contrato_id", "empresa", "cnpj", "status", "prazo_indeterminado", "valor_anterior", "valor_recalculado", "diferenca", "estorno_projetado_anterior", "estorno_projetado_novo", "diferencas_por_ano"]];
  for (const c of comparacoes) {
    linhas.push([
      c.id, c.nomeEmpresa, c.cnpj, c.status, c.prazoIndeterminado ? "sim" : "não",
      c.antes.toFixed(2).replace(".", ","), c.depois.toFixed(2).replace(".", ","), c.diferenca.toFixed(2).replace(".", ","),
      c.estornoProjetadoAntes.toFixed(2).replace(".", ","), c.estornoProjetadoDepois.toFixed(2).replace(".", ","),
      Object.entries(c.porAno).map(([a, v]) => `${a}: ${v.diferenca.toFixed(2).replace(".", ",")}`).join(" | ")
    ]);
  }
  return linhas.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
}
