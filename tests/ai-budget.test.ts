import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calculateCostFen,
  cleanupPending,
  ensureAiUsageTable,
  readAiUsageRow,
  releaseAiUsage,
  reserveAiUsage,
  settleAiUsage,
  type AiRates,
} from '../src/server/ai-budget';

const rates: AiRates = { inputYuanPerMtok: 1, outputYuanPerMtok: 2 };
const now = Date.UTC(2026, 8, 8, 12, 0, 0);
const databases: Database.Database[] = [];

function memoryDatabase(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  ensureAiUsageTable(db);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('AI cost accounting', () => {
  it('rounds each token stream up to integer fen', () => {
    expect(calculateCostFen({ inputTokens: 1, outputTokens: 0 }, rates)).toBe(1);
    expect(calculateCostFen({ inputTokens: 0, outputTokens: 1 }, rates)).toBe(1);
  });

  it('allows exactly the monthly budget but rejects the next reservation', () => {
    const db = memoryDatabase();
    const first = reserveAiUsage('u1', 20_000_000, { inputYuanPerMtok: 1, outputYuanPerMtok: 0 }, {
      monthlyBudgetFen: 2_000,
      now,
    }, db);
    expect(first.ok).toBe(true);
    const second = reserveAiUsage('u1', 1, { inputYuanPerMtok: 1, outputYuanPerMtok: 0 }, {
      monthlyBudgetFen: 2_000,
      now,
    }, db);
    expect(second).toMatchObject({ ok: false, reason: 'monthly_budget' });
  });

  it('enforces ten daily reservations', () => {
    const db = memoryDatabase();
    for (let index = 0; index < 10; index += 1) {
      expect(reserveAiUsage('u1', 1, { inputYuanPerMtok: 0, outputYuanPerMtok: 0 }, {
        monthlyBudgetFen: 2_000,
        now,
      }, db).ok).toBe(true);
    }
    expect(reserveAiUsage('u1', 1, { inputYuanPerMtok: 0, outputYuanPerMtok: 0 }, {
      monthlyBudgetFen: 2_000,
      now,
    }, db)).toMatchObject({ ok: false, reason: 'daily_limit' });
  });

  it('cleans stale pending reservations and releases their budget', () => {
    const db = memoryDatabase();
    const stale = reserveAiUsage('u1', 1, rates, { monthlyBudgetFen: 2_000, now: now - 31 * 60 * 1000 }, db);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(cleanupPending(db, now)).toBe(1);
    expect(readAiUsageRow(stale.reservation.rowId, db)).toMatchObject({ status: 'failed', reserved_cost_fen: 0 });
  });

  it('releases a failed request without deleting its accounting row', () => {
    const db = memoryDatabase();
    const result = reserveAiUsage('u1', 10, rates, { monthlyBudgetFen: 2_000, now }, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(releaseAiUsage(result.reservation, db)).toBe(true);
    expect(readAiUsageRow(result.reservation.rowId, db)).toMatchObject({ status: 'failed', reserved_cost_fen: 0 });
    expect(reserveAiUsage('u1', 10, rates, { monthlyBudgetFen: 2_000, now }, db).ok).toBe(true);
  });

  it('reconciles actual usage and keeps the table free of prompt/answer columns', () => {
    const db = memoryDatabase();
    const result = reserveAiUsage('u1', 10, rates, { monthlyBudgetFen: 2_000, now }, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(settleAiUsage(result.reservation, { inputTokens: 4, outputTokens: 2 }, rates, db, {
      monthlyBudgetFen: 2_000,
      now,
    })).toBe(true);
    expect(readAiUsageRow(result.reservation.rowId, db)).toMatchObject({
      status: 'succeeded',
      input_tokens: 4,
      output_tokens: 2,
      reserved_cost_fen: 0,
      actual_cost_fen: 2,
    });
    const columns = db.prepare('PRAGMA table_info(ai_usage)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'user_id',
      'month',
      'input_tokens',
      'output_tokens',
      'reserved_cost_fen',
      'actual_cost_fen',
      'status',
      'created_at',
    ]);
  });
});
