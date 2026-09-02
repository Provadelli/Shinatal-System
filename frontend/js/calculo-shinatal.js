/**
 * Shinatal — Motor de cálculo da premiação.
 * Implementação literal do "Regulamento Interno — Shinatal" (Shine Rio Serviços Ltda.).
 * Cada função cita a seção do regulamento que implementa.
 *
 * Módulo puro (sem I/O, sem Firebase): recebe arrays já carregados do Firestore e devolve
 * números. É usado tanto pelo dashboard do colaborador (somente leitura) quanto pelo
 * simulador do painel de gestão.
 *
 * ⚠️ Seção 16 ("os redutores terão caráter acumulativo em no máximo dois índices, um maior
 * + um menor") é a única regra genuinamente ambígua do texto. A leitura adotada aqui:
 * dentre os redutores PERCENTUAIS (atrasos, disciplina, avaliação negativa), aplicam-se no
 * máximo dois — o de maior peso e o de menor peso dentre os que ainda restarem — os demais
 * são descartados. O desconto de faltas (Seção 7) tem fórmula própria em R$ e é sempre
 * aplicado, pois o texto não o lista na tabela de "redutores" percentuais da Seção 16.
 * Recomenda-se validação jurídica/RH desta interpretação antes de uso em produção.
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
/* Fundo Shinatal — Seção 2                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {object[]} contratos
 * @param {object[]} contratosEmpresariais contratos empresariais (CNPJ) — feature do Admin. Cada
 *   um já carrega seu próprio `quantidadeFuncionariosIniciais`/`saidasIniciais`/`entradasContrato`
 *   diretamente no documento (sem subcoleção).
 */
function calcularFundo(contratos, contratosEmpresariais = []) {
  let arrecadado = 0;
  let estornos = 0;

  for (const c of contratos) {
    arrecadado += CREDITO_POR_CONTRATO; // Seção 2.1 — crédito integral na ativação

    if (c.status === "encerrado" && c.dataAtivacao && c.dataEncerramento) {
      const meses = mesesEntreDatas(c.dataAtivacao, c.dataEncerramento);
      if (meses < MESES_ANO) {
        const mesesFaltantes = MESES_ANO - meses;
        estornos += (CREDITO_POR_CONTRATO / MESES_ANO) * mesesFaltantes; // Seção 2.2
      }
    }
  }

  for (const ce of contratosEmpresariais) {
    const resumo = calcularResumoContratoEmpresarial(ce);
    arrecadado += resumo.totalCreditado;
    if (ce.status === "encerrado") estornos += resumo.estorno;
  }

  return {
    arrecadado,
    estornos,
    saldoDisponivel: Math.max(0, arrecadado - estornos)
  };
}

