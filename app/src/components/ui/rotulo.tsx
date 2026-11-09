import * as React from "react";
import { cn } from "@/lib/utils";

interface RotuloProps {
  /** Número da seção ("01"…). Decorativo: leitores de tela não leem. */
  numero?: string;
  /** true sobre fundo escuro (vídeo do topo). */
  sobreEscuro?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Rótulo técnico das seções: número em mono, um fio nas três cores do Natal (vermelho, dourado
 * e pinheiro) e texto em maiúsculas espaçadas. É o principal "detalhe de Natal" da página.
 */
export function Rotulo({ numero, sobreEscuro = false, className, children }: RotuloProps) {
  return (
    <p
      className={cn(
        "flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.2em] sm:text-xs",
        sobreEscuro ? "text-[#E8D9AE]" : "text-[#5E615C]",
        className
      )}
    >
      {numero && (
        <span aria-hidden="true" className={sobreEscuro ? undefined : "text-[#1E5B43]"}>
          {numero}
        </span>
      )}
      <span aria-hidden="true" className="fio-natal h-px w-9 shrink-0" />
      {children && <span>{children}</span>}
    </p>
  );
}
