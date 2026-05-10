import { Plus, Minus, Locate } from "lucide-react";

const ZOOM_MIN = 0.45;
const ZOOM_MAX = 6;

interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  canReset: boolean;
  scale: number;
}

interface ZoomButtonProps {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}

function ZoomButton({
  onClick,
  label,
  disabled,
  children,
}: ZoomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-9 h-9 flex items-center justify-center rounded-lg text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onReset,
  canReset,
  scale,
}: ZoomControlsProps) {
  return (
    <div
      className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 p-1.5 rounded-xl bg-[--color-bg-card]/85 backdrop-blur border border-[--color-border-card] shadow-lg"
      role="group"
      aria-label="Controles de zoom del mapa"
    >
      <ZoomButton onClick={onZoomIn} label="Acercar" disabled={scale >= ZOOM_MAX - 0.01}>
        <Plus className="h-5 w-5" />
      </ZoomButton>
      <ZoomButton onClick={onZoomOut} label="Alejar" disabled={scale <= ZOOM_MIN + 0.01}>
        <Minus className="h-5 w-5" />
      </ZoomButton>
      <ZoomButton onClick={onReset} label="Volver al inicio" disabled={!canReset}>
        <Locate className="h-4 w-4" />
      </ZoomButton>
      <div
        aria-live="polite"
        className="text-center text-[10px] font-mono text-[--color-text-muted] pt-1 border-t border-[--color-border-card]"
      >
        {scale.toFixed(1)}×
      </div>
    </div>
  );
}
