import { COLORS } from "@/lib/colors";
import type { IsolatedFact, Article } from "@/lib/types";
import { ExternalLink } from "lucide-react";

const Dot = () => (
  <span
    className="inline-block w-2 h-2 rounded-full shrink-0"
    style={{ background: COLORS.yellow, boxShadow: `0 0 6px ${COLORS.yellow}88` }}
  />
);

export function IsolatedDataBlock({ items, articles }: { items: IsolatedFact[]; articles?: (Article & { media: { name: string } })[] }) {
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
          {items.map((item, i) => {
            // Find article URL for this source from the articles array
            const articleUrl = articles?.find(article => 
              article.media.name.toLowerCase().includes(item.fuente.toLowerCase()) ||
              item.fuente.toLowerCase().includes(article.media.name.toLowerCase())
            )?.url;
            
            return (
              <li
                key={i}
                className="bg-[--color-bg-elevated] rounded-lg p-5 leading-relaxed"
              >
                <p className="text-lg md:text-xl text-[--color-text-secondary]">
                  {item.hecho}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <span
                    className="inline-block text-[11px] font-semibold uppercase tracking-[0.15em] px-2.5 py-1 rounded"
                    style={{
                      background: `${COLORS.yellow}22`,
                      color: COLORS.yellow,
                    }}
                  >
                    {item.fuente}
                  </span>
                  {(item.url || articleUrl) && (
                    <a
                      href={item.url || articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-[--color-text-muted] hover:text-[--color-text-primary] transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Ver noticia
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
