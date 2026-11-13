import { lazy, Suspense, useEffect } from "react";
import { LazyMotion, MotionConfig } from "framer-motion";
import { Cabecalho } from "@/components/secoes/Cabecalho";
import { Hero } from "@/components/secoes/Hero";

// Seções abaixo da primeira tela: arquivos à parte, baixados depois do Hero (menos JS no início).
const QuemSomos = lazy(() => import("@/components/secoes/QuemSomos").then((m) => ({ default: m.QuemSomos })));
const SobreShinatal = lazy(() => import("@/components/secoes/SobreShinatal").then((m) => ({ default: m.SobreShinatal })));
const ComoFunciona = lazy(() => import("@/components/secoes/ComoFunciona").then((m) => ({ default: m.ComoFunciona })));
// Motor de animação do framer-motion, carregado à parte (ver lib/recursos-movimento.ts).
const recursosDeMovimento = () => import("@/lib/recursos-movimento").then((r) => r.default);

/** Liga os comportamentos de página que já existem em frontend/js (mesmos das outras páginas). */
function useComportamentosDaPagina() {
  useEffect(() => {
    // Importados só depois que a página montou: acessibilidade.js procura o menu, o botão de
    // pausar e o <main> assim que carrega.
    import("@legado/ui-utils.js").then(({ pausarAnimacaoForaDaTela, sincronizarAlturaHeader }) => {
      pausarAnimacaoForaDaTela(".barra-shinatal-pista, .faixa-fotos-pista");
      sincronizarAlturaHeader();
    });

    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".header-flutuante").forEach((el) => el.classList.remove("header-transparente"));
      return;
    }
    const observadores: IntersectionObserver[] = [];

    // Cabeçalho transparente sobre o vídeo; bege com fio dourado assim que a pessoa rola.
    const sentinelaHeader = document.getElementById("sentinela-header-scroll");
    if (sentinelaHeader) {
      const obs = new IntersectionObserver(([entrada]) => {
        document.querySelectorAll(".header-flutuante").forEach((el) =>
          el.classList.toggle("header-transparente", entrada.isIntersecting)
        );
      }, { threshold: 0 });
      obs.observe(sentinelaHeader);
      observadores.push(obs);
    }

    // Faixa "Shinatal" no topo de #sobre-nos: some quando a seção termina de cobrir o hero.
    const sentinelaFaixa = document.getElementById("sentinela-faixa-shinatal");
    const faixa = document.querySelector(".barra-shinatal-secao");
    if (sentinelaFaixa && faixa) {
      const obs = new IntersectionObserver(([entrada]) => {
        faixa.classList.toggle("faixa-oculta", !entrada.isIntersecting);
      }, { rootMargin: "0px 0px -100% 0px", threshold: 0 });
      obs.observe(sentinelaFaixa);
      observadores.push(obs);
    }
    return () => observadores.forEach((o) => o.disconnect());
  }, []);

  useEffect(() => {
    import("@legado/acessibilidade.js");
  }, []);
}

export function App() {
  useComportamentosDaPagina();
  return (
    <LazyMotion features={recursosDeMovimento} strict>
      <MotionConfig reducedMotion="user">
        <Cabecalho />
        <main id="conteudo" className="relative z-10" tabIndex={-1}>
          <span id="sentinela-header-scroll" aria-hidden="true" className="block h-px w-full" />
          <Hero />
          <Suspense fallback={null}>
            <QuemSomos />
            <SobreShinatal />
            <ComoFunciona />
          </Suspense>
        </main>
      </MotionConfig>
    </LazyMotion>
  );
}
