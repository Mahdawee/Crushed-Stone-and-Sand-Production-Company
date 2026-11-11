/**
 * پیدا کردن پوشه‌ی داده‌ی برنامه — همان‌جایی که «فردای روشن» دیتابیس را
 * نگه می‌دارد.
 *
 * ## مشکلی که این فایل حل می‌کند (شکار باگ دور ۳۴)
 * ابزار «صفر کردن» تا امروز پوشه‌ی داده را فقط این‌طور پیدا می‌کرد:
 *
 *     FD_DATA_DIR  →  وگرنه <ریشه‌ی مخزن>/data
 *
 * روی کمپیوتر مشتری، برنامه به‌صورت **نصب‌شده** اجرا می‌شود و داده در
 * `%APPDATA%\af.farday.roshan` است. یعنی ابزار هیچ‌وقت آن پوشه را نمی‌دید و
 * روی نسخه‌ی نصب‌شده پیام «فایل دیتابیس نیست» می‌داد — در حالی که مشتری
 * یک سال داده داشت. اپراتور هم فکر می‌کرد داده‌ای نمانده و سیستم آک است.
 *
 * ## قاعده‌ی پیدا کردن (به ترتیب اولویت)
 *   ۱) `--data-dir <مسیر>` روی خط فرمان — خواسته‌ی صریح اپراتور، همیشه برنده
 *   ۲) `--db-file <مسیر>` (یا `FD_DB_FILE`)
 *   ۳) `FD_RESET_DATA_DIR` — برای اسکریپت تحویل، بدون دست‌زدن به تنظیمات برنامه
 *   ۴) `FD_DATA_DIR` — همان قاعده‌ی خود برنامه
 *   ۵) **تشخیص خودکار نسخه‌ی نصب‌شده**:
 *        ویندوز: `%APPDATA%\af.farday.roshan` و `%LOCALAPPDATA%\...`
 *        لینوکس: `$XDG_DATA_HOME/af.farday.roshan` و `~/.local/share/...`
 *        مک:     `~/Library/Application Support/af.farday.roshan`
 *      از میان این‌ها، اولی که فایل `farday.db` دارد انتخاب می‌شود.
 *   ۶) `data/` کنار مخزن (حالت توسعه)
 *   ۷) آخرین سنگر: اولین مسیر تشخیص‌داده‌شده — حتی اگر دیتابیس نداشته باشد،
 *      تا صفحه بگوید «کجا را گشتم» (نه این‌که کورکورانه جای اشتباه را صفر کند).
 *
 * ⚠ هیچ‌جا مسیری **ساخته** نمی‌شود؛ این ماژول فقط می‌خواند. ساختن پوشه فقط
 * وقتی است که صفر کردن واقعاً اجرا شود (`reset-core.mjs`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** شناسه‌ی برنامه — همان `identifier` در `src-tauri/tauri.conf.json` */
export const APP_ID = 'af.farday.roshan';

/** نام فایل دیتابیس پیش‌فرض */
export const DB_NAME = 'farday.db';

export const exists = (p) => {
  try { return !!p && fs.existsSync(p); } catch { return false; }
};

/**
 * فهرست همه‌ی جاهایی که ممکن است پوشه‌ی داده باشد — با برچسب فارسی.
 * ترتیب = اولویت. این فهرست در صفحه‌ی ابزار هم نشان داده می‌شود تا اپراتور
 * بداند ابزار چه جاهایی را گشته است.
 *
 * @param {{root?: string, env?: NodeJS.ProcessEnv, platform?: string, home?: string}} [o]
 */
export function dataDirCandidates(o = {}) {
  const env = o.env || process.env;
  const platform = o.platform || process.platform;
  const home = o.home || env.HOME || env.USERPROFILE || os.homedir();
  const out = [];
  const add = (dir, source) => {
    if (!dir) return;
    const clean = path.resolve(String(dir));
    if (out.some((c) => c.dir === clean)) return;
    out.push({ dir: clean, source });
  };

  /* ۵-الف) ویندوز — همان مسیری که پوسته‌ی Tauri به برنامه می‌دهد */
  if (env.APPDATA) add(path.join(env.APPDATA, APP_ID), 'APPDATA');
  if (env.LOCALAPPDATA) add(path.join(env.LOCALAPPDATA, APP_ID), 'LOCALAPPDATA');
  /*
   * اگر ابزار روی لینوکس/مک اجرا شود ولی داده‌ی یک نصب ویندوزی (مثلاً دیسک
   * کاپی‌شده) را بخواهد صفر کند، این مسیر هم گشته می‌شود. روی ویندوز هم
   * `HOME\AppData\Roaming` همان APPDATA است (بالا دیده شده).
   */
  if (home) {
    add(path.join(home, 'AppData', 'Roaming', APP_ID), 'AppData/Roaming');
    /* ۵-ب) مک */
    add(path.join(home, 'Library', 'Application Support', APP_ID), 'Library/Application Support');
    /* ۵-پ) لینوکس */
    add(path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP_ID), 'XDG_DATA_HOME');
    /* مسیر قدیمی/جایگزین بعضی نصب‌ها */
    add(path.join(home, `.${APP_ID}`), 'home');
  }
  /* ۶) حالت توسعه — `data/` کنار مخزن */
  const root = o.root ? path.resolve(o.root) : '';
  if (root) add(path.join(root, 'data'), 'repo');
  if (platform === 'tmp') add(path.join(os.tmpdir(), APP_ID), 'temp');

  return out;
}

