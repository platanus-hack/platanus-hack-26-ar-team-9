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
}

export interface Contradiction {
  punto_de_choque: string;
  versiones: Record<string, string>;
}

export interface EventDetail {
  verdad_consensuada: string[];
  datos_aislados: IsolatedFact[];
  contradicciones: Contradiction[];
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
