/*
 * The screen capture redrawn at one picture size for the whole recording.
 *
 * A capture changes size whenever the shared tab does: Chrome and Edge add their "Sharing this
 * tab" bar a moment after sharing starts, which makes the page shorter, and resizing the window
 * does it again. The encoder restarts at the new size, but MediaRecorder's MP4 keeps describing
 * the first one, so every later frame lacks rows the file promises and players fill them with
 * green or flickering garbage along the bottom. (WebM's VP8 carries the size in each keyframe and
 * plays fine, so only MP4 recordings come through here.)
 *
 * So the capture plays into a detached <video> and each new frame is drawn onto a canvas of fixed
 * size: the size the capture settles on once that bar is up. A later frame of another size is
 * scaled to fit, on black. The recorder records the canvas. That's one drawImage per captured
 * frame, at most 15 a second; nothing is decoded or re-encoded on the way.
 */

/** The capture's size has to hold this long before it becomes the recording's size. */
const SETTLE_MS = 400;
/** Recording starts by then even if the size keeps changing (someone dragging the window). */
const SETTLE_MAX_MS = 1_500;
/** No first frame by then: the caller records the capture as it comes. */
const FIRST_FRAME_MS = 3_000;
const POLL_MS = 40;

export interface FixedSize {
  stream: MediaStream;
  width: number;
  height: number;
  /** Ends the canvas stream and lets go of the capture (whose tracks stay the caller's). */
  stop(): void;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const sizeOf = (v: HTMLVideoElement) => `${v.videoWidth}x${v.videoHeight}`;

/** Waits for the first frame, then for the size to hold. False if no frame comes. */
async function settle(video: HTMLVideoElement): Promise<boolean> {
  const start = performance.now();
  while (!video.videoWidth) {
    if (performance.now() - start > FIRST_FRAME_MS) return false;
    await wait(POLL_MS);
  }
  let size = sizeOf(video);
  let since = performance.now();
  const cap = since + SETTLE_MAX_MS;
  while (performance.now() - since < SETTLE_MS && performance.now() < cap) {
    await wait(POLL_MS);
    if (sizeOf(video) !== size) {
      size = sizeOf(video);
      since = performance.now();
    }
  }
  return true;
}

/** `source` at one size from start to end, or null when that can't be had (record `source` then). */
export async function fixedSize(source: MediaStream, fps: number): Promise<FixedSize | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = source;
  void video.play().catch(() => {});
  const release = () => {
    video.pause();
    video.srcObject = null;
  };
  if (!(await settle(video))) {
    release();
    return null;
  }
  // encoders want even sides; an odd one loses its last row or column
  const width = video.videoWidth & ~1;
  const height = video.videoHeight & ~1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx || !width || !height || typeof canvas.captureStream !== 'function') {
    release();
    return null;
  }
  const draw = () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    if ((w & ~1) === width && (h & ~1) === height) {
      ctx.drawImage(video, 0, 0);
      return;
    }
    const scale = Math.min(width / w, height / h);
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, Math.round((width - dw) / 2), Math.round((height - dh) / 2), dw, dh);
  };
  draw();
  const stream = canvas.captureStream(fps);
  let stopped = false;
  let timer = 0;
  // a draw for each new frame where the browser announces them (Firefox from 132), else on a clock
  if ('requestVideoFrameCallback' in video) {
    const next = () => {
      if (stopped) return;
      draw();
      video.requestVideoFrameCallback(next);
    };
    video.requestVideoFrameCallback(next);
  } else timer = window.setInterval(draw, 1000 / fps);
  return {
    stream,
    width,
    height,
    stop() {
      stopped = true;
      window.clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      release();
    },
  };
}
