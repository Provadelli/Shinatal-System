// Shinatal — dados da LGPD usados pelo site (cadastro, aceite no login, Perfil → "Meus dados").
//
// VERSAO_TERMOS: data da versão vigente dos Termos de Uso e da Política de Privacidade. Ao mudar
// qualquer um dos dois de forma relevante, atualize as páginas (termos.html, privacidade.html) e
// troque esta versão — todo mundo verá o pedido de aceite de novo no próximo login.
// Ver docs/LGPD.md.
export const VERSAO_TERMOS = "2026-10-27";

/** Controladora dos dados (art. 5º, VI). */
export const CONTROLADORA = "Shine Rio Serviços Ltda.";

/** Encarregado pelo tratamento de dados pessoais (art. 41) — canal dos titulares e da ANPD. */
export const ENCARREGADO = { nome: "Presidente da Shine Rio", email: "shinerio@shinerio.com" };

/** Link de e-mail para o Encarregado com o assunto já preenchido. */
export function linkEncarregado(assunto) {
  return `mailto:${ENCARREGADO.email}?subject=${encodeURIComponent(`[LGPD · Shinatal] ${assunto}`)}`;
}
