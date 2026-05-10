import type {
  GigaCentroid,
  GigaCentroidsResponse,
  CentroidEventsResponse,
  CentroidEvent,
  EventDetail,
} from "./types";
import { getSupabase } from "./supabase";

/**
 * Three data-sources, switched by `NEXT_PUBLIC_DATA_SOURCE`:
 *   - "mock"     → JSONs estáticos en /public/data/*.json (default).
 *   - "local"    → HTTP al pipeline Flask (default localhost:5000).
 *                  Útil para probar contra la DB local antes de Supabase.
 *   - "supabase" → RPC contra Supabase (producción).
 *
 * Para cambiar:
 *   NEXT_PUBLIC_DATA_SOURCE=local      (next dev contra Flask local)
 *   NEXT_PUBLIC_DATA_SOURCE=supabase   (Vercel)
 *   NEXT_PUBLIC_LOCAL_API_URL=http://localhost:5000   (override base URL local)
 */
type DataSource = "mock" | "local" | "supabase";

function getDataSource(): DataSource {
  const v = (process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock").toLowerCase();
  if (v === "local" || v === "supabase") return v;
  return "mock";
}

function getLocalBase(): string {
  return process.env.NEXT_PUBLIC_LOCAL_API_URL ?? "http://localhost:5000";
}

// ─────────────────────────────────────────────────────────────────────
// Giga-centroids (topics)
// ─────────────────────────────────────────────────────────────────────

export async function getGigaCentroids(): Promise<GigaCentroidsResponse> {
  const source = getDataSource();

  if (source === "supabase") {
    // PostgREST sobre la tabla topic_centroids — sin RPC, no aporta nada
    // envolver un SELECT en una función. Ojo: el order chain replica el
    // ORDER BY del schema original (volume DESC, label ASC).
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("topic_centroids")
      .select("id, label, x, y, volume, avg_divergence, color_band, summary")
      .order("volume", { ascending: false })
      .order("label", { ascending: true });
    if (error) throw error;
    return {
      generated_at: new Date().toISOString(),
      centroids: (data ?? []) as GigaCentroid[],
    };
  }

  if (source === "local") {
    const res = await fetch(`${getLocalBase()}/api/topics`, { cache: "no-store" });
    if (!res.ok) throw new Error(`local /api/topics: ${res.status}`);
    return (await res.json()) as GigaCentroidsResponse;
  }

  // mock
  const data = (await import("@/public/data/giga-centroids.json")).default;
  return data as GigaCentroidsResponse;
}

// ─────────────────────────────────────────────────────────────────────
// Centroid events
// ─────────────────────────────────────────────────────────────────────

export async function getCentroidEvents(
  centroidId: string,
): Promise<CentroidEventsResponse> {
  const source = getDataSource();

  if (source === "supabase") {
    // Idem: PostgREST + filter sobre la tabla, no necesitamos RPC.
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("events")
      .select("id, slug, title, x, y, media_count, divergence, divergence_band, summary, keywords")
      .eq("topic_centroid_id", centroidId)
      .order("media_count", { ascending: false })
      .order("published_at", { ascending: false });
    if (error) throw error;
    return { centroid_id: centroidId, events: (data ?? []) as CentroidEvent[] };
  }

  if (source === "local") {
    const res = await fetch(
      `${getLocalBase()}/api/topics/${encodeURIComponent(centroidId)}/events`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`local /api/topics/${centroidId}/events: ${res.status}`);
    return (await res.json()) as CentroidEventsResponse;
  }

  // mock
  const all = (await import("@/public/data/centroid-events.json")).default as Record<
    string,
    CentroidEventsResponse
  >;
  const found = all[centroidId];
  if (found) return found;
  return { centroid_id: centroidId, events: [] };
}

// ─────────────────────────────────────────────────────────────────────
// Event detail (axioma)
// ─────────────────────────────────────────────────────────────────────

export async function getEventDetail(idOrSlug: string): Promise<EventDetail> {
  const source = getDataSource();

  if (source === "supabase") {
    const supabase = getSupabase();
    
    // Get event details first
    const { data: eventData, error: eventError } = await supabase
      .from("event_details")
      .select("verdad_consensuada, datos_aislados, contradicciones")
      .eq("event_id", idOrSlug)
      .maybeSingle();
    
    if (eventError) throw eventError;
    
    // Step 1: Get GUIDs for this event
    const { data: guidsData, error: guidsError } = await supabase
      .from("event_articles")
      .select("guid")
      .eq("event_id", idOrSlug);
    
    if (guidsError) throw guidsError;
    
    // Step 2: Get articles by GUIDs with media info
    let articles: any[] = [];
    if (guidsData && guidsData.length > 0) {
      const guids = guidsData.map((row: any) => row.guid);
      const { data: articlesData, error: articlesError } = await supabase
        .from("articles")
        .select("url, guid, medium_slug, title, summary, author, published_at, language, topics, media!inner(slug, name, feed_url, base_url)")
        .in("guid", guids);
      
      if (articlesError) throw articlesError;
      articles = (articlesData || []) as any[];
    }
    
    if (!eventData) {
      return {
        verdad_consensuada: ["Aún no hay un análisis detallado para este evento."],
        datos_aislados: [],
        contradicciones: [],
        articles: [],
      };
    }
    
    return {
      ...eventData,
      articles,
    } as EventDetail;
  }

  if (source === "local") {
    const res = await fetch(
      `${getLocalBase()}/api/events/${encodeURIComponent(idOrSlug)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return {
        verdad_consensuada: ["Aún no hay un análisis detallado para este evento."],
        datos_aislados: [],
        contradicciones: [],
      };
    }
    const ev = await res.json();
    return {
      verdad_consensuada: ev.verdad_consensuada ?? [],
      datos_aislados: ev.datos_aislados ?? [],
      contradicciones: ev.contradicciones ?? [],
    };
  }

  // mock
  try {
    const mod = await import(`@/public/data/event-${idOrSlug}.json`);
    return mod.default as EventDetail;
  } catch {
    return {
      verdad_consensuada: ["Aún no hay un análisis detallado para este evento."],
      datos_aislados: [],
      contradicciones: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Convenience: load every centroid + every event up-front. Used by the search
 * feature, which must be able to jump across topics. En Supabase y local hace
 * N+1 fetches (1 por topic). En mock carga todo de un JSON.
 */
export async function loadAllCentroidsWithEvents(): Promise<{
  centroids: GigaCentroid[];
  eventsByCentroid: Map<string, CentroidEvent[]>;
}> {
  const source = getDataSource();

  if (source === "mock") {
    const [centroidsRes, allEvents] = await Promise.all([
      getGigaCentroids(),
      import("@/public/data/centroid-events.json").then((m) => m.default),
    ]);
    const grouped = new Map<string, CentroidEvent[]>();
    for (const c of centroidsRes.centroids) {
      const entry = (allEvents as Record<string, CentroidEventsResponse>)[c.id];
      grouped.set(c.id, entry?.events ?? []);
    }
    return { centroids: centroidsRes.centroids, eventsByCentroid: grouped };
  }

  // local + supabase: traemos centroids y después un fetch por cada uno (N+1).
  // Para hackatón con ~5-8 topics es aceptable.
  const centroidsRes = await getGigaCentroids();
  const grouped = new Map<string, CentroidEvent[]>();
  await Promise.all(
    centroidsRes.centroids.map(async (c) => {
      const ev = await getCentroidEvents(c.id);
      grouped.set(c.id, ev.events);
    }),
  );
  return { centroids: centroidsRes.centroids, eventsByCentroid: grouped };
}
