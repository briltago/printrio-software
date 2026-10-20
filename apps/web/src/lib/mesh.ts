/** Helpers for the bed mesh heatmap. */

export interface MeshStats {
  min: number;
  max: number;
  /** max − min: how far from flat the bed is. */
  range: number;
}

export function meshStats(matrix: number[][]): MeshStats | null {
  const values = matrix.flat().filter(Number.isFinite);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, range: max - min };
}

/** Symmetric extent of the diverging scale, so zero always sits at the neutral midpoint. */
export function divergingExtent(stats: MeshStats | null): number {
  if (!stats) return 0;
  return Math.max(Math.abs(stats.min), Math.abs(stats.max), 0.01);
}

/** Diverging fill: blue below zero, red above, gray at zero (mixed in OKLab). */
export function divergingColor(z: number, extent: number): string {
  const share = Math.round(Math.min(1, Math.abs(z) / extent) * 100);
  const pole = z < 0 ? "var(--color-diverging-low)" : "var(--color-diverging-high)";
  return `color-mix(in oklab, ${pole} ${share}%, var(--color-diverging-mid))`;
}

/** Bed coordinate of grid index `i` of `count` points between `from` and `to`. */
export function gridCoordinate(i: number, count: number, from: number, to: number): number {
  if (count <= 1) return from;
  return from + ((to - from) * i) / (count - 1);
}

export const formatMm = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(3)} mm`;
