// Pages for the SEO tests: a live page where everything is right, changed one thing at a time.

/** What the page script reads from a healthy live page. */
export const snapshot = (over = {}) => ({
  url: 'https://www.cresanka.hr/en/rooms/superior',
  environment: 'production',
  titles: ['Superior room with a sea view | Cresanka'],
  descriptions: ['A bright superior room with a balcony over the bay, breakfast included, five minutes from the beach in Cres.'],
  robots: [{ name: 'robots', content: 'index, follow' }],
  viewport: 'width=device-width, initial-scale=1',
  canonicals: ['https://www.cresanka.hr/en/rooms/superior'],
  alternates: [
    { lang: 'hr', href: 'https://www.cresanka.hr/smjestaj/superior' },
    { lang: 'en', href: 'https://www.cresanka.hr/en/rooms/superior' },
    { lang: 'x-default', href: 'https://www.cresanka.hr/smjestaj/superior' },
  ],
  social: {
    'og:title': 'Superior room with a sea view',
    'og:description': 'A bright room with a balcony over the bay.',
    'og:url': 'https://www.cresanka.hr/en/rooms/superior',
    'og:type': 'website',
    'og:image': 'https://www.cresanka.hr/og/superior.jpg',
    'twitter:card': 'summary_large_image',
  },
  jsonld: [JSON.stringify({ '@context': 'https://schema.org', '@type': 'Hotel', name: 'Cresanka' })],
  htmlLang: 'en',
  favicon: true,
  microdata: 0,
  headings: [
    { ref: 'h0', level: 1, text: 'Superior room', visible: true },
    { ref: 'h1', level: 2, text: 'Amenities', visible: true },
  ],
  images: [{ ref: 'i0', src: 'https://www.cresanka.hr/img/superior.jpg', alt: 'Superior room with a sea view', w: 800, h: 500, naturalW: 1600, naturalH: 1000, decorative: false, block: 'Hero' }],
  links: [{ ref: 'a0', href: 'https://www.cresanka.hr/en/contact', name: 'Contact', visible: true }],
  ...over,
});

/** What fetching around that page finds: all well. */
export const network = (over = {}) => ({
  server: { status: 200, finalUrl: 'https://www.cresanka.hr/en/rooms/superior', robotsHeader: '', head: null },
  robots: { status: 200, html: false, text: 'User-agent: *\nAllow: /\nSitemap: https://www.cresanka.hr/sitemap.xml' },
  sitemap: { url: 'https://www.cresanka.hr/sitemap.xml', status: 200, html: false, kind: 'urlset', found: true, urls: 120, hosts: ['cresanka.hr'], partial: false },
  ogImage: { w: 1200, h: 630 },
  site: { titleSame: [], descriptionSame: [], pages: 0, sent: {} },
  ...over,
});

/** The same page on staging, where the canonical and hreflang rightly name the live addresses. */
export const staging = (over = {}) => snapshot({ url: 'https://cresanka-staging.vercel.app/en/rooms/superior', environment: 'staging', ...over });

export const stagingNetwork = (over = {}) =>
  network({
    server: { status: 200, finalUrl: 'https://cresanka-staging.vercel.app/en/rooms/superior', robotsHeader: 'noindex', head: null },
    access: { status: 401, finalUrl: 'https://cresanka-staging.vercel.app/en/rooms/superior' },
    ...over,
  });
