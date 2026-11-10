import { PrismaClient } from './generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Where the SQLite file lives.
 *
 * • Desktop (Tauri)  → FD_DATA_DIR is injected by the Rust shell, e.g.
 *                      C:\Users\<user>\AppData\Roaming\af.farday.roshan
 * • Dev / CLI        → ./data/farday.db inside the repo
 * • FD_DB_FILE       → explicit override (used by scripts & tests)
 */
export function dataDir(): string {
  const dir = process.env.FD_DATA_DIR || path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function databaseFile(): string {
  return process.env.FD_DB_FILE || path.join(dataDir(), 'farday.db');
}

export const BACKUP_DIR = (): string => {
  const dir = path.join(dataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (client) return client;
  const file = databaseFile();
  const adapter = new PrismaLibSql({ url: `file:${file}` });
  client = new PrismaClient({ adapter } as any);
  return client;
}

/** Test / maintenance helper — opens a second connection on another file. */
export function openDb(file: string): PrismaClient {
  const adapter = new PrismaLibSql({ url: `file:${file}` });
  return new PrismaClient({ adapter } as any);
}
