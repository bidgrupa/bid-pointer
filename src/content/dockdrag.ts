import { cornerSpot, nearestCorner, type Corner } from '../shared/corner';
import { SpinMeter } from '../shared/spin';

/*
 * Dragging the dock (Publish task and the launcher) into another corner of the window.
 *
 * A press on the dock stays a click until it moves a few pixels. Then the dock lifts and follows
 * the pointer, a dashed line runs from the launcher to where it would land in the nearest corner
 * (the quarter of the window the pointer is in), and a ring marks that spot, gliding across when
 * the nearest corner changes. On release the dock flies into the corner with a little overshoot,
 * reeling the line in, and the ring ripples as it lands. Esc puts it back where it was.
 */

/** Space between the dock and the window's edges (ui.css .dock). */
const MARGIN = 20;
/** How far a press moves before it's a drag and not a click. */
const THRESHOLD = 6;
/** How lazily the ring follows a change of corner: it covers about two thirds of the way in this long. */
const GLIDE_MS = 70;
/** The flight into the corner (the line reels in behind it), then the ring's ripple as it arrives. */
const LAND_MS = 420;
const RIPPLE_DELAY_MS = LAND_MS * 0.5;
const RIPPLE_MS = 560;
const OVERSHOOT = 'cubic-bezier(0.22, 1.3, 0.36, 1)';
/** The ring's radius (SHELL in view.ts); the line stops short of it. */
const RING = 16;

type Point = { x: number; y: number };

export interface DockHooks {
  /** A corner chosen by dragging, to remember. */
  moved(corner: Corner): void;
  /** How fast the drag is going round in circles (turns per second), on every move. */
  spun?(turnsPerSecond: number): void;
  /** A drag is over: let go of, or put back with Esc. */
  released?(): void;
}

interface Press {
  id: number;
  start: Point;
  /** Where in the dock it was pressed. */
  grab: Point;
  /** The dock where it was picked up. */
  rect: DOMRect;
  dragging: boolean;
  /** Esc put it back; the press still has to end, and its click is swallowed. */
  cancelled: boolean;
  /** Where it would land now. */
  corner: Corner;
}

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motion.matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const centre = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
/** The window as fixed elements see it: without its scrollbars. */
const viewport = () => ({
  width: Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth),
  height: Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight),
});

export class DockDrag {
  private current: Corner | null = null;
  private press: Press | null = null;
  private ring: Point = { x: 0, y: 0 };
  private raf = 0;
  private last = 0;
  /** Until when the guide stays up after a drop: the line reels in, the ring ripples. */
  private landUntil = 0;
  private flights: Animation[] = [];
  private swallowClick = false;
  /** How fast the drag goes round in circles, for the easter egg (confetti.ts). */
  private readonly spin = new SpinMeter();
  private readonly launcher: HTMLElement;
  private readonly track: SVGLineElement;
  private readonly line: SVGLineElement;
  private readonly mark: SVGGElement;
  private readonly pop: SVGGElement;
  private readonly ripple: SVGCircleElement;

  /**
   * `host` carries the corner as data-corner, which ui.css places everything by; `guide` is the
   * line-and-ring overlay.
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly dock: HTMLElement,
    private readonly guide: SVGSVGElement,
    private readonly hooks: DockHooks,
  ) {
    const q = <T extends Element>(sel: string, from: ParentNode = guide) => from.querySelector(sel) as T;
    this.launcher = q('.launcher', dock);
    this.track = q('.dock-guide-track');
    this.line = q('.dock-guide-line');
    this.mark = q('.dock-guide-mark');
    this.pop = q('.dock-guide-pop');
    this.ripple = q('.dock-guide-ripple');
    dock.addEventListener('pointerdown', this.onDown);
    // the click that ends a drag isn't one: the launcher mustn't toggle, nor Publish task publish
    dock.addEventListener(
      'click',
      (e) => {
        if (!this.swallowClick) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  }

  get corner(): Corner | null {
    return this.current;
  }

  get dragging(): boolean {
    return Boolean(this.press?.dragging && !this.press.cancelled);
  }

  /** Puts the dock in `corner` (chosen in another tab, say); flown there when it's on screen. */
  place(corner: Corner, animate = false) {
    if (corner === this.current || this.dragging) return;
    if (animate && this.current && this.dock.getClientRects().length) this.fly(() => this.apply(corner));
    else this.apply(corner);
  }

  /** Esc while dragging: back to where it was. False when there's no drag to cancel. */
  cancel(): boolean {
    const p = this.press;
    if (!p?.dragging || p.cancelled || !this.current) return false;
    p.cancelled = true;
    this.land(this.current);
    this.hooks.released?.();
    return true;
  }

