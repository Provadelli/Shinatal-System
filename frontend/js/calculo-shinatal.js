/**
 * Shinatal — Motor de cálculo da premiação.
 * Implementação do "Regulamento Interno — Shinatal" (Shine Rio Serviços Ltda.).
 * Cada função cita a seção do regulamento que implementa.
 *
 * Módulo puro (sem I/O, sem Firebase): recebe arrays já carregados do Firestore e devolve
 * números. É a ÚNICA fonte de cálculo do sistema — usado pelos painéis, pelo simulador, pela
 * publicação do fundo (fundo-service.js) e pelo script de migração (backend/scripts).
 *
 * Régua de meses dos contratos: versão v2 (VERSAO_REGRA_CALCULO), centralizada em
 * `contarMesesContabilizados`. Nada de valor por contrato fica gravado no banco: tudo é
 * recalculado a partir das datas e quantidades, então a régua vale igual para contratos
 * antigos e novos.
 *
 * ⚠️ Seção 16 ("os redutores terão caráter acumulativo em no máximo dois índices, um maior
 * + um menor") é a única regra genuinamente ambígua do texto. A leitura adotada aqui:
 * dentre os redutores PERCENTUAIS (atrasos, disciplina, avaliação negativa), aplicam-se no
 * máximo dois — o de maior peso e o de menor peso dentre os que ainda restarem — os demais
 * são descartados. O desconto de faltas (Seção 7) tem fórmula própria em R$ e é sempre
 * aplicado, pois o texto não o lista na tabela de "redutores" percentuais da Seção 16.
 */

const CREDITO_POR_CONTRATO = 150; // Seção 2
const MESES_ANO = 12;

/* ------------------------------------------------------------------ */
/* Elegibilidade — Seção 5                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {{status:string, role?:string}} usuario status: 'ativo'|'aviso_previo'|'demitido'|'afastado'
 * @returns {{elegivel:boolean, motivo:string|null}}
 */
function verificarElegibilidade(usuario) {
  const motivos = {
    demitido: "Desligamento (pedido ou demissão) antes da data de pagamento",
    aviso_previo: "Cumprindo aviso prévio na data do pagamento",
    abandono: "Abandono de emprego",
    fraude: "Fraude, falsificação ou ato doloso contra a empresa/cliente",
    // Regra da plataforma (não é da Seção 5 do regulamento): só o Presidente é uma conta
    // puramente de gestão do programa (aprova solicitações, não é premiado) — Admin/DP/RH
    // participam da divisão do fundo normalmente, como qualquer colaborador.
    presidente: "Presidente — não participa da divisão do fundo (Seção especial da plataforma)"
  };
  if (usuario.role === "presidente") {
    return { elegivel: false, motivo: motivos.presidente };
  }
  if (usuario.motivoPerdaIntegral && motivos[usuario.motivoPerdaIntegral]) {
    return { elegivel: false, motivo: motivos[usuario.motivoPerdaIntegral] };
  }
  if (usuario.status === "demitido" || usuario.status === "aviso_previo") {
    return { elegivel: false, motivo: motivos[usuario.status] };
  }
  return { elegivel: true, motivo: null };
}

/* ------------------------------------------------------------------ */
/* Proporcionalidade — Seção 4                                         */
/* ------------------------------------------------------------------ */

/**
 * Avos trabalhados no exercício (Seção 4.1): admissão até dia 15 conta o mês cheio;
 * a partir do dia 16 a contagem começa no mês seguinte. Desligamento antes do fim do
 * ano zera a elegibilidade (Seção 5), então aqui assumimos o colaborador ativo até 31/12
 * do ano-exercício (ou até a data de corte informada).
 * @param {string} dataAdmissaoISO 'aaaa-mm-dd'
 * @param {number} anoExercicio
 * @returns {number} 0 a 12
 */
function calcularAvosTrabalhados(dataAdmissaoISO, anoExercicio) {
  const admissao = new Date(dataAdmissaoISO + "T00:00:00");
  if (Number.isNaN(admissao.getTime())) return 0;

  const anoAdmissao = admissao.getFullYear();
  if (anoAdmissao > anoExercicio) return 0;
  if (anoAdmissao < anoExercicio) return MESES_ANO; // admitido em ano anterior: exercício cheio

  const mesInicio = admissao.getDate() <= 15 ? admissao.getMonth() : admissao.getMonth() + 1;
  const avos = MESES_ANO - mesInicio; // mês de dezembro = índice 11 → 1 avo
  return Math.max(0, Math.min(MESES_ANO, avos));
}

/** Percentual da cota conforme jornada contratual (Seção 4.2). */
function percentualCargaHoraria(cargaHorariaDiaria) {
  const tabela = { 8: 1, 6: 0.75, 4: 0.5 };
  return tabela[cargaHorariaDiaria] ?? 0;
}

/** Peso do colaborador na divisão do fundo: avos/12 × % jornada (Seções 4 e 6). */
function calcularPesoIndividual(usuario, anoExercicio) {
  const avos = calcularAvosTrabalhados(usuario.dataAdmissao, anoExercicio);
  const pctJornada = percentualCargaHoraria(usuario.cargaHoraria);
  return (avos / MESES_ANO) * pctJornada;
}

