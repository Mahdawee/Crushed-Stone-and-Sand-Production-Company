/**
 * نگهبان بازرسی بسته‌ی نصبی — بازنویسی دور ۴۲.
 *
 *   node scripts/ui-check/verify-bundle-msi.test.mjs
 *
 * ── باگی که این تست‌ها قفل می‌کنند ───────────────────────────────────────
 * `verify-bundle.mjs` نسخه‌ی اول محتوا را با «جست‌وجوی رشته در بایت خام»
 * می‌سنجید. روی بیلد واقعی ویندوز:
 *
 *     ✘ ابزار «صفر کردن» داخل بسته نیست      ← غلط (هست، فشرده است)
 *     ✔ ابزار لایسنس و کلید خصوصی نیستند      ← بی‌اثبات (خطرناک)
 *
 * دومی بدتر است: اگر کلید خصوصی داخل بسته بود، باز هم «سبز» می‌شد.
 * یعنی ابزار تأیید می‌توانست امضای فروشنده را لو بدهد و بگوید «سالم».
 *
 * تست‌ها روی **فایل MSI واقعیِ ساخته‌شده** اجرا می‌شوند (CFB + CAB دست‌ساز
 * با ساختار درست)، نه روی فایل ساختگی متنی.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import struct from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeMsiStreamName, listCab } from '../lib/msi-inspect.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

/* ── سازنده‌ی MSI ساختگی با ساختار واقعی (CFB + CAB) ──────────────────── */
const SEC = 512;
const ENDCHAIN = 0xfffffffe, FREESECT = 0xffffffff, FATSECT = 0xfffffffd, NOSTREAM = 0xffffffff;
const pad = (b) => Buffer.concat([b, Buffer.alloc((SEC - (b.length % SEC)) % SEC)]);

function makeCab(names) {
  const parts = names.map((n) => {
    const nm = Buffer.concat([Buffer.from(n, 'latin1'), Buffer.from([0])]);
    const h = Buffer.alloc(16);
    h.writeUInt32LE(100, 0);       // cbFile
    h.writeUInt16LE(0x20, 14);     // attribs (ARCHIVE) — no UTF flag
    return Buffer.concat([h, nm]);
  });
  const body = Buffer.concat(parts);
  const hdr = Buffer.alloc(36);
  hdr.write('MSCF', 0, 'latin1');
  hdr.writeUInt32LE(36 + body.length, 8);
  hdr.writeUInt32LE(36, 16);
  hdr[24] = 3; hdr[25] = 1;
  hdr.writeUInt16LE(1, 26);
  hdr.writeUInt16LE(names.length, 28);
  return Buffer.concat([hdr, body]);
}

function dirent(name, etype, start = ENDCHAIN, size = 0, child = NOSTREAM, right = NOSTREAM) {
  const nm = Buffer.concat([Buffer.from(name, 'utf16le'), Buffer.from([0, 0])]);
  const e = Buffer.alloc(128);
  nm.copy(e, 0);
  e.writeUInt16LE(nm.length, 64);
  e[66] = etype;
  e[67] = 1;
  e.writeUInt32LE(NOSTREAM, 68);   // left
  e.writeUInt32LE(right, 72);
  e.writeUInt32LE(child, 76);
  e.writeUInt32LE(start, 116);
  e.writeBigUInt64LE(BigInt(size), 120);
  return e;
}

// Encode MSI's standard table stream format to exercise real on-disk names.
function encodeMsiName(name) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._';
  let out = '';
  if (name.startsWith('!')) { out = String.fromCharCode(0x4840); name = name.slice(1); }
  for (let i = 0; i < name.length; i++) {
    const a = alphabet.indexOf(name[i]);
    if (a < 0) { out += name[i]; continue; }
    const b = i + 1 < name.length ? alphabet.indexOf(name[i + 1]) : -1;
    if (b >= 0) { out += String.fromCharCode(0x3800 + a + (b << 6)); i++; }
    else out += String.fromCharCode(0x4800 + a);
  }
  return out;
}

