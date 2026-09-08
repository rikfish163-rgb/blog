import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), '..');
const OUTPUT_PATH = join(ROOT, 'src', 'generated', 'stats.json');
const GITHUB_ENDPOINT = 'https://api.github.com/graphql';
const WAKATIME_ENDPOINT = 'https://wakatime.com/api/v1/users/current/summaries';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function emptyWriting() {
  return { available: false, publishedCount: 0, days: [] };
}

function emptyGithub() {
  return { available: false, days: [] };
}

function emptyEditorTime() {
  return { available: false, totalMinutes: 0 };
}

function emptyVisits() {
  return { available: false, days: [], totalViews: 0, totalUniques: 0 };
}

export function emptyStats(now = new Date()) {
  return {
    version: 1,
    generatedOn: utcDate(now),
    writing: emptyWriting(),
    github: emptyGithub(),
    editorTime: emptyEditorTime(),
    visits: emptyVisits(),
  };
}

function warning(label, error) {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.warn(`[stats] ${label} unavailable: ${message}`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (/\.(?:md|mdx)$/i.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function unquote(value) {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s|$)/);
  if (!match) return {};

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
    if (!field) continue;
    fields[field[1]] = unquote(field[2]);
  }
  return fields;
}

function isPublished(frontmatter) {
  const value = frontmatter.draft;
  return value !== true && value !== 'true' && value !== 'True' && value !== 'TRUE';
}

function frontmatterDate(frontmatter) {
  const value = typeof frontmatter.pubDate === 'string' ? frontmatter.pubDate.slice(0, 10) : '';
  return DAY_RE.test(value) ? value : null;
}

export async function collectWritingStats(root = ROOT) {
  const postsDirectory = join(root, 'src', 'content', 'posts');
  const files = await walk(postsDirectory);
  const days = new Map();
  let publishedCount = 0;

  for (const file of files) {
    const frontmatter = parseFrontmatter(await readFile(file, 'utf8'));
    if (!isPublished(frontmatter)) continue;
    publishedCount += 1;
    const date = frontmatterDate(frontmatter);
    if (date) days.set(date, (days.get(date) ?? 0) + 1);
  }

  return {
    available: true,
    publishedCount,
    days: [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, count]) => ({ date, count })),
  };
}

function dateRange(now = new Date(), daysBack = 365) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - daysBack + 1);
  return { start: utcDate(start), end: utcDate(end) };
}

function getFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new Error('fetch is not available');
}

export async function fetchGithubStats({
  env = process.env,
  fetchImpl,
  now = new Date(),
  timeoutMs = 10_000,
} = {}) {
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (!token) return emptyGithub();

  const { start, end } = dateRange(now);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await getFetch(fetchImpl)(GITHUB_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'blog-stats-fetcher',
      },
      body: JSON.stringify({
        query: `query($from: DateTime!, $to: DateTime!) {
          viewer {
            contributionsCollection(from: $from, to: $to) {
              contributionCalendar {
                weeks { contributionDays { date contributionCount } }
              }
            }
          }
        }`,
        variables: { from: `${start}T00:00:00Z`, to: `${end}T23:59:59Z` },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length > 0) throw new Error('GraphQL request failed');

    const weeks = payload.data?.viewer?.contributionsCollection?.contributionCalendar?.weeks;
    if (!Array.isArray(weeks)) throw new Error('GraphQL response missing contribution calendar');
    const days = weeks.flatMap((week) => (Array.isArray(week?.contributionDays) ? week.contributionDays : []))
      .filter((day) => DAY_RE.test(day?.date) && Number.isFinite(Number(day?.contributionCount)))
      .map((day) => ({ date: day.date, count: Math.max(0, Math.trunc(Number(day.contributionCount))) }))
      .sort((left, right) => left.date.localeCompare(right.date));
    return { available: true, days };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchEditorTimeStats({
  env = process.env,
  fetchImpl,
  now = new Date(),
  timeoutMs = 10_000,
  daysBack = 30,
} = {}) {
  const token = env.WAKATIME_API_KEY ?? env.WAKATIME_TOKEN;
  if (!token) return emptyEditorTime();

  const { start, end } = dateRange(now, daysBack);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await getFetch(fetchImpl)(`${WAKATIME_ENDPOINT}?start=${start}&end=${end}`, {
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`,
        'user-agent': 'blog-stats-fetcher',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload.data) ? payload.data : null;
    if (!rows) throw new Error('WakaTime response missing summaries');

    const totalSeconds = rows.reduce((sum, row) => {
      const seconds = Number(row?.grand_total?.total_seconds);
      return Number.isFinite(seconds) && seconds > 0 ? sum + seconds : sum;
    }, 0);
    return {
      available: true,
      // Only an aggregate is persisted. Never copy project, path, branch, editor,
      // command, or per-session timestamps into the generated file.
      totalMinutes: Math.max(0, Math.round(totalSeconds / 60)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function databaseCandidates(root, env) {
  const configured = env.ANALYTICS_DB_PATH ?? env.DATABASE_PATH ?? env.DATABASE_URL;
  const candidates = [];
  if (configured && !configured.includes('://')) candidates.push(configured);
  candidates.push(
    join(root, 'data', 'blog.sqlite'),
    join(root, '.data', 'blog.sqlite'),
    join(root, 'src', 'server', 'database.sqlite'),
    join(root, 'src', 'server', 'data.sqlite'),
  );
  return candidates;
}

export async function readVisitStats({ root = ROOT, env = process.env, databasePath } = {}) {
  const path = databasePath ?? databaseCandidates(root, env).find((candidate) => existsSync(candidate));
  if (!path || !existsSync(path)) return emptyVisits();

  const sqlite = await import('better-sqlite3');
  const Database = sqlite.default;
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = database
      .prepare('SELECT date, views, uniques FROM analytics_daily ORDER BY date ASC')
      .all();
    const days = rows
      .filter((row) => DAY_RE.test(String(row.date)))
      .map((row) => ({
        date: String(row.date),
        views: Math.max(0, Math.trunc(Number(row.views) || 0)),
        uniques: Math.max(0, Math.trunc(Number(row.uniques) || 0)),
      }));
    return {
      available: true,
      days,
      totalViews: days.reduce((sum, day) => sum + day.views, 0),
      totalUniques: days.reduce((sum, day) => sum + day.uniques, 0),
    };
  } finally {
    database.close();
  }
}

async function safe(label, task, fallback) {
  try {
    return await task();
  } catch (error) {
    warning(label, error);
    return fallback;
  }
}

export async function buildStats({ root = ROOT, env = process.env, now = new Date(), fetchImpl } = {}) {
  const [writing, github, editorTime, visits] = await Promise.all([
    safe('writing', () => collectWritingStats(root), emptyWriting()),
    safe('github', () => fetchGithubStats({ env, fetchImpl, now }), emptyGithub()),
    safe('editor time', () => fetchEditorTimeStats({ env, fetchImpl, now }), emptyEditorTime()),
    safe('visits', () => readVisitStats({ root, env }), emptyVisits()),
  ]);

  return {
    version: 1,
    generatedOn: utcDate(now),
    writing,
    github,
    editorTime,
    visits,
  };
}

export async function main() {
  const stats = await buildStats();
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  return stats;
}

if (resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main().catch(async (error) => {
    warning('all statistics', error);
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(emptyStats(), null, 2)}\n`, 'utf8');
    process.exitCode = 0;
  });
}
