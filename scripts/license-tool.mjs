/**
 * ابزار لایسنس — تولید جفت‌کلید، صدور لایسنس، بازرسی و مدیریت.
 *
 *   npm run license                       # راهنمای سریع
 *   npm run license:keygen                # ساخت جفت‌کلید تازه (فقط یک بار!)
 *   npm run license:keygen -- --force     # ساخت مجدد (همه‌ی لایسنس‌های قبلی باطل می‌شوند)
 *   npm run license:issue -- --customer "شرکت الف" --kind yearly --machine A74PA-AW6C7-UAB99-PAPJU-VQWQW
 *   npm run license:issue -- --customer "شرکت الف" --kind custom --start 2026-11-10 --end 2027-11-09
 *   npm run license:verify -- --file license.key
 *   npm run license:list
 *   npm run license:revoke -- --id FR-LIC-…
 *   npm run license:export-pub           # کلید عمومی برای قرار دادن در بسته
 *
 * ## مهم‌ترین چیز
 * فایل کلید خصوصی (`license-keys/private.key`) **هرگز** نباید در گیت یا در
 * بسته‌ی نصب برود. اگر آن را گم کنید، دیگر نمی‌توانید لایسنس تازه صادر
 * کنید (لایسنس‌های صادرشده معتبر می‌مانند). اگر لو برود، هر کسی می‌تواند
 * لایسنس بسازد — در آن صورت `license:keygen --force` و ساخت نسخه‌ی جدید.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keysDir = path.join(root, 'license-keys');
const privatePath = path.join(keysDir, 'private.key');
const publicPath = path.join(keysDir, 'public.key');
const ledgerPath = path.join(keysDir, 'issued.json');
const bundledPublic = path.join(root, 'src-tauri', 'public-key', 'farday-public.b64');
/** منبع «مُهر» — build.rs این را داخل فایل اجرایی می‌پزد */
const sealSource = path.join(root, 'src-tauri', 'seal', 'public-key.txt');
const apiPublic = path.join(root, 'apps', 'api', 'public-key', 'farday-public.b64');

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/* ---------- آرگومان‌ها ---------- */
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

/* ---------- helpers (هم‌خوان با apps/api/src/common/license-kinds.ts) ---------- */
const KINDS = {
  trial: { label: 'آزمایشی', days: 7 },
  monthly: { label: 'ماهوار', days: 30 },
  yearly: { label: 'سالانه', days: 365 },
  custom: { label: 'دلخواه', days: null },
  perpetual: { label: 'ابد', days: null },
  machine: { label: 'فقط قفل دستگاه', days: null },
};
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MACHINE_KEY_LEN = 25;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * ورودی تاریخ کاربر → «YYYY-MM-DD» میلادی.
 *
 * مدیر برنامه تاریخ‌ها را شمسی می‌نویسد («۱۴۰۵/۰۸/۱۹» یا «1405-08-19»)؛
 * لایسنس اما همیشه میلادی ذخیره می‌شود (یک منبع حقیقت، مقایسه‌ی ساده).
 * قاعده‌ی تشخیص: سال ۱۳۰۰–۱۵۰۰ = شمسی، وگرنه میلادی.
 */
const toEnglishDigits = (s) => String(s ?? '')
  .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .trim();

