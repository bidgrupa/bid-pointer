/**
 * Who gets a task that Send to ClickUp makes from an email. The one place to change as Mate's
 * access grows: Pointer suggests Mate only for a clear, small change in a named place, of a kind
 * Mate can actually make, and never for anything vague or touching booking, prices or legal text.
 * Pure functions, unit-tested.
 *
 * "Mate" here is the coding agent: the default assignee, when the options page says it's one (bid's
 * Mate is). "person" is whoever runs Pointer, who read the email and can pass the task on. Without
 * an agent there's nothing to route: every point goes the default assignee's way.
 */
import type { EmailPoint, PointKind, Sensitive } from './email';

export type RoutingRules = {
  /** The default assignee is a coding agent. Off, every point takes the "mate" route with no reasons. */
  agent: boolean;
  /** Mate changes code in the repositories. It can't edit CMS content yet; set true once it can. */
  mateEditsCms: boolean;
  /** Kinds of work Mate may get. Content and media count only while `mateEditsCms` is on. */
  mateKinds: PointKind[];
  /** Kinds that live in a CMS, on the agency's sites. */
  cmsKinds: PointKind[];
  /** Always a person, and always a task of their own, reviewed on their own. */
  ownTask: Sensitive[];
  /** A group with more points than this is split, so its pull request stays reviewable. */
  maxPoints: number;
};

export const ROUTING: RoutingRules = {
  agent: true,
  mateEditsCms: false,
  mateKinds: ['style', 'bug', 'content', 'media'],
  cmsKinds: ['content', 'media'],
  ownTask: ['booking', 'prices', 'legal'],
  maxPoints: 6,
};

export type Route = { to: 'mate' | 'person'; reasons: string[] };

const SENSITIVE_LABEL: Record<Sensitive, string> = { booking: 'booking', prices: 'prices', legal: 'legal text' };

const KIND_REASON: Partial<Record<PointKind, string>> = {
  design: 'needs a design decision',
  feature: 'new functionality',
  other: 'not a kind of work Mate takes',
};

/** Who a point goes to, and why, in a few words for the review. */
export function routePoint(p: EmailPoint, rules: RoutingRules = ROUTING): Route {
  if (!rules.agent) return { to: 'mate', reasons: [] };
  if (p.vague) return { to: 'person', reasons: [`needs clarification: ${p.vague}`] };
  if (p.sensitive) return { to: 'person', reasons: [`touches ${SENSITIVE_LABEL[p.sensitive]}, so it's reviewed on its own`] };
  if (!rules.mateKinds.includes(p.kind)) return { to: 'person', reasons: [KIND_REASON[p.kind] ?? 'not a kind of work Mate takes'] };
  if (rules.cmsKinds.includes(p.kind) && !rules.mateEditsCms) return { to: 'person', reasons: ["CMS content, and Mate can't edit the CMS yet"] };
  if (p.size !== 'small') return { to: 'person', reasons: ['more than one small change'] };
  if (!p.pages.length && !p.urls.length && !p.component) return { to: 'person', reasons: ["doesn't say where"] };
  return { to: 'mate', reasons: ['a clear, small change in a named place'] };
}
