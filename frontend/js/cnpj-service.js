// Shinatal — consulta pública de CNPJ na Receita Federal, via BrasilAPI (espelho gratuito,
// sem chave e com CORS liberado para uso direto do navegador, dos dados públicos da Receita
// Federal/Simples Nacional). Módulo com I/O de rede — mantido fora de calculo-shinatal.js, que
// é puro por design (sem I/O, ver seu próprio cabeçalho).

const BASE_URL = "https://brasilapi.com.br/api/cnpj/v1/";

/**
 * Consulta um CNPJ (14 dígitos, sem máscara) na Receita Federal. Nunca lança — qualquer falha
 * de rede/API vira `{ok:false}` para o chamador decidir o fallback, sem travar o cadastro por
 * causa de uma API externa fora do ar.
 * @param {string} cnpjNormalizado
 * @returns {Promise<
 *   {ok:true, encontrado:true, ativo:boolean, razaoSocial:string, situacao:string} |
 *   {ok:true, encontrado:false} |
 *   {ok:false}
 * >}
 */
async function buscarCNPJReceitaFederal(cnpjNormalizado) {
  try {
    const resp = await fetch(BASE_URL + cnpjNormalizado);
    if (resp.status === 404) return { ok: true, encontrado: false };
    if (!resp.ok) return { ok: false };
    const dados = await resp.json();
    const situacao = String(dados.descricao_situacao_cadastral || "").toUpperCase();
    return {
      ok: true,
      encontrado: true,
      ativo: situacao === "ATIVA",
      razaoSocial: dados.razao_social || dados.nome_fantasia || "",
      situacao: dados.descricao_situacao_cadastral || "Desconhecida"
    };
  } catch {
    return { ok: false };
  }
}

export { buscarCNPJReceitaFederal };
