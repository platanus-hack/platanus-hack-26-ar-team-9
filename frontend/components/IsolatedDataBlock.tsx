import { COLORS } from "@/lib/colors";
import type { IsolatedFact } from "@/lib/types";

const Dot = () => (
  <span
    className="inline-block w-2 h-2 rounded-full shrink-0"
    style={{ background: COLORS.yellow, boxShadow: `0 0 6px ${COLORS.yellow}88` }}
  />
);

export function IsolatedDataBlock({ items }: { items: IsolatedFact[] }) {
  return (
    <section className="rounded-2xl border border-[--color-border-card] bg-[--color-bg-card] p-6 md:p-8">
      <header className="flex items-center gap-2.5 mb-6">
        <Dot />
        <h2 className="text-xs md:text-sm font-bold tracking-[0.2em] uppercase text-[--color-text-primary]">
          Datos aislados
        </h2>
      </header>
      {items.length === 0 ? (
        <p className="text-base text-[--color-text-muted] italic">
          Sin datos aislados detectados.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item, i) => (
            <li
              key={i}
              className="bg-[--color-bg-elevated] rounded-lg p-5 leading-relaxed"
            >
              <p className="text-lg md:text-xl text-[--color-text-secondary]">
                {item.hecho}
              </p>
              <span
                className="inline-block mt-3 text-[11px] font-semibold uppercase tracking-[0.15em] px-2.5 py-1 rounded"
                style={{
                  background: `${COLORS.yellow}22`,
                  color: COLORS.yellow,
                }}
              >
                {item.fuente}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