function makeMsi(names, encoded = false) {
  const cab = makeCab(names);
  const streams = [['!_StringData', Buffer.from('Farday Roshan' + String.fromCharCode(0) + 'Version' + String.fromCharCode(0) + '9.9.9', 'latin1')],
                   ['!_Tables', Buffer.alloc(400, 0x54)],
                   ['Binary.Data', cab]];
  let ndir = 1, starts = [];
  for (let iter = 0; iter < 6; iter++) {
    starts = [];
    let off = ndir + 1;
    for (const [nm, d] of streams) { starts.push([nm, off, d.length]); off += pad(d).length / SEC; }
    const ents = [dirent('Root Entry', 5, FREESECT, 0, 1)];
    starts.forEach(([nm, st, sz], i) => ents.push(dirent(encoded ? encodeMsiName(nm) : nm, 2, st, sz, NOSTREAM, i + 2 < starts.length ? i + 2 : NOSTREAM)));
    const dirdata = pad(Buffer.concat(ents));
    const need = dirdata.length / SEC;
    if (need === ndir) { var dirBuf = dirdata; break; }
    ndir = need; var dirBuf = dirdata;
  }
  const fat = [FATSECT];
  for (let i = 0; i < ndir; i++) fat.push(i < ndir - 1 ? 1 + i + 1 : ENDCHAIN);
  for (const [nm, st, sz] of starts) {
    const cnt = pad(streams.find((s) => s[0] === nm)[1]).length / SEC;
    for (let k = 0; k < cnt; k++) fat.push(k < cnt - 1 ? st + k + 1 : ENDCHAIN);
  }
  while (fat.length < SEC / 4) fat.push(FREESECT);
  const fatSec = Buffer.alloc(SEC);
  fat.slice(0, SEC / 4).forEach((v, i) => fatSec.writeUInt32LE(v, i * 4));
  const body = Buffer.concat([dirBuf, ...streams.map((s) => pad(s[1]))]);
  const hdr = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(hdr, 0);
  hdr.writeUInt16LE(0x3e, 24); hdr.writeUInt16LE(3, 26); hdr.writeUInt16LE(0xfffe, 28);
  hdr.writeUInt16LE(9, 30); hdr.writeUInt16LE(6, 32);
  hdr.writeUInt32LE(1, 44); hdr.writeUInt32LE(1, 48);
  hdr.writeUInt32LE(4096, 56); hdr.writeUInt32LE(ENDCHAIN, 60);
  hdr.writeUInt32LE(0, 64); hdr.writeUInt32LE(ENDCHAIN, 68); hdr.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(i === 0 ? 0 : FREESECT, 76 + 4 * i);
  return Buffer.concat([hdr, fatSec, body]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'msiverify-'));
const bundleOf = (label, buf) => {
  const d = path.join(tmp, label, 'msi');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'Farday Roshan_0.1.0_x64_en-US.msi'), buf);
  return path.join(tmp, label);
};
const verify = (dir) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['scripts/verify-bundle.mjs', '--bundle', dir], { cwd: root, encoding: 'utf8' }) };
  } catch (e) { return { code: e.status, out: String(e.stdout || '') }; }
};

console.log('\n— فهرست CAB خوانده‌شده، ولی کامل بودن MSI نامعلوم —');
const good = verify(bundleOf('good', makeMsi([
  'api\\app.js', 'tools\\reset-ui\\server.mjs', 'tools\\reset-ui\\ui.html', 'farday-public.b64',
])));
ok('فهرست ناقص‌اثبات‌شده نامعلوم است (خارج ۲)', good.code === 2, `خارج ${good.code}`);
ok('reset-ui دیده شد', /reset-ui\).*داخل بسته هست/.test(good.out));
ok('API دیده شد', /API \(app\.js\).*داخل بسته هست/.test(good.out));
ok('کلید عمومی دیده شد', /کلید عمومی.*داخل بسته هست/.test(good.out));

console.log('\n— نام‌های استاندارد MSI و UTF-8 در CAB —');
const encodedName = encodeMsiName('!_StringData');
ok('نام کدگذاری‌شدهٔ جدول MSI خوانده می‌شود', decodeMsiStreamName(encodedName) === '!_StringData');
const encodedMsi = verify(bundleOf('encoded', makeMsi([
  'api\\app.js', 'tools\\reset-ui\\server.mjs', 'farday-public.b64',
], true)));
ok('جریان کدگذاری‌شده خوانده و API شناسایی می‌شود', encodedMsi.code === 2 && /API \(app\.js\).*داخل بسته هست/.test(encodedMsi.out), encodedMsi.out);
const utfName = 'پوشه/رسید.txt';
const utfCab = makeCab([utfName]);
const utfBytes = Buffer.from(utfName, 'utf8');
const utfHdr = Buffer.from(utfCab.subarray(0, 52));
utfHdr.writeUInt16LE(0x80, 36 + 14);
utfHdr.writeUInt32LE(utfHdr.length + utfBytes.length + 1, 8);
const utfFixture = Buffer.concat([utfHdr, utfBytes, Buffer.from([0])]);
ok('نام UTF-8 در CAB درست خوانده می‌شود', listCab(utfFixture)?.names[0] === utfName);

