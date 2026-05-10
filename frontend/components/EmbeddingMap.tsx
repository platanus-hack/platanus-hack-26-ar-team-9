"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import * as d3 from "d3";
import type { CentroidEvent, GigaCentroid } from "@/lib/types";
import { useMapStore } from "@/lib/mapStore";
import { MapLegend } from "./MapLegend";

// Import modular components
import { WelcomeOverlay } from "./EmbeddingMap/WelcomeOverlay";
import { NodeTooltip, type TooltipData } from "./EmbeddingMap/NodeTooltip";
import { ZoomControls } from "./EmbeddingMap/ZoomControls";

// Import custom hooks
import { useParticleSystem } from "./EmbeddingMap/hooks/useParticleSystem";
import { useForceSimulation } from "./EmbeddingMap/hooks/useForceSimulation";
import { useCanvasRenderer } from "./EmbeddingMap/hooks/useCanvasRenderer";

const PADDING = 80;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 6;
const INITIAL_K = 0.5;

type HitResult =
  | { kind: "centroid"; id: string }
  | { kind: "event"; id: string };

interface Props {
  centroids: GigaCentroid[];
  eventsByCentroid: Map<string, CentroidEvent[]>;
}

export function EmbeddingMap({ centroids, eventsByCentroid }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<
    HTMLCanvasElement,
    unknown
  > | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<d3.ZoomTransform>(
    d3.zoomIdentity.scale(INITIAL_K),
  );
  const [hover, setHover] = useState<HitResult | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [tick, setTick] = useState(0);
  const [selectedCentroidId, setSelectedCentroidId] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // ── Map store (search & navigation) ─────────────────────────────────
  const query = useMapStore((s) => s.query);
  const submitVersion = useMapStore((s) => s.submitVersion);
  const searchMatches = useMapStore((s) => s.searchMatches);
  const searchIndex = useMapStore((s) => s.searchIndex);
  const setSearchMatches = useMapStore((s) => s.setSearchMatches);
  const clearSearch = useMapStore((s) => s.clearSearch);
  const pendingTarget = useMapStore((s) => s.pendingTarget);
  const setPendingTarget = useMapStore((s) => s.setPendingTarget);

  // ── Resize observer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Layout: pixel positions of centroids + events ───────────────────
  // ── Cluster-bubble layout (d3-force) ────────────────────────────────────
  // Decisión: las posiciones de events vienen del backend (UMAP), pero como
  // los embeddings MiniLM no separan bien las categorías noticieras, en su
  // lugar las posiciones se DETERMINAN POR LA CATEGORÍA del event:
  //   - cada topic tiene un anchor distribuido en círculo
  //   - cada event se atrae a su anchor de topic (cohesión intra-cluster)
  //   - forceCollide entre events evita solapamiento
  //   - forceManyBody empuja suavemente para que clusters no se aplasten
  // Después de la simulación, el centroide del topic = mean de sus events.
  const { centroidNodes, eventNodes } = useForceSimulation(centroids, eventsByCentroid, size);

  // ── Voronoi tessellation in pixel space ─────────────────────────────
  const voronoi = useMemo(() => {
    if (!centroidNodes.length || !size.width) return null;
    const points: [number, number][] = centroidNodes.map((n) => [n.cx, n.cy]);
    const margin = Math.max(size.width, size.height);
    const delaunay = d3.Delaunay.from(points);
    return delaunay.voronoi([
      -margin,
      -margin,
      size.width + margin,
      size.height + margin,
    ]);
  }, [centroidNodes, size]);

  // ── d3-zoom wiring (set up once size is known) ──────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on("zoom", (event) => {
        setTransform(event.transform);
        // Clear selection if zooming out below threshold
        if (event.transform.k < 2.0 && selectedCentroidId) {
          setSelectedCentroidId(null);
        }
      });

    zoomBehaviorRef.current = zoom;
    const sel = d3.select(canvas);
    sel.call(zoom);
    sel.on("dblclick.zoom", null);

    if (!initializedRef.current) {
      sel.call(
        zoom.transform,
        d3.zoomIdentity
          .translate(
            (size.width / 2) * (1 - INITIAL_K),
            (size.height / 2) * (1 - INITIAL_K),
          )
          .scale(INITIAL_K),
      );
      initializedRef.current = true;
    }

    return () => {
      sel.on(".zoom", null);
    };
  }, [size.width, size.height]);

  // ── Particle system ─────────────────────────────────────────────
  const particles = useParticleSystem(size.width, size.height);

  // ── Animation tick for enhanced effects ────────────────────────────────
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Smooth zoom-to helper ──────────────────────────────────────────
  const zoomTo = useCallback(
    (worldX: number, worldY: number, k: number, duration = 750) => {
      const canvas = canvasRef.current;
      const zoom = zoomBehaviorRef.current;
      if (!canvas || !zoom || size.width === 0) return;
      const tx = size.width / 2 - worldX * k;
      const ty = size.height / 2 - worldY * k;
      d3.select(canvas)
        .transition()
        .duration(duration)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    },
    [size],
  );

  // ── React to external zoom targets (search / nav) ───────────────────
  useEffect(() => {
    if (!pendingTarget) return;
    if (pendingTarget.kind === "reset") {
      zoomTo(size.width / 2, size.height / 2, INITIAL_K, 700);
    } else if (pendingTarget.kind === "topic") {
      const node = centroidNodes.find(
        (n) => n.centroid.id === pendingTarget.centroidId,
      );
      if (node) zoomTo(node.cx, node.cy, 4.0, 800);
    } else if (pendingTarget.kind === "event") {
      const node = eventNodes.find((n) => n.event.id === pendingTarget.eventId);
      if (node) zoomTo(node.cx, node.cy, 4.5, 800);
    }
    setPendingTarget(null);
  }, [pendingTarget, centroidNodes, eventNodes, size, zoomTo, setPendingTarget]);

  // ── Compute search matches when user submits ────────────────────────
  useEffect(() => {
    if (submitVersion === 0) return;
    const q = query.trim().toLowerCase();
    if (!q) return;
    const matches: { event: CentroidEvent; centroidId: string; centroidLabel: string }[] = [];
    for (const [centroidId, events] of eventsByCentroid.entries()) {
      const centroid = centroids.find((c) => c.id === centroidId);
      const label = centroid?.label ?? "";
      for (const ev of events) {
        const inTitle = ev.title.toLowerCase().includes(q);
        const inSummary = ev.summary?.toLowerCase().includes(q) ?? false;
        const inKeywords = ev.keywords.some((k) => k.toLowerCase().includes(q));
        const inLabel = label.toLowerCase().includes(q);
        if (inTitle || inSummary || inKeywords || inLabel) {
          matches.push({ event: ev, centroidId, centroidLabel: label });
        }
      }
    }
    setSearchMatches(matches);
  }, [submitVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── React to search index → zoom to match ──────────────────────────
  useEffect(() => {
    if (!searchMatches.length) return;
    const m = searchMatches[searchIndex];
    if (!m) return;
    const node = eventNodes.find((n) => n.event.id === m.event.id);
    if (node) zoomTo(node.cx, node.cy, 4.5, 850);
  }, [searchIndex, searchMatches, eventNodes, zoomTo]);

  // ── Canvas render ──────────────────────────────────────────────────
  useCanvasRenderer({
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    centroidNodes,
    eventNodes,
    particles,
    voronoi,
    size,
    transform,
    hover,
    tick,
    searchMatches,
    searchIndex,
    selectedCentroidId,
  });

  // ── Hit testing ────────────────────────────────────────────────────
  const hitTest = (clientX: number, clientY: number): HitResult | null => {
    if (!canvasRef.current || !voronoi) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const k = transform.k;
    const oE = (() => {
      return Math.max(0, Math.min(1, (k - 2.5) / 1.0));
    })();
    const oT = (() => {
      const fadeIn = Math.max(0, Math.min(1, (k - 0.7) / 0.3));
      const fadeOut = Math.max(0, Math.min(1, 1 - (k - 3.5) / 0.8));
      return fadeIn * fadeOut;
    })();

    if (oE > 0.5) {
      // Use generous screen-pixel hit radius
      let best: { id: string; dist: number } | null = null;
      for (const n of eventNodes) {
        const cx = transform.applyX(n.cx);
        const cy = transform.applyY(n.cy);
        const r = Math.max(n.r, 12); // constant in screen pixels at any zoom
        const d = Math.hypot(px - cx, py - cy);
        if (d <= r + 4 && (!best || d < best.dist)) {
          best = { id: n.event.id, dist: d };
        }
      }
      if (best) return { kind: "event", id: best.id };
    }

    if (oT > 0.3) {
      const wx = (px - transform.x) / transform.k;
      const wy = (py - transform.y) / transform.k;
      const idx = voronoi.delaunay.find(wx, wy);
      if (idx >= 0 && idx < centroidNodes.length) {
        return { kind: "centroid", id: centroidNodes[idx].centroid.id };
      }
    }

    return null;
  };

  // ── Click handler ──────────────────────────────────────────────────
  const handleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = hitTest(e.clientX, e.clientY);
    const k = transform.k;

    if (hit?.kind === "event") {
      const node = eventNodes.find((n) => n.event.id === hit.id);
      if (node) router.push(`/event/${node.event.id}`);
      return;
    }
    if (hit?.kind === "centroid") {
      const node = centroidNodes.find((n) => n.centroid.id === hit.id);
      if (node) {
        setSelectedCentroidId(hit.id);
        zoomTo(node.cx, node.cy, 4.0, 800);
      }
      return;
    }
    // Empty / welcome click → drill into topics view, biased toward click point
    if (k < 1.2) {
      // Clear selection when clicking empty space
      setSelectedCentroidId(null);
      const wx = (px - transform.x) / transform.k;
      const wy = (py - transform.y) / transform.k;
      // Bias toward center for predictability
      const cx = (wx + size.width / 2) / 2;
      const cy = (wy + size.height / 2) / 2;
      zoomTo(cx, cy, 1.6, 850);
    }
  };

  // ── Mouse move (hover + tooltip) ──────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) {
      setHover(null);
      setTooltip(null);
      (e.currentTarget as HTMLCanvasElement).style.cursor = "grab";
      return;
    }
    setHover(hit);
    (e.currentTarget as HTMLCanvasElement).style.cursor = "pointer";
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (hit.kind === "centroid") {
      const node = centroidNodes.find((n) => n.centroid.id === hit.id);
      if (node) setTooltip({ kind: "centroid", centroid: node.centroid, x, y });
    } else {
      const ev = eventNodes.find((n) => n.event.id === hit.id);
      const c = centroidNodes.find((n) => n.centroid.id === ev?.centroidId);
      if (ev && c) {
        setTooltip({
          kind: "event",
          event: ev.event,
          centroid: c.centroid,
          x,
          y,
        });
      }
    }
  };

  // ── Programmatic zoom controls ────────────────────────────────────
  const zoomBy = (factor: number) => {
    const canvas = canvasRef.current;
    const zoom = zoomBehaviorRef.current;
    if (!canvas || !zoom) return;
    d3.select(canvas)
      .transition()
      .duration(220)
      .ease(d3.easeCubicInOut)
      .call(zoom.scaleBy, factor);
  };
  const resetZoom = () => {
    setPendingTarget({ kind: "reset" });
    clearSearch();
  };

  // Opacity functions for UI elements
  const oW = (() => {
    const k = transform.k;
    return Math.max(0, Math.min(1, 1 - (k - 0.6) / 0.5));
  })();
  const isZoomed = Math.abs(transform.k - INITIAL_K) > 0.05;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[--color-bg-primary]"
    >
      <MapLegend />
      <ZoomControls
        onZoomIn={() => zoomBy(1.5)}
        onZoomOut={() => zoomBy(1 / 1.5)}
        onReset={resetZoom}
        canReset={isZoomed}
        scale={transform.k}
      />

      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setHover(null);
          setTooltip(null);
        }}
        onClick={handleClick}
      />

      <WelcomeOverlay opacity={oW} />
      {tooltip && <NodeTooltip data={tooltip} />}
    </div>
  );
}
