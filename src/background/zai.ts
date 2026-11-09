import { BULLETS_MAX, BULLET_MAX, TITLE_MAX, extractJson, sanitizePrepared } from '../shared/format';
import { EMAIL_SYSTEM_PROMPT, emailPrompt, type EmailPayload } from '../shared/email';
import type { Prepared, RewriteContext } from '../shared/types';

export const ZAI_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
/** Bump this when Z.ai ships the next Flash model. */
export const ZAI_MODEL = 'glm-5.3-flash';

const SYSTEM_PROMPT = `You turn a short QA note about a website into a small, clear task for a frontend developer.
Reply with JSON only, exactly this shape: {"title": string, "bullets": string[]}

Rules:
- Always write in English. Translate the note if it is in another language (notes are often Croatian).
- title: one short imperative sentence, ideally under ${TITLE_MAX} characters. Start with the block name and a colon when a block is given, e.g. "Hero: CTA overlaps title on mobile".
- bullets: 1 to ${BULLETS_MAX} complete sentences, ideally under ${BULLET_MAX} characters each: what is wrong, where exactly, what is expected instead. Nothing else.
- Every sentence must be complete. Be brief by leaving things out, never by cutting a sentence short.
- Never invent details that are not in the note or the context. Do not suggest code or causes.
- Do not repeat the title inside the bullets. No greetings, no sign-off, no markdown.
- If the note is already clear, keep its meaning exactly; just translate and tidy it.`;

function userPayload(ctx: RewriteContext) {
  const block = ctx.block.name ? `${ctx.block.name}${ctx.block.id ? ` (#${ctx.block.id})` : ''}` : null;
  return {
    note: ctx.note,
    block,
    clicked_element: [ctx.element.selector, ctx.element.text ? `"${ctx.element.text}"` : ''].filter(Boolean).join(' '),
    page: ctx.page.path,
    project: ctx.projectLabel,
  };
}

type ChatOptions = {
  timeoutMs: number;
  /** GLM-5.3 always reasons; this says how much. Z.ai takes only these three ("medium" is a 400). */
  effort: 'low' | 'high' | 'max';
  /** Reasoning tokens count against this, so leave headroom for them. */
  maxTokens: number;
};

/** One JSON-mode chat call. Throws on network/API errors and timeouts; returns the reply's text. */
async function chat(apiKey: string, system: string, user: string, o: ChatOptions): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs);
  try {
    const res = await fetch(ZAI_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ZAI_MODEL,
        thinking: { type: 'enabled' },
        reasoning_effort: o.effort,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: o.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new Error(`Z.ai ${res.status}${text ? `: ${text}` : ''}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Z.ai timed out after ${o.timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Throws on network/API errors; returns null when the reply isn't usable JSON. */
export async function rewrite(apiKey: string, ctx: RewriteContext, timeoutMs = 20_000): Promise<Prepared | null> {
  // "low" keeps it quick for a two-line rewrite
  const content = await chat(apiKey, SYSTEM_PROMPT, JSON.stringify(userPayload(ctx)), { timeoutMs, effort: 'low', maxTokens: 2000 });
  return sanitizePrepared(extractJson(content), ctx.note);
}

/**
 * Splits a client's email into atomic points and questions (shared/email.ts has the prompt and
 * tidies the answer). A longer job than a rewrite, so more time and more room to reason.
 * Throws on network/API errors; returns the parsed reply, or null when it isn't JSON.
 */
export async function splitEmail(apiKey: string, email: EmailPayload, timeoutMs = 90_000): Promise<unknown> {
  const content = await chat(apiKey, EMAIL_SYSTEM_PROMPT, emailPrompt(email), { timeoutMs, effort: 'high', maxTokens: 12_000 });
  return extractJson(content);
}
