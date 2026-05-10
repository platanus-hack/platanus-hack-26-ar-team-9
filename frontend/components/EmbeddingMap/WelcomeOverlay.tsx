interface WelcomeOverlayProps {
  opacity: number;
}

export function WelcomeOverlay({ opacity }: WelcomeOverlayProps) {
  if (opacity < 0.02) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6"
      style={{ opacity }}
    >
      <div className="absolute inset-0 -z-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] max-w-[820px] max-h-[820px] rounded-full bg-[--color-accent-green]/10 blur-3xl animate-pulse" />
      </div>
      <h2
        className="relative text-6xl md:text-8xl lg:text-[9rem] font-medium tracking-tight text-[--color-text-primary] leading-[0.95]"
        style={{ fontFamily: "var(--font-fraunces)" }}
      >
        ALETH·IA
      </h2>
      <p
        className="relative mt-5 md:mt-7 text-2xl md:text-4xl italic text-[--color-text-secondary] tracking-tight"
        style={{ fontFamily: "var(--font-fraunces)" }}
      >
        Encontrá las verdades
      </p>
      <div className="relative mt-12 md:mt-16 flex flex-col items-center gap-3 text-[--color-text-primary]">
        <div className="relative">
          {/* Sonar ring — radiates outward continuously */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-white/40 animate-explore-radar"
          />
          {/* Pill — gentle scale breath */}
          <div className="relative px-10 py-4 md:px-14 md:py-5 rounded-full border-2 border-white/35 bg-white/[0.07] backdrop-blur-sm shadow-[0_22px_50px_-12px_rgba(0,0,0,0.7)] animate-explore-pulse">
            <span className="text-xl md:text-3xl font-medium tracking-[0.04em]">
              Explorá
            </span>
          </div>
        </div>
        <span className="text-[11px] md:text-xs tracking-[0.3em] uppercase text-[--color-text-muted] mt-3">
          Tocá cualquier parte del mapa
        </span>
      </div>
    </div>
  );
}