function parseDateInput(input, label = 'تاریخ') {
  const raw = toEnglishDigits(input);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; // میلادی ISO
  const m = /^(\d{3,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(raw);
  if (!m) throw new Error(`${label} درست نیست («${input}»). نمونه: 1405/08/19 یا 2026-11-10`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y >= 1300 && y <= 1500) {
    const jalaali = require('jalaali-js');
    if (!jalaali.isValidJalaaliDate(y, mo, d)) throw new Error(`${label} شمسی درست نیست («${input}»).`);
    const g = jalaali.toGregorian(y, mo, d);
    return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const normalizeMachineKey = (input) => {
  const raw = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, MACHINE_KEY_LEN);
  return raw.replace(/(.{5})/g, '$1-').replace(/-$/, '');
};
const isValidMachineKey = (s) => String(s || '').replace(/-/g, '').length === MACHINE_KEY_LEN;

/** کلید دستگاه از یک بذر — همان الگوریتم برنامه (برای شبیه‌سازی/تست). */
export function machineKeyFromSeed(seedHex) {
  const h = sha256('farday:mk:' + seedHex);
  let out = '';
  for (let i = 0; i < MACHINE_KEY_LEN; i++) {
    out += ALPHABET[parseInt(h.slice(i * 2, i * 2 + 2), 16) % ALPHABET.length];
  }
  return out.replace(/(.{5})/g, '$1-').replace(/-$/, '');
}

/** دستور پشتیبانی: «کلید دستگاه این مشتری را از بذر بساز» (وقتی کلید را نمی‌خواند) */
export function machineKeyFromPhrase(phrase) {
  return machineKeyFromSeed(sha256(String(phrase || '').trim().toLowerCase()));
}

/* ---------- کلیدها ---------- */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: b64u(publicKey.export({ type: 'spki', format: 'der' })),
    privateKey: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
  };
}

function loadPrivate() {
  if (!fs.existsSync(privatePath)) {
    console.error(c.red('✘ کلید خصوصی پیدا نشد.'));
    console.error(`  اول این را اجرا کنید:  ${c.bold('npm run license:keygen')}`);
    process.exit(1);
  }
  const b = unb64u(fs.readFileSync(privatePath, 'utf8'));
  const key = crypto.createPrivateKey({ key: b, format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') {
    console.error(c.red('✘ کلید خصوصی Ed25519 نیست.'));
    process.exit(1);
  }
  return key;
}

function loadPublicB64() {
  for (const p of [publicPath, bundledPublic, apiPublic]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  }
  return '';
}

const sign = (text, key) => b64u(crypto.sign(null, Buffer.from(text, 'utf8'), key));

/* ---------- دفتر لایسنس‌های صادرشده ---------- */
function readLedger() {
  try { return JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch { return { nextId: 1, items: [] }; }
}
function writeLedger(l) {
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 2), 'utf8');
}

/* ---------- صدور ---------- */
export function buildLicense(input, privateKey) {
  const payload = {
    v: 1,
    id: input.id,
    customer: String(input.customer || '').trim(),
    kind: input.kind,
    start: String(input.start || '').slice(0, 10),
    end: input.end ? String(input.end).slice(0, 10) : null,
    machineKey: input.machineKey ? normalizeMachineKey(input.machineKey) : '',
    seats: Number.isFinite(Number(input.seats)) ? Math.max(0, Math.trunc(Number(input.seats))) : 1,
    note: String(input.note || '').trim(),
    issuedAt: input.issuedAt || new Date().toISOString(),
  };
  if (!KINDS[payload.kind]) throw new Error(`نوع لایسنس ناشناخته: ${payload.kind}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.start)) throw new Error('تاریخ شروع درست نیست (YYYY-MM-DD).');
  if (payload.end && !/^\d{4}-\d{2}-\d{2}$/.test(payload.end)) throw new Error('تاریخ پایان درست نیست (YYYY-MM-DD).');
  if (payload.end && payload.end < payload.start) throw new Error('تاریخ پایان قبل از شروع است.');
  payload.machineKey = payload.machineKey ? normalizeMachineKey(payload.machineKey) : '';
  if (payload.machineKey && !isValidMachineKey(payload.machineKey)) {
    throw new Error(`کلید دستگاه باید ${MACHINE_KEY_LEN} نویسه باشد.`);
  }
  if (payload.kind === 'perpetual' || payload.kind === 'machine') payload.end = null;
  const body = b64u(JSON.stringify(payload));
  const sig = sign(body, privateKey);
  return {
    payload,
    body,
    signature: sig,
    text: `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body}\n${sig}\n-----END FARDAY LICENSE-----`,
  };
}

export function inspectLicense(text, publicKeyB64) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('-----'));
  const hasFormat = /^FR-\d+$/.test(lines[0] || '');
  const body = hasFormat ? lines[1] : lines[0];
  const sig = hasFormat ? lines[2] : lines[1];
  if (!body || !sig) return { ok: false, reason: 'متن لایسنس ناقص است.' };
  let payload;
  try { payload = JSON.parse(unb64u(body).toString('utf8')); } catch { return { ok: false, reason: 'بدنه خوانده نشد.' }; }
  let signatureOk = false;
  try {
    const pub = crypto.createPublicKey({ key: unb64u(publicKeyB64), format: 'der', type: 'spki' });
    signatureOk = crypto.verify(null, Buffer.from(body, 'utf8'), pub, unb64u(sig));
  } catch { signatureOk = false; }
  return { ok: signatureOk, signatureOk, payload, reason: signatureOk ? undefined : 'امضا معتبر نیست.' };
}

/* ---------- دستورها ---------- */
function cmdKeygen(opts) {
  if (fs.existsSync(privatePath) && !opts.force) {
    console.log(c.yellow('⚠ کلید خصوصی از قبل هست — دست نزدم.'));
    console.log(`  کلید عمومی فعلی: ${c.dim(loadPublicB64().slice(0, 24) + '…')}`);
    console.log(`  برای ساخت مجدد (باطل‌شدن همه‌ی لایسنس‌های قبلی): ${c.bold('npm run license:keygen -- --force')}`);
    return 0;
  }
  if (opts.force && fs.existsSync(privatePath)) {
    const backup = `${privatePath}.bak-${Date.now()}`;
    fs.copyFileSync(privatePath, backup);
    console.log(c.dim(`نسخه‌ی قبلی کلید در ${path.basename(backup)} نگه داشته شد.`));
  }
  const kp = generateKeyPair();
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(privatePath, kp.privateKey + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(publicPath, kp.publicKey + '\n', 'utf8');
  for (const p of [bundledPublic, apiPublic, sealSource]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, kp.publicKey + '\n', 'utf8');
  }
  console.log(c.green('✔ جفت‌کلید Ed25519 ساخته شد.'));
  console.log(`  کلید خصوصی: ${privatePath} ${c.red('(هرگز این را جایی نفرستید/کامیت نکنید)')}`);
  console.log(`  کلید عمومی: ${publicPath}`);
  console.log(`  کلید عمومی برای بسته: ${path.relative(root, bundledPublic)}`);
  console.log(c.dim('\n  گام بعدی: نسخه‌ی برنامه را با همین کلید عمومی بسازید (npm run desktop:build).'));
  return 0;
}

function cmdIssue(opts) {
  const key = loadPrivate();
  const kind = String(opts.kind || 'yearly');
  if (!KINDS[kind]) {
    console.error(c.red(`✘ نوع لایسنس «${kind}» نیست.`));
    console.error(`  یکی از: ${Object.keys(KINDS).join(' | ')}`);
    return 1;
  }
  let start;
  let end = null;
  try {
    start = opts.start ? parseDateInput(opts.start, 'تاریخ شروع') : todayISO();
    end = opts.end ? parseDateInput(opts.end, 'تاریخ پایان') : null;
  } catch (e) {
    console.error(c.red('✘ ' + e.message));
    return 1;
  }
  if (!end && KINDS[kind].days != null) end = addDays(start, KINDS[kind].days - 1);
  const ledger = readLedger();
  const id = String(opts.id || `FR-LIC-${new Date().getFullYear()}-${String(ledger.nextId).padStart(4, '0')}`);
  /* ورودی کاربر ممکن است فاصله/خط تیره/حروف کوچک داشته باشد — یکسان‌سازی شود */
  const machineKey = opts.machine ? normalizeMachineKey(String(opts.machine)) : '';
  if (machineKey && !isValidMachineKey(machineKey)) {
    console.error(c.red(`✘ کلید دستگاه باید ${MACHINE_KEY_LEN} نویسه باشد (دریافت: ${opts.machine}).`));
    return 1;
  }
  let built;
  try {
    built = buildLicense({
      id, customer: opts.customer || '—', kind, start, end,
      machineKey, seats: opts.seats ?? 1, note: opts.note || '',
    }, key);
  } catch (e) {
    console.error(c.red('✘ ' + e.message));
    return 1;
  }
  const outFile = opts.out ? path.resolve(root, String(opts.out)) : path.join(keysDir, `${id}.lic`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, built.text + '\n', 'utf8');

  ledger.items.push({
    id, customer: built.payload.customer, kind, start, end: built.payload.end,
    machineKey: built.payload.machineKey, seats: built.payload.seats,
    issuedAt: built.payload.issuedAt, file: path.relative(root, outFile), revoked: false,
  });
  ledger.nextId = Number(ledger.nextId || 1) + 1;
  writeLedger(ledger);

  if (opts.json) {
    console.log(JSON.stringify({ ...built.payload, text: built.text }, null, 2));
    return 0;
  }
  console.log(c.green('✔ لایسنس صادر شد.'));
  console.log(`  شناسه: ${c.bold(id)}`);
  console.log(`  مشتری: ${built.payload.customer}`);
  console.log(`  نوع: ${KINDS[kind].label}`);
  console.log(`  شروع: ${start}   پایان: ${built.payload.end || 'ابد'}`);
  console.log(`  قفل دستگاه: ${built.payload.machineKey || c.yellow('بدون قفل دستگاه')}`);
  console.log(`  فایل: ${outFile}`);
  console.log('\n' + c.bold('— متن لایسنس (همین را برای مشتری بفرستید) —'));
  console.log(built.text);
  return 0;
}

function cmdVerify(opts) {
  const text = opts.file
    ? fs.readFileSync(path.resolve(root, String(opts.file)), 'utf8')
    : opts.text
      ? String(opts.text)
      : fs.readFileSync(0, 'utf8');
  const pub = opts.pub ? String(opts.pub) : loadPublicB64();
  if (!pub) { console.error(c.red('✘ کلید عمومی پیدا نشد.')); return 1; }
  const res = inspectLicense(text, pub);
  if (!res.ok) {
    console.error(c.red('✘ لایسنس معتبر نیست: ' + (res.reason || '')));
    return 1;
  }
  const p = res.payload;
  const today = todayISO();
  const expired = p.end && today > p.end;
  const notStarted = p.start && today < p.start;
  console.log(c.green('✔ امضا معتبر است.'));
  console.log(`  شناسه: ${p.id}   مشتری: ${p.customer}`);
  console.log(`  نوع: ${KINDS[p.kind]?.label || p.kind}`);
  console.log(`  بازه: ${p.start} … ${p.end || 'ابد'}   ${c.dim(`(امروز ${today})`)}`);
  if (expired) console.log(c.red('  ✘ منقضی شده است.'));
  else if (notStarted) console.log(c.yellow('  ⚠ هنوز شروع نشده است.'));
  else console.log(c.green('  ✔ همین حالا معتبر است.'));
  console.log(`  قفل دستگاه: ${p.machineKey || '—'}`);
  return res.ok ? 0 : 1;
}

function cmdList(opts) {
  const ledger = readLedger();
  if (!ledger.items.length) { console.log(c.dim('هنوز لایسنسی صادر نشده است.')); return 0; }
  const today = todayISO();
  console.log(c.bold(`${ledger.items.length} لایسنس صادرشده:`));
  for (const it of ledger.items) {
    const state = it.revoked ? c.red('باطل') : it.end && today > it.end ? c.yellow('منقضی') : c.green('فعال');
    console.log(`  ${it.id}  ${state}  ${it.customer}  ${KINDS[it.kind]?.label || it.kind}  ${it.start}…${it.end || 'ابد'}  ${it.machineKey || '—'}`);
  }
  return 0;
}

function cmdRevoke(opts) {
  const id = String(opts.id || opts._[0] || '');
  if (!id) { console.error(c.red('✘ شناسه لازم است: --id FR-LIC-…')); return 1; }
  const ledger = readLedger();
  const it = ledger.items.find((x) => x.id === id);
  if (!it) { console.error(c.red('✘ چنین لایسنسی در دفتر نیست.')); return 1; }
  it.revoked = true;
  it.revokedAt = new Date().toISOString();
  writeLedger(ledger);
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(path.join(keysDir, 'revoked.json'), JSON.stringify(
    ledger.items.filter((x) => x.revoked).map((x) => x.id), null, 2), 'utf8');
  console.log(c.yellow(`⚠ ${id} در دفتر «باطل» علامت زد.`));
  console.log(c.dim('  توجه: باطل‌کردن روی نسخه‌ی نصب‌شده اثر فوری ندارد (برنامه آفلاین است).'));
  console.log(c.dim('  برای توقف واقعی: لایسنس کوتاه‌مدت بدهید یا نسخه‌ی تازه با فهرست باطل‌شده بسازید.'));
  return 0;
}

function cmdExportPub() {
  const pub = loadPublicB64();
  if (!pub) { console.error(c.red('✘ کلید عمومی پیدا نشد. اول license:keygen.')); return 1; }
  console.log(pub);
  return 0;
}

function usage() {
  console.log(`${c.bold('ابزار لایسنس فردای روشن')} — Ed25519 + قفل دستگاه + قفل ساعت

  ${c.bold('npm run license:keygen')}                          ساخت جفت‌کلید (یک بار در عمر پروژه)
  ${c.bold('npm run license:issue -- --customer "شرکت الف"')}
      ${c.dim('--kind yearly|monthly|perpetual|custom|trial|machine')}
      ${c.dim('--machine A74PA-AW6C7-UAB99-PAPJU-VQWQW')}     کلید دستگاه مشتری
      ${c.dim('--start 2026-11-10  --end 2027-11-09')}          برای نوع «دلخواه»
      ${c.dim('--seats 3  --note "…"  --out licenses/x.lic  --json')}
  ${c.bold('npm run license:verify -- --file license-keys/FR-LIC-….lic')}
  ${c.bold('npm run license:list')}                            دفتر لایسنس‌ها
  ${c.bold('npm run license:revoke -- --id FR-LIC-…')}          باطل‌کردن در دفتر
  ${c.bold('npm run license:export-pub')}                      کلید عمومی (برای بسته)

${c.yellow('⚠')} فایل ${c.bold('license-keys/private.key')} را نه کامیت کنید نه برای کسی بفرستید.
   گم شدنش = نمی‌توانید لایسنس تازه بدهید (لایسنس‌های قبلی معتبر می‌مانند).
   لو رفتنش = هر کسی می‌تواند لایسنس بسازد → keygen --force + نسخه‌ی تازه.
`);
  return 0;
}

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const opts = args(argv.slice(1));
const commands = {
  keygen: cmdKeygen, issue: cmdIssue, verify: cmdVerify, list: cmdList,
  revoke: cmdRevoke, 'export-pub': cmdExportPub, help: usage,
};
const fn = commands[cmd];
if (!fn) { usage(); process.exit(1); }
process.exit(fn(opts) ?? 0);
