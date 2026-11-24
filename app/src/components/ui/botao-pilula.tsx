import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Botão pílula: visível já em repouso. Mesmo desenho das páginas estáticas (.btn-pilula).
// "solido" é a ação principal (vermelho-Natal); "vidro" é a de apoio (material translúcido).
// O desenho fica em frontend/css/styles.css (.btn-pilula).
const botaoPilulaVariantes = cva("btn-pilula", {
  variants: {
    estilo: {
      solido: "btn-pilula--solido",
      vidro: "btn-pilula--vidro"
    },
    tamanho: {
      normal: "",
      compacto: "btn-pilula--compacto"
    }
  },
  defaultVariants: { estilo: "solido", tamanho: "normal" }
});

export interface BotaoPilulaProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof botaoPilulaVariantes> {
  /** Ícone antes do texto. */
  icone?: LucideIcon;
  /** Seta ↗ depois do texto (ações principais). */
  seta?: boolean;
}

export const BotaoPilula = React.forwardRef<HTMLAnchorElement, BotaoPilulaProps>(
  ({ className, estilo, tamanho, icone: Icone, seta = false, children, ...props }, ref) => (
    <a ref={ref} className={cn(botaoPilulaVariantes({ estilo, tamanho }), className)} {...props}>
      {Icone && <Icone className="btn-pilula-icone" aria-hidden="true" strokeWidth={1.75} />}
      <span>{children}</span>
      {seta && <ArrowUpRight className="btn-pilula-seta" aria-hidden="true" strokeWidth={2} />}
    </a>
  )
);
BotaoPilula.displayName = "BotaoPilula";
