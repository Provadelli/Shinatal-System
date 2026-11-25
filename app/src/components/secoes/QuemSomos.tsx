// m (não motion): com LazyMotion no App, o motor de animação carrega à parte, fora do pacote inicial.
import { m as motion } from "framer-motion";
import { Rotulo } from "@/components/ui/rotulo";
import { aoEntrarNaTela, cascata, surgir } from "@/lib/movimento";
import { TITULO_SECAO, FRASE_DESTAQUE, TEXTO_CORRIDO } from "@/lib/tipografia";
import { cn } from "@/lib/utils";

export function QuemSomos() {
  return (
    <section id="sobre-nos" className="secao-neve py-16 md:py-24 scroll-mt-24">
      <span aria-hidden="true" className="grade-tecnica grade-tecnica--clara" />

      <motion.div
        {...aoEntrarNaTela}
        variants={cascata(0.12)}
        className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid md:grid-cols-2 gap-12 md:gap-16 items-center"
      >
        <motion.figure variants={surgir} className="quem-somos-foto group order-2 md:order-1">
          <div className="relative">
            {/* Moldura dourada deslocada (decorativa): se afasta da foto ao entrar e no hover. */}
            <span aria-hidden="true" className="quem-somos-moldura absolute inset-0 rounded-2xl border border-festive-gold/60" />
            <div className="relative rounded-2xl overflow-hidden foto-quem-somos shadow-[0_30px_60px_-34px_rgba(35,32,27,0.45)]">
              <img
                src="/assets/foto1-800.webp"
                srcSet="/assets/foto1-400.webp 400w, /assets/foto1-800.webp 800w, /assets/foto1-1200.webp 960w"
                sizes="(min-width: 768px) 50vw, 100vw"
                width={960}
                height={1280}
                alt="Celebração do Shinatal"
                className="w-full h-auto object-cover aspect-[4/3] transition-transform duration-[1400ms] ease-brand group-hover:scale-[1.035]"
                loading="lazy"
              />
            </div>
          </div>
          <figcaption className="font-serif italic text-base text-[#5E615C] mt-7 text-center">
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
          <motion.p variants={surgir} className={cn(FRASE_DESTAQUE, "mb-7 text-on-surface")}>
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