/* ------------------------------------------------------------------ */
/* Régua de meses — versão v2 (nov/2026)                               */
/* ÚNICA referência para contar meses de contratos empresariais e dos  */
/* funcionários alocados neles. Trabalha só com datas de calendário    */
/* ('aaaa-mm-dd' → índice de mês = ano×12 + mês), sem Date/UTC, então  */
/* não existe erro de um dia por fuso horário.                         */
/*                                                                     */
/*  • Entrada (início do contrato, entrada de funcionário, retomada de */
/*    pausa): até o dia 14 o mês conta; do dia 15 em diante, a         */
/*    contagem começa no mês seguinte.                                 */
/*  • Término previsto e encerramento do contrato: o mês final sempre  */
/*    conta, qualquer que seja o dia.                                  */
/*  • Desligamento individual (e início de pausa): o mês só conta se a */
/*    pessoa ficou até o último dia dele.                              */
/* ------------------------------------------------------------------ */

const VERSAO_REGRA_CALCULO = "v2-2026-11";
const VALOR_MES_FUNCIONARIO = CREDITO_POR_CONTRATO / MESES_ANO; // R$ 12,50
const DIA_LIMITE_ENTRADA = 14;

/** 'aaaa-mm-dd' → {ano, mes (0-11), dia}; null se não for uma data de calendário válida. */
function partesISO(dataISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataISO || ""));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]) - 1;
  const dia = Number(m[3]);
  if (mes < 0 || mes > 11 || dia < 1 || dia > diasNoMes(ano, mes)) return null;
  return { ano, mes, dia };
}

function indiceMes(ano, mes) {
  return ano * MESES_ANO + mes;
}

function ehAnoBissexto(ano) {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano, mes) {
  return [31, ehAnoBissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes];
}

function ehUltimoDiaDoMes(dataISO) {
  const p = partesISO(dataISO);
  return !!p && p.dia === diasNoMes(p.ano, p.mes);
}

/** Data de hoje no fuso do aparelho, como 'aaaa-mm-dd' (nunca via toISOString, que é UTC). */
function hojeISOLocal(agora = new Date()) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

/** Índice do primeiro mês contabilizado a partir de uma data de ENTRADA (regra do dia 14). */
function primeiroMesContabilizado(dataISO) {
  const p = partesISO(dataISO);
  if (!p) return null;
  return indiceMes(p.ano, p.mes) + (p.dia <= DIA_LIMITE_ENTRADA ? 0 : 1);
}

/**
 * Índice do último mês contabilizado numa data FINAL.
 * @param {"termino_previsto"|"encerramento"|"referencia"|"desligamento"} tipoFim
 */
function ultimoMesContabilizado(dataISO, tipoFim) {
  const p = partesISO(dataISO);
  if (!p) return null;
  const idx = indiceMes(p.ano, p.mes);
  if (tipoFim === "desligamento") return ehUltimoDiaDoMes(dataISO) ? idx : idx - 1;
  return idx;
}

/**
 * Meses do intervalo [iniIdx, fimIdx] em que houve pausa. A pausa é tratada como uma saída
 * seguida de uma entrada: o mês em que ela começa deixa de contar (exceto se começar no último
 * dia do mês) e o mês da retomada volta a contar se a retomada for até o dia 14. Pausa ainda
 * aberta — ou retomada depois de `ateISO` — vai até o fim do intervalo. Pausas sobrepostas não
 * contam o mesmo mês duas vezes.
 */
function mesesPausadosNoIntervalo(pausas, iniIdx, fimIdx, ateISO) {
  if (fimIdx < iniIdx) return 0;
  const meses = new Set();
  for (const p of (pausas || [])) {
    if (!p || !partesISO(p.dataPausa)) continue;
    if (ateISO && p.dataPausa > ateISO) continue;
    const inicio = Math.max(iniIdx, ultimoMesContabilizado(p.dataPausa, "desligamento") + 1);
    const retomou = p.dataRetomada && partesISO(p.dataRetomada) && (!ateISO || p.dataRetomada <= ateISO);
    const fim = Math.min(fimIdx, retomou ? primeiroMesContabilizado(p.dataRetomada) - 1 : fimIdx);
    for (let m = inicio; m <= fim; m++) meses.add(m);
  }
  return meses.size;
}

/**
 * FUNÇÃO CENTRAL — quantos meses contam entre uma data de entrada e uma data final.
 * @param {{inicio:string, fim:string, tipoFim?:"termino_previsto"|"encerramento"|"referencia"|"desligamento",
 *   pausas?:Array<{dataPausa:string, dataRetomada:string|null}>}} args
 * @returns {number} meses contabilizados (≥ 0)
 */
function contarMesesContabilizados({ inicio, fim, tipoFim = "encerramento", pausas = [] }) {
  const ini = primeiroMesContabilizado(inicio);
  const ult = ultimoMesContabilizado(fim, tipoFim);
  if (ini === null || ult === null || ult < ini) return 0;
  const pausados = mesesPausadosNoIntervalo(pausas, ini, ult, fim);
  return Math.max(0, ult - ini + 1 - pausados);
}

/** "Mês de referência" de uma entrada (regra do dia 14) — rótulo "mm/aaaa" e ano do crédito inicial. */
function calcularMesReferenciaImplantacao(dataInicioISO) {
  const idx = primeiroMesContabilizado(dataInicioISO);
  if (idx === null) return { ano: NaN, mes: NaN };
  return { ano: Math.floor(idx / MESES_ANO), mes: idx % MESES_ANO };
}

/** Formata o mês de referência como "mm/aaaa" para exibição. */
function formatarMesReferencia({ ano, mes }) {
  return `${String(mes + 1).padStart(2, "0")}/${ano}`;
}

