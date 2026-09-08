import type Database from 'better-sqlite3';
import { database } from './database';

export const AI_MAX_DAILY_REQUESTS = 10;
export const AI_MAX_OUTPUT_TOKENS = 800;
export const AI_PENDING_TTL_MS = 30 * 60 * 1000;
export const AI_DEFAULT_MONTHLY_BUDGET_FEN = 2000;

export type AiUsageStatus = 'pending' | 'succeeded' | 'failed';

export interface AiRates {
  readonly inputYuanPerMtok: number;
  readonly outputYuanPerMtok: number;
}

export interface AiBudgetOptions {
  readonly monthlyBudgetFen?: number;
  readonly maxDailyRequests?: number;
  readonly pendingTtlMs?: number;
  readonly now?: Date | number;
}

export interface AiUsageTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AiUsageReservation {
  readonly rowId: number;
  readonly userId: string;
  readonly month: string;
  readonly inputTokens: number;
  readonly reservedCostFen: number;
  readonly createdAt: number;
}

export interface AiBudgetSnapshot {
  readonly month: string;
  readonly dailyRequests: number;
  readonly monthlyReservedCostFen: number;
  readonly monthlyBudgetFen: number;
}

export interface AiReservationResult {
  readonly ok: true;
  readonly reservation: AiUsageReservation;
  readonly snapshot: AiBudgetSnapshot;
}

export interface AiReservationRejection {
  readonly ok: false;
  readonly reason: 'daily_limit' | 'monthly_budget' | 'invalid_request';
  readonly snapshot: AiBudgetSnapshot | null;
}

export type AiReservationOutcome = AiReservationResult | AiReservationRejection;

interface UsageRow {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly reserved_cost_fen: number;
  readonly actual_cost_fen: number;
  readonly status: AiUsageStatus;
  readonly user_id: string;
  readonly month: string;
  readonly created_at: number;
}


function asFiniteNonNegativeInteger(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
  return value;
}

