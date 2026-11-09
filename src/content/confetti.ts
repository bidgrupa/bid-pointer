import { MIN_SPIN, Party } from '../shared/spin';

/*
 * An easter egg: spin the Pointer button round in quick circles while dragging it and it starts
 * throwing confetti, more of it and further the longer it spins. It keeps throwing while it's
 * dragged about; held still for three seconds it throws one last handful and stops. Let go, it
 * stops throwing at once and every piece starts fading as it falls, gone a moment later.
 * (The physics is shared/spin.ts.)
 *
 * The confetti is drawn on a canvas over the whole window, under the button, so it comes out from
 * behind it. Each piece is thrown with some of the button's own speed, so a spinning button flings
 * it outward, then it tumbles and flutters down off the bottom of the window. Nothing runs until
 * something spins fast enough to get going, and once the last piece has fallen the canvas is
 * cleared and hidden and the loop stops.
 */

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Paper is w×h; a sequin is round, w across. */
  w: number;
  h: number;
  round: boolean;
  colour: string;
  /** Its back, a shade darker, seen as it flips over. */
  back: string;
  /** Turning in the plane of the screen (rad, rad/s)... */
  angle: number;
  turn: number;
  /** ...and tumbling end over end (rad, rad/s). */
  flip: number;
  tumble: number;
  /** Where in its side-to-side flutter it is. */
  sway: number;
  age: number;
  /** Its age when the button was let go of, from when it fades away; null until then. */
  fadeFrom: number | null;
}

type Point = { x: number; y: number };

/** bid's oranges and ink, with gold and two brighter colours so it reads as a party; each with its back. */
const COLOURS: [string, string][] = [
  ['#ffa173', '#e07e52'],
  ['#ffba90', '#e39a70'],
  ['#b27050', '#8d543a'],
  ['#1d1c2c', '#3a3950'],
  ['#f5c04a', '#cf9b2c'],
  ['#4fb3a9', '#378c84'],
  ['#f0859e', '#cc6680'],
];

