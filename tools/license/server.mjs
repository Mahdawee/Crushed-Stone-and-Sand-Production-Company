/**
 * ابزار لایسنس با رابط گرافیکی — «پنل مالک».
 *
 *   npm run license:ui          →  http://127.0.0.1:4321
 *
 * چرا: مدیریت کلیدها با ترمینال برای کار روزمره (صدور لایسنس برای مشتری،
 * تمدید، فهرست) خطاپذیر است. این سرور یک صفحه‌ی کامل می‌دهد:
 *
 *   • وضعیت کلیدها (ساخته شده/نیست، اثر انگشت، تاریخ)
 *   • ساخت جفت‌کلید + خروجی کلید عمومی برای بسته
 *   • صدور لایسنس: مشتری، نوع دوره، تاریخ شمسی/میلادی، کلید دستگاه، صندلی
 *   • فهرست لایسنس‌های صادرشده + وضعیت (فعال/منقضی/باطل) + کاپی متن
 *   • بازرسی متن لایسنس (امضا معتبر؟ منقضی؟ برای کدام دستگاه؟)
 *   • باطل‌کردن در دفتر
 *
 * ## امنیت (مهم)
 * سرور فقط روی `127.0.0.1` گوش می‌دهد و به **همین کمپیوتر** محدود است.
 * کلید خصوصی فقط در `license-keys/` خوانده می‌شود و **هرگز** از طریق HTTP
 * برگردانده نمی‌شود. برای هر درخواست تغییردهنده یک توکن CSRF لازم است که
 * فقط در همان صفحه (same-origin) تولید می‌شود، تا یک تب مخرب در مرورگر
 * نتواند لایسنس بسازد.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
/*
 * پوشه‌ی کلیدها — قابل تغییر با `FD_LICENSE_KEYS_DIR`.
 *
 * چرا: تست‌ها نباید به کلید خصوصی **واقعی** پروژه دست بزنند. با این متغیر،
 * تست یک جفت‌کلید موقت می‌سازد و امضاها با کلید تولید قاطی نمی‌شوند.
 * در استفاده‌ی روزمره همان `license-keys/` است.
 */
const keysDir = process.env.FD_LICENSE_KEYS_DIR
  ? path.resolve(process.env.FD_LICENSE_KEYS_DIR)
  : path.join(root, 'license-keys');
const privatePath = path.join(keysDir, 'private.key');
const publicPath = path.join(keysDir, 'public.key');
const ledgerPath = path.join(keysDir, 'issued.json');
const bundledPublic = path.join(root, 'src-tauri', 'public-key', 'farday-public.b64');
const apiPublic = path.join(root, 'apps', 'api', 'public-key', 'farday-public.b64');
const sealSource = path.join(root, 'src-tauri', 'seal', 'public-key.txt');

const PORT = Number(process.env.FD_LICENSE_UI_PORT || 4321);
const HOST = '127.0.0.1';

/* ---------- crypto helpers (هم‌خوان با license.ts) ---------- */
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MK_LEN = 25;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normalizeMachineKey = (v) =>
  String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, MK_LEN).replace(/(.{5})/g, '$1-').replace(/-$/, '');
const isValidMachineKey = (v) => normalizeMachineKey(v).replace(/-/g, '').length === MK_LEN;

/*
 * نوع‌های دوره — **یک** منبع حقیقت.
 *
 * باگ: این جدول سه جا کپی شده بود (سرور ابزار، صفحه‌ی HTML، CLI) و با هم
 * فرق داشتند: `--kind machine` در CLI معنا داشت ولی در صفحه نبود/برعکس.
 * حالا از همان فهرست API خوانده می‌شود؛ صفحه هم آن را از `/api/state`
 * می‌گیرد.
 */
const KIND_DAYS = { trial: 7, monthly: 30, yearly: 365, custom: null, perpetual: null, machine: null };

/** برچسب فارسی نوع — برای پیام‌ها و ستون «نوع» */
const KIND_LABELS = {
  trial: 'آزمایشی', monthly: 'ماهوار', yearly: 'سالانه',
  perpetual: 'ابد (همیشگی)', custom: 'دلخواه', machine: 'ماشین (قدیمی)',
};

