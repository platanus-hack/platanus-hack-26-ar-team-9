import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ConsensusBlock } from "@/components/ConsensusBlock";
import { IsolatedDataBlock } from "@/components/IsolatedDataBlock";
import { DiscrepanciesBlock } from "@/components/DiscrepanciesBlock";
import { ArticlesBlock } from "@/components/ArticlesBlock";
import { loadEvents, loadEventDetail } from "@/lib/mockData";
import { getEventDetail } from "@/lib/api";
import { colorForBand, labelForBand } from "@/lib/colors";

interface PageProps {
  params: Promise<{ id: string }>;
}

// Permitir IDs/slugs no pre-conocidos (modo `local` y `supabase` los traen
// del backend en runtime, no de los mocks).
export const dynamicParams = true;

export async function generateStaticParams() {
  // En non-mock, los IDs no se conocen en build time → SSR/dynamic.
  if ((process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock").toLowerCase() !== "mock") {
    return [];
  }
  const data = await loadEvents();
  return data.events.map((e) => ({ id: e.id }));
}

export default async function EventPage({ params }: PageProps) {
  const { id } = await params;
  const data = await loadEvents();
  // El frontend hace push a /event/<id>; aceptamos también /event/<slug> por las dudas.
  const event = data.events.find((e) => e.id === id || e.slug === id);
  if (!event) notFound();

  const detail = await getEventDetail(id);
  const color = colorForBand(event.divergence_band);

  return (
    <main className="min-h-screen px-4 md:px-8 py-8 md:py-12">
      <div className="mx-auto max-w-[1320px] flex flex-col gap-7 md:gap-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[--color-text-muted] hover:text-[--color-text-primary] transition-colors w-fit"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al mapa
        </Link>

        <header className="flex flex-col gap-4">
          <h1
            className="text-4xl md:text-6xl leading-[1.05] font-medium"
            style={{ fontFamily: "var(--font-fraunces)" }}
          >
            {event.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-[--color-text-secondary]">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: color,
                  boxShadow: `0 0 8px ${color}`,
                }}
              />
              Discrepancia:{" "}
              <strong style={{ color }} className="font-semibold">
                {labelForBand(event.divergence_band)}
              </strong>
            </span>
            <span className="text-[--color-text-muted]">·</span>
            <span>{event.media_count} medios cubrieron este hecho</span>
            {event.trending_topics.length > 0 && (
              <>
                <span className="text-[--color-text-muted]">·</span>
                <span className="flex gap-1.5">
                  {event.trending_topics.map((t) => (
                    <span
                      key={t}
                      className="px-2.5 py-1 rounded-full bg-[--color-bg-card] border border-[--color-border-card] text-xs"
                    >
                      #{t}
                    </span>
                  ))}
                </span>
              </>
            )}
          </div>
          {event.summary && (
            <p className="text-xl md:text-2xl text-[--color-text-secondary] leading-relaxed mt-2 italic">
              {event.summary}
            </p>
          )}
        </header>

        <ConsensusBlock facts={detail.verdad_consensuada} />
        <DiscrepanciesBlock items={detail.contradicciones} articles={detail.articles} />
        <IsolatedDataBlock items={detail.datos_aislados} articles={detail.articles} />
        <ArticlesBlock articles={detail.articles || []} />
        <footer className="text-center text-xs text-[--color-text-muted] tracking-wide pt-2 pb-4">
          Cobertura por: {event.media_sources.join(" · ")}
        </footer>
      </div>
    </main>
  );
}
