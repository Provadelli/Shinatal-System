import { motion } from "framer-motion";
import { Award, CalendarCheck, CircleCheck, Gift, HeartHandshake, TrendingUp, Users } from "lucide-react";
import { CardInfo } from "@/components/ui/card-info";
import { Rotulo } from "@/components/ui/rotulo";
import { aoEntrarNaTela, cascata, surgir } from "@/lib/movimento";
import { TITULO_SECAO } from "@/lib/tipografia";
import { cn } from "@/lib/utils";

const ETAPAS = [
  { icone: Gift, texto: "Fundo formado a cada novo contrato fechado pela Shine Rio." },
  { icone: Users, texto: "Participam todos os funcionários orgânicos alocados no escritório administrativo da empresa." },
  { icone: CircleCheck, texto: "Assiduidade e bom desempenho contam pontos a seu favor." },
  { icone: CalendarCheck, texto: "Pagamento em parcela única, preferencialmente em dezembro." }
];

const VALORES = [
  { icone: Award, titulo: "Compromisso e reconhecimento", texto: "Nosso trabalho gera resultados. E os resultados são compartilhados." },
  { icone: HeartHandshake, titulo: "Qualidade que gera resultados", texto: "Cada colaborador faz a diferença na qualidade, na produtividade e na competitividade da Shine Rio." },
  { icone: TrendingUp, titulo: "Crescimento conjunto", texto: "Cada novo contrato e cada contrato mantido fortalecem a participação de todos." },
  { icone: Gift, titulo: "Participação de todos", texto: "A caixinha é construída ao longo do ano e compartilhada proporcionalmente com quem fez parte dessa jornada." }
];

const numero = (i: number) => String(i + 1).padStart(2, "0");

/** Cabeçalho de seção: rótulo numerado e título, entrando em cascata. */
function CabecalhoSecao({ numero: n, titulo }: { numero: string; titulo: string }) {
  return (
    <motion.div {...aoEntrarNaTela} variants={cascata(0.1)} className="mb-10 md:mb-12">
      <motion.div variants={surgir}>
        <Rotulo numero={n} className="mb-5" />
      </motion.div>
      <motion.h2 variants={surgir} className={cn(TITULO_SECAO, "text-on-surface")}>
        {titulo}
      </motion.h2>
    </motion.div>
  );
}

// "Como funciona" (malha de pontos) e "Nossos valores", ambos na base neve, em cards.
// Tudo fica visível e entra um item depois do outro ao rolar.
export function ComoFunciona() {
  return (
    <>
      <section id="como-funciona" className="secao-neve py-16 md:py-24 scroll-mt-24">
        <span aria-hidden="true" className="grade-pontos" />
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop relative">
          <CabecalhoSecao numero="03" titulo="Como funciona o programa" />
          <motion.div {...aoEntrarNaTela} variants={cascata(0.08)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
            {ETAPAS.map((etapa, i) => (
              <CardInfo key={etapa.texto} numero={numero(i)} icone={etapa.icone}>
                {etapa.texto}
              </CardInfo>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Valores em cards, na mesma base neve. */}
      <section id="nossos-valores" className="secao-neve py-16 md:py-24 scroll-mt-24">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <CabecalhoSecao numero="04" titulo="Nossos valores" />
          <motion.div {...aoEntrarNaTela} variants={cascata(0.08)} className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
            {VALORES.map((valor, i) => (
              <CardInfo key={valor.titulo} numero={numero(i)} icone={valor.icone} titulo={valor.titulo}>
                {valor.texto}
              </CardInfo>
            ))}
          </motion.div>
        </div>
      </section>
    </>
  );
}
