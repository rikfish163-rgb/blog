import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const configuredPath = process.env.BLOG_DATABASE_PATH?.trim();
export const databasePath = configuredPath || '.data/blog.sqlite';

mkdirSync(dirname(databasePath), { recursive: true });

export const database: Database.Database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('busy_timeout = 5000');
database.pragma('foreign_keys = ON');
