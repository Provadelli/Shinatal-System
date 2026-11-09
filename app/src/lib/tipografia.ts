// Escala tipográfica da página inicial — um lugar só, para as seções ficarem consistentes.
// Space Grotesk nos títulos (apertado, peso 600), Inter no texto (linha confortável, até ~65
// caracteres por linha) e JetBrains Mono nos rótulos (ver components/ui/rotulo.tsx).

/** Título principal do topo. */
export const TITULO_HERO =
  "font-display font-semibold text-[2.6rem] leading-[1.02] tracking-[-0.035em] sm:text-[3.25rem] lg:text-[4rem]";

/** Título de seção (h2). */
export const TITULO_SECAO =
  "font-display font-semibold text-[2rem] leading-[1.1] tracking-[-0.03em] md:text-[2.75rem] md:leading-[1.05]";

/** Parágrafo de abertura de uma seção: um degrau acima do texto corrido. */
export const TEXTO_ABERTURA = "font-body text-[1.1875rem] leading-[1.6] md:text-[1.3125rem] md:leading-[1.55]";

/** Texto corrido. */
export const TEXTO_CORRIDO = "font-body text-[1.0625rem] leading-[1.75] md:text-lg md:leading-[1.75]";
