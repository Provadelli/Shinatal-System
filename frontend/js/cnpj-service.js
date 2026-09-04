// Shinatal — consulta pública de CNPJ na Receita Federal, via BrasilAPI (espelho gratuito,
// sem chave e com CORS liberado para uso direto do navegador, dos dados públicos da Receita
// Federal/Simples Nacional). Módulo com I/O de rede — mantido fora de calculo-shinatal.js, que
// é puro por design (sem I/O, ver seu próprio cabeçalho).

const BASE_URL = "https://brasilapi.com.br/api/cnpj/v1/";
const TIMEOUT_MS = 8000;

/**
 * Consulta um CNPJ (14 caracteres sem máscara — numérico ou o novo formato alfanumérico da
 * Receita Federal) na Receita Federal. Nunca lança — qualquer falha de rede/API/timeout vira
 * `{ok:false, motivo}` para o chamador decidir o fallback, sem travar o cadastro por causa de
 * uma API externa fora do ar ou sem resposta.
 * @param {string} cnpjNormalizado
 * @returns {Promise<
 *   {ok:true, encontrado:true, ativo:boolean, razaoSocial:string, nomeFantasia:string, situacao:string} |
 *   {ok:true, encontrado:false} |
 *   {ok:false, motivo:'timeout'|'rede'|'servidor'}
 * >}
 */
async function buscarCNPJReceitaFederal(cnpjNormalizado) {
  const controle = new AbortController();
  const timeoutId = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(BASE_URL + cnpjNormalizado, { signal: controle.signal });
    if (resp.status === 404) return { ok: true, encontrado: false };
    if (!resp.ok) return { ok: false, motivo: "servidor" };
    const dados = await resp.json();
    const situacao = String(dados.descricao_situacao_cadastral || "").toUpperCase();
    return {
      ok: true,
      encontrado: true,
      ativo: situacao === "ATIVA",
      razaoSocial: dados.razao_social || "",
      nomeFantasia: dados.nome_fantasia || "",
      situacao: dados.descricao_situacao_cadastral || "Desconhecida"
    };
  } catch (erro) {
    return { ok: false, motivo: erro.name === "AbortError" ? "timeout" : "rede" };
  } finally {
    clearTimeout(timeoutId);
  }
}

export { buscarCNPJReceitaFederal };
