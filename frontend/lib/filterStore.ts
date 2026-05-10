"use client";

import { create } from "zustand";

interface FilterState {
  search: string;
  topic: string | null;
  media: string[];
  hoveredEventId: string | null;
  setSearch: (s: string) => void;
  toggleTopic: (t: string) => void;
  toggleMedia: (m: string) => void;
  clearMedia: () => void;
  setHovered: (id: string | null) => void;
  reset: () => void;
}

export const useFilters = create<FilterState>((set) => ({
  search: "",
  topic: null,
  media: [],
  hoveredEventId: null,
  setSearch: (search) => set({ search }),
  toggleTopic: (t) =>
    set((state) => ({ topic: state.topic === t ? null : t })),
  toggleMedia: (m) =>
    set((state) => ({
      media: state.media.includes(m)
        ? state.media.filter((x) => x !== m)
        : [...state.media, m],
    })),
  clearMedia: () => set({ media: [] }),
  setHovered: (id) => set({ hoveredEventId: id }),
  reset: () =>
    set({ search: "", topic: null, media: [], hoveredEventId: null }),
}));
