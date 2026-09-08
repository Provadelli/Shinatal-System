// Shinatal — vitrine de "Perfil" (o próprio colaborador, ou visto por admin/DP/RH/Presidente):
// junta tudo que calculo-shinatal.js já calcula numa única tela, sem repetir nenhuma fórmula.
import { formatarMoeda, formatarData, formatarMesAno, escaparHTML, formatarJornadaSemanal } from "./ui-utils.js";
import { contarPontosAtraso } from "./calculo-shinatal.js";

const ROTULOS_ADVERTENCIA = {
  verbal: "Advertência verbal", escrita: "Advertência escrita",
  suspensao1: "1ª suspensão", suspensao2: "2ª suspensão", suspensao3: "3ª suspensão"
};
const ROTULOS_CONCEITO = { excelente: "Excelente", bom: "Bom", regular: "Regular", insatisfatorio: "Insatisfatório" };

/** Botão de lixeira — só aparece quando `tipo` está em `tiposExcluiveis` e há um `aoExcluir`. */
function botaoExcluir(tipo, id, tiposExcluiveis) {
  if (!tiposExcluiveis || !tiposExcluiveis.includes(tipo) || !id) return "";
  return `<button data-excluir-registro data-tipo="${tipo}" data-id="${id}" title="Excluir (lançado por engano)" aria-label="Excluir lançamento" class="text-christmas-red hover:opacity-70 transition-opacity p-1 shrink-0">
    <span class="material-symbols-outlined text-lg">delete</span>
  </button>`;
}

/**
 * @param {HTMLElement} container elemento onde o HTML do perfil detalhado será injetado
 * @param {{
 *   usuario: object,
 *   dados: {faltas:object[], atrasos:object[], advertencias:object[], avaliacoes:object[]},
 *   resultado: object,    // saída de calcularCotaColaborador
 *   somaPesos: number,
 *   anoExercicio: number,
 *   tiposExcluiveis?: string[],           // ex.: ['falta','atraso','advertencia','avaliacao']
 *   aoExcluir?: (tipo:string, id:string) => void
 * }} params
 */