function asFiniteNonNegativeRate(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function nowMilliseconds(value: Date | number | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.now();
}

export function monthKey(value: Date | number = Date.now()): string {
  return new Date(nowMilliseconds(value)).toISOString().slice(0, 7);
}

function dayStartMilliseconds(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The site accepts at most 1000 UTF-16 code units. Counting every code unit is
 * intentionally conservative because it never reserves less than the provider
 * may tokenize for a mixed Chinese/Latin prompt.
 */
export function estimateInputTokens(input: string): number {
  return Math.max(1, input.length);
}

/** Convert one token stream's price to integer fen, rounding up. */
export function costFenForTokens(tokens: number, yuanPerMtok: number): number {
  const safeTokens = asFiniteNonNegativeInteger(tokens);
  const safeRate = asFiniteNonNegativeRate(yuanPerMtok);
  if (safeTokens === null || safeRate === null) return Number.POSITIVE_INFINITY;
  if (safeTokens === 0 || safeRate === 0) return 0;
  return Math.ceil((safeTokens * safeRate * 100) / 1_000_000);
}

/**
 * Charge each stream conservatively and independently. This avoids a fractional
 * input charge cancelling a fractional output charge at a budget boundary.
 */
export function calculateCostFen(tokens: AiUsageTokens, rates: AiRates): number {
  return (
    costFenForTokens(tokens.inputTokens, rates.inputYuanPerMtok) +
    costFenForTokens(tokens.outputTokens, rates.outputYuanPerMtok)
  );
}

export function estimateReservationCostFen(inputTokens: number, rates: AiRates): number {
  return calculateCostFen(
    { inputTokens, outputTokens: AI_MAX_OUTPUT_TOKENS },
    rates,
  );
}

export function ratesFromEnvironment(env: NodeJS.ProcessEnv = process.env): AiRates | null {
  const input = Number(env.AI_INPUT_YUAN_PER_MTOK ?? '');
  const output = Number(env.AI_OUTPUT_YUAN_PER_MTOK ?? '');
  if (asFiniteNonNegativeRate(input) === null || asFiniteNonNegativeRate(output) === null) {
    return null;
  }
  return { inputYuanPerMtok: input, outputYuanPerMtok: output };
}

export function monthlyBudgetFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = Number(env.AI_MONTHLY_BUDGET_FEN ?? AI_DEFAULT_MONTHLY_BUDGET_FEN);
  if (!Number.isSafeInteger(value) || value < 0) return AI_DEFAULT_MONTHLY_BUDGET_FEN;
  return value;
}

/** Create the intentionally minimal accounting table. rowid identifies a reservation. */
export function ensureAiUsageTable(db: Database.Database = database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reserved_cost_fen INTEGER NOT NULL,
      actual_cost_fen INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_usage_user_month_created_idx
      ON ai_usage (user_id, month, created_at);
    CREATE INDEX IF NOT EXISTS ai_usage_pending_created_idx
      ON ai_usage (status, created_at);
  `);
}

export function cleanupPending(
  db: Database.Database = database,
  now: Date | number = Date.now(),
  pendingTtlMs = AI_PENDING_TTL_MS,
): number {
  const nowMs = nowMilliseconds(now);
  const ttl = Number.isFinite(pendingTtlMs) && pendingTtlMs >= 0 ? pendingTtlMs : AI_PENDING_TTL_MS;
  const result = db
    .prepare(
      `UPDATE ai_usage
       SET status = 'failed', reserved_cost_fen = 0, actual_cost_fen = 0
       WHERE status = 'pending' AND created_at < ?`,
    )
    .run(nowMs - ttl);
  return result.changes;
}

function normalizeOptions(options: AiBudgetOptions): {
  monthlyBudgetFen: number;
  maxDailyRequests: number;
  pendingTtlMs: number;
  nowMs: number;
} {
  const monthlyBudgetFen =
    options.monthlyBudgetFen === undefined
      ? monthlyBudgetFromEnvironment()
      : Number.isSafeInteger(options.monthlyBudgetFen) && options.monthlyBudgetFen >= 0
        ? options.monthlyBudgetFen
        : AI_DEFAULT_MONTHLY_BUDGET_FEN;
  const maxDailyRequests =
    options.maxDailyRequests === undefined
      ? AI_MAX_DAILY_REQUESTS
      : Number.isSafeInteger(options.maxDailyRequests) && options.maxDailyRequests >= 0
        ? options.maxDailyRequests
        : AI_MAX_DAILY_REQUESTS;
  const pendingTtlMs =
    options.pendingTtlMs === undefined
      ? AI_PENDING_TTL_MS
      : Number.isFinite(options.pendingTtlMs) && options.pendingTtlMs >= 0
        ? options.pendingTtlMs
        : AI_PENDING_TTL_MS;
  return {
    monthlyBudgetFen,
    maxDailyRequests,
    pendingTtlMs,
    nowMs: nowMilliseconds(options.now),
  };
}

function monthlySpent(db: Database.Database, userId: string, month: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
         CASE status
           WHEN 'pending' THEN reserved_cost_fen
           WHEN 'succeeded' THEN actual_cost_fen
           ELSE 0
         END
       ), 0) AS spent
       FROM ai_usage
       WHERE user_id = ? AND month = ?`,
    )
    .get(userId, month) as { spent: number } | undefined;
  return row?.spent ?? 0;
}

