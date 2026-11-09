/**
 * Building Send to ClickUp's UI (Gmail, HubSpot) without innerHTML. Gmail enforces Trusted Types,
 * under which an HTML string assigned to the DOM can throw; elements made one by one never do.
 */

type Child = Node | string | number | null | undefined | false;

type Props = {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [type, fn] of Object.entries(props.on ?? {})) el.addEventListener(type, fn as EventListener);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';

/** An icon from path data: [tag, attributes] pairs under one <svg>. */
export function icon(viewBox: string, parts: [string, Record<string, string>][], attrs: Record<string, string> = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of parts) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

export const ICON = {
  /** Pointer's comment pin: round, with its one sharp corner bottom left. */
  pin: () =>
    icon('0 0 20 20', [
      ['path', { d: 'M3 17V10a7 7 0 1 1 7 7z', fill: 'currentColor' }],
      ['circle', { cx: '10', cy: '10', r: '2.6', fill: '#fdfcfc' }],
    ]),
  check: () => icon('0 0 16 16', [['path', { ...stroke, 'stroke-width': '2.2', d: 'M3.5 8.5l3 3 6-7' }]]),
  close: () => icon('0 0 16 16', [['path', { ...stroke, 'stroke-width': '1.8', d: 'M4 4l8 8M12 4l-8 8' }]]),
  chevronLeft: () => icon('0 0 16 16', [['path', { ...stroke, 'stroke-width': '1.8', d: 'M10 3.5L5.5 8l4.5 4.5' }]]),
  chevronRight: () => icon('0 0 16 16', [['path', { ...stroke, 'stroke-width': '1.8', d: 'M6 3.5l4.5 4.5L6 12.5' }]]),
  pencil: () =>
    icon('0 0 16 16', [
      ['path', { ...stroke, 'stroke-width': '1.6', d: 'M10.5 2.75l2.75 2.75L5.75 13H3v-2.75z' }],
      ['path', { ...stroke, 'stroke-width': '1.6', d: 'M9 4.25L11.75 7' }],
    ]),
  /** Put back: an arrow turning round. */
  undo: () =>
    icon('0 0 16 16', [
      ['path', { ...stroke, 'stroke-width': '1.6', d: 'M5.5 3.5L3 6l2.5 2.5' }],
      ['path', { ...stroke, 'stroke-width': '1.6', d: 'M3 6h6.5a3.5 3.5 0 0 1 0 7H6' }],
    ]),
  alert: () =>
    icon('0 0 20 20', [
      ['circle', { cx: '10', cy: '10', r: '9', fill: 'currentColor' }],
      ['path', { d: 'M10 5.5v5.25', stroke: '#fdfcfc', 'stroke-width': '2', 'stroke-linecap': 'round' }],
      ['circle', { cx: '10', cy: '14.1', r: '1.15', fill: '#fdfcfc' }],
    ]),
  file: () =>
    icon('0 0 20 20', [
      ['path', { ...stroke, 'stroke-width': '1.5', d: 'M5.5 2.75h6l3.75 3.75v10a.75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75V3.5a.75.75 0 0 1 .75-.75z' }],
      ['path', { ...stroke, 'stroke-width': '1.5', d: 'M11.25 2.75V6.5H15' }],
    ]),
  spinner: () =>
    icon(
      '0 0 20 20',
      [
        ['circle', { cx: '10', cy: '10', r: '7', fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.25', 'stroke-width': '2.5' }],
        ['path', { ...stroke, 'stroke-width': '2.5', d: 'M10 3a7 7 0 0 1 7 7' }],
      ],
      { class: 'spin' },
    ),
};
