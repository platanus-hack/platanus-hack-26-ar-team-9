import { COLORS } from "@/lib/colors";

const Dot = () => (
  <span
    className="inline-block w-2 h-2 rounded-full shrink-0"
    style={{ background: COLORS.green, boxShadow: `0 0 6px ${COLORS.green}88` }}
  />
);

export function ConsensusBlock({ facts }: { facts: string[] }) {
  return (
    <section className="rounded-2xl border border-[--color-border-card] bg-[--color-bg-card] p-6 md:p-8">
      <header className="flex items-center gap-2.5 mb-6">
        <Dot />
        <h2 className="text-xs md:text-sm font-bold tracking-[0.2em] uppercase text-[--color-text-primary]">
          Verdad consensuada
        </h2>
      </header>
      {facts.length === 0 ? (
        <p className="text-base text-[--color-text-muted] italic">
          Sin hechos confirmados aún.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {facts.map((fact, i) => (
            <li
              key={i}
              className="text-lg md:text-xl leading-relaxed text-[--color-text-secondary] pl-5 border-l-2"
              style={{ borderColor: `${COLORS.green}66` }}
            >
              {fact}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
