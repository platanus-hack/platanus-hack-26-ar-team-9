import { useEffect } from "react";
import * as d3 from "d3";
import type { CentroidEvent, GigaCentroid } from "@/lib/types";
import { colorForDivergence } from "@/lib/colors";

const CONNECTION_DISTANCE = 200;

// Enhanced zoom thresholds with smoother transitions
function welcomeOpacity(k: number) {
  return clamp(1 - (k - 0.6) / 0.5, 0, 1);
}
function topicsOpacity(k: number) {
  const fadeIn = clamp((k - 0.7) / 0.3, 0, 1);
  const fadeOut = clamp(1 - (k - 3.5) / 0.8, 0, 1);
  return fadeIn * fadeOut;
}
function eventsOpacity(k: number) {
  return clamp((k - 2.5) / 1.0, 0, 1);
}
function particlesOpacity(k: number) {
  return clamp((k - 0.3) / 0.4, 0, 0.6);
}
function connectionsOpacity(k: number) {
  return clamp((k - 1.0) / 1.5, 0, 0.3);
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

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
  life: number;
}

interface CanvasRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  centroidNodes: CentroidNode[];
  eventNodes: EventNode[];
  particles: Particle[];
  voronoi: d3.Voronoi<any> | null;
  size: { width: number; height: number };
  transform: d3.ZoomTransform;
  hover: { kind: "centroid" | "event"; id: string } | null;
  tick: number;
  searchMatches: { event: CentroidEvent; centroidId: string; centroidLabel: string }[];
  searchIndex: number;
  selectedCentroidId: string | null;
}

export function useCanvasRenderer({
  canvasRef,
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
}: CanvasRendererProps) {
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

    // Layer 0 — Ambient particles for depth
    const oP = particlesOpacity(k);
    if (oP > 0.01) {
      for (const particle of particles) {
        ctx.save();
        ctx.globalAlpha = particle.alpha * oP;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Layer 1 — Voronoi territories
    const territoryAlpha = 0.06 * (oW * 0.55 + oT + oE * 0.55);
    
    // Determine active cluster for transparency effect
    const activeClusterId = hover?.kind === "centroid" ? hover.id : 
                           (searchMatches.length > 0 && searchIndex >= 0 ? 
                            searchMatches[searchIndex].centroidId : null);
    
    if (territoryAlpha > 0.02) {
      for (let i = 0; i < centroidNodes.length; i++) {
        const node = centroidNodes[i];
        const isHover = hover?.kind === "centroid" && hover.id === node.centroid.id;
        const isActiveCluster = activeClusterId === node.centroid.id;
        const isOtherCluster = activeClusterId && !isActiveCluster;
        const fill = node.color;

        ctx.save();
        
        const poly = voronoi?.cellPolygon(i);
        if (poly) {
          ctx.beginPath();
          for (let j = 0; j < poly.length; j++) {
            const [px, py] = poly[j];
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          
          // Reduce opacity for non-active clusters when one is active
          const clusterOpacityMultiplier = isOtherCluster ? 0.3 : 1;
          ctx.globalAlpha = territoryAlpha * (isHover ? 0.45 : 0.22 + breath * 0.05) * clusterOpacityMultiplier;
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.globalAlpha = territoryAlpha * (isHover ? 0.95 : 0.7) * clusterOpacityMultiplier;
          ctx.lineWidth = (isHover ? 2.2 : 1.2) / k;
          ctx.strokeStyle = fill;
          ctx.stroke();
        }
        
        ctx.restore();
      }
    }

    // Layer 1.5 — Connection lines between nearby clusters
    const oC = connectionsOpacity(k);
    if (oC > 0.01) {
      ctx.strokeStyle = '#ffffff';
      for (let i = 0; i < centroidNodes.length; i++) {
        for (let j = i + 1; j < centroidNodes.length; j++) {
          const node1 = centroidNodes[i];
          const node2 = centroidNodes[j];
          const dist = Math.hypot(node2.cx - node1.cx, node2.cy - node1.cy);
          
          if (dist < CONNECTION_DISTANCE) {
            const strength = 1 - (dist / CONNECTION_DISTANCE);
            // Reduce connection opacity if neither cluster is active
            const isNode1Active = activeClusterId === node1.centroid.id;
            const isNode2Active = activeClusterId === node2.centroid.id;
            const connectionOpacityMultiplier = (activeClusterId && !isNode1Active && !isNode2Active) ? 0.2 : 1;
            
            ctx.save();
            ctx.globalAlpha = strength * oC * 0.3 * connectionOpacityMultiplier;
            ctx.lineWidth = strength * 2 / k;
            ctx.beginPath();
            ctx.moveTo(node1.cx, node1.cy);
            ctx.lineTo(node2.cx, node2.cy);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // Layer 2 — Enhanced Centroid markers with glow effects
    if (oT > 0.02) {
      for (const node of centroidNodes) {
        const isHover =
          hover?.kind === "centroid" && hover.id === node.centroid.id;
        const isActiveCluster = activeClusterId === node.centroid.id;
        const isOtherCluster = activeClusterId && !isActiveCluster;
        
        // Reduce opacity for non-active clusters
        const centroidOpacityMultiplier = isOtherCluster ? 0.3 : 1;
        
        ctx.save();
        ctx.globalAlpha = oT * centroidOpacityMultiplier;

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
        
        // Check if this event belongs to the selected centroid
        const isInSelectedCentroid = selectedCentroidId && node.centroidId === selectedCentroidId;
        // Apply darkening effect if a centroid is selected and this event is not in it
        const shouldDarken = selectedCentroidId && !isInSelectedCentroid;

        ctx.save();
        ctx.globalAlpha = shouldDarken ? oE * 0.15 : oE; // Darken non-selected events to 15% opacity

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

        // Enhanced glow effect
        const glowIntensity = isHover || isCurrentMatch ? 1.5 : 1;
        ctx.shadowColor = node.color;
        ctx.shadowBlur = (glowIntensity * 15 + breath * 8) / k;
        
        // Outer glow ring
        ctx.strokeStyle = node.color + "33";
        ctx.lineWidth = 2 / k;
        ctx.beginPath();
        const glowR = ((isHover ? 1.3 : 1) * node.r + 4 + pulse * 3) / k;
        ctx.arc(node.cx, node.cy, glowR, 0, Math.PI * 2);
        ctx.stroke();
        
        // Main body with gradient
        const gradient = ctx.createRadialGradient(
          node.cx, node.cy, 0,
          node.cx, node.cy, node.r
        );
        gradient.addColorStop(0, node.color);
        gradient.addColorStop(0.7, node.color + "cc");
        gradient.addColorStop(1, node.color + "66");
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const r = ((isHover ? 1.18 : 1) * node.r) / k;
        ctx.arc(node.cx, node.cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Enhanced white core with inner glow (only for non-darkened events)
        if (!shouldDarken) {
          ctx.fillStyle = "#ffffff";
          ctx.globalAlpha = oE * 0.95;
          ctx.beginPath();
          ctx.arc(node.cx, node.cy, Math.max(r * 0.45, 1.5 / k), 0, Math.PI * 2);
          ctx.fill();
          
          // Inner bright spot
          ctx.fillStyle = node.color;
          ctx.globalAlpha = oE * 0.3;
          ctx.beginPath();
          ctx.arc(node.cx - r * 0.2, node.cy - r * 0.2, Math.max(r * 0.15, 0.8 / k), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }, [
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
  ]);
}
