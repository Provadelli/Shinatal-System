import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Botão vazado: só contorno; no hover/foco a cor (vinho ou verde-escuro) preenche o botão inteiro.
// O desenho fica em frontend/css/styles.css (.btn-contorno), o mesmo usado no rodapé estático.
// Dois tons: "vinho" (ação principal, com seta ↗) e "verde" (secundária, verde-escuro).
const botaoContornoVariantes = cva("btn-contorno", {
  variants: {
    tom: {
      vinho: "btn-contorno--vinho",
      verde: "btn-contorno--verde"
    },
    tamanho: {
      normal: "",
      compacto: "btn-contorno--compacto"
    }
  },
  defaultVariants: { tom: "verde", tamanho: "normal" }
});

export interface BotaoContornoProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof botaoContornoVariantes> {
  /** Ícone antes do texto. */
  icone?: LucideIcon;
  /** Seta ↗ depois do texto (ações principais). */
  seta?: boolean;
}

export const BotaoContorno = React.forwardRef<HTMLAnchorElement, BotaoContornoProps>(
  ({ className, tom, tamanho, icone: Icone, seta = false, children, ...props }, ref) => (
    <a ref={ref} className={cn(botaoContornoVariantes({ tom, tamanho }), className)} {...props}>
      {Icone && <Icone className="btn-contorno-icone" aria-hidden="true" strokeWidth={1.75} />}
      <span>{children}</span>
      {seta && <ArrowUpRight className="btn-contorno-seta" aria-hidden="true" strokeWidth={2} />}
    </a>
  )
);
BotaoContorno.displayName = "BotaoContorno";