function dailyCount(db: Database.Database, userId: string, nowMs: number): number {
  const start = dayStartMilliseconds(nowMs);
  const end = start + 24 * 60 * 60 * 1000;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM ai_usage
       WHERE user_id = ? AND created_at >= ? AND created_at < ?
         AND status IN ('pending', 'succeeded')`,
    )
    .get(userId, start, end) as { count: number } | undefined;
  return row?.count ?? 0;
}

function snapshot(
  db: Database.Database,
  userId: string,
  nowMs: number,
  monthlyBudgetFen: number,
): AiBudgetSnapshot {
  const month = monthKey(nowMs);
  return {
    month,
    dailyRequests: dailyCount(db, userId, nowMs),
    monthlyReservedCostFen: monthlySpent(db, userId, month),
    monthlyBudgetFen,
  };
}

/**
 * Reserve the conservative cost inside BEGIN IMMEDIATE. The transaction is the
 * only place that checks daily/monthly capacity and inserts a pending row.
 */
export function reserveAiUsage(
  userId: string,
  inputTokens: number,
  rates: AiRates,
  options: AiBudgetOptions = {},
  db: Database.Database = database,
): AiReservationOutcome {
  if (!userId || asFiniteNonNegativeInteger(inputTokens) === null) {
    return { ok: false, reason: 'invalid_request', snapshot: null };
  }
  const requestedCostFen = estimateReservationCostFen(inputTokens, rates);
  if (!Number.isSafeInteger(requestedCostFen)) {
    return { ok: false, reason: 'invalid_request', snapshot: null };
  }
  const normalized = normalizeOptions(options);
  ensureAiUsageTable(db);
  const run = db.transaction(() => {
    cleanupPending(db, normalized.nowMs, normalized.pendingTtlMs);
    const before = snapshot(db, userId, normalized.nowMs, normalized.monthlyBudgetFen);
    if (before.dailyRequests >= normalized.maxDailyRequests) {
      return { ok: false, reason: 'daily_limit', snapshot: before } as AiReservationRejection;
    }
    if (before.monthlyReservedCostFen + requestedCostFen > normalized.monthlyBudgetFen) {
      return { ok: false, reason: 'monthly_budget', snapshot: before } as AiReservationRejection;
    }
    const month = monthKey(normalized.nowMs);
    const result = db
      .prepare(
        `INSERT INTO ai_usage
         (user_id, month, input_tokens, output_tokens, reserved_cost_fen, actual_cost_fen, status, created_at)
         VALUES (?, ?, ?, 0, ?, 0, 'pending', ?)`,
      )
      .run(userId, month, inputTokens, requestedCostFen, normalized.nowMs);
    const rowIdValue = result.lastInsertRowid;
    const rowId = typeof rowIdValue === 'bigint' ? Number(rowIdValue) : rowIdValue;
    const reservation: AiUsageReservation = {
      rowId,
      userId,
      month,
      inputTokens,
      reservedCostFen: requestedCostFen,
      createdAt: normalized.nowMs,
    };
    const after = snapshot(db, userId, normalized.nowMs, normalized.monthlyBudgetFen);
    return { ok: true, reservation, snapshot: after } as AiReservationResult;
  });
  return run.immediate();
}

/** Account provider usage and replace the reservation with actual integer cost. */
export function settleAiUsage(
  reservation: AiUsageReservation,
  usage: AiUsageTokens,
  rates: AiRates,
  db: Database.Database = database,
  options: AiBudgetOptions = {},
): boolean {
  const inputTokens = asFiniteNonNegativeInteger(usage.inputTokens);
  const outputTokens = asFiniteNonNegativeInteger(usage.outputTokens);
  if (inputTokens === null || outputTokens === null) return false;
  const actualCostFen = calculateCostFen({ inputTokens, outputTokens }, rates);
  if (!Number.isSafeInteger(actualCostFen)) return false;
  const normalized = normalizeOptions(options);
  ensureAiUsageTable(db);
  const run = db.transaction(() => {
    const current = db
      .prepare(
        `SELECT user_id, month, input_tokens, output_tokens, reserved_cost_fen, actual_cost_fen,
                status, created_at
         FROM ai_usage WHERE rowid = ?`,
      )
      .get(reservation.rowId) as UsageRow | undefined;
    if (!current || current.status !== 'pending') return false;
    const spentWithoutReservation = monthlySpent(db, current.user_id, current.month) - current.reserved_cost_fen;
    if (spentWithoutReservation + actualCostFen > normalized.monthlyBudgetFen) {
      db.prepare(
        `UPDATE ai_usage SET status = 'failed', reserved_cost_fen = 0, actual_cost_fen = 0
         WHERE rowid = ? AND status = 'pending'`,
      ).run(reservation.rowId);
      return false;
    }
    db.prepare(
      `UPDATE ai_usage
       SET input_tokens = ?, output_tokens = ?, reserved_cost_fen = 0, actual_cost_fen = ?, status = 'succeeded'
       WHERE rowid = ? AND status = 'pending'`,
    ).run(inputTokens, outputTokens, actualCostFen, reservation.rowId);
    return true;
  });
  return run.immediate();
}

/** Release an abandoned/failed provider request without deleting its audit row. */
export function releaseAiUsage(
  reservation: AiUsageReservation,
  db: Database.Database = database,
): boolean {
  ensureAiUsageTable(db);
  const run = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE ai_usage
         SET status = 'failed', reserved_cost_fen = 0, actual_cost_fen = 0
         WHERE rowid = ? AND status = 'pending'`,
      )
      .run(reservation.rowId);
    return result.changes === 1;
  });
  return run.immediate();
}

/** Read one row without exposing prompt/answer fields. Useful for diagnostics/tests. */
export function readAiUsageRow(
  rowId: number,
  db: Database.Database = database,
): (UsageRow & { rowid: number }) | null {
  ensureAiUsageTable(db);
  const row = db
    .prepare(
      `SELECT rowid, user_id, month, input_tokens, output_tokens, reserved_cost_fen,
              actual_cost_fen, status, created_at
       FROM ai_usage WHERE rowid = ?`,
    )
    .get(rowId) as (UsageRow & { rowid: number }) | undefined;
  return row ?? null;
}

// Short aliases keep the accounting API easy to discover without duplicating logic.
export const reserveBudget = reserveAiUsage;
export const settleBudget = settleAiUsage;
export const releaseBudget = releaseAiUsage;
