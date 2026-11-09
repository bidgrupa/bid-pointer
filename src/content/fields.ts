/** Form fields in Pointer's shadow UI: growing text fields, fitting pickers, and a task's review. */
import type { TaskDraft } from '../shared/types';

/**
 * Text fields grow with their text through CSS `field-sizing`, which Firefox doesn't support
 * yet. There, grow them by hand, up to the CSS max-height.
 */
const GROWS_ON_ITS_OWN = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

export function autoGrow(field: HTMLTextAreaElement) {
  if (GROWS_ON_ITS_OWN) return;
  const fit = () => {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + (field.offsetHeight - field.clientHeight)}px`;
  };
  field.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Without `field-sizing`, a <select> is as wide as its longest option; size it to the chosen one. */
export function fitSelect(select: HTMLSelectElement | null) {
  if (GROWS_ON_ITS_OWN || !select) return;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return;
  const cs = getComputedStyle(select);
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = select.selectedOptions[0]?.textContent ?? '';
  const chrome = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k as 'paddingLeft']) || 0), 0);
  select.style.width = `${Math.ceil(measureCtx.measureText(text).width + chrome + 4)}px`;
}

/** A quick shake, for something that can't go yet (an empty note, no project chosen). */
export function shake(el: Element | null) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(3px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 300, easing: 'ease-out' },
  );
}

/**
 * Wires a review's two fields: Enter in the name, or Ctrl+Enter in either, sends it; the
 * description keeps Enter for new lines. Focuses the name. Returns the send function, or null
 * when the container shows no review.
 */
export function wireReview(container: HTMLElement, draft: TaskDraft, done: (d: TaskDraft) => void, onInput: () => void): (() => void) | null {
  // a comment's review has no name field
  const name = container.querySelector<HTMLTextAreaElement>('.review-title');
  const description = container.querySelector<HTMLTextAreaElement>('.review-description');
  if (!description) return null;
  const send = () => done({ name: name?.value.replace(/\s+/g, ' ').trim() || draft.name, description: description.value });
  name?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  description.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });
  for (const field of [name, description]) {
    if (!field) continue;
    field.addEventListener('input', onInput);
    autoGrow(field);
  }
  const first = name ?? description;
  first.focus();
  first.setSelectionRange(first.value.length, first.value.length);
  return send;
}