/**
 * بازه‌ی تاریخ را با نوع دوره هم‌تراز می‌کند.
 *
 * درخواست کاربر: «تاریخ شروع خوب است همیشه امروز باشد و تاریخ شروع و ختم
 * باید مرتبط با انتخاب نوع لایسنس تطبیق شود؛ مثلاً آزمایشی را تاریخ‌ها از
 * امروز تا هفت روز تنظیم کنند».
 *
 * ## باگ‌هایی که این تابع می‌بندد
 * • تاریخ شروع هرچه کاربر می‌نوشت پذیرفته می‌شد — حتی گذشته یا سال آینده.
 *   لایسنسی که «از فردا» شروع شود روی دستگاه مشتری «معتبر نیست» می‌دهد و
 *   مشتری فکر می‌کند کلید خراب است. حالا شروعِ دوره‌های زمانی **همیشه
 *   امروز** است (سرور خودش می‌گذارد، به کلاینت اعتماد نمی‌کند).
 * • پایانِ ارسالی نادیده گرفته می‌شد: با نوع «آزمایشی» می‌شد یک لایسنس
 *   یک‌ساله صادر کرد (فقط برچسبش «آزمایشی» بود). حالا برای دوره‌های زمانی،
 *   پایان **از نوع دوره** حساب می‌شود و اگر پایانِ ناسازگار بفرستید، خطای
 *   روشن می‌گیرید — نه یک لایسنس با برچسب دروغ.
 * • «ابد» و «ماشین» همیشه پایان ندارند (حتی اگر تاریخ بفرستید).
 */
function resolveRange(kind, inputStart, inputEnd, today = todayISO()) {
  const startISO = parseDateToISO(inputStart || today, 'تاریخ شروع');
  const endISO = inputEnd ? parseDateToISO(inputEnd, 'تاریخ پایان') : null;
  const days = KIND_DAYS[kind];
  if (days == null) {
    /* ابد/دلخواه: «ابد» پایان ندارد، «دلخواه» پایان دست کاربر است */
    if (kind === 'perpetual' || kind === 'machine') return { start: startISO, end: null, forced: false };
    return { start: startISO, end: endISO, forced: false };
  }
  /*
   * دوره‌ی زمانی: شروع باید امروز باشد تا لایسنس همین حالا کار کند.
   * اگر کاربر تاریخ گذشته داده باشد، صریح می‌گوییم جایگزین شد.
   */
  const start = today;
  const end = addDays(start, days - 1);
  if (startISO !== today) {
    return { start, end, forced: true, note: `تاریخ شروع با امروز (${today}) جایگزین شد.` };
  }
  if (endISO && endISO !== end) {
    throw new Error(
      `با نوع «${KIND_LABELS[kind] || kind}» تاریخ پایان باید ${end} باشد (${days} روز از امروز). ` +
      'برای بازه‌ی دلخواه، نوع «دلخواه» را انتخاب کنید.',
    );
  }
  return { start, end, forced: false };
}

/**
 * ورودی تاریخ (شمسی یا میلادی، با رقم فارسی/عربی) → میلادی ISO.
 *
 * چرا در سرور: کلاینت ممکن است هر رشته‌ای بفرستد؛ اعتبارسنجی باید یک جا و
 * قابل اعتماد باشد. سال ۱۳۰۰–۱۵۰۰ = شمسی، وگرنه میلادی.
 */