/* ------------------------------------------------------------------ */
/* Contratos Empresariais (CNPJ)                                       */
/* O cálculo é feito por LOTE de funcionários — o quadro inicial que   */
/* continua, cada saída do quadro inicial e cada entrada durante o     */
/* contrato. Cada lote tem os seus próprios meses creditados e os seus */
/* próprios meses contados; um desligamento nunca altera os demais.    */
/*                                                                     */
/* Prazo determinado: o lote recebe R$12,50 × meses da entrada até o   */
/* fim previsto (teto: meses vigentes do contrato, no máximo 12).      */
/* Prazo indeterminado: o lote recebe R$150 cheios (12 meses).         */
/* Quando o lote sai (desligamento) ou o contrato encerra, ele passa a */
/* valer R$12,50 × meses contados (teto 12); a diferença é descontada  */
/* (saída) ou estornada (encerramento).                                */
/* ------------------------------------------------------------------ */

/** Duração prevista entre o início e o fim previsto do contrato (mês final sempre conta). */
function calcularDuracaoMesesPrevista(dataInicioISO, dataFimPrevistaISO) {
  if (!dataInicioISO || !dataFimPrevistaISO) return 0;
  return contarMesesContabilizados({ inicio: dataInicioISO, fim: dataFimPrevistaISO, tipoFim: "termino_previsto" });
}

/** Meses previstos do contrato, limitados a 12 (o crédito nunca passa de R$150/funcionário). */
function calcularMesesVigentesContrato(dataInicioISO, dataFimPrevistaISO) {
  return Math.min(calcularDuracaoMesesPrevista(dataInicioISO, dataFimPrevistaISO), MESES_ANO);
}

/** R$12,50 × funcionários iniciais × meses vigentes previstos (Seção 2.1). */
function calcularCreditoInicialContratoEmpresarial(contrato) {
  if (contrato.prazoIndeterminado) return CREDITO_POR_CONTRATO * (contrato.quantidadeFuncionariosIniciais || 0);
  const meses = calcularMesesVigentesContrato(contrato.dataInicio, contrato.dataFimPrevista);
  return VALOR_MES_FUNCIONARIO * (contrato.quantidadeFuncionariosIniciais || 0) * meses;
}

/** Quantidade de funcionários de um registro — 1 se não informado (registros antigos). */
function quantidadeDoRegistro(registro) {
  return Math.max(1, Number(registro?.quantidade) || 1);
}

/** A data de entrada efetiva de um lote nunca é anterior ao início do contrato. */
function entradaEfetiva(dataISO, contrato) {
  return contrato.dataInicio && dataISO < contrato.dataInicio ? contrato.dataInicio : dataISO;
}

/**
 * Meses creditados antecipadamente a um lote que entrou em `dataEntradaISO`.
 * Determinado: da entrada até o fim previsto, limitado aos meses vigentes do contrato.
 * Indeterminado: 12.
 */
function calcularMesesCreditadosLote(dataEntradaISO, contrato) {
  if (contrato.prazoIndeterminado) return MESES_ANO;
  const vigentes = calcularMesesVigentesContrato(contrato.dataInicio, contrato.dataFimPrevista);
  if (vigentes <= 0 || !dataEntradaISO) return 0;
  const restantes = contarMesesContabilizados({
    inicio: entradaEfetiva(dataEntradaISO, contrato), fim: contrato.dataFimPrevista, tipoFim: "termino_previsto"
  });
  return Math.max(0, Math.min(restantes, vigentes));
}

/**
 * Lotes de funcionários do contrato até a data de referência.
 * @returns {Array<{origem:"quadro_inicial"|"entrada", entrada:string, saida:string|null, quantidade:number}>}
 */
function montarLotesContrato(contrato, dataReferenciaISO) {
  const lotes = [];
  let iniciaisRestantes = contrato.quantidadeFuncionariosIniciais || 0;
  for (const s of (contrato.saidasIniciais || [])) {
    if (!s.data || s.data > dataReferenciaISO) continue;
    const quantidade = quantidadeDoRegistro(s);
    iniciaisRestantes -= quantidade;
    lotes.push({ origem: "quadro_inicial", entrada: contrato.dataInicio, saida: s.data, quantidade });
  }
  if (iniciaisRestantes > 0) {
    lotes.push({ origem: "quadro_inicial", entrada: contrato.dataInicio, saida: null, quantidade: iniciaisRestantes });
  }
  for (const e of (contrato.entradasContrato || [])) {
    if (!e.dataEntrada || e.dataEntrada > dataReferenciaISO) continue;
    const saida = e.dataSaida && e.dataSaida <= dataReferenciaISO ? e.dataSaida : null;
    lotes.push({ origem: "entrada", entrada: e.dataEntrada, saida, quantidade: quantidadeDoRegistro(e) });
  }
  return lotes;
}

/**
 * Valores de um lote. `desconto` (saída já ocorrida) ou `estornoProjetado` (ainda vinculado:
 * quanto seria estornado se o contrato encerrasse na data de referência).
 */
function calcularLote(lote, contrato, dataReferenciaISO) {
  const pausas = contrato.pausas || [];
  const entrada = entradaEfetiva(lote.entrada, contrato);
  const mesesCreditados = calcularMesesCreditadosLote(lote.entrada, contrato);
  const credito = VALOR_MES_FUNCIONARIO * lote.quantidade * mesesCreditados;
  const fim = lote.saida || dataReferenciaISO;
  const tipoFim = lote.saida ? "desligamento" : "encerramento";
  const mesesContados = Math.min(MESES_ANO, contarMesesContabilizados({ inicio: entrada, fim, tipoFim, pausas }));
  const diferenca = VALOR_MES_FUNCIONARIO * lote.quantidade * Math.max(0, mesesCreditados - mesesContados);
  return {
    ...lote, mesesCreditados, mesesContados, credito,
    desconto: lote.saida ? diferenca : 0,
    estornoProjetado: lote.saida ? 0 : diferenca
  };
}

