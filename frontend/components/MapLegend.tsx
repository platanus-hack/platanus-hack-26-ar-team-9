"use client";

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COLORS } from "@/lib/colors";

const Dot = ({ color }: { color: string }) => (
  <span
    className="inline-block w-2.5 h-2.5 rounded-full"
    style={{ background: color, boxShadow: `0 0 6px ${color}88` }}
  />
);

export function MapLegend() {
  return (
    <Popover>
      <PopoverTrigger
        className="absolute top-5 right-5 z-10 w-14 h-14 flex items-center justify-center rounded-full border border-[--color-border-card] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] hover:scale-105 active:scale-95 transition-all"
        style={{ backgroundColor: "#11141d", color: "#f8fafc" }}
        aria-label="Leyenda del mapa"
      >
        <Info className="h-6 w-6" strokeWidth={2.5} color="#f8fafc" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 ring-1 ring-white/10 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] p-5"
        style={{ backgroundColor: "#11141d", opacity: 1 }}
      >
        <h3 className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[--color-text-muted] mb-3">
          Cómo leer el mapa
        </h3>
        <dl className="space-y-3 text-sm leading-relaxed">
          <div>
            <dt className="font-medium text-[--color-text-primary]">Tamaño</dt>
            <dd className="text-[--color-text-secondary]">
              Cuántos medios cubrieron el tema.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[--color-text-primary]">Color</dt>
            <dd className="text-[--color-text-secondary]">
              Nivel de discrepancia entre las versiones que dan los medios.
            </dd>
          </div>
        </dl>
        <ul className="mt-3 space-y-1.5 text-xs text-[--color-text-secondary]">
          <li className="flex items-center gap-2">
            <Dot color={COLORS.green} /> Consenso
          </li>
          <li className="flex items-center gap-2">
            <Dot color={COLORS.yellow} /> Versiones mixtas
          </li>
          <li className="flex items-center gap-2">
            <Dot color={COLORS.red} /> Alta discrepancia
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
