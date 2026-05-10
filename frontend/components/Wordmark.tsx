import { cn } from "@/lib/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("text-center select-none", className)}>
      <h1
        className="font-serif text-5xl md:text-7xl font-medium tracking-[0.18em] text-[--color-text-primary]"
        style={{ fontFamily: "var(--font-fraunces)" }}
      >
        ALETH
        <span className="text-[--color-accent-red] mx-1">·</span>
        IA
      </h1>
      <p
        className="mt-3 text-sm md:text-base italic text-[--color-text-secondary] tracking-wide"
        style={{ fontFamily: "var(--font-fraunces)" }}
      >
        Las noticias del día, mapeadas por su veracidad
      </p>
    </div>
  );
}
