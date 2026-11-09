/**
 * Send to ClickUp in HubSpot: the pure parts of reading a Help Desk ticket (hubspot/read.ts), unit-tested.
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 86_400_000;

/**
 * When a message was sent, from what the thread shows: the day above it ("October 23", "October 23,
 * 2025", "Yesterday", "Monday") and its time ("1:25 PM", "13:25"). A day without a year is the last
 * one by that date. 0 when either can't be read.
 */
export function hubspotSentAt(day: string, time: string, now: Date = new Date()): number {
  const t = time.trim().match(/^(\d{1,2})[:.](\d{2})\s*([ap])?\.?\s*m?\.?$/i);
  if (!t) return 0;
  let hours = Number(t[1]);
  const minutes = Number(t[2]);
  const half = t[3]?.toLowerCase();
  if (half === 'p' && hours < 12) hours += 12;
  if (half === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return 0;

  const d = day.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const at = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes).getTime();
  const daysAgo = (n: number) => at(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  if (d === 'today') return daysAgo(0);
  if (d === 'yesterday') return daysAgo(1);
  const weekday = WEEKDAYS.indexOf(d);
  if (weekday >= 0) return daysAgo((now.getDay() - weekday + 7) % 7 || 7);

  // "october 23", "october 23 2025", "23 october 2025", "oct 23"
  const parts = d.split(' ');
  const monthAt = parts.findIndex((p) => p.length >= 3 && MONTHS.some((m) => m.startsWith(p.replace(/\.$/, ''))));
  if (monthAt < 0) return 0;
  const month = MONTHS.findIndex((m) => m.startsWith((parts[monthAt] ?? '').replace(/\.$/, '')));
  const numbers = parts.filter((_, i) => i !== monthAt).map((p) => Number(p.replace(/\.$/, '')));
  const date = numbers.find((n) => Number.isInteger(n) && n >= 1 && n <= 31);
  const year = numbers.find((n) => Number.isInteger(n) && n >= 2000 && n <= 2100);
  if (!date) return 0;
  if (year) return at(new Date(year, month, date));
  const sent = at(new Date(now.getFullYear(), month, date));
  return sent > now.getTime() + DAY_MS ? at(new Date(now.getFullYear() - 1, month, date)) : sent;
}

/** A short, stable hash (FNV-1a, base 36). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * An id for a message in a ticket, for remembering what was sent to ClickUp. HubSpot's page shows
 * no message ids, so it's made from what it does show: the ticket, the sender, the day and time,
 * and which of several alike it is.
 */
export const hubspotMessageId = (ticketId: string, sender: string, day: string, time: string, nth = 0): string =>
  `hs:${ticketId || '?'}:${hash([sender.trim().toLowerCase(), day.trim().toLowerCase(), time.trim().toLowerCase(), nth].join('|'))}`;

const nameWords = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The ClickUp person with a HubSpot user's name: the same full name, or one name holding the
 * other's first and last name (accents and middle names aside). One word alone never matches: two
 * Anas would be a guess. Null when no one or more than one fits.
 */
export function memberByName<T extends { name: string }>(name: string, members: T[]): T | null {
  const want = nameWords(name);
  if (want.length < 2) return null;
  const fits = members.filter((m) => {
    const have = nameWords(m.name);
    if (have.length < 2) return false;
    const [short, long] = have.length <= want.length ? [have, want] : [want, have];
    return short[0] === long[0] && short.at(-1) === long.at(-1);
  });
  return fits.length === 1 ? (fits[0] ?? null) : null;
}

/** HubSpot's own servers: the only ones Pointer fetches a file from with the person's HubSpot session. */
export function isHubSpotFileHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(hubspot\.com|hubspotusercontent(-[a-z0-9]+)?\.(net|com)|hubfs\.net)$/i.test(u.hostname);
  } catch {
    return false;
  }
}