function parseDateToISO(input, label = 'تاریخ') {
  const raw = String(input ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();
  if (!raw) throw new Error(`${label} لازم است.`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = /^(\d{3,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(raw);
  if (!m) throw new Error(`${label} درست نیست («${input}»). نمونه: ۱۴۰۵/۰۸/۱۹ یا 2026-11-10`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y >= 1300 && y <= 1500) {
    const j = jalaali();
    if (!j.isValidJalaaliDate(y, mo, d)) throw new Error(`${label} شمسی درست نیست («${input}»).`);
    const g = j.toGregorian(y, mo, d);
    return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`${label} درست نیست («${input}»).`);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** jalaali-js به‌صورت CommonJS — یک بار بارگذاری و کش می‌شود */
let jalaaliMod = null;
function jalaali() {
  if (!jalaaliMod) {
    /* createRequire از ماژول node:module می‌آید (نه crypto) */
    const { createRequire } = nodeModule;
    const req = createRequire(import.meta.url);
    jalaaliMod = req('jalaali-js');
  }
  return jalaaliMod;
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------- keys ---------- */
function keysState() {
  const hasPrivate = fs.existsSync(privatePath);
  const pub = fs.existsSync(publicPath) ? fs.readFileSync(publicPath, 'utf8').trim() : '';
  const bundled = fs.existsSync(bundledPublic) ? fs.readFileSync(bundledPublic, 'utf8').trim() : '';
  return {
    hasPrivate,
    publicKey: pub,
    fingerprint: pub ? sha256(pub).slice(0, 16) : '',
    bundledMatches: Boolean(pub) && pub === bundled,
    bundledExists: Boolean(bundled),
    createdAt: hasPrivate ? fs.statSync(privatePath).mtime.toISOString() : null,
  };
}

function loadPrivate() {
  if (!fs.existsSync(privatePath)) throw new Error('کلید خصوصی ساخته نشده است. اول «ساخت جفت‌کلید» را بزنید.');
  const key = crypto.createPrivateKey({ key: unb64u(fs.readFileSync(privatePath, 'utf8')), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('کلید خصوصی Ed25519 نیست.');
  return key;
}

const sign = (text, key) => b64u(crypto.sign(null, Buffer.from(text, 'utf8'), key));

/* ---------- ledger ---------- */
function readLedger() {
  try {
    const j = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!Array.isArray(j.items)) j.items = [];
    if (!j.nextId) j.nextId = j.items.length + 1;
    return j;
  } catch {
    return { nextId: 1, items: [] };
  }
}
function writeLedger(l) {
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 2), 'utf8');
}

/**
 * خواندن «درخواست تمدید» که خودِ برنامه ساخته است.
 *
 * قالب:
 *   -----BEGIN FARDAY RENEW REQUEST-----
 *   <base64url JSON>
 *   SUM:<16 hex>
 *   -----END FARDAY RENEW REQUEST-----
 *
 * checksum فقط دست‌کاری تصادفی/ناقص‌شدن را می‌گیرد؛ مرجع واقعی هویت،
 * کلید خصوصیِ امضای لایسنس است.
 */
function parseRenewRequest(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('متن درخواست خالی است.');
  if (!/BEGIN FARDAY RENEW REQUEST/.test(text)) {
    throw new Error('این متن، درخواست تمدید «فردای روشن» نیست.');
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /BEGIN FARDAY RENEW REQUEST/.test(l));
  const j = lines.findIndex((l) => /END FARDAY RENEW REQUEST/.test(l));
  if (i < 0 || j <= i) throw new Error('ساختار فایل درخواست ناقص است.');
  const payloadLine = lines.slice(i + 1, j).find((l) => !/^SUM:/.test(l));
  const sumLine = lines.slice(i + 1, j).find((l) => /^SUM:/.test(l));
  if (!payloadLine) throw new Error('بدنه‌ی درخواست پیدا نشد.');

  let obj;
  try { obj = JSON.parse(Buffer.from(payloadLine, 'base64url').toString('utf8')); }
  catch { throw new Error('بدنه‌ی درخواست خوانا نیست.'); }
  if (obj?.kind !== 'farday-renew-request') throw new Error('نوع درخواست نامعتبر است.');

  const want = sha256(payloadLine).slice(0, 16);
  const got = sumLine ? sumLine.replace(/^SUM:/, '') : '';
  if (got && got !== want) {
    /* هشدار می‌دهیم ولی متوقف نمی‌کنیم: درخواست تنها «راهنما»ی اپراتور است */
    obj.checksumMismatch = true;
  }
  if (!/^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/.test(String(obj.machineKey || ''))) {
    throw new Error('کلید دستگاه در درخواست معتبر نیست.');
  }
  return obj;
}

/* ---------- issue / inspect ---------- */
function buildLicense(input, privateKey) {
  const kind = String(input.kind || 'yearly');
  if (!(kind in KIND_DAYS)) {
    throw new Error(`نوع دوره ناشناخته: ${kind} — یکی از: ${Object.keys(KIND_DAYS).join(' | ')}`);
  }
  /* بازه از نوع دوره ساخته می‌شود، نه از ورودی آزاد کلاینت (باگ: تاریخ ناسازگار) */
  const range = resolveRange(kind, input.start, input.end, input.today || todayISO());
  const start = range.start;
  const end = range.end;
  if (end && end < start) throw new Error('تاریخ پایان قبل از شروع است.');
  const machineKey = input.machineKey ? normalizeMachineKey(input.machineKey) : '';
  if (machineKey && !isValidMachineKey(machineKey)) throw new Error(`کلید دستگاه باید ${MK_LEN} نویسه باشد.`);
  const payload = {
    v: 1,
    id: String(input.id),
    customer: String(input.customer || '').trim(),
    kind,
    start,
    end,
    machineKey,
    seats: Math.max(0, Math.trunc(Number(input.seats) || 0)),
    note: String(input.note || '').trim(),
    issuedAt: new Date().toISOString(),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.start)) throw new Error('تاریخ شروع درست نیست.');
  const body = b64u(JSON.stringify(payload));
  const sig = sign(body, privateKey);
  return {
    payload,
    text: `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body}\n${sig}\n-----END FARDAY LICENSE-----`,
    rangeNote: range.forced ? range.note : undefined,
    days: KIND_DAYS[kind],
  };
}

function inspect(text, publicKey) {
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
    const pub = crypto.createPublicKey({ key: unb64u(publicKey), format: 'der', type: 'spki' });
    signatureOk = crypto.verify(null, Buffer.from(body, 'utf8'), pub, unb64u(sig));
  } catch { signatureOk = false; }
  const today = todayISO();
  return {
    ok: signatureOk, signatureOk, payload,
    reason: signatureOk ? undefined : 'امضا معتبر نیست (متن تغییر کرده یا کلید عمومی دیگری است).',
    expired: Boolean(payload?.end && today > payload.end),
    notStarted: Boolean(payload?.start && today < payload.start),
  };
}

/* ---------- تاریخ شمسی برای نمایش ---------- */
const require_ = crypto; // فقط برای اینکه ESLint از require در ESM شکایت نکند
async function jalaaliLabel(iso) {
  try {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const j = jalaali().toJalaali(y, m, d);
    const months = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];
    return `${j.jd} ${months[j.jm - 1]} ${j.jy}`.replace(/[0-9]/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)]);
  } catch { return iso; }
}
void require_;