function mesesEntreDatas(inicioISO, fimISO) {
  const inicio = new Date(inicioISO + "T00:00:00");
  const fim = new Date(fimISO + "T00:00:00");
  return (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth());
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
/* Contratos Empresariais (CNPJ) — Repactuação                         */
/* Tudo fica direto no documento do contrato, sem subcoleção nem nomes */
/* individuais: o quadro inicial é só uma quantidade; quem sai desse   */
/* grupo entra em `saidasIniciais` (data + motivo); quem entra durante */
/* o contrato entra em `entradasContrato` (data de entrada + data de   */
/* saída, se já saiu também) — nenhum dos dois precisa de nome, só a   */
/* contagem e a data importam para o cálculo. Cada entrada/saída       */
/* ajusta o fundo em R$150,00 (valor fixo por funcionário — não é      */
/* proporcionalizado por mês). O crédito inicial (Seção 2.1) é         */
/* proporcional aos MESES PREVISTOS do contrato (dataInicio →          */
/* dataFimPrevista), limitados a 12 — um contrato previsto para 12+    */
/* meses credita o valor cheio de R$150/funcionário, e um previsto     */
/* para menos já nasce proporcional. Se o contrato encerrar antes de   */
/* atingir esses mesmos meses previstos, o total creditado é estornado */
/* proporcionalmente aos meses que faltavam (Seção 2.2), com base nos  */
/* meses REALMENTE decorridos até o encerramento.                      */
/* ------------------------------------------------------------------ */

const CREDITO_AJUSTE_FUNCIONARIO_CONTRATO = 150;

/** Duração prevista entre o início e o encerramento previsto do contrato. */
function calcularDuracaoMesesPrevista(dataInicioISO, dataFimPrevistaISO) {
  if (!dataInicioISO || !dataFimPrevistaISO) return 0;
  return Math.max(0, mesesEntreDatas(dataInicioISO, dataFimPrevistaISO));
}

/** Meses previstos do contrato, limitados a 12 (o crédito nunca ultrapassa R$150/func. — Seção 2). */
function calcularMesesVigentesContrato(dataInicioISO, dataFimPrevistaISO) {
  return Math.min(calcularDuracaoMesesPrevista(dataInicioISO, dataFimPrevistaISO), MESES_ANO);
}

/** R$150/12 por funcionário do quadro inicial, × os meses vigentes previstos do contrato (Seção 2.1). */
function calcularCreditoInicialContratoEmpresarial(contrato) {
  const meses = calcularMesesVigentesContrato(contrato.dataInicio, contrato.dataFimPrevista);
  return (CREDITO_POR_CONTRATO / MESES_ANO) * (contrato.quantidadeFuncionariosIniciais || 0) * meses;
}

/** Quantidade de funcionários de um registro de saída/entrada — 1 se não informado (compatível
 * com registros antigos, de antes do campo de quantidade em lote). */
function quantidadeDoRegistro(registro) {
  return Math.max(1, Number(registro?.quantidade) || 1);
}

/**
 * Ajustes de +150,00 (entrada durante o contrato) e -150,00 (saída — do quadro inicial ou de
 * uma entrada) POR FUNCIONÁRIO, até a data de referência. Cada registro pode representar um
 * lote de N funcionários (campo `quantidade`) — nenhum dos dois precisa de nome, só datas e a
 * contagem de cada lote.
 * @param {Array<{dataEntrada:string, dataSaida?:string|null, quantidade?:number}>} entradasContrato
 * @param {Array<{data:string, quantidade?:number}>} saidasIniciais
 */
function calcularAjustesFuncionariosContrato(entradasContrato, saidasIniciais, dataReferenciaISO) {
  let acrescido = 0;
  let descontado = 0;
  for (const e of (entradasContrato || [])) {
    const qtd = quantidadeDoRegistro(e);
    if (e.dataEntrada && e.dataEntrada <= dataReferenciaISO) acrescido += CREDITO_AJUSTE_FUNCIONARIO_CONTRATO * qtd;
    if (e.dataSaida && e.dataSaida <= dataReferenciaISO) descontado += CREDITO_AJUSTE_FUNCIONARIO_CONTRATO * qtd;
  }
  for (const s of (saidasIniciais || [])) {
    if (s.data && s.data <= dataReferenciaISO) descontado += CREDITO_AJUSTE_FUNCIONARIO_CONTRATO * quantidadeDoRegistro(s);
  }
  return { acrescido, descontado };
}

/** Soma os meses em que o contrato ficou pausado até a data de referência — uma pausa ainda
 * aberta (dataRetomada null) conta até a própria data de referência. Tempo pausado não conta
 * como tempo efetivo de execução do contrato (ver "Pausar contrato" abaixo). */
function calcularMesesPausados(pausas, dataReferenciaISO) {
  return (pausas || []).reduce((soma, p) => {
    if (!p.dataPausa || p.dataPausa > dataReferenciaISO) return soma;
    const fim = p.dataRetomada && p.dataRetomada < dataReferenciaISO ? p.dataRetomada : dataReferenciaISO;
    return soma + Math.max(0, mesesEntreDatas(p.dataPausa, fim));
  }, 0);
}

/** Estorno proporcional se o contrato encerrar (ou estiver projetado a encerrar) antes dos meses
 * previstos. `mesesDecorridos` é o tempo EFETIVO de execução — exclui qualquer período em que o
 * contrato esteve pausado (ver `calcularMesesPausados`), já que pausas não contam para os 12 meses. */
function calcularEstornoContratoEmpresarial(dataInicioISO, dataFimPrevistaISO, dataReferenciaISO, valorCreditadoAteAData, pausas = []) {
  if (!dataInicioISO || valorCreditadoAteAData <= 0) return 0;
  const mesesAlvo = calcularMesesVigentesContrato(dataInicioISO, dataFimPrevistaISO);
  if (mesesAlvo <= 0) return 0;
  const mesesBrutos = Math.max(0, mesesEntreDatas(dataInicioISO, dataReferenciaISO));
  const mesesDecorridos = Math.max(0, mesesBrutos - calcularMesesPausados(pausas, dataReferenciaISO));
  if (mesesDecorridos >= mesesAlvo) return 0;
  const mesesFaltantes = mesesAlvo - mesesDecorridos;
  return Math.min(valorCreditadoAteAData, (valorCreditadoAteAData / mesesAlvo) * mesesFaltantes);
}

/**
 * Resumo financeiro completo de um contrato empresarial: crédito inicial, ajustes por
 * entrada/saída e o estorno — real se já encerrado, ou projetado ("se encerrasse hoje")
 * enquanto o contrato estiver ativo (Cláusula 2.2). Também devolve o headcount atual
 * (`qtdAtual`), já líquido de saídas do quadro inicial e de entradas que também saíram.
 *
 * `acrescido`/`descontado` (exibidos na planilha) somam tanto os ajustes de funcionários
 * quanto o efeito de mudar o prazo previsto do contrato (`ajustePrazo`) — estender o prazo
 * aumenta o crédito (entra em `acrescido`), encurtar reduz (entra em `descontado`). Esse
 * ajuste é só de EXIBIÇÃO: `totalCreditado` já reflete o prazo atual através do próprio
 * `creditoInicial`, então `ajustePrazo` não é somado de novo ali (evita contar duas vezes).
 * @param {{dataInicio:string, status:string, dataEncerramentoReal:string|null,
 *   dataFimPrevista?:string, dataFimPrevistaOriginal?:string,
 *   quantidadeFuncionariosIniciais?:number, saidasIniciais?:Array<{data:string}>,
 *   entradasContrato?:Array<{dataEntrada:string, dataSaida?:string|null}>}} contrato
 */
function calcularResumoContratoEmpresarial(contrato, hojeISO = new Date().toISOString().slice(0, 10)) {
  const dataReferencia = contrato.status === "encerrado" ? (contrato.dataEncerramentoReal || hojeISO) : hojeISO;
  const saidasIniciais = contrato.saidasIniciais || [];
  const entradasContrato = contrato.entradasContrato || [];
  const creditoInicial = calcularCreditoInicialContratoEmpresarial(contrato);
  const { acrescido: acrescidoFuncionarios, descontado: descontadoFuncionarios } =
    calcularAjustesFuncionariosContrato(entradasContrato, saidasIniciais, dataReferencia);

  // Contratos antigos (de antes deste campo existir) não têm dataFimPrevistaOriginal — nesse
  // caso o prazo atual vira a própria base de comparação, então o ajuste dá 0 (comportamento
  // igual ao de antes desta função existir, sem quebrar contratos já cadastrados).
  const creditoInicialOriginal = calcularCreditoInicialContratoEmpresarial(
    { ...contrato, dataFimPrevista: contrato.dataFimPrevistaOriginal || contrato.dataFimPrevista }
  );
  const ajustePrazo = creditoInicial - creditoInicialOriginal;

  const acrescido = acrescidoFuncionarios + Math.max(0, ajustePrazo);
  const descontado = descontadoFuncionarios + Math.max(0, -ajustePrazo);
  const totalCreditado = creditoInicial + acrescidoFuncionarios - descontadoFuncionarios;
  const pausas = contrato.pausas || [];
  const estorno = calcularEstornoContratoEmpresarial(contrato.dataInicio, contrato.dataFimPrevista, dataReferencia, totalCreditado, pausas);
  const totalCreditadoFundo = contrato.status === "encerrado" ? Math.max(0, totalCreditado - estorno) : totalCreditado;
  const saidasIniciaisQtd = saidasIniciais.reduce((soma, s) => soma + quantidadeDoRegistro(s), 0);
  const entradasAtivasQtd = entradasContrato.filter((e) => !e.dataSaida).reduce((soma, e) => soma + quantidadeDoRegistro(e), 0);
  const qtdAtual = Math.max(0, (contrato.quantidadeFuncionariosIniciais || 0) - saidasIniciaisQtd) + entradasAtivasQtd;
  const mesesPausados = calcularMesesPausados(pausas, dataReferencia);
  return { creditoInicial, acrescido, descontado, ajustePrazo, totalCreditado, estorno, totalCreditadoFundo, dataReferencia, qtdAtual, mesesPausados };
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

/** Atraso relevante = entrada ≥ 20 minutos após o horário contratual (Seção 8.4). */
function ehAtrasoRelevante(minutosAtraso) {
  return minutosAtraso >= 20;
}

/**
 * Conta pontos de atraso no ano (Seção 8.2): cada bloco de 6 atrasos relevantes num mesmo MÊS
 * vira 1 ponto — 6 atrasos = 1 ponto, 12 = 2 pontos, 36 = 6 pontos, 72 = 12 pontos (teto, ver
 * calcularPercentualAtraso). Até 5 atrasos no mês não gera nenhum ponto.
 * @returns {{pontos:number, porMes:Record<string, number>}}
 */
function contarPontosAtraso(atrasos, anoExercicio) {
  const porMes = {}; // 'aaaa-mm' -> contagem de atrasos relevantes
  for (const a of atrasos) {
    const data = new Date(a.data + "T00:00:00");
    if (data.getFullYear() !== anoExercicio) continue;
    if (!ehAtrasoRelevante(a.minutosAtraso)) continue;
    const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
    porMes[chave] = (porMes[chave] || 0) + 1;
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
function calcularCotaComContexto(uidAlvo, todosUsuarios, mapaDados, contratos, anoExercicio) {
  const { saldoDisponivel } = calcularFundo(contratos);
  const elegiveis = todosUsuarios.filter((u) => verificarElegibilidade(u).elegivel);
  const somaPesos = elegiveis.reduce((soma, u) => soma + calcularPesoIndividual(u, anoExercicio), 0);

  const usuarioAlvo = todosUsuarios.find((u) => u.uid === uidAlvo);
  if (!usuarioAlvo) return null;

  const dados = mapaDados[uidAlvo] || { faltas: [], atrasos: [], advertencias: [], avaliacoes: [] };
  return calcularCotaColaborador(usuarioAlvo, dados, saldoDisponivel, somaPesos, anoExercicio);
}

// Exportações ES Module (consumidas via <script type="module"> em dashboard.js/gestao.js).
export {
  CREDITO_POR_CONTRATO,
  MESES_ANO,
  verificarElegibilidade,
  calcularAvosTrabalhados,
  percentualCargaHoraria,
  calcularPesoIndividual,
  calcularFundo,
  mesesEntreDatas,
  contarFaltasComDesconto,
  calcularDescontoFaltas,
  ehAtrasoRelevante,
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
  CREDITO_AJUSTE_FUNCIONARIO_CONTRATO,
  calcularDuracaoMesesPrevista,
  calcularMesesVigentesContrato,
  quantidadeDoRegistro,
  calcularCreditoInicialContratoEmpresarial,
  calcularAjustesFuncionariosContrato,
  calcularEstornoContratoEmpresarial,
  calcularResumoContratoEmpresarial,
  calcularMesesPausados
};
