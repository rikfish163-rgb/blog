import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface AiIndexChunk {
  readonly id: string;
  readonly lang: 'zh' | 'en';
  readonly title: string;
  readonly url: string;
  readonly text: string;
  readonly embedding?: readonly number[];
}

export interface AiIndex {
  readonly version?: number;
  readonly publicReady: boolean;
  readonly mode?: 'keyword' | 'embedding';
  readonly chunks: readonly AiIndexChunk[];
}

export interface RetrievedChunk extends AiIndexChunk {
  readonly score: number;
}

export interface AiSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

const TOKEN_PATTERN = /[\p{Script=Han}]|[\p{L}\p{N}_-]+/gu;

function isLang(value: unknown): value is 'zh' | 'en' {
  return value === 'zh' || value === 'en';
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isChunk(value: unknown): value is AiIndexChunk {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    isLang(candidate.lang) &&
    typeof candidate.title === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.text === 'string' &&
    (candidate.embedding === undefined || isNumberArray(candidate.embedding))
  );
}

function isIndex(value: unknown): value is AiIndex {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.publicReady === 'boolean' && Array.isArray(candidate.chunks) && candidate.chunks.every(isChunk);
}

export function parseAiIndex(value: unknown): AiIndex {
  if (!isIndex(value)) {
    return { publicReady: false, mode: 'keyword', chunks: [] };
  }
  return {
    version: typeof value.version === 'number' ? value.version : undefined,
    publicReady: value.publicReady,
    mode: value.mode === 'embedding' ? 'embedding' : 'keyword',
    chunks: value.chunks,
  };
}

export async function loadAiIndex(
  path = resolve(process.cwd(), 'src/generated/ai-index.json'),
): Promise<AiIndex> {
  try {
    const source = await readFile(path, 'utf8');
    return parseAiIndex(JSON.parse(source) as unknown);
  } catch {
    return { publicReady: false, mode: 'keyword', chunks: [] };
  }
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(TOKEN_PATTERN) ?? [];
}

function termFrequency(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens(value)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function keywordScore(queryCounts: Map<string, number>, chunk: AiIndexChunk): number {
  const titleCounts = termFrequency(chunk.title);
  const textCounts = termFrequency(chunk.text);
  let score = 0;
  for (const [term, queryCount] of queryCounts) {
    score += (titleCounts.get(term) ?? 0) * queryCount * 6;
    score += (textCounts.get(term) ?? 0) * queryCount;
  }
  return score;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let aLength = 0;
  let bLength = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    aLength += left * left;
    bLength += right * right;
  }
  if (aLength === 0 || bLength === 0) return -1;
  return dot / Math.sqrt(aLength * bLength);
}

/** Return at most six chunks from the requested language, deterministically ranked. */
export function retrieveTopChunks(
  index: AiIndex,
  query: string,
  lang: 'zh' | 'en',
  limit = 6,
  queryEmbedding?: readonly number[],
): RetrievedChunk[] {
  const queryCounts = termFrequency(query);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 6) : 6;
  const candidates = index.chunks
    .filter((chunk) => chunk.lang === lang)
    .map((chunk, sourceIndex) => {
      const vectorScore =
        queryEmbedding && chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : -1;
      const score = vectorScore >= 0 ? vectorScore : keywordScore(queryCounts, chunk);
      return { ...chunk, score, sourceIndex };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex)
    .slice(0, safeLimit)
    .map(({ sourceIndex: _sourceIndex, ...chunk }) => chunk);
  return candidates;
}

export function sourcesFor(chunks: readonly AiIndexChunk[]): AiSource[] {
  const seen = new Set<string>();
  const sources: AiSource[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    sources.push({ id: chunk.id, title: chunk.title, url: chunk.url });
  }
  return sources;
}

/**
 * The model is explicitly constrained to the retrieved text. Numbered source
 * blocks make citations easy to validate and keep personal-data speculation out.
 */
export function buildSystemPrompt(lang: 'zh' | 'en', chunks: readonly AiIndexChunk[]): string {
  const sourceBlocks = chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.title}\nURL: ${chunk.url}\n${chunk.text}`)
    .join('\n\n');
  if (lang === 'zh') {
    return [
      '你是这个博客的资料问答助手。只能根据下方检索片段回答，不得使用片段以外的知识，不得推测或补写作者的个人经历、观点、联系方式或未验证事实。',
      '如果片段没有答案，明确说“资料中没有相关信息”，不要猜测。回答使用中文，简洁准确，并在每个关键事实后附来源编号，例如 [1]。不要编造来源。',
      '检索片段：',
      sourceBlocks || '（没有检索到片段）',
    ].join('\n\n');
  }
  return [
    'You answer questions about this blog using only the retrieved excerpts below. Do not use outside knowledge, and do not infer or invent the author’s personal experiences, opinions, contact details, or unverified facts.',
    'If the excerpts do not contain the answer, say “The indexed material does not contain that information.” Do not guess. Answer in English, keep it concise, and cite every material claim with a source number such as [1]. Never invent a source.',
    'Retrieved excerpts:',
    sourceBlocks || '(No excerpts were retrieved.)',
  ].join('\n\n');
}
