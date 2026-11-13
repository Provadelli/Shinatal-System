import * as React from "react";
// m (não motion): com LazyMotion no App, o motor de animação carrega à parte, fora do pacote inicial.
import { m as motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { surgir } from "@/lib/movimento";

interface CardInfoProps {
  /** Número de ordem ("01"…). Decorativo. */
  numero: string;
  icone: LucideIcon;
  titulo?: string;
  children: React.ReactNode;
  className?: string;
}

// Card de "Como funciona" e "Nossos valores": superfície branca, borda fina, texto em grafite.
// Número e ícone em verde-pinheiro; no hover, efeitos dourados: a borda aquece para o dourado,
// o círculo do ícone se enche de dourado e um fio dourado se desenha na base. Entra em cascata
// com o grupo (variante `surgir`).
export function CardInfo({ numero, icone: Icone, titulo, children, className }: CardInfoProps) {
  return (
    <motion.article
      variants={surgir}
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className={cn(
        "group relative flex h-full flex-col gap-8 overflow-hidden rounded-[0.875rem] border border-[#E4E1D8] bg-white p-6 sm:p-7",
        "shadow-[0_1px_2px_rgba(20,22,20,0.04),0_6px_18px_rgba(20,22,20,0.04)]",
        "transition-[border-color,box-shadow] duration-500 ease-brand",
        "hover:border-[#C9A048] hover:shadow-[0_2px_6px_rgba(20,22,20,0.05),0_26px_48px_-22px_rgba(122,92,34,0.45)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <span aria-hidden="true" className="font-mono text-xs font-medium tracking-[0.18em] text-[#1E5B43]">
          {numero}
        </span>
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#E4E1D8] text-[#1E5B43] transition-colors duration-500 ease-brand group-hover:border-transparent group-hover:text-[#101412]">
          <span
            aria-hidden="true"
            className="absolute inset-0 scale-0 rounded-full bg-gradient-to-br from-[#FBE7B0] via-[#E9C77C] to-[#C9A048] transition-transform duration-500 ease-brand group-hover:scale-100"
          />
          <Icone
            aria-hidden="true"
            strokeWidth={1.6}
            className="relative h-5 w-5 transition-transform duration-500 ease-brand group-hover:-rotate-12"
          />
        </span>
      </div>

      <div className="mt-auto">
        {titulo && (
          <h3 className="mb-2.5 font-display text-[1.375rem] font-semibold leading-snug tracking-[-0.02em] text-[#141614]">
            {titulo}
          </h3>
        )}
        <p className={cn("font-body", titulo ? "text-[1.0625rem] leading-[1.65] text-[#5E615C]" : "text-[1.125rem] leading-[1.6] text-[#141614]")}>
          {children}
        </p>
      </div>

      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gradient-to-r from-[#C9A048] via-[#F0CF7A] to-transparent transition-transform duration-700 ease-brand group-hover:scale-x-100"
      />
    </motion.article>
  );
}
