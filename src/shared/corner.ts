/** Where the dock (Publish task and the launcher) sits: any corner of the window, dragged there. */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const DEFAULT_CORNER: Corner = 'bottom-right';

export const isCorner = (v: unknown): v is Corner => typeof v === 'string' && (CORNERS as readonly string[]).includes(v);

/** The corner nearest a point in a width×height window: the quarter of the window it's in. */
export function nearestCorner(x: number, y: number, width: number, height: number): Corner {
  const v = y < height / 2 ? 'top' : 'bottom';
  const h = x < width / 2 ? 'left' : 'right';
  return `${v}-${h}`;
}

/** Top-left of a w×h box sitting in `corner`, `margin` in from both edges. */
export function cornerSpot(corner: Corner, w: number, h: number, width: number, height: number, margin: number): { x: number; y: number } {
  return {
    x: corner.endsWith('left') ? margin : width - margin - w,
    y: corner.startsWith('top') ? margin : height - margin - h,
  };
}