/** Meses em que o contrato inteiro esteve pausado, do início até a data de referência. */
function calcularMesesPausados(pausas, dataReferenciaISO, dataInicioISO = null) {
  const ini = dataInicioISO ? primeiroMesContabilizado(dataInicioISO) : -Infinity;
  const fim = ultimoMesContabilizado(dataReferenciaISO, "referencia");
  if (fim === null) return 0;
  return mesesPausadosNoIntervalo(pausas, ini, fim, dataReferenciaISO);
}

/** Funcionário-meses pausados (pausas parciais do quadro): Σ quantidade × meses pausados. */
function calcularFuncionarioMesesPausados(funcionariosPausados, dataReferenciaISO, dataInicioISO = null) {
  return (funcionariosPausados || []).reduce(
    (soma, p) => soma + quantidadeDoRegistro(p) * calcularMesesPausados([p], dataReferenciaISO, dataInicioISO), 0
  );
}

/**
 * Monta a lista de pausas atualizada a partir de uma transição de status: entrar em "pausado"
 * abre uma nova pausa; sair de "pausado" fecha a última pausa aberta. Retorna `null` quando a
 * transição exige uma data que ainda não foi informada.
 */
function montarPausasAposTransicao(pausasAtuais, estavaPausado, novoStatus, dataPausa, dataRetomada) {
  const pausas = pausasAtuais || [];
  if (novoStatus === "pausado" && !estavaPausado) {
    if (!dataPausa) return null;
    return [...pausas, { dataPausa, dataRetomada: null }];
  }
  if (estavaPausado && novoStatus !== "pausado") {
    if (!dataRetomada) return null;
    return pausas.map((p, i) => (i === pausas.length - 1 ? { ...p, dataRetomada } : p));
  }
  return pausas;
}

/** Converte a data de uma entrada do histórico (Timestamp do Firestore, Date, {seconds} ou
 * string) para 'aaaa-mm-dd' no fuso local; null se não der para ler. */
function dataHistoricoParaISO(valor) {
  if (!valor) return null;
  if (typeof valor === "string" && partesISO(valor) && valor.length === 10) return valor;
  let d = null;
  if (typeof valor.toDate === "function") d = valor.toDate();
  else if (valor instanceof Date) d = valor;
  else if (typeof valor.seconds === "number") d = new Date(valor.seconds * 1000);
  else if (typeof valor._seconds === "number") d = new Date(valor._seconds * 1000);
  else if (typeof valor === "string") d = new Date(valor);
  if (!d || Number.isNaN(d.getTime())) return null;
  return hojeISOLocal(d);
}

/** Data da última alteração de prazo registrada no histórico do contrato (ou null). */
function dataUltimaAlteracaoPrazo(contrato) {
  const alteracoes = (contrato.historicoMovimentacoes || [])
    .filter((h) => h.tipo === "edicao_prazo" && /prazo/i.test(h.descricao || ""));
  for (let i = alteracoes.length - 1; i >= 0; i--) {
    const iso = dataHistoricoParaISO(alteracoes[i].data);
    if (iso) return iso;
  }
  return null;
}

/**
 * Resumo financeiro completo de um contrato empresarial (determinado ou indeterminado):
 * crédito inicial, entradas/saídas, ajuste de prazo e estorno — real se encerrado, projetado
 * ("se encerrasse hoje") enquanto ativo. `movimentos` traz cada lançamento datado (base do fundo
 * por exercício) e `lotes` o detalhamento por grupo de funcionários.
 */
