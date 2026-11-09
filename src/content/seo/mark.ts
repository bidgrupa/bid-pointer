/**
 * Show, in the SEO panel: scrolls an element into view and rings it on the page for a few seconds,
 * following it as the page scrolls. An element that isn't laid out (in a closed slide or menu)
 * can't be shown, nor one the page has since replaced; the caller says so.
 */
const SHOW_MS = 3500;

export class SeoMark {
  private target: Element | null = null;
  private until = 0;
  private raf = 0;

  constructor(private readonly box: HTMLElement) {}

  show(el: Element | undefined, label: string): 'shown' | 'hidden' | 'gone' {
    if (!el?.isConnected) return 'gone';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'hidden';
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: still ? 'instant' : 'smooth' });
    this.target = el;
    this.until = performance.now() + SHOW_MS;
    const tab = this.box.querySelector('.seo-mark-tab');
    if (tab) tab.textContent = label;
    // replays the ring's entrance
    this.box.classList.remove('is-visible');
    void this.box.offsetWidth;
    this.box.classList.add('is-visible');
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.follow);
    return 'shown';
  }

  hide() {
    this.target = null;
    cancelAnimationFrame(this.raf);
    this.box.classList.remove('is-visible');
  }

  private follow = (now: number) => {
    const el = this.target;
    if (!el?.isConnected || now > this.until) return this.hide();
    const r = el.getBoundingClientRect();
    this.box.style.left = `${r.left}px`;
    this.box.style.top = `${r.top}px`;
    this.box.style.width = `${r.width}px`;
    this.box.style.height = `${r.height}px`;
    this.box.classList.toggle('is-inside', r.top < 30);
    this.raf = requestAnimationFrame(this.follow);
  };
}
