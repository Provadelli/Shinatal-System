// m (não motion): com LazyMotion no App, o motor de animação carrega à parte, fora do pacote inicial.
import { m as motion } from "framer-motion";
import { Rotulo } from "@/components/ui/rotulo";
import { aoEntrarNaTela, cascata, surgir } from "@/lib/movimento";
import { TITULO_SECAO, TEXTO_ABERTURA, TEXTO_CORRIDO } from "@/lib/tipografia";
import { cn } from "@/lib/utils";

const FOTOS = [
  { src: "/assets/foto1-800.webp", srcSet: "/assets/foto1-400.webp 400w, /assets/foto1-800.webp 800w, /assets/foto1-1200.webp 960w", largura: 960, altura: 1280, alt: "Celebração do Shinatal" },
  { src: "/assets/foto2-640.webp", srcSet: "/assets/foto2-320.webp 320w, /assets/foto2-640.webp 640w, /assets/foto2-960.webp 960w", largura: 960, altura: 1280, alt: "Celebração em cada detalhe" },
  { src: "/assets/foto3-640.webp", srcSet: "/assets/foto3-320.webp 320w, /assets/foto3-640.webp 640w, /assets/foto3-960.webp 960w", largura: 960, altura: 1280, alt: "Bem-estar como reconhecimento" },
  { src: "/assets/foto4-640.webp", srcSet: "/assets/foto4-320.webp 320w, /assets/foto4-640.webp 640w, /assets/foto4-960.webp 960w", largura: 960, altura: 720, alt: "Brindes a um ano de conquistas" },
  { src: "/assets/foto5-640.webp", srcSet: "/assets/foto5-320.webp 320w, /assets/foto5-640.webp 640w, /assets/foto5-960.webp 960w", largura: 720, altura: 1280, alt: "Lembranças de gratidão" }
];

// A faixa roda em loop com duas cópias da lista (a segunda escondida dos leitores de tela).
function GrupoFotos({ copia = false }: { copia?: boolean }) {
  return (
    <div className="faixa-fotos-grupo" aria-hidden={copia || undefined}>
      {FOTOS.map((foto) => (
        <div key={foto.src} className="faixa-fotos-item">
          <img src={foto.src} srcSet={foto.srcSet} sizes="300px" width={foto.largura} height={foto.altura} alt={copia ? "" : foto.alt} loading="lazy" />
        </div>
      ))}
    </div>
  );
}

export function SobreShinatal() {
  return (
    <section id="sobre-shinatal" className="secao-verde overflow-hidden py-16 md:py-24 scroll-mt-24">
      {/* Duas colunas no computador: título à esquerda, texto à direita (uma coluna no celular). */}
      <motion.div
        {...aoEntrarNaTela}
        variants={cascata(0.12)}
        className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop relative grid gap-8 md:grid-cols-12 md:gap-12 md:items-end"
      >
        <div className="md:col-span-5">
          <motion.div variants={surgir}>
            <Rotulo numero="02" sobreEscuro className="mb-5">Sobre o Shinatal</Rotulo>
          </motion.div>
          <motion.h2 variants={surgir} className={cn(TITULO_SECAO, "text-white")}>
            O espírito da celebração
          </motion.h2>
        </div>
        <div className="md:col-span-7 max-w-[40rem]">
          <motion.p variants={surgir} className={cn(TEXTO_ABERTURA, "mb-5 text-white")}>
            O Shinatal vai além da celebração entre nós. Todos os anos, levamos o espírito do Natal para comunidades
            carentes, proporcionando às crianças um dia de alegria, diversão, presentes e esperança.
          </motion.p>
          <motion.p variants={surgir} className={cn(TEXTO_CORRIDO, "text-white/80")}>
            Mais do que comemorar nossas conquistas, acreditamos que também é nosso papel compartilhar o que
            construímos com a sociedade. Por isso, transformamos parte do nosso espírito de união e solidariedade em
            momentos especiais para quem mais precisa.
          </motion.p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 1.2 }}
        className="faixa-fotos-sobre mt-12"
      >
        <div className="faixa-fotos-pista">
          <GrupoFotos />
          <GrupoFotos copia />
        </div>
      </motion.div>
    </section>
  );
}
