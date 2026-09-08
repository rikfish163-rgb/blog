import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isRobotUserAgent,
  normalizePathname,
  readAnalyticsDays,
  recordPageView,
} from '../src/server/analytics';

const databases: Database.Database[] = [];
const productionEnv = {
  NODE_ENV: 'production',
  ANALYTICS_HMAC_SECRET: 'test-only-secret',
} as NodeJS.ProcessEnv;

function memoryDatabase(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('privacy-preserving analytics', () => {
  it('rejects paths that could encode extra request data', () => {
    expect(normalizePathname('/zh/posts/hello')).toBe('/zh/posts/hello');
    expect(normalizePathname('/zh/posts/hello?from=mail')).toBeNull();
    expect(normalizePathname('/zh/posts/hello#note')).toBeNull();
    expect(normalizePathname('https://example.com/zh')).toBeNull();
  });

  it('filters missing and robotic user agents', () => {
    expect(isRobotUserAgent(null)).toBe(true);
    expect(isRobotUserAgent('curl/8.0')).toBe(true);
    expect(isRobotUserAgent('Mozilla/5.0 Firefox/145.0')).toBe(false);
  });

  it('does not count non-production traffic', () => {
    const db = memoryDatabase();
    expect(recordPageView({
      pathname: '/zh',
      ip: '198.51.100.9',
      userAgent: 'Mozilla/5.0 Firefox/145.0',
      env: { NODE_ENV: 'development' },
      db,
    })).toEqual({ accepted: false, unique: false });
    expect(readAnalyticsDays(db)).toEqual([]);
  });

  it('increments views while deduplicating daily visitors per path', () => {
    const db = memoryDatabase();
    const request = {
      pathname: '/zh/posts/giving-deepseek-eyes',
      ip: '198.51.100.9',
      userAgent: 'Mozilla/5.0 Firefox/145.0',
      now: new Date('2026-09-08T12:00:00Z'),
      env: productionEnv,
      db,
    };

    expect(recordPageView(request)).toEqual({ accepted: true, unique: true });
    expect(recordPageView(request)).toEqual({ accepted: true, unique: false });
    expect(readAnalyticsDays(db)).toEqual([{
      date: '2026-09-08',
      pathname: '/zh/posts/giving-deepseek-eyes',
      views: 2,
      uniques: 1,
    }]);

    const columns = db.prepare('PRAGMA table_info(analytics_daily_sessions)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(['date', 'pathname', 'digest']);
  });
});
