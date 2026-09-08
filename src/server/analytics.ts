import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';

import { database } from './database';

const MAX_PATHNAME_LENGTH = 2_048;
const MAX_USER_AGENT_LENGTH = 512;
const HASH_ALGORITHM = 'sha256';

const ROBOT_USER_AGENT = /bot|crawler|spider|headless|slurp|bingpreview|facebookexternalhit|monitor|uptime|curl|wget|python-requests|scrapy|go-http-client|axios|lighthouse|pagespeed/i;
const NON_PRODUCTION_ENVIRONMENT = /^(?:dev|development|preview|staging|test)$/i;

export interface AnalyticsDay {
  date: string;
  pathname: string;
  views: number;
  uniques: number;
}

export interface RecordPageViewInput {
  pathname: unknown;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  db?: Database.Database;
}

export interface RecordPageViewResult {
  accepted: boolean;
  unique: boolean;
}

export const ANALYTICS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS analytics_daily (
    date TEXT NOT NULL,
    pathname TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
    uniques INTEGER NOT NULL DEFAULT 0 CHECK (uniques >= 0),
    PRIMARY KEY (date, pathname)
  );

  CREATE TABLE IF NOT EXISTS analytics_daily_sessions (
    date TEXT NOT NULL,
    pathname TEXT NOT NULL,
    digest TEXT NOT NULL,
    PRIMARY KEY (date, pathname, digest)
  );
`;

export function ensureAnalyticsSchema(db: Database.Database = database): void {
  db.exec(ANALYTICS_SCHEMA);
}

export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Only a pathname is accepted. Query strings and fragments are deliberately
 * rejected rather than silently discarded, so callers cannot smuggle data into
 * the endpoint or make two URLs look like one view.
 */
export function normalizePathname(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATHNAME_LENGTH) return null;
  if (!value.startsWith('/') || value.includes('?') || value.includes('#') || /[\u0000-\u0020\u007f\\]/.test(value)) {
    return null;
  }

  const trailingSlash = value.length > 1 && value.endsWith('/');
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const pathname = `/${segments.join('/')}`;
  if (pathname === '/' || trailingSlash) return pathname;
  return pathname;
}

export function isRobotUserAgent(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string' || userAgent.trim().length === 0) return true;
  return ROBOT_USER_AGENT.test(userAgent);
}

export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  const deployment = env.VERCEL_ENV ?? env.ASTRO_ENV ?? env.APP_ENV ?? '';
  return !NON_PRODUCTION_ENVIRONMENT.test(deployment);
}

function analyticsSecret(env: NodeJS.ProcessEnv): string | null {
  const configured = env.ANALYTICS_HMAC_SECRET ?? env.AUTH_SECRET ?? env.BETTER_AUTH_SECRET;
  return configured && configured.length > 0 ? configured : null;
}

export function dailyDerivedKey(date: string, secret: string): Buffer {
  return createHmac(HASH_ALGORITHM, secret).update(`analytics-day:${date}`, 'utf8').digest();
}

/**
 * Returns only a one-way daily digest. The caller must not persist the supplied
 * IP or user-agent; the analytics tables contain this digest only.
 */
export function sessionDigest(date: string, ip: string, userAgent: string, secret: string): string {
  const key = dailyDerivedKey(date, secret);
  return createHmac(HASH_ALGORITHM, key)
    .update(`${date}\n${ip}\n${userAgent}`, 'utf8')
    .digest('hex');
}

function boundedUserAgent(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, MAX_USER_AGENT_LENGTH);
}

export function recordPageView(input: RecordPageViewInput): RecordPageViewResult {
  const db = input.db ?? database;
  if (!isProductionEnvironment(input.env ?? process.env)) return { accepted: false, unique: false };
  const pathname = normalizePathname(input.pathname);
  if (!pathname || isRobotUserAgent(input.userAgent)) return { accepted: false, unique: false };

  const date = utcDate(input.now ?? new Date());
  const secret = analyticsSecret(input.env ?? process.env);
  const userAgent = boundedUserAgent(input.userAgent);
  const ip = typeof input.ip === 'string' ? input.ip.slice(0, 128) : null;
  // Missing credentials still contribute an aggregate view, but cannot create a
  // unique digest. No raw identifier reaches a SQL statement.
  const digest = secret && ip && userAgent ? sessionDigest(date, ip, userAgent, secret) : null;

  ensureAnalyticsSchema(db);
  const transaction = db.transaction(() => {
    db
      .prepare(
        `INSERT INTO analytics_daily (date, pathname, views, uniques)
         VALUES (?, ?, 1, 0)
         ON CONFLICT(date, pathname) DO UPDATE SET views = analytics_daily.views + 1`,
      )
      .run(date, pathname);

    if (!digest) return false;
    const inserted = db
      .prepare('INSERT OR IGNORE INTO analytics_daily_sessions (date, pathname, digest) VALUES (?, ?, ?)')
      .run(date, pathname, digest);
    if (inserted.changes === 0) return false;

    db
      .prepare('UPDATE analytics_daily SET uniques = uniques + 1 WHERE date = ? AND pathname = ?')
      .run(date, pathname);
    return true;
  });

  return { accepted: true, unique: transaction() };
}

export function readAnalyticsDays(db: Database.Database = database): AnalyticsDay[] {
  ensureAnalyticsSchema(db);
  const rows = db
    .prepare('SELECT date, pathname, views, uniques FROM analytics_daily ORDER BY date ASC, pathname ASC')
    .all() as Array<{ date: string; pathname: string; views: number; uniques: number }>;
  return rows.map((row) => ({
    date: row.date,
    pathname: row.pathname,
    views: Math.max(0, Math.trunc(row.views)),
    uniques: Math.max(0, Math.trunc(row.uniques)),
  }));
}
