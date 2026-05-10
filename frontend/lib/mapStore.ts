import { create } from "zustand";
import type { CentroidEvent } from "./types";

export interface SearchMatch {
  event: CentroidEvent;
  centroidId: string;
  centroidLabel: string;
}

export type ZoomTarget =
  | { kind: "reset" }
  | { kind: "topic"; centroidId: string }
  | { kind: "event"; eventId: string };

interface MapState {
  query: string;
  setQuery: (q: string) => void;

  /** Bumped each time the user submits the search bar. */
  submitVersion: number;
  submitSearch: () => void;

  searchMatches: SearchMatch[];
  searchIndex: number;
  setSearchMatches: (m: SearchMatch[]) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  clearSearch: () => void;

  /** Set by external triggers; map watches and animates to it then nulls. */
  pendingTarget: ZoomTarget | null;
  setPendingTarget: (t: ZoomTarget | null) => void;
}

export const useMapStore = create<MapState>((set, get) => ({
  query: "",
  setQuery: (q) => set({ query: q }),

  submitVersion: 0,
  submitSearch: () => set({ submitVersion: get().submitVersion + 1 }),

  searchMatches: [],
  searchIndex: 0,
  setSearchMatches: (m) => set({ searchMatches: m, searchIndex: 0 }),
  nextMatch: () => {
    const { searchMatches, searchIndex } = get();
    if (!searchMatches.length) return;
    set({ searchIndex: (searchIndex + 1) % searchMatches.length });
  },
  prevMatch: () => {
    const { searchMatches, searchIndex } = get();
    if (!searchMatches.length) return;
    set({
      searchIndex:
        (searchIndex - 1 + searchMatches.length) % searchMatches.length,
    });
  },
  clearSearch: () =>
    set({ query: "", searchMatches: [], searchIndex: 0 }),

  pendingTarget: null,
  setPendingTarget: (t) => set({ pendingTarget: t }),
}));