  private apply(corner: Corner) {
    this.current = corner;
    this.host.dataset.corner = corner;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary || this.press || !this.current) return;
    const rect = this.dock.getBoundingClientRect();
    this.press = {
      id: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      grab: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      rect,
      dragging: false,
      cancelled: false,
      corner: this.current,
    };
    // on the window until it's a drag: a quick flick can leave the dock before the first move
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
  };

  private onMove = (e: PointerEvent) => {
    const p = this.press;
    if (!p || e.pointerId !== p.id || p.cancelled) return;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) < THRESHOLD) return;
      this.begin(p);
    }
    const { width, height } = viewport();
    const x = clamp(e.clientX - p.grab.x, 0, width - p.rect.width);
    const y = clamp(e.clientY - p.grab.y, 0, height - p.rect.height);
    this.dock.style.translate = `${x - p.rect.left}px ${y - p.rect.top}px`;
    const corner = nearestCorner(e.clientX, e.clientY, width, height);
    if (corner !== p.corner) {
      p.corner = corner;
      this.bounce();
    }
    this.hooks.spun?.(this.spin.sample(e.clientX, e.clientY, performance.now()));
  };

  private onUp = (e: PointerEvent) => {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    this.press = null;
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onUp, true);
    if (!p.dragging) return; // a click: the buttons take it from here
    this.swallowClick = true;
    window.setTimeout(() => (this.swallowClick = false), 0);
    if (p.cancelled) return;
    // a cancelled pointer (the browser took over the touch, say) goes back like Esc
    const corner = e.type === 'pointercancel' ? (this.current ?? p.corner) : p.corner;
    const changed = corner !== this.current;
    this.land(corner);
    this.hooks.released?.();
    if (changed) this.hooks.moved(corner);
  };

  private begin(p: Press) {
    p.dragging = true;
    this.spin.reset();
    for (const f of this.flights) f.cancel();
    this.flights = [];
    try {
      this.dock.setPointerCapture(p.id); // keeps the drag over iframes too
    } catch {
      // the pointer is already gone; its pointerup ends this
    }
    this.dock.classList.add('is-dragging');
    if (!reducedMotion()) this.dock.animate([{ scale: '1' }, { scale: '1.04' }], { duration: 140, easing: 'ease-out' });
    this.ring = this.spotFor(p.corner);
    this.landUntil = 0;
    this.draw(centre(this.launcher.getBoundingClientRect()), this.ring);
    this.guide.classList.add('is-visible');
    this.bounce();
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Drops the dock into `corner`; the frame loop reels the line in behind it, then hides the guide. */
  private land(corner: Corner) {
    this.fly(() => {
      for (const a of this.dock.getAnimations()) a.cancel(); // a lift still under way
      this.dock.classList.remove('is-dragging');
      this.dock.style.translate = '';
      this.apply(corner);
    });
    this.landUntil = performance.now() + (reducedMotion() ? 0 : RIPPLE_DELAY_MS + RIPPLE_MS);
    if (!reducedMotion()) {
      this.ripple.animate(
        [
          { transform: 'scale(1)', opacity: 0.8 },
          { transform: 'scale(2.6)', opacity: 0 },
        ],
        { duration: RIPPLE_MS, delay: RIPPLE_DELAY_MS, easing: 'ease-out', fill: 'backwards' },
      );
    }
  }

  /**
   * Runs `change` (which puts the dock somewhere new), then flies each button from where it was
   * to where it is now, so it moves and swaps sides (left corners put the launcher outermost) in
   * one motion.
   */
  private fly(change: () => void) {
    const buttons = [...this.dock.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.hidden);
    const before = buttons.map((b) => b.getBoundingClientRect());
    change();
    for (const f of this.flights) f.cancel();
    this.flights = [];
    if (reducedMotion()) return;
    buttons.forEach((b, i) => {
      const was = before[i]!;
      const now = b.getBoundingClientRect();
      if (!now.width || !was.width) return;
      const from = centre(was);
      const to = centre(now);
      this.flights.push(
        b.animate(
          [
            { translate: `${from.x - to.x}px ${from.y - to.y}px`, scale: `${was.width / now.width}` },
            { translate: '0px 0px', scale: '1' },
          ],
          { duration: LAND_MS, easing: OVERSHOOT },
        ),
      );
    });
  }

  /** The ring's little hop when it appears or changes corner. */
  private bounce() {
    if (reducedMotion()) return;
    this.pop.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 320, easing: OVERSHOOT });
  }

  /** Where the launcher's centre ends up in `corner`: the outermost end of the dock. */
  private spotFor(corner: Corner): Point {
    const { width, height } = viewport();
    const w = this.dock.offsetWidth;
    const h = this.dock.offsetHeight;
    const spot = cornerSpot(corner, w, h, width, height, MARGIN);
    const half = this.launcher.offsetWidth / 2;
    return { x: corner.endsWith('left') ? spot.x + half : spot.x + w - half, y: spot.y + h / 2 };
  }

  private frame = (now: number) => {
    const dt = Math.min(64, now - this.last);
    this.last = now;
    const p = this.press;
    const target = this.spotFor(p && !p.cancelled ? p.corner : (this.current ?? 'bottom-right'));
    const k = reducedMotion() ? 1 : 1 - Math.exp(-dt / GLIDE_MS);
    this.ring = { x: this.ring.x + (target.x - this.ring.x) * k, y: this.ring.y + (target.y - this.ring.y) * k };
    this.draw(centre(this.launcher.getBoundingClientRect()), this.ring);
    if ((p && !p.cancelled) || now < this.landUntil) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.raf = 0;
    this.guide.classList.remove('is-visible');
  };

  /** The line from the launcher to the ring's edge, and the ring. */
  private draw(from: Point, to: Point) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    // stop at the ring; a launcher already on its spot has no line at all
    const reach = Math.max(0, length - RING - 6) / (length || 1);
    const end = { x: from.x + dx * reach, y: from.y + dy * reach };
    for (const l of [this.track, this.line]) {
      l.setAttribute('x1', `${from.x}`);
      l.setAttribute('y1', `${from.y}`);
      l.setAttribute('x2', `${end.x}`);
      l.setAttribute('y2', `${end.y}`);
    }
    this.mark.setAttribute('transform', `translate(${to.x} ${to.y})`);
  }
}
