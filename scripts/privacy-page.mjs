// Renders PRIVACY.md into privacy.html: the page Pointer ships and links from its settings, and the
// one to host at the address the store listings give. PRIVACY.md stays the one text to edit.
// Knows only what PRIVACY.md uses: headings, paragraphs, "- " lists, tables, **bold**, [links](…).

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** One line's inline markdown: links and bold, everything else escaped. */
const inline = (s) =>
  esc(s)
    .replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function body(markdown) {
  const out = [];
  const blocks = markdown.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const heading = /^(#{1,2}) (.*)$/.exec(block);
    if (heading && lines.length === 1) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (lines.every((l) => l.startsWith('- '))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`);
    } else if (lines.length >= 2 && lines.every((l) => l.trim().startsWith('|'))) {
      const [head, , ...rows] = lines;
      const th = cells(head).map((c) => `<th>${inline(c)}</th>`).join('');
      const tr = rows.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
    } else if (/^Last updated: /.test(block)) {
      out.push(`<p class="updated">${inline(block)}</p>`);
    } else {
      out.push(`<p>${inline(lines.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

const STYLE = `
  :root { --ink: #1d1c2c; --ink-2: #5f5e69; --line: #e8e5e0; --paper: #fdfcfc; --link: #8f5537; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 48px 20px 96px; }
  h1 { margin: 0 0 4px; font-size: 32px; line-height: 1.2; }
  h2 { margin: 40px 0 8px; font-size: 20px; }
  .updated { margin: 0; color: var(--ink-2); }
  li + li { margin-top: 6px; }
  a { color: var(--link); }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { padding: 10px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { font-weight: 600; }`;

/** The whole page: self-contained, so the same file works inside Pointer and on any web host. */
export function privacyPage(markdown) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>bid Pointer privacy policy</title>
    <!-- Rendered from PRIVACY.md by scripts/privacy-page.mjs; edit that file, not this one. -->
    <style>${STYLE}
    </style>
  </head>
  <body>
    <main>
${body(markdown)}
    </main>
  </body>
</html>
`;
}
