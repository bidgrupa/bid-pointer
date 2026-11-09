import type { BlockInfo, ElementInfo } from '../shared/types';

const LABEL_RE = /^\[(.+?) - (.+?)\]$/;

/**
 * DebugBlock.tsx (pages-template) renders:
 *   <div class="relative …">
 *     <div class="hidden md:absolute …"><span>[BlockName - componentId]</span><button>Δ Block Data</button></div>
 *     {children}
 *   </div>
 * The label div is the wrapper's first child and the span is its first child.
 */
function debugLabel(node: Element): { name: string; id: string } | null {
  const first = node.firstElementChild;
  if (!first || first.tagName !== 'DIV') return null;
  const span = first.firstElementChild;
  if (!span || span.tagName !== 'SPAN') return null;
  const m = (span.textContent ?? '').trim().match(LABEL_RE);
  if (!m || !m[1] || !m[2]) return null;
  return { name: m[1].trim(), id: m[2].trim() };
}

/** Walks up from the clicked element to the nearest CMS block wrapper. */
export function findBlock(start: Element): { el: Element; info: BlockInfo } | null {
  let node: Element | null = start;
  while (node && node !== document.body && node !== document.documentElement) {
    const name = node.getAttribute('data-block-name');
    if (name) {
      return { el: node, info: { name, id: node.getAttribute('data-block-id') ?? '', source: 'data-attr' } };
    }
    const label = debugLabel(node);
    if (label) return { el: node, info: { ...label, source: 'debug-span' } };
    node = node.parentElement;
  }
  return null;
}

const SKIP_TAGS = new Set(['HTML', 'BODY']);

function nodeName(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = Array.from(el.classList).find((c) => /^[a-zA-Z][\w-]*$/.test(c) && !c.includes(':'));
  return cls ? `${tag}.${cls}` : tag;
}

/** Ids React or a UI kit generates (":r1:", "radix-…", long numbers) change between loads. */
const STABLE_ID = /^[A-Za-z][\w-]*$/;
const GENERATED_ID = /^radix-|\d{3,}/;

/**
 * A CSS path that finds the element again after a reload: from the nearest unique, stable id,
 * or from <body>, with nth-of-type wherever siblings share a tag.
 */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    const id = node.id;
    if (id && STABLE_ID.test(id) && !GENERATED_ID.test(id) && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(id)}`);
      return parts.join(' > ');
    }
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const current = node;
    const tag = current.tagName.toLowerCase();
    const same = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
    node = parent;
  }
  parts.unshift('body');
  return parts.join(' > ');
}

/** Short, human-readable path (max 3 levels) plus visible text of the clicked element. */
export function describeElement(el: Element, stopAt: Element | null): ElementInfo {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < 3 && !SKIP_TAGS.has(node.tagName) && node !== stopAt) {
    parts.unshift(nodeName(node));
    node = node.parentElement;
  }
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const text = raw.replace(/\s+/g, ' ').trim();
  return { selector: parts.join(' > '), text: text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text };
}
