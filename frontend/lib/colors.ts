import type { DivergenceBand } from "./types";

export const COLORS = {
  green: "#10b981",
  yellow: "#eab308",
  red: "#ef4444",
  bgPrimary: "#0a0c12",
  bgCard: "#1a1d2e",
  borderCard: "#2d3148",
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
} as const;

export function bandFromDivergence(divergence: number): DivergenceBand {
  if (divergence <= 0.33) return "low";
  if (divergence <= 0.66) return "medium";
  return "high";
}

export function colorForBand(band: DivergenceBand): string {
  switch (band) {
    case "low":
      return COLORS.green;
    case "medium":
      return COLORS.yellow;
    case "high":
      return COLORS.red;
  }
}

/**
 * Gradiente continuo verde → amarillo → rojo en función de la divergencia.
 * `divergence` se asume en [0, 1]. Usá esto cuando querés señal fina (un topic
 * a 0.55 se ve casi naranja; uno a 0.20 se ve verde-amarillento). Para señal
 * por bandas discretas, usá colorForBand.
 */
export function colorForDivergence(divergence: number): string {
  const d = Math.max(0, Math.min(1, divergence));
  // Dos tramos lineales: 0..0.5 verde→amarillo, 0.5..1 amarillo→rojo.
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  let r: number, g: number, b: number;
  if (d <= 0.5) {
    const t = d / 0.5; // 0..1
    // green (#10b981) → yellow (#eab308)
    r = lerp(0x10, 0xea, t);
    g = lerp(0xb9, 0xb3, t);
    b = lerp(0x81, 0x08, t);
  } else {
    const t = (d - 0.5) / 0.5; // 0..1
    // yellow (#eab308) → red (#ef4444)
    r = lerp(0xea, 0xef, t);
    g = lerp(0xb3, 0x44, t);
    b = lerp(0x08, 0x44, t);
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function labelForBand(band: DivergenceBand): string {
  switch (band) {
    case "low":
      return "Baja";
    case "medium":
      return "Media";
    case "high":
      return "Alta";
  }
}