/** میلادی ISO → «۱۴۰۵/۰۸/۱۹» با رقم فارسی (پیش‌فرض کادرهای تاریخ) */
async function jalaaliInputLabel(iso) {
  try {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const j = jalaali().toJalaali(y, m, d);
    const s = `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
    return s.replace(/[0-9]/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[Number(x)]);
  } catch { return iso; }
}

/* ---------- CSRF ---------- */
const CSRF = crypto.randomBytes(18).toString('hex');

/* ---------- HTTP ---------- */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

/*
 * خواندن بدنه، با سقفِ حجم.
 *
 * ── باگ (شکار باگ دور ۳۰) ────────────────────────────────────────────────
 * در نسخه‌ی قبلی بعد از رد کردن («خارج از حد مجاز») فقط `req.destroy` صدا
 * زده می‌شد ولی `reject` **نشد**؛ پرامیس معلق می‌ماند، پاسخ HTTP هرگز
 * فرستاده نمی‌شد و اتصال باز می‌ماند. حالا هم پرامیس رد می‌شود و هم
 * `settled` نگه داشته می‌شود تا یک‌بار بیشتر حل/رد نشود.
 */
const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  let settled = false;
  const chunks = [];
  /*
   * ⚠ سوکت را نمی‌کشیم: `req.destroy()` باعث ECONNRESET می‌شد و مرورگر
   * پیام خطای شبکه می‌دید، نه پیام فارسی «بدنه بیش از حد بزرگ است».
   * فقط خواندن را متوقف می‌کنیم تا لایه‌ی بالاتر پاسخ ۴۰۰ را بفرستد.
   */
  const fail = (msg) => {
    if (settled) return;
    settled = true;
    chunks.length = 0;
    try { req.pause(); } catch { /* ignore */ }
    reject(new Error(msg));
  };
  req.on('data', (c) => {
    if (settled) return;
    size += c.length;
    if (size > 200_000) { fail('بدنه‌ی درخواست بیش از حد بزرگ است.'); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (settled) return;
    settled = true;
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch { reject(new Error('JSON نامعتبر.')); }
  });
  req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  req.on('aborted', () => { if (!settled) { settled = true; reject(new Error('درخواست نیمه‌کاره قطع شد.')); } });
});

/** فقط درخواست‌های same-origin و با توکن CSRF تغییردهنده پذیرفته می‌شوند. */
function guardMutation(req) {
  const origin = req.headers.origin || '';
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('مبدأ درخواست مجاز نیست.');
  const token = req.headers['x-license-csrf'];
  if (token !== CSRF) throw new Error('توکن امنیتی نامعتبر است — صفحه را دوباره باز کنید.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    /* صفحه */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = fs.readFileSync(path.join(here, 'ui.html'), 'utf8').replace('__CSRF__', CSRF);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    /* وضعیت کلیدها و دفتر */
    if (req.method === 'GET' && p === '/api/state') {
      const ledger = readLedger();
      const today = todayISO();
      const items = await Promise.all(ledger.items.map(async (it) => ({
        ...it,
        state: it.revoked ? 'revoked' : it.end && today > it.end ? 'expired' : 'active',
        startLabel: await jalaaliLabel(it.start),
        endLabel: it.end ? await jalaaliLabel(it.end) : 'ابد',
      })));
      json(res, 200, {
        keys: keysState(),
        items: items.reverse(),
        nextId: `FR-LIC-${new Date().getFullYear()}-${String(ledger.nextId).padStart(4, '0')}`,
        today,
        todayLabel: await jalaaliLabel(today),
        /* «۱۴۰۵/۰۸/۱۹» برای پیش‌فرض فورم — قبلاً کلاینت خودش (غلط) می‌ساخت */
        todayJalali: await jalaaliInputLabel(today),
        kinds: Object.keys(KIND_DAYS),
        /*
         * فراداده‌ی نوع‌ها به یک منبع حقیقت می‌آید: صفحه دیگر جدول خودش را
         * ندارد. `issuable` = نوع‌هایی که برای صدور تازه پیشنهاد می‌شوند
         * («ماشین» قدیمی حذف شد چون با «ابد» عین هم بود).
         */
        kindMeta: Object.entries(KIND_DAYS).map(([value, days]) => ({
          value, days, label: KIND_LABELS[value] || value,
          issuable: value !== 'machine',
          hint: days == null
            ? (value === 'custom' ? 'بازه‌ی دلخواه' : 'بدون تاریخ پایان — قفل دستگاه فعال')
            : `${days} روز از امروز`,
          start: value === 'perpetual' || value === 'machine' ? today : today,
          end: days == null ? null : addDays(today, days - 1),
        })),
      });
      return;
    }

    /* ساخت جفت‌کلید */
    if (req.method === 'POST' && p === '/api/keygen') {
      guardMutation(req);
      /*
       * ⚠ حفاظ امنیتی (دور ۱۶): اگر این سرور با پوشه‌ی کلید **جایگزین**
       * (`FD_LICENSE_KEYS_DIR`) بالا آمده باشد، هرگز نباید کلید عمومی داخل
       * بسته را عوض کند.
       *
       * چه اتفاقی افتاده بود: تست خودکار ابزار را با کلید موقت بالا می‌آورد
       * و `keygen force` می‌زد؛ کد بی‌توجه به `keysDir`، کلید عمومی داخل
       * `apps/api/public-key/` و `src-tauri/public-key/` را هم بازنویسی
       * می‌کرد. نتیجه: لایسنس‌های واقعی مشتریان با کلید جدید نمی‌خواندند.
       * حالا در این حالت فقط پوشه‌ی موقت تغییر می‌کند.
       */
      const isolated = Boolean(process.env.FD_LICENSE_KEYS_DIR);
      const body = await readBody(req);
      if (fs.existsSync(privatePath) && !body.force) {
        json(res, 409, { ok: false, message: 'کلید خصوصی از قبل هست. برای ساخت مجدد، تأیید کنید.' });
        return;
      }
      if (body.force && fs.existsSync(privatePath)) {
        fs.copyFileSync(privatePath, `${privatePath}.bak-${Date.now()}`);
      }
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const pub = b64u(publicKey.export({ type: 'spki', format: 'der' }));
      const priv = b64u(privateKey.export({ type: 'pkcs8', format: 'der' }));
      fs.mkdirSync(keysDir, { recursive: true });
      fs.writeFileSync(privatePath, priv + '\n', { encoding: 'utf8', mode: 0o600 });
      fs.writeFileSync(publicPath, pub + '\n', 'utf8');
      if (!isolated) {
        for (const dst of [bundledPublic, apiPublic, sealSource]) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, pub + '\n', 'utf8');
        }
      }
      json(res, 200, {
        ok: true,
        message: isolated
          ? 'جفت‌کلید تست ساخته شد (کلید داخل بسته دست نخورد).'
          : 'جفت‌کلید ساخته شد و کلید عمومی در بسته کاپی شد.',
        keys: keysState(),
      });
      return;
    }

    /* صدور لایسنس */
    if (req.method === 'POST' && p === '/api/issue') {
      guardMutation(req);
      const body = await readBody(req);
      const privateKey = loadPrivate();
      const ledger = readLedger();
      const id = String(body.id || `FR-LIC-${new Date().getFullYear()}-${String(ledger.nextId).padStart(4, '0')}`);
      /*
       * تاریخ‌ها در سرور یکسان‌سازی می‌شوند (شمسی → میلادی) و **با نوع دوره
       * تطبیق داده می‌شوند**: دوره‌های زمانی همیشه از امروز شروع می‌شوند و
       * پایانشان از روی همان نوع حساب می‌شود.
       */
      const today = todayISO();
      const startISO = body.start ? parseDateToISO(body.start, 'تاریخ شروع') : today;
      const endISO = body.end ? parseDateToISO(body.end, 'تاریخ پایان') : null;
      const built = buildLicense({ ...body, id, start: startISO, end: endISO, today }, privateKey);
      fs.mkdirSync(keysDir, { recursive: true });
      const file = path.join(keysDir, `${id}.lic`);
      fs.writeFileSync(file, built.text + '\n', 'utf8');
      ledger.items.push({
        id,
        customer: built.payload.customer,
        kind: built.payload.kind,
        start: built.payload.start,
        end: built.payload.end,
        machineKey: built.payload.machineKey,
        seats: built.payload.seats,
        note: built.payload.note,
        issuedAt: built.payload.issuedAt,
        file: path.relative(root, file),
        revoked: false,
      });
      ledger.nextId = Number(ledger.nextId || 1) + 1;
      writeLedger(ledger);
      json(res, 200, {
        ok: true,
        message: `لایسنس ${id} صادر شد` +
          (built.payload.end ? ` — ${built.payload.start} تا ${built.payload.end}.` : ' — بدون تاریخ پایان.') +
          (built.rangeNote ? ` (${built.rangeNote})` : ''),
        id,
        text: built.text,
        payload: built.payload,
        endLabel: built.payload.end ? await jalaaliLabel(built.payload.end) : 'ابد',
        startLabel: await jalaaliLabel(built.payload.start),
        rangeNote: built.rangeNote || null,
        /*
         * آدرس ذخیره‌ی فایل `.lic` — درخواست کاربر: «گزینه‌ی ذخیره به‌عنوان
         * فایل هم بعد از ساخت لایسنس باشد». فایل از همان لحظه روی دیسک
         * اپراتور هست؛ این آدرس برای دکمه‌ی «ذخیره فایل» صفحه است و با
         * `content-disposition: attachment` فرستاده می‌شود (ذخیره، نه نمایش).
         */
        downloadUrl: `/api/download?id=${encodeURIComponent(id)}`,
        savedFile: path.relative(root, file),
      });
      return;
    }

    /* بازرسی متن */
    if (req.method === 'POST' && p === '/api/verify') {
      guardMutation(req);
      const body = await readBody(req);
      const keys = keysState();
      const pub = String(body.publicKey || keys.publicKey || '').trim();
      if (!pub) { json(res, 400, { ok: false, message: 'کلید عمومی موجود نیست.' }); return; }
      const r = inspect(body.text, pub);
      json(res, 200, {
        ...r,
        startLabel: r.payload ? await jalaaliLabel(r.payload.start) : '',
        endLabel: r.payload?.end ? await jalaaliLabel(r.payload.end) : 'ابد',
      });
      return;
    }

    /* باطل‌کردن */
    if (req.method === 'POST' && p === '/api/revoke') {
      guardMutation(req);
      const body = await readBody(req);
      const ledger = readLedger();
      const it = ledger.items.find((x) => x.id === body.id);
      if (!it) { json(res, 404, { ok: false, message: 'چنین لایسنسی در دفتر نیست.' }); return; }
      it.revoked = Boolean(body.revoked ?? true);
      it.revokedAt = it.revoked ? new Date().toISOString() : null;
      writeLedger(ledger);
      json(res, 200, { ok: true, message: it.revoked ? `${it.id} باطل علامت خورد.` : `${it.id} دوباره فعال شد.` });
      return;
    }

    /*
     * ── تمدید ──
     *
     * درخواست کاربر: «ابزار مدیریت لایسنس باید قابلیت تمدید لایسنس مشتریان
     * را داشته باشد و تمدید باید از داخل خود برنامه انجام شود».
     *
     * ورودی: متن درخواستی که خودِ برنامه ساخته (`POST /license/renew-request`)
     * خروجی: لایسنس جدید که **جایگزین** قبلی می‌شود.
     *
     * چرا «جایگزینی» و نه «افزودن فایل دوم»: برنامه فقط یک لایسنس فعال
     * نگه می‌دارد (`activeLicenseText`). اگر دو لایسنس داشته باشیم، ترتیب
     * اعتبار مبهم می‌شود و کاربر باید بداند کدام را پاک کند. با جایگزینی،
     * تمدید = همان عملِ فعال‌سازی با لایسنس تازه.
     *
     * منطق تاریخ:
     *   • اگر لایسنس فعلی هنوز منقضی نشده → شروع تمدید = **فردای** پایان فعلی
     *     (روزهای باقی‌مانده سوخت نمی‌شود).
     *   • اگر منقضی شده یا ابدی است → شروع = امروز.
     */
    if (req.method === 'POST' && p === '/api/renew') {
      guardMutation(req);
      const body = await readBody(req);
      const parsed = parseRenewRequest(String(body.request || ''));
      const days = Math.max(1, Math.min(3650, Number(body.days) || parsed.requestedDays || 365));
      const privateKey = loadPrivate();
      const ledger = readLedger();

      const currentId = parsed.currentLicenseId && /^FR-LIC-[A-Za-z0-9-]+$/.test(parsed.currentLicenseId)
        ? parsed.currentLicenseId : null;
      const current = currentId ? ledger.items.find((x) => x.id === currentId) : null;

      /* تاریخ شروع: فردای پایان فعلی، یا امروز */
      const today = todayISO();
      let start = today;
      let extendedFrom = null;
      if (current?.end) {
        const nextDay = addDays(current.end, 1);
        if (nextDay > today) { start = nextDay; extendedFrom = current.end; }
        else { start = today; extendedFrom = current.end; }
      }

      const id = `FR-LIC-${new Date().getFullYear()}-${String(ledger.nextId).padStart(4, '0')}`;
      const end = addDays(start, days - 1);
      const built = buildLicense({
        id,
        customer: String(body.customer || current?.customer || parsed.note || 'مشتری تمدیدشده').slice(0, 120),
        kind: 'custom',
        start,
        end,
        machineKey: parsed.machineKey || current?.machineKey || '',
        seats: Number(body.seats || current?.seats || 1),
        note: String(body.note || `تمدید ${days} روزه${extendedFrom ? ` از ${extendedFrom}` : ''}`).slice(0, 300),
      }, privateKey);

      fs.mkdirSync(keysDir, { recursive: true });
      const file = path.join(keysDir, `${id}.lic`);
      fs.writeFileSync(file, built.text + '\n', 'utf8');

      ledger.items.push({
        id, customer: built.payload.customer, kind: built.payload.kind,
        start: built.payload.start, end: built.payload.end,
        machineKey: built.payload.machineKey, seats: built.payload.seats,
        note: built.payload.note, issuedAt: built.payload.issuedAt,
        file: path.relative(root, file), revoked: false,
        renewOf: currentId || null,
      });
      /* لایسنس قبلی «تمدیدشده» علامت می‌خورد تا در فهرست ابزار روشن باشد */
      if (current) { current.renewedBy = id; current.renewedAt = new Date().toISOString(); }
      ledger.nextId = Number(ledger.nextId || 1) + 1;
      writeLedger(ledger);

      json(res, 200, {
        ok: true,
        message: `لایسنس ${id} برای ${days} روز تمدید شد (${built.payload.start} تا ${built.payload.end}).`,
        id,
        text: built.text,
        payload: built.payload,
        startLabel: await jalaaliLabel(built.payload.start),
        endLabel: built.payload.end ? await jalaaliLabel(built.payload.end) : 'ابد',
        extendedFrom,
        renewedFrom: currentId,
        previous: current || null,
      });
      return;
    }

    /*
     * خواندن یک فایل درخواست تمدید (قبل از تمدید) تا اپراتور ببیند
     * درخواست از کدام دستگاه و کدام لایسنس است.
     */
    if (req.method === 'POST' && p === '/api/renew-parse') {
      /*
       * ── باگ (شکار باگ دور ۳۰) ────────────────────────────────────────────
       * تنها مسیر POSTی بود که `guardMutation` نداشت: هر صفحه‌ای که روی همین
       * کمپیوتر باز باشد (یا یک iframe در یک سایت) می‌توانست درخواست تمدید
       * را به این سرور بفرستد و پاسخ بگیرد. پاسخ محرمانه نیست، ولی یکدستی
       * محافظ‌ها مهم است: هر مسیری که بدنه می‌خواند، همان بررسی مبدأ و
       * توکن CSRF را باید داشته باشد.
       */
      guardMutation(req);
      const body = await readBody(req);
      const parsed = parseRenewRequest(String(body.request || ''));
      json(res, 200, { ok: true, ...parsed });
      return;
    }

    /*
     * ذخیره‌ی فایل `.lic` با نام درست — «گزینه‌ی ذخیره به‌عنوان فایل بعد از
     * ساخت لایسنس».
     *
     * چرا جدا از `/api/file` (که JSON می‌دهد): برای دانلود واقعی مرورگر باید
     * `content-disposition: attachment` ببیند. قبلاً صفحه فایل را از JSON
     * می‌ساخت؛ اگر متن در کاپی/پیست خط می‌شکست، فایل خراب ذخیره می‌شد.
     * حالا بایت‌های اصلی فایل از سرور می‌آید.
     */
    if (req.method === 'GET' && p === '/api/download') {
      const id = String(url.searchParams.get('id') || '');
      if (!/^FR-LIC-[A-Za-z0-9-]+$/.test(id)) { json(res, 400, { ok: false, message: 'شناسه نامعتبر.' }); return; }
      const f = path.join(keysDir, `${id}.lic`);
      if (!fs.existsSync(f)) { json(res, 404, { ok: false, message: 'فایل پیدا نشد.' }); return; }
      const text = fs.readFileSync(f, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${id}.lic"`,
        'cache-control': 'no-store',
      });
      res.end(text);
      return;
    }

    /* کاپی متن لایسنس از فایل */
    if (req.method === 'GET' && p === '/api/file') {
      const id = String(url.searchParams.get('id') || '');
      if (!/^FR-LIC-[A-Za-z0-9-]+$/.test(id)) { json(res, 400, { ok: false, message: 'شناسه نامعتبر.' }); return; }
      const f = path.join(keysDir, `${id}.lic`);
      if (!fs.existsSync(f)) { json(res, 404, { ok: false, message: 'فایل پیدا نشد.' }); return; }
      json(res, 200, { ok: true, text: fs.readFileSync(f, 'utf8') });
      return;
    }

    json(res, 404, { ok: false, message: 'مسیر ناشناخته.' });
  } catch (e) {
    json(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

/*
 * ── باگ (شکار باگ دور ۳۰) ────────────────────────────────────────────────
 * اگر پورت اشغال بود (ابزار از قبل باز است، یا برنامه‌ی دیگری آن را گرفته)،
 * Node یک استک‌تریس انگلیسی `EADDRINUSE` می‌ریخت و پنجره‌ی کنسول بسته
 * می‌شد — کاربر هیچ نمی‌فهمید چه شد. حالا پیام فارسی با راه‌حل.
 */
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\n⛔ پورت ${PORT} در حال استفاده است.`);
    console.error('   یعنی ابزار از قبل باز است (یکی از پنجره‌های قبلی) یا برنامه‌ی دیگری این پورت را گرفته.');
    console.error(`   • اگر ابزار باز است، همان صفحه‌ی مرورگر را استفاده کنید: http://${HOST}:${PORT}`);
    console.error('   • یا با یک پورت دیگر اجرا کنید:  FD_LICENSE_UI_PORT=' + (PORT + 1));
    console.error('   برای بستن نسخه‌ی قبلی، پنجره‌ی کنسول آن را ببندید.\n');
    process.exit(1);
  }
  console.error('\n⛔ سرور ابزار بالا نیامد:', e?.message || e, '\n');
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const keys = keysState();
  console.log(`\n🗝  ابزار لایسنس فردای روشن → http://${HOST}:${PORT}\n`);
  console.log(`   کلید خصوصی: ${keys.hasPrivate ? 'موجود' : '⚠ ساخته نشده'}`);
  if (keys.hasPrivate) console.log(`   اثر انگشت کلید عمومی: ${keys.fingerprint}`);
  console.log('   برای بستن: Ctrl+C\n');
});
