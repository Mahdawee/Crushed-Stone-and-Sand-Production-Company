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
const keysDir = path.join(root, 'license-keys');
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

const KIND_DAYS = { trial: 7, monthly: 30, yearly: 365, custom: null, perpetual: null, machine: null };

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

/* ---------- issue / inspect ---------- */
function buildLicense(input, privateKey) {
  const kind = String(input.kind || 'yearly');
  if (!(kind in KIND_DAYS)) throw new Error(`نوع دوره ناشناخته: ${kind}`);
  let end = input.end ? String(input.end).slice(0, 10) : null;
  if (!end && KIND_DAYS[kind] != null) end = addDays(String(input.start).slice(0, 10), KIND_DAYS[kind] - 1);
  if (kind === 'perpetual' || kind === 'machine') end = null;
  if (end && end < input.start) throw new Error('تاریخ پایان قبل از شروع است.');
  const machineKey = input.machineKey ? normalizeMachineKey(input.machineKey) : '';
  if (machineKey && !isValidMachineKey(machineKey)) throw new Error(`کلید دستگاه باید ${MK_LEN} نویسه باشد.`);
  const payload = {
    v: 1,
    id: String(input.id),
    customer: String(input.customer || '').trim(),
    kind,
    start: String(input.start).slice(0, 10),
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

/* ---------- CSRF ---------- */
const CSRF = crypto.randomBytes(18).toString('hex');

/* ---------- HTTP ---------- */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 200_000) { reject(new Error('بدنه‌ی درخواست بیش از حد بزرگ است.')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('JSON نامعتبر.')); }
  });
  req.on('error', reject);
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
        kinds: Object.keys(KIND_DAYS),
      });
      return;
    }

    /* ساخت جفت‌کلید */
    if (req.method === 'POST' && p === '/api/keygen') {
      guardMutation(req);
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
      for (const dst of [bundledPublic, apiPublic, sealSource]) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, pub + '\n', 'utf8');
      }
      json(res, 200, { ok: true, message: 'جفت‌کلید ساخته شد و کلید عمومی در بسته کاپی شد.', keys: keysState() });
      return;
    }

    /* صدور لایسنس */
    if (req.method === 'POST' && p === '/api/issue') {
      guardMutation(req);
      const body = await readBody(req);
      const privateKey = loadPrivate();
      const ledger = readLedger();
      const id = String(body.id || `FR-LIC-${new Date().getFullYear()}-${String(ledger.nextId).padStart(4, '0')}`);
      /* تاریخ‌ها در سرور یکسان‌سازی می‌شوند (شمسی → میلادی) */
      const startISO = parseDateToISO(body.start, 'تاریخ شروع');
      const endISO = body.end ? parseDateToISO(body.end, 'تاریخ پایان') : null;
      const built = buildLicense({ ...body, id, start: startISO, end: endISO }, privateKey);
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
        message: `لایسنس ${id} صادر شد.`,
        id,
        text: built.text,
        payload: built.payload,
        endLabel: built.payload.end ? await jalaaliLabel(built.payload.end) : 'ابد',
        startLabel: await jalaaliLabel(built.payload.start),
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

server.listen(PORT, HOST, () => {
  const keys = keysState();
  console.log(`\n🗝  ابزار لایسنس فردای روشن → http://${HOST}:${PORT}\n`);
  console.log(`   کلید خصوصی: ${keys.hasPrivate ? 'موجود' : '⚠ ساخته نشده'}`);
  if (keys.hasPrivate) console.log(`   اثر انگشت کلید عمومی: ${keys.fingerprint}`);
  console.log('   برای بستن: Ctrl+C\n');
});