function calcularResumoContratoEmpresarial(contrato, hojeISO = hojeISOLocal()) {
  const encerrado = contrato.status === "encerrado";
  const dataReferencia = encerrado ? (contrato.dataEncerramentoReal || hojeISO) : hojeISO;
  const indeterminado = !!contrato.prazoIndeterminado;
  const qtdIniciais = contrato.quantidadeFuncionariosIniciais || 0;

  const creditoInicial = calcularCreditoInicialContratoEmpresarial(contrato);
  const creditoInicialOriginal = indeterminado
    ? creditoInicial
    : calcularCreditoInicialContratoEmpresarial({ ...contrato, dataFimPrevista: contrato.dataFimPrevistaOriginal || contrato.dataFimPrevista });
  const ajustePrazo = creditoInicial - creditoInicialOriginal;

  const lotes = montarLotesContrato(contrato, dataReferencia).map((l) => calcularLote(l, contrato, dataReferencia));
  const movimentos = [{ tipo: "credito_inicial", data: contrato.dataInicio, valor: creditoInicialOriginal }];
  if (ajustePrazo !== 0) {
    movimentos.push({ tipo: "prazo", data: dataUltimaAlteracaoPrazo(contrato) || contrato.dataInicio, valor: ajustePrazo });
  }

  let acrescidoFuncionarios = 0;
  let descontadoFuncionarios = 0;
  let estornoLotes = 0;
  for (const l of lotes) {
    if (l.origem === "entrada") {
      acrescidoFuncionarios += l.credito;
      movimentos.push({ tipo: "entrada", data: l.entrada, valor: l.credito });
    }
    if (l.saida) {
      descontadoFuncionarios += l.desconto;
      movimentos.push({ tipo: "saida", data: l.saida, valor: -l.desconto });
    }
    estornoLotes += l.estornoProjetado;
  }

  const totalCreditado = Math.max(0, creditoInicial + acrescidoFuncionarios - descontadoFuncionarios);
  const pausas = contrato.pausas || [];
  const funcionariosPausados = [...(contrato.pausasQuadroInicial || []), ...(contrato.pausasEntradas || [])];
  const funcionarioMesesPausados = calcularFuncionarioMesesPausados(funcionariosPausados, dataReferencia, contrato.dataInicio);
  const estorno = Math.min(totalCreditado, estornoLotes + VALOR_MES_FUNCIONARIO * funcionarioMesesPausados);
  const totalCreditadoFundo = encerrado ? Math.max(0, totalCreditado - estorno) : totalCreditado;
  if (encerrado && estorno > 0) movimentos.push({ tipo: "estorno", data: dataReferencia, valor: -estorno });

  const saidasIniciaisQtd = (contrato.saidasIniciais || []).reduce((soma, s) => soma + quantidadeDoRegistro(s), 0);
  const entradasAtivasQtd = (contrato.entradasContrato || []).filter((e) => !e.dataSaida).reduce((soma, e) => soma + quantidadeDoRegistro(e), 0);
  const qtdAtual = Math.max(0, qtdIniciais - saidasIniciaisQtd) + entradasAtivasQtd;
  const qtdPausadaAtual = funcionariosPausados.filter((p) => !p.dataRetomada).reduce((soma, p) => soma + quantidadeDoRegistro(p), 0);

  // `acrescido`/`descontado` (exibidos na planilha) incluem o efeito da mudança de prazo; o
  // `totalCreditado` já reflete o prazo atual pelo próprio `creditoInicial` (sem contar duas vezes).
  return {
    creditoInicial,
    acrescido: acrescidoFuncionarios + Math.max(0, ajustePrazo),
    descontado: descontadoFuncionarios + Math.max(0, -ajustePrazo),
    ajustePrazo, totalCreditado, estorno, totalCreditadoFundo, dataReferencia,
    qtdAtual, mesesPausados: calcularMesesPausados(pausas, dataReferencia, contrato.dataInicio),
    funcionarioMesesPausados, qtdPausadaAtual, movimentos, lotes,
    // Para exibição: meses do contrato já contabilizados na data de referência (régua v2, sem
    // as pausas) e o total que dá direito a crédito (vigentes, ou 12 no prazo indeterminado).
    mesesContabilizados: contarMesesContabilizados({ inicio: contrato.dataInicio, fim: dataReferencia, tipoFim: "referencia", pausas }),
    mesesCreditoPrevistos: indeterminado ? MESES_ANO : calcularMesesVigentesContrato(contrato.dataInicio, contrato.dataFimPrevista),
    versaoRegra: VERSAO_REGRA_CALCULO
  };
}

/**
 * Detalhe de UM registro da aba Funcionários (uma saída do quadro inicial ou uma entrada),
 * calculado pela mesma régua do resumo — o que a tela mostra é exatamente o que vai ao fundo.
 * @param {"saida_inicial"|"entrada"} tipo
 */
function detalharRegistroFuncionarios(contrato, registro, tipo, hojeISO = hojeISOLocal()) {
  const dataReferencia = contrato.status === "encerrado" ? (contrato.dataEncerramentoReal || hojeISO) : hojeISO;
  const lote = tipo === "saida_inicial"
    ? { origem: "quadro_inicial", entrada: contrato.dataInicio, saida: registro.data, quantidade: quantidadeDoRegistro(registro) }
    : { origem: "entrada", entrada: registro.dataEntrada, saida: registro.dataSaida || null, quantidade: quantidadeDoRegistro(registro) };
  if (lote.saida && lote.saida > dataReferencia) lote.saida = null;
  const calculado = calcularLote(lote, contrato, dataReferencia);
  const fim = lote.saida || dataReferencia;
  const faixa = faixaMesesContabilizados(entradaEfetiva(lote.entrada, contrato), fim, lote.saida ? "desligamento" : "referencia");
  return { ...calculado, faixa, dataReferencia };
}

/** Primeiro e último mês contabilizados entre duas datas ({ano, mes}), ou null se nenhum. */
function faixaMesesContabilizados(inicioISO, fimISO, tipoFim) {
  const ini = primeiroMesContabilizado(inicioISO);
  const fim = ultimoMesContabilizado(fimISO, tipoFim);
  if (ini === null || fim === null || fim < ini) return null;
  const mes = (idx) => ({ ano: Math.floor(idx / MESES_ANO), mes: idx % MESES_ANO });
  return { inicio: mes(ini), fim: mes(fim) };
}

/* ------------------------------------------------------------------ */
/* Fundo Shinatal                                                      */
/* ------------------------------------------------------------------ */

/** Ano (exercício) de uma movimentação. O crédito inicial segue o mês de referência da
 * implantação (regra do dia 14 — implantado em 15/12/2026 conta em 2027); as demais, o ano
 * da própria data. */
function anoDoMovimento(movimento) {
  if (!movimento.data) return null;
  if (movimento.tipo === "credito_inicial") return calcularMesReferenciaImplantacao(movimento.data).ano;
  return Number(String(movimento.data).slice(0, 4));
}

/**
 * Quanto um contrato movimentou o Fundo Shinatal de um ano específico.
 * @returns {{creditado:number, descontado:number, estorno:number, liquido:number}}
 */
function calcularContribuicaoNoAno(contrato, ano, hojeISO) {
  const { movimentos } = calcularResumoContratoEmpresarial(contrato, hojeISO);
  let creditado = 0;
  let descontado = 0;
  let estorno = 0;
  for (const m of movimentos) {
    if (anoDoMovimento(m) !== ano || !m.valor) continue;
    if (m.valor > 0) creditado += m.valor;
    else if (m.tipo === "estorno") estorno += -m.valor;
    else descontado += -m.valor;
  }
  return { creditado, descontado, estorno, liquido: creditado - descontado - estorno };
}

