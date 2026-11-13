// Curvas e variantes de movimento da página inicial.
// Só opacity e transform animam (feitos pela GPU). Com "reduzir movimento" no sistema, o
// <MotionConfig reducedMotion="user"> do App desliga os deslocamentos.
import type { Variants } from "framer-motion";

export const EASE_BRAND = [0.16, 0.84, 0.32, 1] as const;
export const EASE_SOFT = [0.22, 0.68, 0, 1] as const;

/** Container que revela os filhos um depois do outro. */
export function cascata(passo = 0.1, atraso = 0): Variants {
  return {
    oculto: {},
    visivel: { transition: { staggerChildren: passo, delayChildren: atraso } }
  };
}

/** Item que sobe e aparece. */
export const surgir: Variants = {
  oculto: { opacity: 0, y: 22 },
  visivel: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE_BRAND } }
};

/**
 * Variante do topo (anima logo ao abrir): começa em 0.01, não 0 — o Chrome ignora opacity 0 no
 * LCP. Só para o Hero: nas seções que esperam a rolagem (aoEntrarNaTela), 0.01 deixaria texto
 * quase invisível parado na página, e o axe acusa contraste.
 */
export const surgirTopo: Variants = {
  oculto: { opacity: 0.01, y: 22 },
  visivel: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE_BRAND } }
};

/** Revela uma vez, quando entra na tela. */
export const aoEntrarNaTela = {
  initial: "oculto",
  whileInView: "visivel",
  viewport: { once: true, amount: 0.2 }
} as const;
