"use client";

import { useMemo } from "react";
import { EmbeddingMap } from "./EmbeddingMap";
import { SearchBar } from "./SearchBar";
import type { CentroidEvent, GigaCentroid } from "@/lib/types";

interface Props {
  centroids: GigaCentroid[];
  groupedEvents: Record<string, CentroidEvent[]>;
}

export function MapClient({ centroids, groupedEvents }: Props) {
  const eventsByCentroid = useMemo(() => {
    const m = new Map<string, CentroidEvent[]>();
    for (const k of Object.keys(groupedEvents)) m.set(k, groupedEvents[k]);
    return m;
  }, [groupedEvents]);

  return (
    <div className="relative w-full h-[calc(100vh-48px)] min-h-[640px]">
      <EmbeddingMap centroids={centroids} eventsByCentroid={eventsByCentroid} />
      <SearchBar />
    </div>
  );
}
