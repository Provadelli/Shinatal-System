import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { Cabecalho } from "@/components/secoes/Cabecalho";
import { Hero } from "@/components/secoes/Hero";
import { QuemSomos } from "@/components/secoes/QuemSomos";
import { SobreShinatal } from "@/components/secoes/SobreShinatal";
import { ComoFunciona } from "@/components/secoes/ComoFunciona";

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
    <MotionConfig reducedMotion="user">
      <Cabecalho />
      <main id="conteudo" className="relative z-10" tabIndex={-1}>
        <span id="sentinela-header-scroll" aria-hidden="true" className="block h-px w-full" />
        <Hero />
        <QuemSomos />
        <SobreShinatal />
        <ComoFunciona />
      </main>
    </MotionConfig>
  );
}
