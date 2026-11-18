// Shinatal: lógica pura da reconciliação com a planilha de controle (sem Firebase, testável).
// Lê backend/scripts/dados/planilha-controle-2026.json, monta o estado que cada contrato deve
// ter e compara com o que está no banco. Nada aqui grava; o script importar-planilha-controle.mjs
// aplica o plano.
//
// Princípios:
//  • Não duplica: cada contrato da planilha aponta para um documento existente (docId). Só cria
//    quando o contrato é marcado como "novo" e o documento ainda não existe.
//  • Não apaga: registros do banco que não estão na planilha (saídas, entradas, pausas, contratos)
//    nunca são removidos; viram divergência no relatório.
//  • Campos travados (nome, CNPJ, início, quadro inicial) não são alterados; diferença neles é
//    divergência bloqueante.
//  • Idempotente: aplicado sobre o próprio resultado, o plano não tem nenhuma alteração.

import * as motor from "../../../frontend/js/calculo-shinatal.js";

export const AUTOR_IMPORTACAO = "script:importar-planilha-controle";
const TOLERANCIA = 0.005;
const arred = (v) => Math.round((v || 0) * 100) / 100;
const difere = (a, b) => Math.abs((a || 0) - (b || 0)) >= TOLERANCIA;

export function formatarReais(valor) {
  return (valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Normaliza texto para comparação (sem acento, maiúsculo). */
function normalizarTexto(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

/** true se o registro parece ser do contrato excluído desta tarefa (nome ou a linha Urca/RJ). */
export function pareceContratoExcluido(registro) {
  const texto = normalizarTexto([registro?.nomeEmpresa, registro?.tomador, registro?.local].filter(Boolean).join(" "));
  if (/\bCPRM\b/.test(texto)) return true;
  if (/SERVICO GEOLOGICO/.test(texto)) return true;
  return /\bURCA\b/.test(texto) && (registro?.implantacao === "2026-11-16" || registro?.dataInicio === "2026-11-16");
}

/* ------------------------------------------------------------------ */
/* Estado-alvo de cada contrato a partir das linhas da planilha        */
/* ------------------------------------------------------------------ */

function agrupar(itens, chave, montar) {
  const mapa = new Map();
  for (const i of itens) {
    const k = chave(i);
    mapa.set(k, montar(i, mapa.get(k)));
  }
  return [...mapa.values()];
}

/**
 * Estado-alvo de cada contrato: prazo indeterminado, sem término previsto, quadro inicial,
 * saídas do quadro inicial e entradas (com saída, quando houver). Linhas iguais (mesma data de
 * entrada e de saída) viram um único registro com a quantidade somada, como a tela faz.
 */
export function montarContratosDaPlanilha(dados) {
  const linhas = dados.linhas || [];
  for (const l of linhas) {
    if (pareceContratoExcluido(l)) throw new Error(`Linha ${l.id} pertence ao contrato excluído desta tarefa.`);
  }
  return (dados.contratos || []).map((c) => {
    if (pareceContratoExcluido(c)) throw new Error(`Contrato ${c.chave} pertence ao contrato excluído desta tarefa.`);
    const doContrato = linhas.filter((l) => l.contrato === c.chave);
    if (!doContrato.length) throw new Error(`Contrato ${c.chave} sem nenhuma linha da planilha.`);
    const quadro = doContrato.filter((l) => l.papel === "quadro_inicial");
    const entradas = doContrato.filter((l) => l.papel === "entrada");
    for (const l of quadro) {
      if (l.implantacao !== c.dataInicio) {
        throw new Error(`Linha ${l.id}: implantação ${l.implantacao} diferente do início do contrato ${c.chave} (${c.dataInicio}).`);
      }
    }
    for (const l of entradas) {
      if (l.implantacao < c.dataInicio) throw new Error(`Linha ${l.id}: entrada antes do início do contrato ${c.chave}.`);
    }
    const saidasIniciais = agrupar(
      quadro.filter((l) => l.saida), (l) => l.saida,
      (l, atual) => ({ data: l.saida, motivo: null, quantidade: (atual?.quantidade || 0) + l.quantidade })
    ).sort((a, b) => a.data.localeCompare(b.data));
    const entradasContrato = agrupar(
      entradas, (l) => `${l.implantacao}|${l.saida || ""}`,
      (l, atual) => ({ dataEntrada: l.implantacao, dataSaida: l.saida || null, motivo: null, quantidade: (atual?.quantidade || 0) + l.quantidade })
    ).sort((a, b) => a.dataEntrada.localeCompare(b.dataEntrada) || String(a.dataSaida).localeCompare(String(b.dataSaida)));
    return {
      chave: c.chave, docId: c.docId, novo: !!c.novo,
      nomeEmpresa: c.nomeEmpresa, cnpj: c.cnpj, dataInicio: c.dataInicio,
      quantidadeFuncionariosIniciais: quadro.reduce((s, l) => s + l.quantidade, 0),
      prazoIndeterminado: true, dataFimPrevista: null, duracaoMesesPrevista: null,
      status: "ativo", dataEncerramentoReal: null,
      saidasIniciais, entradasContrato,
      ajusteManual: c.ajusteManual || null,
      linhas: doContrato
    };
  });
}

/** Entrada `ajuste_manual` do histórico (lida pelo motor em obterAjusteManual). */
export function montarEntradaAjusteManual(alvo, regua, data, origem) {
  return {
    tipo: "ajuste_manual",
    efeito: alvo.ajusteManual.efeito,
    origem,
    versaoRegra: motor.VERSAO_REGRA_CALCULO,
    descricao: `Ajuste manual: contrato contribui com R$ 0,00 ao fundo (positivo 0, negativo 0). `
      + `Pela régua seriam crédito de ${formatarReais(regua.credito)} e desconto de ${formatarReais(regua.desconto)}.`,
    motivo: alvo.ajusteManual.motivo,
    valorRegua: { credito: arred(regua.credito), desconto: arred(regua.desconto), liquido: arred(regua.credito - regua.desconto) },
    fundoAntes: arred(regua.totalAntes),
    fundoDepois: 0,
    data,
    registradoPor: AUTOR_IMPORTACAO
  };
}

/** Contrato completo (como no banco) só a partir do estado-alvo; usado em testes e na criação. */
export function contratoDoAlvo(alvo, { historicoMovimentacoes = [] } = {}) {
  return {
    id: alvo.docId,
    nomeEmpresa: alvo.nomeEmpresa, cnpj: alvo.cnpj, valorContrato: null,
    dataInicio: alvo.dataInicio, dataFimPrevista: null, dataFimPrevistaOriginal: null, duracaoMesesPrevista: null,
    quantidadeFuncionariosIniciais: alvo.quantidadeFuncionariosIniciais,
    prazoIndeterminado: true, status: "ativo", dataEncerramentoReal: null,
    saidasIniciais: alvo.saidasIniciais.map((s) => ({ ...s })),
    entradasContrato: alvo.entradasContrato.map((e) => ({ ...e })),
    pausas: [], pausasQuadroInicial: [], pausasEntradas: [],
    historicoMovimentacoes
  };
}

/** Contratos finais da planilha (com o ajuste manual aplicado), sem banco. Base dos testes. */
export function contratosEsperados(dados, data = "2026-11-17") {
  return montarContratosDaPlanilha(dados).map((alvo) => {
    const historico = alvo.ajusteManual
      ? [{ tipo: "ajuste_manual", efeito: alvo.ajusteManual.efeito, motivo: alvo.ajusteManual.motivo, data }]
      : [];
    return contratoDoAlvo(alvo, { historicoMovimentacoes: historico });
  });
}

/* ------------------------------------------------------------------ */
/* Reconciliação com o banco                                           */
/* ------------------------------------------------------------------ */

const chaveSaida = (s) => `${s.data}|${motor.quantidadeDoRegistro(s)}`;
const chaveEntrada = (e) => `${e.dataEntrada}|${motor.quantidadeDoRegistro(e)}`;

/** Junta a lista do banco com a do alvo sem apagar nada. */
function reconciliarSaidas(existentes = [], alvo, divergencias, nome) {
  const restantes = [...existentes];
  const resultado = [];
  for (const s of alvo) {
    const i = restantes.findIndex((x) => chaveSaida(x) === chaveSaida(s));
    if (i >= 0) resultado.push(restantes.splice(i, 1)[0]);
    else resultado.push({ ...s });
  }
  for (const x of restantes) {
    divergencias.push({ contrato: nome, gravidade: "bloqueante", mensagem: `Saída do quadro inicial em ${x.data} (${motor.quantidadeDoRegistro(x)}) existe no sistema e não está na planilha. Mantida.` });
    resultado.push(x);
  }
  return resultado;
}

function reconciliarEntradas(existentes = [], alvo, divergencias, nome) {
  const restantes = [...existentes];
  const resultado = [];
  for (const e of alvo) {
    const i = restantes.findIndex((x) => chaveEntrada(x) === chaveEntrada(e)
      && (x.dataSaida || null) === (e.dataSaida || null));
    if (i >= 0) { resultado.push(restantes.splice(i, 1)[0]); continue; }
    // Mesma entrada ainda sem saída no sistema: só completa a data de saída.
    const j = restantes.findIndex((x) => chaveEntrada(x) === chaveEntrada(e) && !x.dataSaida);
    if (j >= 0) { resultado.push({ ...restantes.splice(j, 1)[0], dataSaida: e.dataSaida }); continue; }
    resultado.push({ ...e });
  }
  for (const x of restantes) {
    divergencias.push({ contrato: nome, gravidade: "bloqueante", mensagem: `Entrada de ${x.dataEntrada} (${motor.quantidadeDoRegistro(x)}${x.dataSaida ? `, saída ${x.dataSaida}` : ""}) existe no sistema e não está na planilha. Mantida.` });
    resultado.push(x);
  }
  return resultado;
}

const iguais = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Valores de um contrato no motor: total no fundo e líquido por exercício. */
function valoresNoMotor(contrato, anos, hojeISO) {
  const r = motor.calcularResumoContratoEmpresarial(contrato, hojeISO);
  const porAno = {};
  for (const ano of anos) porAno[ano] = arred(motor.calcularContribuicaoNoAno(contrato, ano, hojeISO).liquido);
  return { total: arred(r.totalCreditadoFundo), porAno, resumo: r };
}

/**
 * Plano de reconciliação.
 * @param {object[]} contratosBanco documentos de contratosEmpresariais (com `id`)
 * @param {object} dados conteúdo de planilha-controle-2026.json
 * @param {string} hojeISO data de referência do cálculo
 * @param {*} data valor gravado em `data` nas entradas de histórico (Timestamp ou ISO)
 */
export function planejarReconciliacao(contratosBanco, dados, hojeISO, data = hojeISO) {
  const alvos = montarContratosDaPlanilha(dados);
  const anos = [dados.exercicio - 1, dados.exercicio];
  const acoes = [];
  const divergencias = [];
  const porId = new Map(contratosBanco.map((c) => [c.id, c]));
  const usados = new Set();

  for (const alvo of alvos) {
    const existente = porId.get(alvo.docId);
    const nome = alvo.nomeEmpresa;

    if (!existente) {
      if (!alvo.novo) {
        divergencias.push({ contrato: nome, gravidade: "bloqueante", mensagem: `Documento ${alvo.docId} não encontrado no sistema (esperado já cadastrado). Nada foi criado no lugar dele.` });
        continue;
      }
      const semHistorico = contratoDoAlvo(alvo);
      const depois = valoresNoMotor(semHistorico, anos, hojeISO);
      const criacao = {
        tipo: "criacao",
        descricao: `Crédito inicial lançado: ${alvo.quantidadeFuncionariosIniciais} funcionário(s) × R$150 (prazo indeterminado)`,
        fundoAntes: 0, fundoDepois: arred(motor.CREDITO_POR_CONTRATO * alvo.quantidadeFuncionariosIniciais),
        data, registradoPor: AUTOR_IMPORTACAO, versaoRegra: motor.VERSAO_REGRA_CALCULO
      };
      const auditoria = montarEntradaImportacao({ alvo, acao: "criar", antes: { total: 0, porAno: Object.fromEntries(anos.map((a) => [a, 0])) }, depois, alteracoes: [{ campo: "contrato", antes: null, depois: "criado a partir da planilha" }], data, origem: dados.origem });
      const { id, ...campos } = { ...semHistorico, historicoMovimentacoes: [criacao, auditoria] };
      acoes.push({ tipo: "criar", id: alvo.docId, nomeEmpresa: nome, campos, alteracoes: auditoria.alteracoes, antes: 0, depois: depois.total, porAno: auditoria.porAno, entradasHistorico: [criacao, auditoria] });
      continue;
    }
    usados.add(existente.id);

    // Campos travados: só conferem.
    for (const campo of ["cnpj", "dataInicio", "quantidadeFuncionariosIniciais"]) {
      const banco = campo === "cnpj" ? motor.normalizarCNPJ(existente.cnpj) : existente[campo];
      if (!iguais(banco, alvo[campo])) {
        divergencias.push({ contrato: nome, gravidade: "bloqueante", mensagem: `${campo}: sistema ${JSON.stringify(banco)}, planilha ${JSON.stringify(alvo[campo])}. Campo travado, não alterado.` });
      }
    }
    if (normalizarTexto(existente.nomeEmpresa) !== normalizarTexto(alvo.nomeEmpresa)) {
      divergencias.push({ contrato: nome, gravidade: "aviso", mensagem: `Nome no sistema "${existente.nomeEmpresa}" diferente do esperado. Mantido.` });
    }
    if (existente.status !== "ativo") {
      divergencias.push({ contrato: nome, gravidade: "bloqueante", mensagem: `Status no sistema "${existente.status}" (a planilha trata como ativo). Não alterado.` });
    }
    const pausas = [...(existente.pausas || []), ...(existente.pausasQuadroInicial || []), ...(existente.pausasEntradas || [])];
    if (pausas.length) {
      divergencias.push({ contrato: nome, gravidade: "aviso", mensagem: `${pausas.length} pausa(s) registradas no sistema e ausentes da planilha. Mantidas.` });
    }

    const campos = {};
    const alteracoes = [];
    const definir = (campo, valor) => {
      if (iguais(existente[campo] ?? null, valor)) return;
      campos[campo] = valor;
      alteracoes.push({ campo, antes: existente[campo] ?? null, depois: valor });
    };
    definir("prazoIndeterminado", true);
    definir("dataFimPrevista", null);
    definir("duracaoMesesPrevista", null);
    definir("saidasIniciais", reconciliarSaidas(existente.saidasIniciais, alvo.saidasIniciais, divergencias, nome));
    definir("entradasContrato", reconciliarEntradas(existente.entradasContrato, alvo.entradasContrato, divergencias, nome));

    const precisaAjuste = !!alvo.ajusteManual && !motor.obterAjusteManual(existente);
    if (!alteracoes.length && !precisaAjuste) {
      const valores = valoresNoMotor(existente, anos, hojeISO);
      acoes.push({ tipo: "igual", id: existente.id, nomeEmpresa: nome, antes: valores.total, depois: valores.total, porAno: {} });
      continue;
    }

    const antes = valoresNoMotor(existente, anos, hojeISO);
    const semAjuste = { ...existente, ...campos };
    const entradasHistorico = [];
    if (precisaAjuste) {
      const r = valoresNoMotor(semAjuste, anos, hojeISO).resumo;
      const credito = r.movimentos.filter((m) => m.valor > 0).reduce((s, m) => s + m.valor, 0);
      const desconto = r.movimentos.filter((m) => m.valor < 0).reduce((s, m) => s - m.valor, 0);
      entradasHistorico.push(montarEntradaAjusteManual(alvo, { credito, desconto, totalAntes: r.totalCreditadoFundo }, data, dados.origem));
      alteracoes.push({ campo: "ajusteManual", antes: null, depois: alvo.ajusteManual.motivo });
    }
    const final = { ...semAjuste, historicoMovimentacoes: [...(existente.historicoMovimentacoes || []), ...entradasHistorico] };
    const depois = valoresNoMotor(final, anos, hojeISO);
    const auditoria = montarEntradaImportacao({ alvo, acao: "atualizar", antes, depois, alteracoes, data, origem: dados.origem });
    entradasHistorico.unshift(auditoria);
    acoes.push({ tipo: "atualizar", id: existente.id, nomeEmpresa: nome, campos, alteracoes, antes: antes.total, depois: depois.total, porAno: auditoria.porAno, entradasHistorico });
  }

  // Contratos do banco que não estão na planilha: nunca são tocados, só listados.
  const foraDaPlanilha = contratosBanco.filter((c) => !usados.has(c.id) && !alvos.some((a) => a.docId === c.id))
    .map((c) => ({ id: c.id, nomeEmpresa: c.nomeEmpresa || "", excluidoDaTarefa: pareceContratoExcluido(c) }));

  return { origem: dados.origem, acoes, divergencias, foraDaPlanilha, anos };
}

/** Aplica o plano em memória (o mesmo que o script grava no banco). */
export function aplicarPlanoEmMemoria(contratosBanco, plano) {
  const porId = new Map(contratosBanco.map((c) => [c.id, { ...c }]));
  for (const a of plano.acoes) {
    if (a.tipo === "criar") porId.set(a.id, { id: a.id, ...a.campos });
    if (a.tipo === "atualizar") {
      const atual = porId.get(a.id);
      porId.set(a.id, { ...atual, ...a.campos, historicoMovimentacoes: [...(atual.historicoMovimentacoes || []), ...a.entradasHistorico] });
    }
  }
  return [...porId.values()];
}

/** Entrada `importacao_planilha` do histórico: valor anterior, recalculado, diferença e motivo. */
export function montarEntradaImportacao({ alvo, acao, antes, depois, alteracoes, data, origem }) {
  const porAno = {};
  for (const ano of Object.keys(depois.porAno)) {
    const a = antes.porAno[ano] || 0;
    const d = depois.porAno[ano] || 0;
    if (difere(a, d)) porAno[String(ano)] = { antes: arred(a), depois: arred(d), diferenca: arred(d - a) };
  }
  const resumoAnos = Object.entries(porAno).map(([ano, v]) => `${ano}: ${v.diferenca >= 0 ? "+" : "-"}${formatarReais(Math.abs(v.diferenca))}`).join("; ");
  return {
    tipo: "importacao_planilha",
    origem,
    versaoRegra: motor.VERSAO_REGRA_CALCULO,
    descricao: `${acao === "criar" ? "Cadastro" : "Conferência"} pela planilha de controle: valor no fundo de `
      + `${formatarReais(antes.total)} para ${formatarReais(depois.total)}${resumoAnos ? ` (por exercício: ${resumoAnos})` : ""}`,
    motivo: "Reconciliação com a planilha de controle do Shinatal (régua v2, prazo indeterminado).",
    alteracoes: alteracoes.map((x) => ({ campo: x.campo, antes: JSON.stringify(x.antes), depois: JSON.stringify(x.depois) })),
    funcionarios: alvo.linhas.map((l) => ({
      linha: l.id, funcao: l.funcao, local: l.local ?? null, implantacao: l.implantacao, saida: l.saida || null, quantidade: l.quantidade
    })),
    fundoAntes: arred(antes.total),
    fundoDepois: arred(depois.total),
    diferenca: arred(depois.total - antes.total),
    porAno,
    data,
    registradoPor: AUTOR_IMPORTACAO
  };
}

/** Relatório CSV (separador ";" para abrir direto no Excel em pt-BR). */
export function relatorioCSV(plano) {
  const br = (v) => (v || 0).toFixed(2).replace(".", ",");
  const linhas = [["acao", "contrato_id", "empresa", "valor_anterior", "valor_recalculado", "diferenca", "alteracoes", "por_exercicio"]];
  for (const a of plano.acoes) {
    linhas.push([
      a.tipo, a.id, a.nomeEmpresa, br(a.antes), br(a.depois), br((a.depois || 0) - (a.antes || 0)),
      (a.alteracoes || []).map((x) => x.campo).join(" | "),
      Object.entries(a.porAno || {}).map(([ano, v]) => `${ano}: ${br(v.diferenca)}`).join(" | ")
    ]);
  }
  for (const d of plano.divergencias) linhas.push(["divergencia_" + d.gravidade, "", d.contrato, "", "", "", d.mensagem, ""]);
  for (const f of plano.foraDaPlanilha) linhas.push([f.excluidoDaTarefa ? "fora_da_tarefa_nao_alterado" : "fora_da_planilha_nao_alterado", f.id, f.nomeEmpresa, "", "", "", "", ""]);
  return linhas.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
}
