import { COLORS } from "@/lib/colors";
import type { Contradiction } from "@/lib/types";

const Dot = () => (
  <span
    className="inline-block w-2 h-2 rounded-full shrink-0"
    style={{ background: COLORS.red, boxShadow: `0 0 6px ${COLORS.red}88` }}
  />
);

function VersionCard({ source, text }: { source: string; text: string }) {
  return (
    <div className="bg-[--color-bg-card] rounded-lg p-5 border border-[--color-border-card] h-full">
      <div
        className="text-sm font-bold uppercase tracking-[0.15em] mb-3"
        style={{ color: COLORS.red }}
      >
        {source}
      </div>
      <p className="text-lg md:text-xl text-[--color-text-secondary] leading-relaxed">
        {text}
      </p>
    </div>
  );
}

export function DiscrepanciesBlock({ items }: { items: Contradiction[] }) {
  return (
    <section className="rounded-2xl border border-[--color-border-card] bg-[--color-bg-card] p-6 md:p-8">
      <header className="flex items-center gap-2.5 mb-6">
        <Dot />
        <h2 className="text-xs md:text-sm font-bold tracking-[0.2em] uppercase text-[--color-text-primary]">
          Discrepancias entre medios
        </h2>
      </header>
      {items.length === 0 ? (
        <p className="text-base text-[--color-text-muted] italic">
          Los medios coinciden en este evento — sin contradicciones detectadas.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {items.map((c, i) => {
            const versions = Object.entries(c.versiones);
            const isPair = versions.length === 2;
            return (
              <article
                key={i}
                className="bg-[--color-bg-elevated] rounded-xl p-5 md:p-6 border-l-4"
                style={{ borderColor: `${COLORS.red}88` }}
              >
                <h3
                  className="text-xs md:text-sm font-bold uppercase tracking-[0.15em] mb-5"
                  style={{ color: COLORS.red }}
                >
                  Punto de choque · {c.punto_de_choque}
                </h3>
                {isPair ? (
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-5 items-stretch">
                    <VersionCard
                      source={versions[0][0]}
                      text={versions[0][1]}
                    />
                    <div
                      className="hidden md:flex items-center justify-center text-[10px] font-bold tracking-[0.25em] uppercase"
                      style={{ color: `${COLORS.red}cc` }}
                    >
                      <span className="px-3 py-1.5 rounded-full border border-[--color-border-card] bg-[--color-bg-card]">
                        VS
                      </span>
                    </div>
                    <VersionCard
                      source={versions[1][0]}
                      text={versions[1][1]}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                    {versions.map(([source, text]) => (
                      <VersionCard key={source} source={source} text={text} />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