/** Anos (exercícios) em que um conjunto de contratos teve alguma movimentação. */
function anosComMovimento(contratosEmpresariais = [], hojeISO) {
  const anos = new Set();
  for (const c of contratosEmpresariais) {
    for (const m of calcularResumoContratoEmpresarial(c, hojeISO).movimentos) {
      const ano = anoDoMovimento(m);
      if (Number.isFinite(ano) && m.valor) anos.add(ano);
    }
  }
  return [...anos].sort((a, b) => a - b);
}

/**
 * Fundo Shinatal de um exercício. A única fonte de dinheiro são os contratos empresariais
 * (CNPJ); só entram as movimentações daquele ano.
 */
function calcularFundo(contratosEmpresariais = [], anoExercicio = new Date().getFullYear(), hojeISO) {
  let arrecadado = 0;
  let estornos = 0;
  for (const ce of contratosEmpresariais) {
    const contribuicao = calcularContribuicaoNoAno(ce, anoExercicio, hojeISO);
    arrecadado += contribuicao.creditado;
    estornos += contribuicao.descontado + contribuicao.estorno;
  }
  return { arrecadado, estornos, saldoDisponivel: Math.max(0, arrecadado - estornos) };
}

/**
 * Agregados publicados no banco (`fundo/{ano}` e `estatisticas/publico`). Mesma função para a
 * interface e para o script de migração — o que o banco guarda é sempre o que as telas calculam.
 */
function montarAgregadosFundo(contratosEmpresariais = [], usuarios = [], anoExercicio, hojeISO) {
  const { arrecadado, estornos, saldoDisponivel } = calcularFundo(contratosEmpresariais, anoExercicio, hojeISO);
  const somaPesos = usuarios
    .filter((u) => verificarElegibilidade(u).elegivel)
    .reduce((soma, u) => soma + calcularPesoIndividual(u, anoExercicio), 0);
  const colaboradores = contratosEmpresariais.reduce(
    (soma, ce) => soma + calcularResumoContratoEmpresarial(ce, hojeISO).qtdAtual, 0
  );
  return {
    fundo: {
      arrecadado, estornos, saldoDisponivel, somaPesos,
      totalContratosAtivos: contratosEmpresariais.filter((c) => c.status === "ativo").length,
      totalContratosEncerrados: contratosEmpresariais.filter((c) => c.status === "encerrado").length
    },
    // `arrecadado` público = saldo líquido (o mesmo valor mostrado na gestão).
    publico: { arrecadado: saldoDisponivel, colaboradores }
  };
}


/* ------------------------------------------------------------------ */
/* CNPJ — cadastro de empresas (Repactuação)                           */
/* Valida tanto o CNPJ numérico tradicional quanto o formato           */
/* alfanumérico da Receita Federal (vigente desde jul/2026): os 12     */
/* caracteres-base podem ser dígito ou letra maiúscula (A-Z), e os 2   */
/* dígitos verificadores continuam sempre numéricos. O valor de cada   */
/* caractere-base é (código ASCII − 48) — para dígitos '0'-'9' isso já */
/* é o próprio valor numérico (0-9), então a mesma fórmula de módulo   */
/* 11 do CNPJ tradicional cobre os dois formatos sem ramificação.      */
/* ------------------------------------------------------------------ */

