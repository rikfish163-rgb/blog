import type { APIRoute } from 'astro';
import { auth } from '../../../auth';
import { database } from '../../../server/database';
import {
  AI_MAX_OUTPUT_TOKENS,
  calculateCostFen,
  estimateInputTokens,
  monthlyBudgetFromEnvironment,
  ratesFromEnvironment,
  releaseAiUsage,
  reserveAiUsage,
  settleAiUsage,
} from '../../../server/ai-budget';
import {
  buildSystemPrompt,
  loadAiIndex,
  retrieveTopChunks,
  sourcesFor,
} from '../../../server/ai-retrieval';

export const prerender = false;

const MAX_INPUT_LENGTH = 1000;
const MAX_BODY_BYTES = 32 * 1024;

type ChatLanguage = 'zh' | 'en';

interface ChatBody {
  readonly lang: ChatLanguage;
  readonly input: string;
}

interface ProviderUsage {
  readonly prompt_tokens?: unknown;
  readonly completion_tokens?: unknown;
}

interface ProviderChoice {
  readonly message?: { readonly content?: unknown };
}

interface ProviderResponse {
  readonly choices?: readonly ProviderChoice[];
  readonly usage?: ProviderUsage;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function endpoint(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return new RegExp(`/${suffix}$`, 'i').test(base) ? base : `${base}/${suffix}`;
}

function isLanguage(value: unknown): value is ChatLanguage {
  return value === 'zh' || value === 'en';
}

function parseBody(value: unknown): ChatBody | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const lang = body.lang;
  const input = body.input ?? body.question;
  if (!isLanguage(lang) || typeof input !== 'string') return null;
  const normalized = input.trim();
  if (!normalized || normalized.length > MAX_INPUT_LENGTH) return null;
  return { lang, input: normalized };
}

function integerUsage(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function contentText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const text = value
    .filter((part): part is { readonly type?: unknown; readonly text?: unknown } => Boolean(part && typeof part === 'object'))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim();
  return text || null;
}

function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin !== expected) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false;
  const referer = request.headers.get('referer');
  if (!referer) return true;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function responseUsage(
  body: ProviderResponse,
  inputFallback: number,
  outputFallback: number,
): { inputTokens: number; outputTokens: number } {
  const inputTokens = integerUsage(body.usage?.prompt_tokens) ?? inputFallback;
  const outputTokens = integerUsage(body.usage?.completion_tokens) ?? outputFallback;
  return {
    inputTokens,
    outputTokens: Math.min(AI_MAX_OUTPUT_TOKENS, outputTokens),
  };
}

async function getSessionUserId(request: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV && process.env.AI_PUBLIC_ENABLED !== 'true') {
    return new Response(null, { status: 404 });
  }
  if (!sameOrigin(request)) return json({ error: 'same-origin request required' }, 403);
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'application/json required' }, 415);
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'request body too large' }, 413);
  }

  const userId = await getSessionUserId(request);
  if (!userId) return json({ error: 'login required' }, 401);

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'request body too large' }, 413);
    }
    body = JSON.parse(raw) as unknown;
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const input = parseBody(body);
  if (!input) return json({ error: `input must be 1-${MAX_INPUT_LENGTH} characters and lang must be zh or en` }, 400);

  const baseUrl = process.env.AI_BASE_URL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  const chatModel = process.env.AI_CHAT_MODEL?.trim();
  const rates = ratesFromEnvironment();
  if (!baseUrl || !apiKey || !chatModel || !rates) {
    return json({ error: 'AI provider is not configured; Pagefind search remains available' }, 503);
  }

  const index = await loadAiIndex();
  if (!index.publicReady) {
    return json({ error: 'AI index is not publicly ready; Pagefind search remains available' }, 503);
  }
  const chunks = retrieveTopChunks(index, input.input, input.lang, 6);
  const systemPrompt = buildSystemPrompt(input.lang, chunks);
  const inputTokens = estimateInputTokens(`${systemPrompt}\n${input.input}`);
  const reservation = reserveAiUsage(userId, inputTokens, rates, {
    monthlyBudgetFen: monthlyBudgetFromEnvironment(),
  });
  if (!reservation.ok) {
    if (reservation.reason === 'daily_limit') return json({ error: 'daily AI request limit reached' }, 429);
    if (reservation.reason === 'monthly_budget') return json({ error: 'monthly AI budget reached' }, 429);
    return json({ error: 'AI request could not be reserved' }, 503);
  }

  try {
    const providerResponse = await fetch(endpoint(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.input },
        ],
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!providerResponse.ok) throw new Error('provider request failed');
    const providerBody = (await providerResponse.json()) as ProviderResponse;
    const answer = contentText(providerBody.choices?.[0]?.message?.content);
    if (!answer) throw new Error('provider returned no answer');
    const usage = responseUsage(providerBody, inputTokens, estimateInputTokens(answer));
    if (!settleAiUsage(reservation.reservation, usage, rates, database, { monthlyBudgetFen: monthlyBudgetFromEnvironment() })) {
      return json({ error: 'AI usage could not be reconciled within the monthly budget' }, 503);
    }
    return json({
      answer,
      sources: sourcesFor(chunks),
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costFen: calculateCostFen(usage, rates),
      },
    });
  } catch {
    releaseAiUsage(reservation.reservation);
    return json({ error: 'AI provider is temporarily unavailable' }, 502);
  }
};

export const ALL: APIRoute = async () => json({ error: 'method not allowed' }, 405);
