// Shared by the smoke tests: a recording, made as Pointer makes them, of a canvas "capture" that
// changes size partway, as a shared tab does when the browser adds its "Sharing this tab" bar and
// again when the window is resized. Recorded straight, Chrome's and Edge's MP4 keeps the first size
// and every later frame comes out with a green, garbled strip along the bottom (0.6.1); through
// fixedSize() (src/content/fixedsize.ts) every frame keeps one size and its real bottom edge.
import * as esbuild from 'esbuild';

/** fixedsize.ts as a page script: window.PointerFixedSize.fixedSize. */
export async function fixedSizeScript() {
  const out = await esbuild.build({
    entryPoints: ['src/content/fixedsize.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'PointerFixedSize',
    write: false,
    target: 'es2022',
  });
  return out.outputFiles[0].text;
}

/**
 * In the page: about three seconds of a grey canvas with a blue band along its bottom edge, which
 * gets shorter after 250 ms and changes shape at 2 s. Returns the recording's type, the size
 * fixedSize() settled on, the sizes the decoded frames came in, and how many of them don't end in
 * the blue band.
 */
export async function resizingRecording() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const src = document.createElement('canvas');
  src.width = 1000;
  src.height = 620;
  const g = src.getContext('2d');
  let n = 0;
  const paint = () => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, src.width, src.height);
    g.fillStyle = '#fff';
    g.fillRect((n++ * 23) % (src.width - 100), 100, 100, 100);
    g.fillStyle = '#3060c0';
    g.fillRect(0, src.height - 40, src.width, 40);
  };
  paint();
  const timer = setInterval(paint, 1000 / 15);
  const source = src.captureStream(15);
  const t0 = performance.now();
  setTimeout(() => ((src.height = 580), paint()), 250); // the sharing bar
  setTimeout(() => ((src.width = 900), (src.height = 600), paint()), 2000); // the window resized
  const fixed = await window.PointerFixedSize.fixedSize(source, 15);
  if (!fixed) return { error: 'fixedSize() gave up' };
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(fixed.stream, { mimeType, videoBitsPerSecond: 1_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  await sleep(3200 - (performance.now() - t0));
  await new Promise((r) => ((rec.onstop = r), rec.stop()));
  clearInterval(timer);
  fixed.stop();
  for (const track of source.getTracks()) track.stop();

  const v = document.createElement('video');
  v.muted = true;
  document.body.append(v);
  v.src = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
  await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = () => j(new Error(String(v.error?.message))))));
  const c = document.createElement('canvas');
  const cg = c.getContext('2d', { willReadFrequently: true });
  const frames = [];
  await new Promise((done) => {
    const step = (_, m) => {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      cg.drawImage(v, 0, 0);
      const band = cg.getImageData(0, c.height - 12, c.width, 12).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < band.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += band[i + k];
      const [r, gr, b] = sum.map((s) => s / (band.length / 4));
      frames.push({ size: `${m.width}x${m.height}`, blue: b > r + 50 && b > gr + 30 });
      if (!v.ended) v.requestVideoFrameCallback(step);
    };
    v.requestVideoFrameCallback(step);
    v.onended = done;
    v.play();
    setTimeout(done, 8000);
  });
  URL.revokeObjectURL(v.src);
  v.remove();
  return {
    mimeType: rec.mimeType,
    fixed: `${fixed.width}x${fixed.height}`,
    frames: frames.length,
    sizes: [...new Set(frames.map((f) => f.size))],
    brokenBottoms: frames.filter((f) => !f.blue).length,
  };
}
