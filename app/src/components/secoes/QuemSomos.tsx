// m (não motion): com LazyMotion no App, o motor de animação carrega à parte, fora do pacote inicial.
import { m as motion } from "framer-motion";
import { Rotulo } from "@/components/ui/rotulo";
import { aoEntrarNaTela, cascata, surgir } from "@/lib/movimento";
import { TITULO_SECAO, TEXTO_ABERTURA, TEXTO_CORRIDO } from "@/lib/tipografia";
import { cn } from "@/lib/utils";

const FAIXA = ["Reconhecimento", "Gratidão", "Shine Rio", "Celebração 2026"];

function GrupoFaixa({ oculto = false }: { oculto?: boolean }) {
  return (
    <ul className="barra-shinatal-grupo" aria-hidden={oculto || undefined}>
      {FAIXA.flatMap((item) => [
        <li key={`m-${item}`} className="barra-shinatal-marca">Shinatal</li>,
        <li key={item} className="barra-shinatal-item">{item}</li>
      ])}
    </ul>
  );
}

export function QuemSomos() {
  return (
    <section id="sobre-nos" className="secao-neve py-16 md:py-24 scroll-mt-24">
      <span id="sentinela-faixa-shinatal" aria-hidden="true" className="block h-px w-full" />
      <div className="barra-shinatal-secao" aria-hidden="true">
        <div className="barra-shinatal-pista">
          <GrupoFaixa />
          <GrupoFaixa oculto />
        </div>
      </div>
      <span aria-hidden="true" className="grade-tecnica grade-tecnica--clara" />

      <motion.div
        {...aoEntrarNaTela}
        variants={cascata(0.12)}
        className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid md:grid-cols-2 gap-12 md:gap-16 items-center"
      >
        <motion.figure variants={surgir} className="order-2 md:order-1">
          <div className="relative">
            {/* Moldura dourada deslocada (decorativa) */}
            <span aria-hidden="true" className="absolute inset-0 translate-x-3 translate-y-3 rounded-lg border border-festive-gold/60" />
            <div className="relative rounded-lg overflow-hidden foto-quem-somos shadow-[0_18px_40px_-18px_rgba(35,32,27,0.35)]">
              <img
                src="/assets/foto1-800.webp"
                srcSet="/assets/foto1-400.webp 400w, /assets/foto1-800.webp 800w, /assets/foto1-1200.webp 960w"
                sizes="(min-width: 768px) 50vw, 100vw"
                width={960}
                height={1280}
                alt="Celebração do Shinatal"
                className="w-full h-auto object-cover aspect-[4/3]"
                loading="lazy"
              />
            </div>
          </div>
          <figcaption className="font-body text-label-sm text-outline mt-6 text-center">
            O espírito de celebração e gratidão que move o Shinatal.
          </figcaption>
        </motion.figure>

        <div className="order-1 md:order-2 max-w-[38rem]">
          <motion.div variants={surgir}>
            <Rotulo numero="01" className="mb-5">Nossa história</Rotulo>
          </motion.div>
          <motion.h2 variants={surgir} className={cn(TITULO_SECAO, "mb-7 text-on-surface")}>
            Quem somos
          </motion.h2>
          <motion.p variants={surgir} className={cn(TEXTO_ABERTURA, "mb-6 text-on-surface")}>
            A Shine Rio nasceu do compromisso de tratar cada colaborador como parte essencial de uma mesma equipe.
            Ao longo do nosso caminho, aprendemos que reconhecimento e cuidado constroem histórias, e é esse espírito
            que carregamos em cada contrato, em cada dia de trabalho e em cada conquista.
          </motion.p>
          <motion.div variants={surgir} className="space-y-4 border-l border-festive-gold/40 pl-5">
            <p className={cn(TEXTO_CORRIDO, "text-on-surface-variant")}>
              Acreditamos que dedicação merece ser celebrada. O Shinatal nasceu dessa crença: transformar o esforço diário
              de quem faz a Shine Rio acontecer em um gesto concreto de gratidão, no espírito de amor, generosidade e
              esperança que o Natal, nascimento de Jesus, representa.
            </p>
            <p className={cn(TEXTO_CORRIDO, "text-on-surface-variant")}>
              Mais do que um programa de premiação, o Shinatal é a nossa forma de dizer obrigado, com a energia do Rio
              de Janeiro e o brilho de uma época que celebra o que realmente importa: as pessoas.
            </p>
            <p className={cn(TEXTO_CORRIDO, "text-on-surface-variant")}>
              E esse espírito também se estende à sociedade, levando alegria, solidariedade e esperança a quem mais precisa.
            </p>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