/** مسیرهای داده از آرگومان‌های خط فرمان (`--data-dir X` / `--data-dir=X`). */
export function dataDirFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--data-dir' || a === '--data') {
      const v = argv[i + 1];
      if (v && !String(v).startsWith('--')) return { dir: v };
    }
    const m = a.match(/^--(?:data-dir|data)=(.+)$/);
    if (m) return { dir: m[1] };
  }
  return null;
}

/** مسیر فایل دیتابیس از آرگومان‌ها (`--db-file X` / `--db-file=X`). */
export function dbFileFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--db-file' || a === '--db') {
      const v = argv[i + 1];
      if (v && !String(v).startsWith('--')) return v;
    }
    const m = a.match(/^--(?:db-file|db)=(.+)$/);
    if (m) return m[1];
  }
  return '';
}

/**
 * تصمیم نهایی: کدام پوشه‌ی داده و کدام فایل دیتابیس؟
 *
 * @param {{root?: string, env?: NodeJS.ProcessEnv, argv?: string[], platform?: string, home?: string}} [o]
 * @returns {{dataDir: string, dbFile: string, source: string, explicit: boolean,
 *            dbExists: boolean, searched: Array<{dir: string, source: string, hasDb: boolean}>, note: string}}
 */
export function resolveDataDir(o = {}) {
  const env = o.env || process.env;
  /*
   * ⚠ پیش‌فرض `process.argv` است، نه `[]`. باگ (دور ۳۴): وقتی فراخوان
   * `argv` نمی‌داد، `--data-dir` روی خط فرمان **کاملاً نادیده** گرفته می‌شد و
   * ابزار بی‌صدا سراغ پوشه‌ی مخزن می‌رفت.
   */
  const argv = Array.isArray(o.argv) ? o.argv : process.argv.slice(2);
  const argDir = dataDirFromArgv(argv);
  const argDb = dbFileFromArgv(argv);

  const searched = dataDirCandidates(o).map((c) => ({
    ...c,
    hasDb: exists(path.join(c.dir, DB_NAME)),
  }));

  /* ── ۱) خواسته‌ی صریح اپراتور ── */
  if (argDir) {
    const dir = path.resolve(String(argDir.dir));
    const dbFile = argDb ? path.resolve(argDb) : path.join(dir, DB_NAME);
    return {
      dataDir: dir, dbFile, source: '--data-dir', explicit: true,
      dbExists: exists(dbFile) || exists(path.join(dir, DB_NAME)),
      searched,
      note: '',
    };
  }
  if (argDb) {
    const dbFile = path.resolve(String(argDb));
    return {
      dataDir: path.dirname(dbFile), dbFile, source: '--db-file', explicit: true,
      dbExists: exists(dbFile), searched, note: '',
    };
  }

  /* ── ۲) متغیرهای محیطی — به همان ترتیب اولویت ── */
  const envDb = String(env.FD_DB_FILE || '').trim();
  if (envDb) {
    const dbFile = path.resolve(envDb);
    return {
      dataDir: path.dirname(dbFile), dbFile, source: 'FD_DB_FILE', explicit: true,
      dbExists: exists(dbFile), searched, note: '',
    };
  }
  for (const [key, source] of [['FD_RESET_DATA_DIR', 'FD_RESET_DATA_DIR'], ['FD_DATA_DIR', 'FD_DATA_DIR']]) {
    const v = String(env[key] || '').trim();
    if (!v) continue;
    const dir = path.resolve(v);
    const dbFile = path.join(dir, DB_NAME);
    return {
      dataDir: dir, dbFile, source, explicit: true,
      dbExists: exists(dbFile), searched, note: '',
    };
  }

  /* ── ۳) تشخیص خودکار: اولی که دیتابیس دارد ── */
  const withDb = searched.find((c) => c.hasDb);
  if (withDb) {
    const dbFile = path.join(withDb.dir, DB_NAME);
    return {
      dataDir: withDb.dir, dbFile, source: `${withDb.source} (تشخیص خودکار)`, explicit: false,
      dbExists: true, searched,
      note: withDb.source === 'APPDATA' || withDb.source === 'LOCALAPPDATA' || withDb.source === 'AppData/Roaming'
        ? 'نسخه‌ی نصب‌شده پیدا شد.'
        : '',
    };
  }

  /* ── ۴) هیچ دیتابیسی نیست؛ یک مسیر معقول برمی‌گردانیم تا پیام روشن باشد ── */
  const first = searched[0] || { dir: path.join(o.root || process.cwd(), 'data'), source: 'repo' };
  /* اگر نسخه‌ی نصب‌شده مسیرش وجود دارد (حتی بی‌دیتابیس) همان را نشان بده */
  const existingDir = searched.find((c) => exists(c.dir));
  const pick = existingDir || first;
  return {
    dataDir: pick.dir,
    dbFile: path.join(pick.dir, DB_NAME),
    source: pick.source,
    explicit: false,
    dbExists: false,
    searched,
    note: 'هیچ دیتابیسی در مسیرهای شناخته‌شده پیدا نشد — با --data-dir مسیر را بدهید.',
  };
}

/** خلاصه‌ی کوتاه برای لاگ/صفحه: چرا این پوشه انتخاب شد. */
export function explain(res) {
  const lines = [`پوشه‌ی داده: ${res.dataDir}`, `منبع: ${res.source}`];
  if (res.note) lines.push(res.note);
  if (res.searched?.length) {
    lines.push('جاهایی که گشته شد:');
    for (const c of res.searched) lines.push(`  ${c.hasDb ? '✔' : '·'} ${c.dir}  [${c.source}]`);
  }
  return lines.join('\n');
}