/** Paper falls slowly: mostly air. It settles at about 200px a second. */
const GRAVITY = 500;
const DRAG = 2.5;
/** Pieces older than this fade out wherever they are; more than this many at once and the oldest go. */
const MAX_AGE_S = 7;
/** Let go of, the confetti out there fades away over this long. */
const FADE_S = 1.2;
const MAX_PIECES = 1400;
/** A spin counts as fresh for this long; the drag reports it on every move. */
const SPIN_FRESH_MS = 150;
/** How quickly the drawn party follows the spinning (seconds to cover about two thirds). */
const FOLLOW_S = 0.5;

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export class Confetti {
  private readonly party = new Party();
  private readonly ctx: CanvasRenderingContext2D | null;
  private pieces: Piece[] = [];
  /** The party as drawn, easing toward its intensity. */
  private level = 0;
  private spinRate = 0;
  private spinAt = 0;
  private raf = 0;
  private last = 0;
  private prev: Point | null = null;
  /** A fraction of a piece carried between frames, so slow rates still throw some. */
  private owed = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private readonly launcher: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d');
    canvas.hidden = true;
  }

  /** The button was let go of: no more confetti, and what's out there starts fading as it falls, now. */
  release() {
    if (!this.raf) return;
    this.party.stop();
    this.owed = 0;
    this.level = 0;
    this.host.classList.remove('is-partying', 'is-wild');
    for (const p of this.pieces) p.fadeFrom ??= p.age;
  }

  /** The drag's spin right now, in turns per second. */
  spin(turnsPerSecond: number) {
    if (motion.matches || !this.ctx) return;
    this.spinRate = turnsPerSecond;
    this.spinAt = performance.now();
    if (!this.raf && turnsPerSecond >= MIN_SPIN) {
      this.canvas.hidden = false;
      this.last = performance.now();
      this.prev = null;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    const box = this.launcher.getBoundingClientRect();
    const shown = box.width > 0;
    const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const step = this.prev ? { x: at.x - this.prev.x, y: at.y - this.prev.y } : { x: 0, y: 0 };
    this.prev = at;
    const moving = shown && Math.hypot(step.x, step.y) > 0.3;
    const spin = now - this.spinAt < SPIN_FRESH_MS ? this.spinRate : 0;

    const event = this.party.step(dt, spin, moving);
    if (event === 'start') {
      this.host.classList.add('is-partying');
      if (shown) {
        this.launcher.animate([{ scale: '1' }, { scale: '1.12' }, { scale: '1' }], { duration: 360, easing: 'ease-out' });
        this.throw(70, box, { x: 0, y: 0 }, 1.25);
      }
    } else if (event === 'end') {
      this.host.classList.remove('is-partying', 'is-wild');
      if (shown) this.throw(45, box, { x: 0, y: 0 }, 1.1); // one last handful
    }
    this.level = this.party.on ? this.level + (this.party.intensity - this.level) * (1 - Math.exp(-dt / FOLLOW_S)) : 0;
    this.host.classList.toggle('is-wild', this.party.on && this.level > 0.7);

    if (this.party.on && shown) {
      this.owed += (30 + 230 * this.level) * dt;
      const count = Math.floor(this.owed);
      this.owed -= count;
      this.throw(count, box, step, 1, dt);
    }
    this.fall(dt);
    this.draw();

    if (this.party.on || this.party.energy > 0 || this.pieces.length) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.raf = 0;
    this.canvas.hidden = true;
  };

  /**
   * Throws `count` pieces up out of the button, `power` times as hard as usual. With `dt`, the
   * button moved by `step` in that time: the pieces are spread along the way it came and carry
   * some of its speed, so a fast button flings a smooth stream outward.
   */
  private throw(count: number, box: DOMRect, step: Point, power: number, dt?: number) {
    const l = this.level;
    const velocity = dt ? { x: step.x / dt, y: step.y / dt } : { x: 0, y: 0 };
    for (let i = 0; i < count; i++) {
      const back = dt ? Math.random() : 0;
      const direction = -Math.PI / 2 + rand(-0.9, 0.9); // a cone, mostly up
      const speed = rand(250, 520) * (0.7 + 0.8 * l) * power;
      const [colour, shade] = COLOURS[Math.floor(Math.random() * COLOURS.length)]!;
      const kind = Math.random();
      const ribbon = l > 0.5 && kind < 0.2; // long thin strips once it gets going
      const round = !ribbon && kind > 0.85;
      this.pieces.push({
        x: rand(box.left + 10, box.right - 10) - step.x * back,
        y: rand(box.top, box.top + box.height * 0.4) - step.y * back,
        vx: Math.cos(direction) * speed + velocity.x * 0.6,
        vy: Math.sin(direction) * speed + velocity.y * 0.6,
        w: ribbon ? 3 : round ? rand(5, 7) : rand(6, 10),
        h: ribbon ? rand(12, 18) : rand(3, 5.5),
        round,
        colour,
        back: shade,
        angle: rand(0, Math.PI * 2),
        turn: rand(-12, 12),
        flip: rand(0, Math.PI * 2),
        tumble: rand(6, 16),
        sway: rand(0, Math.PI * 2),
        age: 0,
        fadeFrom: null,
      });
    }
    if (this.pieces.length > MAX_PIECES) this.pieces.splice(0, this.pieces.length - MAX_PIECES);
  }

  private fall(dt: number) {
    const drag = Math.exp(-DRAG * dt);
    const floor = this.canvas.clientHeight + 40;
    for (const p of this.pieces) {
      p.age += dt;
      p.vx *= drag;
      p.vy = p.vy * drag + GRAVITY * dt;
      // paper doesn't fall straight: it flutters side to side
      p.x += (p.vx + Math.sin(p.age * 4 + p.sway) * 45) * dt;
      p.y += p.vy * dt;
      p.angle += p.turn * dt;
      p.flip += p.tumble * dt;
    }
    this.pieces = this.pieces.filter((p) => p.age < MAX_AGE_S && p.y < floor && (p.fadeFrom === null || p.age - p.fadeFrom < FADE_S));
  }

  private draw() {
    const ctx = this.ctx!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    for (const p of this.pieces) {
      // turned in the plane, then squashed by its tumble: it shows its back when it's over
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      const tilt = Math.cos(p.flip);
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin * tilt, dpr * cos * tilt, dpr * p.x, dpr * p.y);
      const old = p.age > MAX_AGE_S - 0.6 ? (MAX_AGE_S - p.age) / 0.6 : 1;
      const letGo = p.fadeFrom === null ? 1 : 1 - (p.age - p.fadeFrom) / FADE_S;
      ctx.globalAlpha = Math.max(0, Math.min(old, letGo));
      ctx.fillStyle = tilt >= 0 ? p.colour : p.back;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
}
