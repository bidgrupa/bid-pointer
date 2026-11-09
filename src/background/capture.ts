import type { CaptureRequest, Rect } from '../shared/types';

// bid design tokens (src/styles/tokens.css); canvas can't read CSS variables
const ORANGE = '#ffa173'; // bid-orange
const INK = '#1d1c2c'; // bid-black
const PAPER = '#fdfcfc'; // bid-white
const PAD = 24;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampRect(r: Rect, w: number, h: number): Rect {
  const x0 = clamp(r.x, 0, w);
  const y0 = clamp(r.y, 0, h);
  const x1 = clamp(r.x + r.w, 0, w);
  const y1 = clamp(r.y + r.h, 0, h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

/**
 * The on-page pin (content/ui.css .pin): a comment pin whose one sharp corner sits on the
 * click, so the clicked spot itself stays visible. Its body points up and right unless the
 * image edge is in the way, as on the page. Paper halo, ink edge, orange fill, paper centre.
 */
function drawPin(g: OffscreenCanvasRenderingContext2D, x: number, y: number, s: number, bounds: { w: number; h: number }) {
  const size = 24 * s;
  const flipX = x + size + 4 * s > bounds.w;
  const flipY = y - size - 4 * s < 0;
  const r = (w: number) => w / 2;
  // inset > 0 shrinks the shape toward its centre, inset < 0 grows it (the halo)
  const shape = (inset: number, fill: string) => {
    const w = size - inset * 2;
    const left = flipX ? x - size + inset : x + inset;
    const top = flipY ? y + inset : y - size + inset;
    // radii run top-left, top-right, bottom-right, bottom-left; the tip's corner is square
    const radii = flipY ? (flipX ? [r(w), 0, r(w), r(w)] : [0, r(w), r(w), r(w)]) : flipX ? [r(w), r(w), 0, r(w)] : [r(w), r(w), r(w), 0];
    g.beginPath();
    g.roundRect(left, top, w, w, radii);
    g.fillStyle = fill;
    g.fill();
  };
  g.save();
  g.shadowColor = 'rgba(29, 28, 44, 0.35)';
  g.shadowBlur = 10 * s;
  g.shadowOffsetY = 4 * s;
  shape(-2 * s, PAPER);
  g.restore();
  shape(0, INK);
  shape(2 * s, ORANGE);
  g.beginPath();
  g.arc(flipX ? x - size / 2 : x + size / 2, flipY ? y + size / 2 : y - size / 2, 4 * s, 0, Math.PI * 2);
  g.fillStyle = PAPER;
  g.fill();
}

/**
 * Screenshot of the visible tab, cropped to the block (plus padding), with everything
 * outside the clicked element dimmed, the element outlined and the pin at the click
 * point. Returns a PNG data URL.
 */
export async function captureAndMark(windowId: number, req: CaptureRequest): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const { w: vw, h: vh } = req.viewport;
  const sx = bmp.width / vw; // accounts for devicePixelRatio and browser zoom
  const sy = bmp.height / vh;

  let crop = clampRect({ x: req.block.x - PAD, y: req.block.y - PAD, w: req.block.w + PAD * 2, h: req.block.h + PAD * 2 }, vw, vh);
  if (crop.w < 40 || crop.h < 40) crop = { x: 0, y: 0, w: vw, h: vh };
  const el = clampRect(req.element, vw, vh);

  const canvas = new OffscreenCanvas(Math.max(1, Math.round(crop.w * sx)), Math.max(1, Math.round(crop.h * sy)));
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas unavailable');

  g.drawImage(bmp, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, 0, 0, canvas.width, canvas.height);

  // dim everything, then redraw the clicked element undimmed
  g.fillStyle = 'rgba(29, 28, 44, 0.35)';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const ex = (el.x - crop.x) * sx;
  const ey = (el.y - crop.y) * sy;
  const ew = el.w * sx;
  const eh = el.h * sy;
  if (ew > 0 && eh > 0) {
    g.drawImage(bmp, el.x * sx, el.y * sy, el.w * sx, el.h * sy, ex, ey, ew, eh);
    // an orange line with an ink edge, so it reads on light and dark sites
    const gap = 2 * sx;
    const outline = (width: number, colour: string) => {
      g.beginPath();
      g.roundRect(ex - gap, ey - gap, ew + gap * 2, eh + gap * 2, 4 * sx);
      g.lineWidth = width;
      g.strokeStyle = colour;
      g.stroke();
    };
    outline(5 * sx, INK);
    outline(3 * sx, ORANGE);
  }

  const mx = clamp((req.click.x - crop.x) * sx, 0, canvas.width);
  const my = clamp((req.click.y - crop.y) * sy, 0, canvas.height);
  drawPin(g, mx, my, sx, { w: canvas.width, h: canvas.height });

  bmp.close();
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}
