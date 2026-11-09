/*
 * The easter egg's physics, kept apart from the drawing (content/confetti.ts) so it can be tested:
 * how fast something being dragged goes round in circles, and how worked up that gets it.
 */

/** Headings come from steps at least this long, so a shaky hand isn't a spin. */
const STEP_PX = 6;
/** A turn this sharp between two steps is a change of mind, not part of a circle. */
const MAX_TURN = 2;
/** Spin is measured over this much of the recent past. */
const WINDOW_MS = 600;

/**
 * Turns per second of the direction of travel over the last moments of a drag. Wiggling back and
 * forth cancels out; going round and round adds up, whatever the circle's size or centre.
 */
export class SpinMeter {
  private anchor: { x: number; y: number } | null = null;
  private heading: number | null = null;
  private turns: { t: number; d: number }[] = [];

  /** Adds the pointer at (x, y) at time t (ms) and returns the spin now. */
  sample(x: number, y: number, t: number): number {
    if (!this.anchor) this.anchor = { x, y };
    const dx = x - this.anchor.x;
    const dy = y - this.anchor.y;
    if (Math.hypot(dx, dy) >= STEP_PX) {
      this.anchor = { x, y };
      const heading = Math.atan2(dy, dx);
      if (this.heading !== null) {
        let d = heading - this.heading;
        if (d > Math.PI) d -= 2 * Math.PI;
        else if (d <= -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) < MAX_TURN) this.turns.push({ t, d });
      }
      this.heading = heading;
    }
    return this.rate(t);
  }

  /** Turns per second over the window ending at t. */
  rate(t: number): number {
    while (this.turns.length && t - this.turns[0]!.t > WINDOW_MS) this.turns.shift();
    const sum = this.turns.reduce((s, turn) => s + turn.d, 0);
    return Math.abs(sum) / (2 * Math.PI) / (WINDOW_MS / 1000);
  }

  reset() {
    this.anchor = null;
    this.heading = null;
    this.turns = [];
  }
}

/** Spinning slower than this (turns per second) does nothing. */
export const MIN_SPIN = 1;
/** Energy gained per turn, at or above MIN_SPIN. */
const ENERGY_PER_TURN = 0.4;
/** The confetti starts at this much energy (about two seconds at one and a half turns a second)... */
export const START_AT = 1;
/** ...and is at its wildest at this much, after several more seconds of spinning. */
export const MAX_ENERGY = 5;
/** Before it starts, energy drains away this fast (per second) when it isn't spinning, so idle wiggles don't add up. */
const FADE_PER_S = 0.8;
/** Standing still this long ends it. */
export const QUIET_MS = 3000;

export type PartyEvent = 'start' | 'end' | null;

/** How worked up the button is: started by spinning, wilder the longer it spins, over after standing still. */
export class Party {
  energy = 0;
  on = false;
  /** How long it has stood still, in ms. */
  still = 0;

  /** Moves on by dt seconds, spinning at `spin` turns per second, moved or not since the last step. */
  step(dt: number, spin: number, moving: boolean): PartyEvent {
    if (spin >= MIN_SPIN) this.energy = Math.min(MAX_ENERGY, this.energy + dt * spin * ENERGY_PER_TURN);
    else if (!this.on) this.energy = Math.max(0, this.energy - dt * FADE_PER_S);
    this.still = moving ? 0 : this.still + dt * 1000;
    if (!this.on && this.energy >= START_AT) {
      this.on = true;
      return 'start';
    }
    if (this.on && this.still >= QUIET_MS) {
      this.on = false;
      this.energy = 0;
      return 'end';
    }
    return null;
  }

  /** Over at once, however it was going. */
  stop() {
    this.on = false;
    this.energy = 0;
    this.still = 0;
  }

  /** 0 when it has just started, 1 at its wildest; 0 when it's over. */
  get intensity(): number {
    return this.on ? Math.min(1, (this.energy - START_AT) / (MAX_ENERGY - START_AT)) : 0;
  }
}