function renderizarPerfilDetalhado(container, { usuario, dados, resultado, somaPesos, anoExercicio, tiposExcluiveis = [], aoExcluir = null }) {
  const participacaoPct = somaPesos > 0 ? (resultado.pesoIndividual / somaPesos) * 100 : 0;
  const { porMes } = contarPontosAtraso(dados.atrasos, anoExercicio);
  const mesesComAtraso = Object.entries(porMes).filter(([, qtd]) => qtd > 0).sort(([a], [b]) => a.localeCompare(b));

  const faltasOrdenadas = [...dados.faltas].sort((a, b) => (a.data < b.data ? 1 : -1));
  const atrasosOrdenados = [...dados.atrasos].sort((a, b) => (a.mesAno < b.mesAno ? 1 : -1));
  const advertenciasOrdenadas = [...dados.advertencias].sort((a, b) => (a.data < b.data ? 1 : -1));
  const avaliacaoDoAno = dados.avaliacoes.find((a) => a.ano === anoExercicio);

  container.innerHTML = `
    <div class="space-y-5">
      <div>
        <h4 class="font-display text-headline-md text-on-surface">${escaparHTML(usuario.nome) || "—"}</h4>
        <p class="font-body text-label-sm text-on-surface-variant">${escaparHTML(usuario.cargo) || "—"} · ${formatarJornadaSemanal(usuario.cargaHoraria)}</p>
      </div>
      <p class="font-body text-label-sm text-on-surface-variant">Admissão em ${usuario.dataAdmissao ? formatarData(usuario.dataAdmissao) : "—"}</p>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div class="bg-surface-container rounded-lg p-3">
          <p class="font-body text-label-sm text-on-surface-variant">Faltas injustificadas</p>
          <p class="font-display text-headline-md text-on-surface">${resultado.numeroFaltas}</p>
          <p class="font-body text-label-sm text-christmas-red">${resultado.descontoFaltas ? "-" + formatarMoeda(resultado.descontoFaltas) : "—"}</p>
        </div>
        <div class="bg-surface-container rounded-lg p-3">
          <p class="font-body text-label-sm text-on-surface-variant">Pontos de atraso</p>
          <p class="font-display text-headline-md text-on-surface">${resultado.pontosAtraso}</p>
          <p class="font-body text-label-sm text-christmas-red">${resultado.pontosAtraso ? "-" + resultado.pontosAtraso + "%" : "—"}</p>
        </div>
        <div class="bg-surface-container rounded-lg p-3">
          <p class="font-body text-label-sm text-on-surface-variant">Participação no fundo</p>
          <p class="font-display text-headline-md text-on-surface">${participacaoPct.toFixed(1)}%</p>
        </div>
      </div>

      <div>
        <p class="font-body font-semibold text-on-surface mb-1">Faltas</p>
        ${faltasOrdenadas.length ? `
        <ul class="space-y-1">
          ${faltasOrdenadas.map((f) => `
            <li class="flex items-center justify-between gap-2 font-body text-label-sm bg-surface-container rounded-lg px-3 py-1.5">
              <span>${formatarData(f.data)} — ${f.justificada ? "justificada" : "injustificada"}${f.motivo ? ` (${escaparHTML(f.motivo)})` : ""}</span>
              ${botaoExcluir("falta", f.id, tiposExcluiveis)}
            </li>`).join("")}
        </ul>` : `<p class="font-body text-label-sm text-on-surface-variant">Nenhuma falta registrada.</p>`}
      </div>

      ${mesesComAtraso.length ? `
      <div>
        <p class="font-body font-semibold text-on-surface mb-1">Atrasos por mês</p>
        <ul class="space-y-1">
          ${mesesComAtraso.map(([mes, qtd]) => `
            <li class="flex justify-between font-body text-label-sm bg-surface-container rounded-lg px-3 py-1.5">
              <span>${mes}</span><span>${qtd} atraso(s) · ${Math.floor(qtd / 6)} ponto(s)</span>
            </li>`).join("")}
        </ul>
      </div>` : ""}

      ${atrasosOrdenados.length ? `
      <div>
        <p class="font-body font-semibold text-on-surface mb-1">Atrasos — detalhado</p>
        <ul class="space-y-1">
          ${atrasosOrdenados.map((a) => `
            <li class="flex items-center justify-between gap-2 font-body text-label-sm bg-surface-container rounded-lg px-3 py-1.5">
              <span>${formatarMesAno(a.mesAno)} — ${a.quantidadeAtrasos ?? "?"} atraso(s)</span>
              ${botaoExcluir("atraso", a.id, tiposExcluiveis)}
            </li>`).join("")}
        </ul>
      </div>` : ""}

      <div>
        <p class="font-body font-semibold text-on-surface mb-1">Advertências</p>
        ${advertenciasOrdenadas.length ? `
        <ul class="space-y-1">
          ${advertenciasOrdenadas.map((a) => `
            <li class="flex items-center justify-between gap-2 font-body text-label-sm bg-surface-container rounded-lg px-3 py-1.5">
              <span>${escaparHTML(ROTULOS_ADVERTENCIA[a.tipo] || a.tipo)} — ${formatarData(a.data)}${a.motivo ? ` (${escaparHTML(a.motivo)})` : ""}</span>
              ${botaoExcluir("advertencia", a.id, tiposExcluiveis)}
            </li>`).join("")}
        </ul>` : `<p class="font-body text-label-sm text-on-surface-variant">Nenhuma advertência registrada.</p>`}
      </div>

      <div>
        <p class="font-body font-semibold text-on-surface mb-1">Avaliação de desempenho (${anoExercicio})</p>
        ${avaliacaoDoAno ? `
        <div class="flex items-center justify-between gap-2 font-body text-label-sm bg-surface-container rounded-lg px-3 py-1.5">
          <span>${ROTULOS_CONCEITO[avaliacaoDoAno.conceito] || avaliacaoDoAno.conceito}${avaliacaoDoAno.data ? " em " + formatarData(avaliacaoDoAno.data) : ""}</span>
          ${botaoExcluir("avaliacao", avaliacaoDoAno.id, tiposExcluiveis)}
        </div>` : `<p class="font-body text-label-sm text-on-surface-variant">Ainda não avaliado(a) este ano.</p>`}
      </div>

      <div class="border-t border-outline-variant/30 pt-4">
        <p class="font-body font-semibold text-on-surface mb-2">Cota estimada</p>
        <div class="space-y-1 font-body text-label-sm">
          <div class="flex justify-between"><span class="text-on-surface-variant">Cota base (proporcional)</span><span>${formatarMoeda(resultado.cotaBase)}</span></div>
          ${resultado.percentualRedutoresAplicados ? `<div class="flex justify-between text-christmas-red"><span>Redutores (atraso/disciplina/avaliação)</span><span>-${(resultado.percentualRedutoresAplicados * 100).toFixed(0)}%</span></div>` : ""}
          ${resultado.descontoFaltas ? `<div class="flex justify-between text-christmas-red"><span>Desconto por faltas</span><span>-${formatarMoeda(resultado.descontoFaltas)}</span></div>` : ""}
          ${resultado.percentualAdicionais ? `<div class="flex justify-between text-secondary"><span>Bônus/avaliação positiva</span><span>+${(resultado.percentualAdicionais * 100).toFixed(0)}%</span></div>` : ""}
          <div class="flex justify-between font-bold text-on-surface pt-1 border-t border-outline-variant/20"><span>Cota final estimada</span><span>${resultado.elegivel ? formatarMoeda(resultado.cotaFinal) : "Inelegível"}</span></div>
        </div>
        ${!resultado.elegivel ? `<p class="font-body text-label-sm text-christmas-red mt-2">${resultado.motivoInelegibilidade}</p>` : ""}
      </div>
    </div>`;

  if (aoExcluir) {
    container.querySelectorAll("[data-excluir-registro]").forEach((btn) => {
      btn.addEventListener("click", () => aoExcluir(btn.dataset.tipo, btn.dataset.id));
    });
  }
}

export { renderizarPerfilDetalhado };
