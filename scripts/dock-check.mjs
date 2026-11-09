// Shared by the smoke tests: dragging the dock (Publish task and the launcher) to another corner
// of the window (src/content/dockdrag.ts), with real mouse input.

/** The dock as the page shows it: its corner, the launcher's box and the drag guide. */
export const dockState = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('#bid-pointer');
    const root = host.shadowRoot;
    const box = (s) => {
      const b = root.querySelector(s).getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const [, mx, my] = (root.querySelector('.dock-guide-mark').getAttribute('transform') ?? '').match(/translate\(([-\d.]+) ([-\d.]+)\)/) ?? [];
    const line = root.querySelector('.dock-guide-line');
    return {
      corner: host.dataset.corner,
      launcher: box('.launcher'),
      dragging: root.querySelector('.dock').classList.contains('is-dragging'),
      guide: root.querySelector('.dock-guide').classList.contains('is-visible'),
      ring: mx ? { x: Number(mx), y: Number(my) } : null,
      lineEnd: { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) },
      active: root.querySelector('.launcher').classList.contains('is-active'),
      viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    };
  });

/** Presses the launcher and drags it to (x, y) in steps, without letting go. */
export async function pressAndDrag(page, x, y, steps = 12) {
  const { launcher: l } = await dockState(page);
  const from = { x: l.x + l.w / 2, y: l.y + l.h / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps);
}

/** Where the launcher's centre lands in `corner`: 20px in from the edges, outermost in the dock. */
export function launcherSpot(corner, launcher, viewport) {
  return {
    x: corner.endsWith('left') ? 20 + launcher.w / 2 : viewport.w - 20 - launcher.w / 2,
    y: corner.startsWith('top') ? 20 + launcher.h / 2 : viewport.h - 20 - launcher.h / 2,
  };
}

/** Where the recording bar and the review sheet sit (both follow the dock). */
export const followers = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('#bid-pointer').shadowRoot;
    const at = (s) => {
      const cs = getComputedStyle(root.querySelector(s));
      return `${cs.left},${cs.top}`;
    };
    return { recbar: at('.recbar'), sheet: at('.sheet') };
  });

// ---------- the easter egg: spin it and it throws confetti (src/content/confetti.ts) ----------

/** Whether the button is throwing confetti, whether it's gone wild (spun for a good while), and whether any is on screen. */
export const partyState = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('#bid-pointer');
    return {
      partying: host.classList.contains('is-partying'),
      wild: host.classList.contains('is-wild'),
      shown: !host.shadowRoot.querySelector('.confetti').hidden,
    };
  });

/**
 * How solid the confetti on screen is: the average opacity of the pixels it covers (0-255), and the
 * share of them that are fully solid. Fading pieces aren't solid anywhere except where several
 * overlap, so that share collapses the moment they start to fade. Also whether it's still being thrown.
 */
export const confettiAlpha = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('#bid-pointer');
    const canvas = host.shadowRoot.querySelector('.confetti');
    let covered = 0;
    let solid = 0;
    let sum = 0;
    if (!canvas.hidden && canvas.width) {
      const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < px.length; i += 4) {
        if (!px[i]) continue;
        covered++;
        sum += px[i];
        if (px[i] >= 250) solid++;
      }
    }
    return {
      mean: covered ? Math.round(sum / covered) : 0,
      solid: covered ? Number((solid / covered).toFixed(2)) : 0,
      partying: host.classList.contains('is-partying'),
    };
  });

/** With the button held, circles the pointer round `centre` for `ms`, at real speed. */
export async function spinDock(page, centre, radius, turnsPerSecond, ms) {
  const t0 = Date.now();
  for (let t = 0; t < ms; t = Date.now() - t0) {
    const a = (2 * Math.PI * turnsPerSecond * t) / 1000;
    await page.mouse.move(centre.x + radius * Math.cos(a), centre.y + radius * Math.sin(a));
  }
}

/** With the button held, shakes the pointer side to side round `centre` for `ms`. */
export async function wiggleDock(page, centre, reach, perSecond, ms) {
  const t0 = Date.now();
  for (let t = 0; t < ms; t = Date.now() - t0) {
    await page.mouse.move(centre.x + reach * Math.sin((2 * Math.PI * perSecond * t) / 1000), centre.y);
  }
}