const PESOS_CNPJ_D1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_D2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Remove máscara e normaliza para maiúsculas (aceita dígitos e letras A-Z). */
function normalizarCNPJ(valor) {
  return String(valor || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Aplica a máscara XX.XXX.XXX/XXXX-XX sobre o que já foi digitado. */
function formatarCNPJ(valor) {
  const v = normalizarCNPJ(valor).slice(0, 14);
  const partes = [
    [0, 2], [2, 5], [5, 8], [8, 12], [12, 14]
  ].map(([ini, fim]) => v.slice(ini, fim)).filter(Boolean);
  let saida = partes[0] || "";
  if (partes[1]) saida += "." + partes[1];
  if (partes[2]) saida += "." + partes[2];
  if (partes[3]) saida += "/" + partes[3];
  if (partes[4]) saida += "-" + partes[4];
  return saida;
}

function calcularDigitoCNPJ(base, pesos) {
  const soma = base.split("").reduce((acc, ch, i) => acc + (ch.charCodeAt(0) - 48) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** @returns {boolean} true se o CNPJ (numérico ou alfanumérico) é válido. */
function validarCNPJ(valor) {
  const cnpj = normalizarCNPJ(valor);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false; // todos os caracteres iguais

  const doze = cnpj.slice(0, 12);
  const d1 = calcularDigitoCNPJ(doze, PESOS_CNPJ_D1);
  const d2 = calcularDigitoCNPJ(doze + String(d1), PESOS_CNPJ_D2);
  return cnpj.slice(12) === `${d1}${d2}`;
}


/* ------------------------------------------------------------------ */
/* Faltas injustificadas — Seção 7                                     */
/* ------------------------------------------------------------------ */

/** Filtra e conta apenas as faltas que geram desconto (Seção 7.3 exclui as justificadas). */
function contarFaltasComDesconto(faltas, anoExercicio) {
  return faltas.filter((f) => {
    const ano = new Date(f.data + "T00:00:00").getFullYear();
    return ano === anoExercicio && f.justificada === false;
  }).length;
}

/** Desconto = cota individual ÷ 30 × nº de faltas (Seção 7.1). */
function calcularDescontoFaltas(cotaAntesDoDesconto, numeroFaltas) {
  return (cotaAntesDoDesconto / 30) * numeroFaltas;
}

/* ------------------------------------------------------------------ */
/* Atrasos / pontualidade — Seção 8                                    */
/* ------------------------------------------------------------------ */

/**
 * Conta pontos de atraso no ano (Seção 8.2): cada bloco de 6 atrasos num mesmo MÊS vira 1 ponto —
 * 6 atrasos = 1 ponto, 12 = 2 pontos, 36 = 6 pontos, 72 = 12 pontos (teto, ver
 * calcularPercentualAtraso). Até 5 atrasos no mês não gera nenhum ponto. A quantidade de atrasos
 * de cada mês é informada diretamente pelo DP (campo "mesAno" + "quantidadeAtrasos"), já
 * considerando quais atrasos contam (Seção 8.4) — o sistema não registra mais horários.
 * @returns {{pontos:number, porMes:Record<string, number>}}
 */
function contarPontosAtraso(atrasos, anoExercicio) {
  const porMes = {}; // 'aaaa-mm' -> soma de atrasos lançados no mês
  for (const a of atrasos) {
    const ano = Number((a.mesAno || "").split("-")[0]);
    if (ano !== anoExercicio) continue;
    porMes[a.mesAno] = (porMes[a.mesAno] || 0) + (Number(a.quantidadeAtrasos) || 0);
  }
  const pontos = Object.values(porMes).reduce((soma, qtd) => soma + Math.floor(qtd / 6), 0);
  return { pontos, porMes };
}

/** Cada ponto = 1% de desconto, teto de 12% (Seção 8.3). */
function calcularPercentualAtraso(pontos) {
  return Math.min(12, pontos) / 100;
}

/* ------------------------------------------------------------------ */
/* Medidas disciplinares — Seção 9                                     */
/* ------------------------------------------------------------------ */

const TABELA_DISCIPLINAR = {
  verbal: 0.05,
  escrita: 0.10,
  suspensao1: 0.25,
  suspensao2: 0.50,
  suspensao3: "PERDA_INTEGRAL"
};

/**
 * Retorna o maior redutor disciplinar aplicável no ano (o regulamento não soma advertências
 * entre si — usa-se a ocorrência mais grave) e sinaliza perda integral na 3ª suspensão.
 */
function calcularDisciplinar(advertencias, anoExercicio) {
  const doAno = advertencias.filter((a) => new Date(a.data + "T00:00:00").getFullYear() === anoExercicio);
  if (doAno.some((a) => a.tipo === "suspensao3")) {
    return { percentual: 1, perdaIntegral: true, ocorrencias: doAno };
  }
  let maior = 0;
  for (const a of doAno) {
    const valor = TABELA_DISCIPLINAR[a.tipo];
    if (typeof valor === "number") maior = Math.max(maior, valor);
  }
  return { percentual: maior, perdaIntegral: false, ocorrencias: doAno };
}

/* ------------------------------------------------------------------ */
/* Avaliação de desempenho — Seção 11                                  */
/* ------------------------------------------------------------------ */

const TABELA_AVALIACAO = { excelente: 0.02, bom: 0, regular: -0.05, insatisfatorio: -0.15 };

function calcularAvaliacao(avaliacoes, anoExercicio) {
  const doAno = avaliacoes.find((a) => a.ano === anoExercicio && a.validadoRH);
  if (!doAno) return { percentual: 0, conceito: null };
  return { percentual: TABELA_AVALIACAO[doAno.conceito] ?? 0, conceito: doAno.conceito };
}

/* ------------------------------------------------------------------ */
/* Bônus por excelência — Seção 10                                     */
/* ------------------------------------------------------------------ */

function calcularBonusExcelencia({ numeroFaltas, pontosAtraso, disciplinar }) {
  const semOcorrencias = numeroFaltas === 0 && pontosAtraso === 0 && disciplinar.ocorrencias.length === 0;
  return semOcorrencias ? 0.03 : 0;
}

/* ------------------------------------------------------------------ */
/* Consolidação da Seção 16 (acumulação de redutores/adicionais)       */
/* ------------------------------------------------------------------ */

/**
 * Aplica no máximo 2 redutores percentuais (o maior + o menor entre os restantes).
 * @param {number[]} percentuais lista de redutores percentuais candidatos (0 a 1)
 */
function limitarRedutoresADoisIndices(percentuais) {
  const validos = percentuais.filter((p) => p > 0).sort((a, b) => b - a);
  if (validos.length <= 2) return validos.reduce((soma, p) => soma + p, 0);
  return validos[0] + validos[validos.length - 1];
}

/* ------------------------------------------------------------------ */
/* Pipeline completo por colaborador                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {object} usuario doc de `usuarios/{uid}`
 * @param {object} dados { faltas, atrasos, advertencias, avaliacoes } — já filtrados por uid
 * @param {number} saldoFundo saldo disponível do fundo no exercício
 * @param {number} somaPesos soma de calcularPesoIndividual() de todos os elegíveis
 * @param {number} anoExercicio
 */
function calcularCotaColaborador(usuario, dados, saldoFundo, somaPesos, anoExercicio) {
  const elegibilidade = verificarElegibilidade(usuario);
  const resultado = {
    elegivel: elegibilidade.elegivel,
    motivoInelegibilidade: elegibilidade.motivo,
    pesoIndividual: 0,
    cotaBase: 0,
    percentualRedutoresAplicados: 0,
    descontoFaltas: 0,
    percentualAdicionais: 0,
    numeroFaltas: 0,
    pontosAtraso: 0,
    disciplinar: { percentual: 0, perdaIntegral: false, ocorrencias: [] },
    avaliacao: { percentual: 0, conceito: null },
    bonusExcelencia: 0,
    cotaFinal: 0,
    detalhamento: []
  };

  if (!elegibilidade.elegivel || saldoFundo <= 0 || somaPesos <= 0) {
    return resultado;
  }

  // 1) Cota base proporcional (Seções 4 e 6)
  const peso = calcularPesoIndividual(usuario, anoExercicio);
  const cotaBase = (peso / somaPesos) * saldoFundo;
  resultado.pesoIndividual = peso;
  resultado.cotaBase = cotaBase;

  // 2) Insumos dos redutores/adicionais
  const numeroFaltas = contarFaltasComDesconto(dados.faltas, anoExercicio);
  const { pontos: pontosAtraso } = contarPontosAtraso(dados.atrasos, anoExercicio);
  const disciplinar = calcularDisciplinar(dados.advertencias, anoExercicio);
  const avaliacao = calcularAvaliacao(dados.avaliacoes, anoExercicio);
  const bonus = calcularBonusExcelencia({ numeroFaltas, pontosAtraso, disciplinar });

  resultado.numeroFaltas = numeroFaltas;
  resultado.pontosAtraso = pontosAtraso;
  resultado.disciplinar = disciplinar;
  resultado.avaliacao = avaliacao;
  resultado.bonusExcelencia = bonus;

  // Perda integral por 3ª suspensão (Seção 9)
  if (disciplinar.perdaIntegral) {
    resultado.cotaFinal = 0;
    resultado.detalhamento.push("Perda integral: 3ª suspensão disciplinar (Seção 9).");
    return resultado;
  }

  // 3) Redutores percentuais — no máximo 2 índices (Seção 16)
  const percentualAtraso = calcularPercentualAtraso(pontosAtraso);
  const percentualAvaliacaoNegativa = avaliacao.percentual < 0 ? Math.abs(avaliacao.percentual) : 0;
  const percentualRedutores = limitarRedutoresADoisIndices([
    percentualAtraso,
    disciplinar.percentual,
    percentualAvaliacaoNegativa
  ]);
  resultado.percentualRedutoresAplicados = percentualRedutores;
  const cotaAposRedutores = cotaBase * (1 - percentualRedutores);

  // 4) Desconto de faltas injustificadas (Seção 7) — aplicado após os redutores percentuais
  const descontoFaltas = calcularDescontoFaltas(cotaAposRedutores, numeroFaltas);
  resultado.descontoFaltas = descontoFaltas;
  const cotaAposFaltas = Math.max(0, cotaAposRedutores - descontoFaltas);

  // 5) Adicionais — bônus de excelência + avaliação positiva, acumuláveis (Seção 16)
  const percentualAvaliacaoPositiva = avaliacao.percentual > 0 ? avaliacao.percentual : 0;
  const percentualAdicionais = bonus + percentualAvaliacaoPositiva;
  resultado.percentualAdicionais = percentualAdicionais;

  const cotaFinal = cotaAposFaltas * (1 + percentualAdicionais);
  resultado.cotaFinal = Math.max(0, cotaFinal);

  return resultado;
}

/**
 * Recalcula a cota estimada de TODOS os elegíveis para obter a soma de pesos correta e
 * então devolve o resultado individual do `uidAlvo`. Use esta função no dashboard/simulador.
 */
function calcularCotaComContexto(uidAlvo, todosUsuarios, mapaDados, contratosEmpresariais, anoExercicio) {
  const { saldoDisponivel } = calcularFundo(contratosEmpresariais, anoExercicio);
  const elegiveis = todosUsuarios.filter((u) => verificarElegibilidade(u).elegivel);
  const somaPesos = elegiveis.reduce((soma, u) => soma + calcularPesoIndividual(u, anoExercicio), 0);

  const usuarioAlvo = todosUsuarios.find((u) => u.uid === uidAlvo);
  if (!usuarioAlvo) return null;

  const dados = mapaDados[uidAlvo] || { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
  return calcularCotaColaborador(usuarioAlvo, dados, saldoDisponivel, somaPesos, anoExercicio);
}

// Exportações ES Module (consumidas via <script type="module"> e pelos testes/scripts em Node).
export {
  CREDITO_POR_CONTRATO,
  MESES_ANO,
  VALOR_MES_FUNCIONARIO,
  VERSAO_REGRA_CALCULO,
  verificarElegibilidade,
  calcularAvosTrabalhados,
  percentualCargaHoraria,
  calcularPesoIndividual,
  calcularFundo,
  calcularContribuicaoNoAno,
  anoDoMovimento,
  anosComMovimento,
  montarAgregadosFundo,
  contarFaltasComDesconto,
  calcularDescontoFaltas,
  contarPontosAtraso,
  calcularPercentualAtraso,
  calcularDisciplinar,
  calcularAvaliacao,
  calcularBonusExcelencia,
  limitarRedutoresADoisIndices,
  calcularCotaColaborador,
  calcularCotaComContexto,
  normalizarCNPJ,
  formatarCNPJ,
  validarCNPJ,
  partesISO,
  diasNoMes,
  ehAnoBissexto,
  ehUltimoDiaDoMes,
  hojeISOLocal,
  primeiroMesContabilizado,
  ultimoMesContabilizado,
  mesesPausadosNoIntervalo,
  contarMesesContabilizados,
  calcularDuracaoMesesPrevista,
  calcularMesesVigentesContrato,
  calcularMesesCreditadosLote,
  montarLotesContrato,
  quantidadeDoRegistro,
  calcularCreditoInicialContratoEmpresarial,
  calcularResumoContratoEmpresarial,
  detalharRegistroFuncionarios,
  faixaMesesContabilizados,
  calcularMesesPausados,
  calcularFuncionarioMesesPausados,
  montarPausasAposTransicao,
  calcularMesReferenciaImplantacao,
  formatarMesReferencia,
  dataHistoricoParaISO
};
