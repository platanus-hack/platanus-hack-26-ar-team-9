export type DivergenceBand = "low" | "medium" | "high";

export interface Event {
  id: string;
  slug: string;
  title: string;
  /** normalized [-1, 1] */
  x: number;
  /** normalized [-1, 1] */
  y: number;
  media_count: number;
  /** [0, 1] */
  divergence: number;
  divergence_band: DivergenceBand;
  trending_topics: string[];
  media_sources: string[];
  keywords: string[];
  summary?: string;
}

export interface EventsPayload {
  generated_at: string;
  events: Event[];
  trending_topics: string[];
  media_sources: string[];
}

export interface IsolatedFact {
  hecho: string;
  fuente: string;
  url?: string;
}

export interface Contradiction {
  punto_de_choque: string;
  versiones: Record<string, string>;
  urls?: Record<string, string>;
}

export interface EventDetail {
  verdad_consensuada: string[];
  datos_aislados: IsolatedFact[];
  contradicciones: Contradiction[];
  articles?: (Article & { media: Media })[];
}

export interface Filters {
  search: string;
  topic: string | null;
  media: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Giga-centroid contract (see /contrato-bdd/contract.md)
// ─────────────────────────────────────────────────────────────────────

export type ColorBand = DivergenceBand;

export interface GigaCentroid {
  id: string;
  label: string;
  /** normalized [-1, 1] */
  x: number;
  /** normalized [-1, 1] */
  y: number;
  /** number of events in this topic (drives territory size) */
  volume: number;
  avg_divergence: number;
  color_band: ColorBand;
  summary?: string;
}

export interface GigaCentroidsResponse {
  generated_at: string;
  centroids: GigaCentroid[];
}

export interface CentroidEvent {
  id: string;
  slug: string;
  title: string;
  /** normalized [-1, 1], lies inside parent centroid territory */
  x: number;
  y: number;
  media_count: number;
  divergence: number;
  divergence_band: DivergenceBand;
  summary?: string;
  keywords: string[];
}

export interface CentroidEventsResponse {
  centroid_id: string;
  events: CentroidEvent[];
}

// ─────────────────────────────────────────────────────────────────────
// Article types (for news links in clusters)
// ─────────────────────────────────────────────────────────────────────

export interface Article {
  url: string;
  guid: string;
  medium_slug: string;
  title: string;
  summary?: string;
  body?: string;
  author?: string;
  published_at?: string;
  language?: string;
  topics?: string[];
}

export interface Media {
  slug: string;
  name: string;
  feed_url?: string;
  base_url?: string;
}

export interface EventArticlesResponse {
  event_id: string;
  articles: (Article & { media: Media })[];
}
