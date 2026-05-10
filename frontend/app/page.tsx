import { MapClient } from "@/components/MapClient";
import { loadAllCentroidsWithEvents } from "@/lib/api";
import type { CentroidEvent } from "@/lib/types";

export default async function HomePage() {
  const { centroids, eventsByCentroid } = await loadAllCentroidsWithEvents();
  const groupedEvents: Record<string, CentroidEvent[]> = {};
  for (const [k, v] of eventsByCentroid.entries()) groupedEvents[k] = v;

  return (
    <main className="min-h-screen">
      <MapClient centroids={centroids} groupedEvents={groupedEvents} />
      <footer className="text-center text-xs text-[--color-text-muted] tracking-wide py-4">
        ALETH·IA · navegá la noticia como un mapa
      </footer>
    </main>
  );
}