console.log('\n— نشت کلید خصوصی → قرمز (این همان چیزی است که نسخه‌ی قبل نمی‌گرفت) —');
const leak = verify(bundleOf('leak', makeMsi([
  'api\\app.js', 'tools\\license\\server.mjs', 'private.key', 'farday-public.b64',
])));
ok('خارج ۱', leak.code === 1, `خارج ${leak.code}`);
ok('کلید خصوصی گزارش شد', /کلید خصوصی/.test(leak.out) && /نباید باشند/.test(leak.out));
ok('ابزار لایسنس گزارش شد', /ابزار لایسنس/.test(leak.out));

console.log('\n— نیافتن ابزار در فهرست ناقص → نامعلوم —');
const miss = verify(bundleOf('missing', makeMsi(['api\\app.js', 'farday-public.b64'])));
ok('نبود با فهرست ناقص نامعلوم است', miss.code === 2, `خارج ${miss.code}`);
ok('پیام صادقانه می‌دهد', /کامل بودن فهرست ثابت نشده/.test(miss.out));

console.log('\n— نام کوتاه ۸.۳ (همان چیزی که WiX واقعاً می‌نویسد) —');
/*
 * این مهم‌ترین تست این فایل است. بسته‌بند MSI تاو��ری نام‌ها را ۸.۳ نگه
 * می‌دارد؛ اگر فقط مسیر کامل را بپذیریم، روی بسته‌ی واقعیِ سالم «✘ نیست»
 * می‌دهیم — همان هشدار غلطی که باعث بازنویسی شد.
 */
const short83 = verify(bundleOf('short83', makeMsi([
  'API\\APP.JS', 'SERVER~1.MJS', 'FARDAY~1.B64',
])));
ok('نام کوتاه به‌تنهایی تأیید نیست', short83.code === 2, `خارج ${short83.code}`);
ok('دلیل نامعلوم بودن نام کوتاه را می‌گوید', /نام کوتاه/.test(short83.out));

console.log('\n— فایل خوانده‌نشدنی → نامعلوم (۲)، هرگز «سالم» —');
const junk = Buffer.alloc(20000); for (let i = 0; i < junk.length; i++) junk[i] = (i * 131) & 0xff;
const opaque = verify(bundleOf('opaque', junk));
ok('خارج ۲', opaque.code === 2, `خارج ${opaque.code}`);
ok('می‌گوید بازرسی ممکن نیست', /بازرسی محتوا ممکن نیست/.test(opaque.out));
ok('ادعای سالم نمی‌کند', !/بسته سالم است/.test(opaque.out));
/*
 * و نباید هیچ «✔»ی بدهد. یک بسته‌ی خوانده‌نشده که «۱ سالم» گزارش کند،
 * بدترین حالت است: کاربر جمع می‌زند و فکر می‌کند همه‌چیز مرتب است.
 */
ok('هیچ بررسی‌ای را «سالم» نمی‌شمارد', /\(0 سالم\)/.test(opaque.out), opaque.out.match(/\(.*?سالم\)/)?.[0]);

console.log('\n— هیچ فایل نصبی → ۲، نه ۰ —');
fs.mkdirSync(path.join(tmp, 'empty'), { recursive: true });
const none = verify(path.join(tmp, 'empty'));
ok('خارج ۲', none.code === 2, `خارج ${none.code}`);

console.log('\n— کد بازرسی: روش درست، نه جست‌وجوی رشته —');
const vb = read('scripts/verify-bundle.mjs');
ok('از خواننده‌ی واقعی MSI استفاده می‌کند', /inspectMsi/.test(vb));
ok('جست‌وجوی رشته‌ی خام حذف شده', !/rawStrings/.test(vb));
ok('«نتوانستم» با نامعلوم گزارش می‌شود', /نه سالم، نه خراب/.test(vb));
ok('تطبیق مسیر جداست، نه زیررشته', /\(\^\|\[\\\\\/\]\)/.test(vb));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
