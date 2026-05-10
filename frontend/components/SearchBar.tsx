"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useMapStore } from "@/lib/mapStore";
import { cn } from "@/lib/cn";

/**
 * Floating search FAB anchored bottom-right of the map.
 *
 * States
 *   collapsed → 56×56 circular button with subtle vertical bob animation
 *   expanded  → animated pill with input + close + (when matches) prev/next
 *
 * Closing the FAB clears any active search so the next open starts fresh.
 */
export function SearchBar() {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = useMapStore((s) => s.query);
  const setQuery = useMapStore((s) => s.setQuery);
  const submitSearch = useMapStore((s) => s.submitSearch);
  const clearSearch = useMapStore((s) => s.clearSearch);
  const matches = useMapStore((s) => s.searchMatches);
  const matchIndex = useMapStore((s) => s.searchIndex);
  const submitVersion = useMapStore((s) => s.submitVersion);
  const next = useMapStore((s) => s.nextMatch);
  const prev = useMapStore((s) => s.prevMatch);

  // Focus the input shortly after expansion so the width animation gets to play.
  useEffect(() => {
    if (!expanded) return;
    const t = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, [expanded]);

  const handleClose = () => {
    clearSearch();
    setExpanded(false);
  };

  const hasMatches = matches.length > 0;
  const noResults =
    !hasMatches && query.trim().length > 0 && submitVersion > 0;
  const current = hasMatches ? matches[matchIndex] : null;

  const widthClass = !expanded
    ? "w-14"
    : hasMatches
      ? "w-[min(620px,calc(100vw-32px))]"
      : "w-[min(440px,calc(100vw-32px))]";

  return (
    <div
      className={cn(
        "absolute bottom-5 right-5 z-30 h-14 rounded-full overflow-hidden",
        "bg-[--color-bg-elevated] border border-[--color-border-card]",
        "shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)]",
        "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
        widthClass,
        !expanded && "animate-search-fab",
      )}
      style={{ backgroundColor: "#11141d" }}
    >
      {/* Collapsed: full-area button */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Buscar en el mapa"
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-opacity duration-200",
          expanded ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
        style={{ color: "#f8fafc" }}
      >
        <Search className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* Expanded: search form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim().length > 0) submitSearch();
        }}
        className={cn(
          "absolute inset-0 flex items-center gap-2 pl-5 pr-2",
          "transition-opacity duration-200 delay-200",
          expanded ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <Search
          className="h-5 w-5 text-[--color-text-muted] shrink-0"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="text"
          placeholder="Buscar tema, palabra…"
          aria-label="Buscar"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-base text-[--color-text-primary] placeholder:text-[--color-text-muted] py-3"
        />

        {hasMatches && current && (
          <div className="flex items-center gap-1 shrink-0 pl-2 pr-1 border-l border-[--color-border-card]">
            <span
              className="text-[11px] font-mono text-[--color-text-muted] px-1 select-none"
              aria-live="polite"
            >
              {matchIndex + 1}/{matches.length}
            </span>
            <button
              type="button"
              onClick={prev}
              aria-label="Resultado anterior"
              className="p-1.5 rounded-full text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-white/5 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Resultado siguiente"
              className="p-1.5 rounded-full text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-white/5 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {noResults && (
          <span className="text-xs text-[--color-text-muted] shrink-0 italic px-2">
            Sin resultados
          </span>
        )}

        <button
          type="button"
          onClick={handleClose}
          aria-label="Cerrar búsqueda"
          className="shrink-0 p-2.5 rounded-full text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-white/5 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
