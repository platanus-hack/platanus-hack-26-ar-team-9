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
import { Plus, Minus, Locate } from "lucide-react";
import type { CentroidEvent, GigaCentroid } from "@/lib/types";
import { colorForBand, colorForDivergence, labelForBand } from "@/lib/colors";
import { useMapStore } from "@/lib/mapStore";
import { MapLegend } from "./MapLegend";

const PADDING = 80;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 6;
const INITIAL_K = 0.5;

// Zoom thresholds — continuous opacity blending across layers.
function welcomeOpacity(k: number) {
  return clamp(1 - (k - 0.6) / 0.5, 0, 1); // 1 ≤0.6, 0 ≥1.1
}
function topicsOpacity(k: number) {
  const fadeIn = clamp((k - 0.7) / 0.3, 0, 1);
  const fadeOut = clamp(1 - (k - 3.5) / 0.8, 0, 1);
  return fadeIn * fadeOut;
}
function eventsOpacity(k: number) {
  return clamp((k - 2.5) / 1.0, 0, 1);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

interface CentroidNode {
  centroid: GigaCentroid;
  cx: number;
  cy: number;
  r: number;
  color: string;
}

interface EventNode {
  event: CentroidEvent;
  centroidId: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
}

type HitResult =
  | { kind: "centroid"; id: string }
  | { kind: "event"; id: string };

interface CentroidTooltipData {
  kind: "centroid";
  centroid: GigaCentroid;
  x: number;
  y: number;
}
interface EventTooltipData {
  kind: "event";
  event: CentroidEvent;
  centroid: GigaCentroid;
  x: number;
  y: number;
}
type TooltipData = CentroidTooltipData | EventTooltipData;

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
  const { centroidNodes, eventNodes } = useMemo<{
    centroidNodes: CentroidNode[];
    eventNodes: EventNode[];
  }>(() => {
    if (size.width === 0 || size.height === 0) return { centroidNodes: [], eventNodes: [] };

    const eventRScale = d3
      .scaleSqrt()
      .domain([1, 15])
      .range([7, 18])
      .clamp(true);
    const centroidRScale = d3
      .scaleSqrt()
      .domain([1, 20])
      .range([26, 64])
      .clamp(true);

    // Anchors: un punto por topic, distribuidos en círculo alrededor del centro.
    const cx = size.width / 2;
    const cy = size.height / 2;
    const ringRadius = Math.min(size.width, size.height) * 0.32;
    const N = centroids.length;
    const anchorByTopic = new Map<string, { x: number; y: number }>();
    centroids.forEach((c, i) => {
      const angle = (i / Math.max(N, 1)) * 2 * Math.PI - Math.PI / 2;
      anchorByTopic.set(c.id, {
        x: cx + ringRadius * Math.cos(angle),
        y: cy + ringRadius * Math.sin(angle),
      });
    });

    type SimEvent = d3.SimulationNodeDatum & {
      event: CentroidEvent;
      topicId: string;
      r: number;
      color: string;
    };

    const eventsSim: SimEvent[] = [];
    for (const [centroidId, events] of eventsByCentroid.entries()) {
      const anchor = anchorByTopic.get(centroidId);
      if (!anchor) continue;
      for (const e of events) {
        eventsSim.push({
          event: e,
          topicId: centroidId,
          r: eventRScale(Math.max(e.media_count, 1)),
          color: colorForDivergence(e.divergence ?? 0),
          // Empezamos cerca del anchor con jitter para que la sim no diverja.
          x: anchor.x + (Math.random() - 0.5) * 30,
          y: anchor.y + (Math.random() - 0.5) * 30,
        });
      }
    }

    if (!eventsSim.length) return { centroidNodes: [], eventNodes: [] };

    const sim = d3
      .forceSimulation<SimEvent>(eventsSim)
      .force(
        "x",
        d3.forceX<SimEvent>((d) => anchorByTopic.get(d.topicId)?.x ?? cx).strength(0.35),
      )
      .force(
        "y",
        d3.forceY<SimEvent>((d) => anchorByTopic.get(d.topicId)?.y ?? cy).strength(0.35),
      )
      .force("charge", d3.forceManyBody<SimEvent>().strength(-25))
      .force(
        "collide",
        d3.forceCollide<SimEvent>((d) => d.r + 3).strength(1).iterations(3),
      )
      .stop();

    // ~300 ticks alcanzan para que se acomoden los clusters sin oscilar.
    for (let i = 0; i < 300; i++) sim.tick();

    const eventNodesOut: EventNode[] = eventsSim.map((s) => ({
      event: s.event,
      centroidId: s.topicId,
      cx: s.x ?? 0,
      cy: s.y ?? 0,
      r: s.r,
      color: s.color,
    }));

    // Centroid de cada topic = mean(x, y) de sus events tras la simulación.
    const centroidNodesOut: CentroidNode[] = centroids.map((c) => {
      const myEvents = eventNodesOut.filter((e) => e.centroidId === c.id);
      const anchor = anchorByTopic.get(c.id) ?? { x: cx, y: cy };
      const meanX = myEvents.length
        ? myEvents.reduce((s, e) => s + e.cx, 0) / myEvents.length
        : anchor.x;
      const meanY = myEvents.length
        ? myEvents.reduce((s, e) => s + e.cy, 0) / myEvents.length
        : anchor.y;
      return {
        centroid: c,
        cx: meanX,
        cy: meanY,
        r: centroidRScale(c.volume),
        color: colorForDivergence(c.avg_divergence ?? 0),
      };
    });

    return { centroidNodes: centroidNodesOut, eventNodes: eventNodesOut };
  }, [centroids, eventsByCentroid, size]);

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
      .on("zoom", (event) => setTransform(event.transform));

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

  // ── Animation tick for pulse effects ────────────────────────────────
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
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0 || !voronoi) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const k = transform.k;
    const oW = welcomeOpacity(k);
    const oT = topicsOpacity(k);
    const oE = eventsOpacity(k);
    const t = performance.now();
    const pulse = (Math.sin(t / 700) + 1) / 2; // 0..1
    const breath = (Math.sin(t / 1400) + 1) / 2;

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Layer 1 — Voronoi territories (atenuado: el layout ahora es cluster-bubble,
    // los territorios eran solo confusión visual. Dejamos un hint sutil.)
    const territoryAlpha = 0.06 * (oW * 0.55 + oT + oE * 0.55);
    if (territoryAlpha > 0.02) {
      for (let i = 0; i < centroidNodes.length; i++) {
        const node = centroidNodes[i];
        const poly = voronoi.cellPolygon(i);
        if (!poly) continue;
        const isHover =
          hover?.kind === "centroid" && hover.id === node.centroid.id;
        const fill = node.color;

        ctx.save();
        ctx.beginPath();
        for (let j = 0; j < poly.length; j++) {
          const [px, py] = poly[j];
          if (j === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        // Soft fill
        ctx.globalAlpha =
          territoryAlpha * (isHover ? 0.45 : 0.22 + breath * 0.05);
        ctx.fillStyle = fill;
        ctx.fill();
        // Border
        ctx.globalAlpha = territoryAlpha * (isHover ? 0.95 : 0.7);
        ctx.lineWidth = (isHover ? 2.2 : 1.2) / k;
        ctx.strokeStyle = fill;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Layer 2 — Centroid markers + labels
    if (oT > 0.02) {
      for (const node of centroidNodes) {
        const isHover =
          hover?.kind === "centroid" && hover.id === node.centroid.id;
        ctx.save();
        ctx.globalAlpha = oT;

        // Pulse ring (click affordance)
        const ringR = (node.r * 0.6 + 8 + pulse * 14) / k;
        ctx.strokeStyle = node.color + (isHover ? "aa" : "55");
        ctx.lineWidth = (isHover ? 2.5 : 1.6) / k;
        ctx.beginPath();
        ctx.arc(node.cx, node.cy, ringR, 0, Math.PI * 2);
        ctx.stroke();

        // Core dot
        ctx.fillStyle = node.color;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = (isHover ? 28 : 16) / k;
        ctx.beginPath();
        ctx.arc(
          node.cx,
          node.cy,
          ((isHover ? 0.34 : 0.28) * node.r) / k,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        const labelSize = (26 + (isHover ? 3 : 0)) / k;
        const offset = (node.r * 0.55) / k + labelSize * 0.7;
        // Subtle dark plate behind label to keep contrast over busy territories
        const labelText = node.centroid.label;
        ctx.font = `600 ${labelSize}px var(--font-fraunces), serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const padX = 10 / k;
        const padY = 5 / k;
        const metrics = ctx.measureText(labelText);
        const labelW = metrics.width + padX * 2;
        const labelH = labelSize * 1.15 + padY * 2;
        ctx.save();
        ctx.globalAlpha = oT * 0.55;
        ctx.fillStyle = "#0a0c12";
        roundRect(
          ctx,
          node.cx - labelW / 2,
          node.cy + offset - labelH / 2,
          labelW,
          labelH,
          6 / k,
        );
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = "#f8fafc";
        ctx.fillText(labelText, node.cx, node.cy + offset);

        const subSize = 14 / k;
        ctx.font = `500 ${subSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(
          `${node.centroid.volume} historias`,
          node.cx,
          node.cy + offset + labelSize * 0.85,
        );
        ctx.restore();
      }
    }

    // Layer 3 — Event nodes
    if (oE > 0.02) {
      const matchIds = new Set(searchMatches.map((m) => m.event.id));
      const currentMatchId = searchMatches[searchIndex]?.event.id;
      for (const node of eventNodes) {
        const isHover =
          hover?.kind === "event" && hover.id === node.event.id;
        const isMatch = matchIds.has(node.event.id);
        const isCurrentMatch = currentMatchId === node.event.id;

        ctx.save();
        ctx.globalAlpha = oE;

        // Search highlight ring
        if (isCurrentMatch) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3 / k;
          ctx.beginPath();
          ctx.arc(
            node.cx,
            node.cy,
            (node.r + 8 + pulse * 6) / k,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        } else if (isMatch) {
          ctx.strokeStyle = "#ffffff88";
          ctx.lineWidth = 1.5 / k;
          ctx.beginPath();
          ctx.arc(node.cx, node.cy, (node.r + 5) / k, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Subtle pulse halo on every event (click affordance)
        if (!isMatch && !isHover) {
          ctx.strokeStyle = node.color + "44";
          ctx.lineWidth = 1 / k;
          ctx.beginPath();
          ctx.arc(
            node.cx,
            node.cy,
            (node.r + 2 + pulse * 3) / k,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }

        // Body
        ctx.fillStyle = node.color;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = (isHover || isCurrentMatch ? 22 : 10) / k;
        ctx.beginPath();
        const r = ((isHover ? 1.18 : 1) * node.r) / k;
        ctx.arc(node.cx, node.cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // White core
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = oE * 0.92;
        ctx.beginPath();
        ctx.arc(node.cx, node.cy, Math.max(r * 0.45, 1.5 / k), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }, [
    centroidNodes,
    eventNodes,
    voronoi,
    size,
    transform,
    hover,
    tick,
    searchMatches,
    searchIndex,
  ]);

  // ── Hit testing ────────────────────────────────────────────────────
  const hitTest = (clientX: number, clientY: number): HitResult | null => {
    if (!canvasRef.current || !voronoi) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const k = transform.k;
    const oE = eventsOpacity(k);
    const oT = topicsOpacity(k);

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
      if (node) zoomTo(node.cx, node.cy, 4.0, 800);
      return;
    }
    // Empty / welcome click → drill into topics view, biased toward click point
    if (k < 1.2) {
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

  const oW = welcomeOpacity(transform.k);
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

// ─────────────────────────────────────────────────────────────────────
// Welcome cinematic overlay
// ─────────────────────────────────────────────────────────────────────
function WelcomeOverlay({ opacity }: { opacity: number }) {
  if (opacity < 0.02) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6"
      style={{ opacity }}
    >
      <div className="absolute inset-0 -z-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] max-w-[820px] max-h-[820px] rounded-full bg-[--color-accent-green]/10 blur-3xl animate-pulse" />
      </div>
      <h2
        className="relative text-6xl md:text-8xl lg:text-[9rem] font-medium tracking-tight text-[--color-text-primary] leading-[0.95]"
        style={{ fontFamily: "var(--font-fraunces)" }}
      >
        ALETH·IA
      </h2>
      <p
        className="relative mt-5 md:mt-7 text-2xl md:text-4xl italic text-[--color-text-secondary] tracking-tight"
        style={{ fontFamily: "var(--font-fraunces)" }}
      >
        Encontrá la verdad
      </p>
      <div className="relative mt-12 md:mt-16 flex flex-col items-center gap-3 text-[--color-text-primary]">
        <div className="relative">
          {/* Sonar ring — radiates outward continuously */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-white/40 animate-explore-radar"
          />
          {/* Pill — gentle scale breath */}
          <div className="relative px-10 py-4 md:px-14 md:py-5 rounded-full border-2 border-white/35 bg-white/[0.07] backdrop-blur-sm shadow-[0_22px_50px_-12px_rgba(0,0,0,0.7)] animate-explore-pulse">
            <span className="text-xl md:text-3xl font-medium tracking-[0.04em]">
              Explorá
            </span>
          </div>
        </div>
        <span className="text-[11px] md:text-xs tracking-[0.3em] uppercase text-[--color-text-muted] mt-3">
          Tocá cualquier parte del mapa
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────────────
function NodeTooltip({ data }: { data: TooltipData }) {
  const left = data.x + 14;
  const top = data.y + 14;
  if (data.kind === "centroid") {
    const c = data.centroid;
    const color = colorForBand(c.color_band);
    return (
      <div
        role="tooltip"
        className="absolute z-20 pointer-events-none w-72 rounded-lg border border-[--color-border-card] p-3 shadow-2xl text-xs text-[--color-text-secondary] fade-in"
        style={{ left, top, backgroundColor: "#11141d" }}
      >
        <div className="flex items-start gap-2 mb-2">
          <span
            className="mt-1 w-2 h-2 rounded-full shrink-0"
            style={{ background: color, boxShadow: `0 0 6px ${color}` }}
          />
          <p
            className="text-[--color-text-primary] text-base leading-tight font-medium"
            style={{ fontFamily: "var(--font-fraunces)" }}
          >
            {c.label}
          </p>
        </div>
        <div className="pl-4 grid grid-cols-2 gap-2 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Historias</div>
            <div className="text-[--color-text-primary] font-semibold">{c.volume}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Discrepancia</div>
            <div className="font-semibold" style={{ color }}>{labelForBand(c.color_band)}</div>
          </div>
        </div>
        {c.summary && (
          <p className="pl-4 leading-relaxed text-[--color-text-secondary]">{c.summary}</p>
        )}
      </div>
    );
  }

  const e = data.event;
  const color = colorForBand(e.divergence_band);
  return (
    <div
      role="tooltip"
      className="absolute z-20 pointer-events-none w-80 rounded-lg border border-[--color-border-card] p-3 shadow-2xl text-xs text-[--color-text-secondary] fade-in"
      style={{ left, top, backgroundColor: "#11141d" }}
    >
      <div className="flex items-start gap-2 mb-2">
        <span
          className="mt-1 w-2 h-2 rounded-full shrink-0"
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
        />
        <p className="text-[--color-text-primary] text-sm leading-snug font-medium">{e.title}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2 pl-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Medios</div>
          <div className="text-[--color-text-primary] font-semibold">{e.media_count}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted]">Discrepancia</div>
          <div className="font-semibold" style={{ color }}>{labelForBand(e.divergence_band)}</div>
        </div>
      </div>
      <div className="pl-4">
        <div className="text-[10px] uppercase tracking-wider text-[--color-text-muted] mb-1">Tópico</div>
        <div className="leading-relaxed">{data.centroid.label}</div>
      </div>
      <div className="mt-2 pt-2 border-t border-[--color-border-card] text-[10px] text-[--color-text-muted]">
        Click para ver el desglose
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Zoom controls
// ─────────────────────────────────────────────────────────────────────
interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  canReset: boolean;
  scale: number;
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
  onReset,
  canReset,
  scale,
}: ZoomControlsProps) {
  return (
    <div
      className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 p-1.5 rounded-xl bg-[--color-bg-card]/85 backdrop-blur border border-[--color-border-card] shadow-lg"
      role="group"
      aria-label="Controles de zoom del mapa"
    >
      <ZoomButton onClick={onZoomIn} label="Acercar" disabled={scale >= ZOOM_MAX - 0.01}>
        <Plus className="h-5 w-5" />
      </ZoomButton>
      <ZoomButton onClick={onZoomOut} label="Alejar" disabled={scale <= ZOOM_MIN + 0.01}>
        <Minus className="h-5 w-5" />
      </ZoomButton>
      <ZoomButton onClick={onReset} label="Volver al inicio" disabled={!canReset}>
        <Locate className="h-4 w-4" />
      </ZoomButton>
      <div
        aria-live="polite"
        className="text-center text-[10px] font-mono text-[--color-text-muted] pt-1 border-t border-[--color-border-card]"
      >
        {scale.toFixed(1)}×
      </div>
    </div>
  );
}

function ZoomButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-9 h-9 flex items-center justify-center rounded-lg text-[--color-text-secondary] hover:text-[--color-text-primary] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
