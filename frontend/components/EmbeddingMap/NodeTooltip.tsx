import type { CentroidEvent, GigaCentroid } from "@/lib/types";
import { colorForBand, labelForBand } from "@/lib/colors";

interface CentroidTooltipData {
  kind: "centroid";
  centroid: GigaCentroid;
  x: number;
  y: number;
}

interface EventTooltipData {
  kind: "event";
  event: CentroidEvent;
  centroid: GigaCentroid;
  x: number;
  y: number;
}

export type TooltipData = CentroidTooltipData | EventTooltipData;

interface NodeTooltipProps {
  data: TooltipData;
}

export function NodeTooltip({ data }: NodeTooltipProps) {
  const left = data.x + 14;
  const top = data.y + 14;
  
  if (data.kind === "centroid") {
    const c = data.centroid;
    const color = colorForBand(c.color_band);
    return (
      <div
        role="tooltip"
        className="absolute z-20 pointer-events-none w-72 rounded-lg border border-[--color-border-card] p-3 shadow-2xl text-xs text-[--color-text-secondary] fade-in"
        style={{ left, top, backgroundColor: "#11141d" }}
      >
        <div className="flex items-start gap-2 mb-2">
          <span
            className="mt-1 w-2 h-2 rounded-full shrink-0"
            style={{ background: color, boxShadow: `0 0 6px ${color}` }}
          />
          <p
            className="text-[--color-text-primary] text-base leading-tight font-medium"
            style={{ fontFamily: "var(--font-fraunces)" }}
          >
            {c.label}
          </p>
        </div>
        <div className="pl-4 grid grid-cols-2 gap-2 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Historias</div>
            <div className="text-[--color-text-primary] font-semibold">{c.volume}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Discrepancia</div>
            <div className="font-semibold" style={{ color }}>{labelForBand(c.color_band)}</div>
          </div>
        </div>
        {c.summary && (
          <p className="pl-4 leading-relaxed text-[--color-text-secondary]">{c.summary}</p>
        )}
      </div>
    );
  }

  const e = data.event;
  const color = colorForBand(e.divergence_band);
  return (
    <div
      role="tooltip"
      className="absolute z-20 pointer-events-none w-80 rounded-lg border border-[--color-border-card] p-3 shadow-2xl text-xs text-[--color-text-secondary] fade-in"
      style={{ left, top, backgroundColor: "#11141d" }}
    >
      <div className="flex items-start gap-2 mb-2">
        <span
          className="mt-1 w-2 h-2 rounded-full shrink-0"
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
        />
        <p className="text-[--color-text-primary] text-sm leading-snug font-medium">{e.title}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2 pl-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Medios</div>
          <div className="text-[--color-text-primary] font-semibold">{e.media_count}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Discrepancia</div>
          <div className="font-semibold" style={{ color }}>{labelForBand(e.divergence_band)}</div>
        </div>
      </div>
      <div className="pl-4">
        <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted] mb-1">Tópico</div>
        <div className="leading-relaxed">{data.centroid.label}</div>
      </div>
      <div className="mt-2 pt-2 border-t border-[--color-border-card] text-[10px] text-[--color-text-muted]">
        Click para ver el desglose
      </div>
    </div>
  );
}
