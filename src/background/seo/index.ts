/** The background's side of the SEO check: one handler for all its messages. */
import { fetchAccess, fetchText } from './fetch';
import { visitSite } from './site';
import { prepareSeo, publishSeo, undoSeo } from './task';
import { technicalDataAllowed } from '../technical';
import { probeLink } from '../../shared/seo';
import type { Msg } from '../../shared/types';

export type SeoMsg = Extract<Msg, { type: `pointer:seo-${string}` }>;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function handleSeo(msg: SeoMsg): Promise<unknown> {
  switch (msg.type) {
    case 'pointer:seo-fetch':
      return fetchText(msg.url);
    case 'pointer:seo-access':
      return fetchAccess(msg.url);
    case 'pointer:seo-head':
      // without cookies: links to other sites are checked as a stranger would follow them
      return /^https?:\/\//i.test(msg.url) ? probeLink((input, init) => fetch(input, { ...init, credentials: 'omit' }), msg.url) : { error: 'not a web address' };
    case 'pointer:seo-site':
      return visitSite(msg.site, msg);
    case 'pointer:seo-prepare':
      return prepareSeo(msg.request, { omitTechnical: !(await technicalDataAllowed()) });
    case 'pointer:seo-publish':
      return publishSeo(msg.request, { omitTechnical: !(await technicalDataAllowed()) }, msg.edited);
    case 'pointer:seo-undo':
      try {
        return await undoSeo(msg.taskId);
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
  }
}
