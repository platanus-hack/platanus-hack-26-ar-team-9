/**
 * Hexagonal grid layout utilities for organizing clusters in a honeycomb pattern
 */

export interface HexPoint {
  x: number;
  y: number;
  q: number; // axial coordinate
  r: number; // axial coordinate
}

export interface HexSize {
  width: number;
  height: number;
}

/**
 * Convert axial hex coordinates to pixel coordinates
 */
export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const y = size * (3 / 2 * r);
  return { x, y };
}

/**
 * Convert pixel coordinates to axial hex coordinates
 */
export function pixelToHex(x: number, y: number, size: number): { q: number; r: number } {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
  const r = (2 / 3 * y) / size;
  return hexRound(q, r);
}

/**
 * Round fractional axial coordinates to nearest hex
 */
export function hexRound(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  
  const q_diff = Math.abs(rq - q);
  const r_diff = Math.abs(rr - r);
  const s_diff = Math.abs(rs - s);
  
  if (q_diff > r_diff && q_diff > s_diff) {
    rq = -rr - rs;
  } else if (r_diff > s_diff) {
    rr = -rq - rs;
  }
  
  return { q: rq, r: rr };
}

/**
 * Generate hexagonal grid points in a spiral pattern
 */
export function generateHexagonalSpiral(
  centerX: number,
  centerY: number,
  hexSize: number,
  count: number
): HexPoint[] {
  const points: HexPoint[] = [];
  
  // Start with center hex
  if (count > 0) {
    points.push({
      x: centerX,
      y: centerY,
      q: 0,
      r: 0
    });
  }
  
  if (count <= 1) return points;
  
  // Generate spiral outward
  let q = 0;
  let r = 0;
  let radius = 1;
  let direction = 0;
  const directions = [
    [1, 0],   // east
    [1, -1],  // southeast
    [0, -1],  // southwest
    [-1, 0],  // west
    [-1, 1],  // northwest
    [0, 1]    // northeast
  ];
  
  for (let i = 1; i < count; i++) {
    // Move to next hex
    const [dq, dr] = directions[direction];
    q += dq;
    r += dr;
    
    // Convert to pixel coordinates
    const pixel = hexToPixel(q, r, hexSize);
    points.push({
      x: centerX + pixel.x,
      y: centerY + pixel.y,
      q,
      r
    });
    
    // Check if we need to turn (completing a ring)
    if (i === 3 * radius * (radius + 1) - 1 && i < count - 1) {
      radius++;
      direction = 0;
    } else if (direction < 5) {
      direction++;
    } else {
      direction = 0;
    }
  }
  
  return points;
}

/**
 * Generate hexagonal grid in a rectangular pattern
 */
export function generateHexagonalGrid(
  centerX: number,
  centerY: number,
  hexSize: number,
  cols: number,
  rows: number
): HexPoint[] {
  const points: HexPoint[] = [];
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Offset every other row for hexagonal packing
      const q = col - Math.floor(row / 2);
      const r = row;
      
      const pixel = hexToPixel(q, r, hexSize);
      points.push({
        x: centerX + pixel.x - (cols * hexSize * Math.sqrt(3)) / 2,
        y: centerY + pixel.y - (rows * hexSize * 1.5) / 2,
        q,
        r
      });
    }
  }
  
  return points;
}

/**
 * Calculate optimal hex size for given area and number of points
 */
export function calculateOptimalHexSize(
  areaWidth: number,
  areaHeight: number,
  pointCount: number
): number {
  // Estimate grid dimensions needed
  const aspectRatio = areaWidth / areaHeight;
  const estimatedCells = Math.ceil(pointCount * 1.3); // 30% extra space for better spacing
  
  // Try different grid configurations
  let bestSize = 0;
  let minWaste = Infinity;
  
  for (let cols = 1; cols <= Math.ceil(Math.sqrt(estimatedCells * aspectRatio)); cols++) {
    const rows = Math.ceil(estimatedCells / cols);
    const hexWidth = Math.sqrt(3) * cols;
    const hexHeight = 1.5 * rows;
    
    const sizeX = areaWidth / hexWidth;
    const sizeY = areaHeight / hexHeight;
    const size = Math.min(sizeX, sizeY);
    
    const waste = (cols * rows - pointCount) / pointCount;
    
    if (waste < minWaste && size > 25) { // Minimum hex size of 25px
      minWaste = waste;
      bestSize = size;
    }
  }
  
  return Math.max(bestSize, 40); // Minimum 40px hex size for better visibility
}

/**
 * Get hexagonal distance between two points
 */
export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

/**
 * Get neighbors of a hex in axial coordinates
 */
export function getHexNeighbors(q: number, r: number): { q: number; r: number }[] {
  return [
    { q: q + 1, r: r },     // east
    { q: q + 1, r: r - 1 }, // southeast
    { q: q, r: r - 1 },     // southwest
    { q: q - 1, r: r },     // west
    { q: q - 1, r: r + 1 }, // northwest
    { q: q, r: r + 1 },     // northeast
  ];
}
