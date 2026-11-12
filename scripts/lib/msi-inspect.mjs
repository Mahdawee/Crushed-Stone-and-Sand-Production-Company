/**
 * خواندن فهرست فایل‌های داخل یک بسته‌ی MSI — بدون وابستگی بیرونی.
 *
 * ── چرا این فایل لازم شد (دور ۴۲) ───────────────────────────────────────
 * `verify-bundle.mjs` محتوای MSI را با «جست‌وجوی رشته در بایت‌های خام»
 * بررسی می‌کرد. روی بیلد واقعی ویندوز، یک «✘ ابزار صفر کردن نیست» داد.
 *
 * آن هشدار **غلط** بود، ولی مشکل بزرگ‌تر خودِ روش بود:
 *
 *   • «پیدا شد» اثباتی نیست: `app.js` زیررشته‌ی `myapp.js` و `app.json`
 *     هم هست، و در باندل JS هم می‌آید. ممکن است هیچ ربطی به بسته‌بندی
 *     نداشته باشد.
 *   • «پیدا نشد» هم اثباتی نیست: بار بسته **فشرده** است. نبودنِ یک رشته
 *     در داده‌ی فشرده هیچ چیزی را ثابت نمی‌کند.
 *
 * و این دومی خطرناک است: بررسی «کلید خصوصی لایسنس داخل بسته نیست» با
 * همین روش **سبز** درمی‌آمد. یعنی ممکن بود کلید امضا برای مشتری برود و
 * ابزار بگوید «سالم است». سکوتِ سبز بدترین نوع دروغ است.
 *
 * ── راه‌حل ──────────────────────────────────────────────────────────────
 * فهرست فایل‌ها را از **جدول‌های خود MSI** می‌خوانیم:
 *   MSI = فایل مرکب OLE (CFB) → stream با نام «!_StringData» و «!_Tables»
 *   بار فایل‌ها در جدول `File` (ستون `FileName`) و در `Media`/CAB است.
 * از آنجا نام CAB را می‌گیریم و با خواندن **هدر CAB** فهرست فایل‌های
 * داخلش را بیرون می‌کشیم (نام‌ها در هدر، بدون فشرده‌سازی، خوانا هستند).
 *
 * هر مرحله اگر شکست بخورد `null` برمی‌گرداند — نه یک فهرست خالی. تفاوت
 * این دو مهم است: «فهرست خالی» یعنی «هیچ فایلی نیست»، ولی `null` یعنی
 * «نتوانستم بخوانم» و باید «نامعلوم» گزارش شود، نه «سالم».
 */
import * as fs from 'node:fs';

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

/* ─────────────────────────── CFB / OLE reader ─────────────────────────── */

function readSectors(buf, fat, start, secSize, endMark = ENDCHAIN) {
  const parts = [];
  const seen = new Set();
  let cur = start;
  while (cur < endMark && cur !== FREESECT && !seen.has(cur)) {
    if (cur >= fat.length) return null;
    seen.add(cur);
    const off = (cur + 1) * secSize;
    if (off + secSize > buf.length) return null;
    parts.push(buf.subarray(off, off + secSize));
    cur = fat[cur];
  }
  return Buffer.concat(parts);
}

// Windows Installer compresses table/stream names into Unicode codepoints.
// 0x4840 marks a table stream; 0x3800..0x47ff encode pairs, 0x4800..0x483f singles.
export function decodeMsiStreamName(name) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._';
  let result = '';
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code === 0x4840) result += '!';
    else if (code >= 0x4800 && code < 0x4840) result += alphabet[code - 0x4800];
    else if (code >= 0x3800 && code < 0x4800) {
      const v = code - 0x3800;
      result += alphabet[v & 63] + alphabet[(v >> 6) & 63];
    } else result += ch;
  }
  return result;
}

/** درخت دایرکتوری CFB را پیمایش می‌کند و مسیر کامل هر stream را می‌دهد. */
export function readCfbStreams(buf) {
  if (!buf || buf.length < 512 || !buf.subarray(0, 8).equals(CFB_MAGIC)) return null;
  const secSize = 1 << buf.readUInt16LE(30);
  if (secSize !== 512 && secSize !== 4096) return null;
  const dirStart = buf.readUInt32LE(48);
  const difatStart = buf.readUInt32LE(68);

  /* زنجیره‌ی FAT: ۱۰۹ ورودی در هدر + ادامه در DIFAT */
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const v = buf.readUInt32LE(76 + 4 * i);
    if (v < 0xfffffffa) fatSectors.push(v);
  }
  let ds = difatStart;
  const guard = new Set();
  while (ds < 0xfffffffa && !guard.has(ds) && guard.size < 10000) {
    guard.add(ds);
    const off = (ds + 1) * secSize;
    if (off + secSize > buf.length) break;
    const per = secSize / 4 - 1;
    for (let i = 0; i < per; i++) {
      const v = buf.readUInt32LE(off + 4 * i);
      if (v < 0xfffffffa) fatSectors.push(v);
    }
    ds = buf.readUInt32LE(off + 4 * per);
  }
  const fat = [];
  for (const fs2 of fatSectors) {
    const off = (fs2 + 1) * secSize;
    if (off + secSize > buf.length) continue;
    for (let i = 0; i < secSize / 4; i++) fat.push(buf.readUInt32LE(off + 4 * i));
  }
  if (!fat.length) return null;

  const dirBuf = readSectors(buf, fat, dirStart, secSize);
  if (!dirBuf) return null;

  const entries = [];
  for (let i = 0; i * 128 + 128 <= dirBuf.length; i++) {
    const off = i * 128;
    const nameLen = dirBuf.readUInt16LE(off + 64);
    if (nameLen < 2 || nameLen > 64) { entries.push(null); continue; }
    const name = decodeMsiStreamName(dirBuf.subarray(off, off + nameLen - 2).toString('utf16le'));
    entries.push({
      name,
      type: dirBuf[off + 66],          // 1=storage 2=stream 5=root
      left: dirBuf.readUInt32LE(off + 68),
      right: dirBuf.readUInt32LE(off + 72),
      child: dirBuf.readUInt32LE(off + 76),
      start: dirBuf.readUInt32LE(off + 116),
      size: Number(dirBuf.readBigUInt64LE(off + 120)),
    });
  }
  if (!entries.length || !entries[0]) return null;

  /* پیمایش درخت سرخ-سیاه؛ با سقف تکرار تا دیتای خراب حلقه نسازد */
  const streams = new Map();
  const walk = (idx, prefix, depth) => {
    if (idx >= entries.length || !entries[idx] || depth > 32) return;
    const e = entries[idx];
    walk(e.left, prefix, depth + 1);
    walk(e.right, prefix, depth + 1);
    if (e.type === 2) {
      streams.set(prefix ? `${prefix}/${e.name}` : e.name, { start: e.start, size: e.size });
    } else if (e.type === 1 || e.type === 5) {
      if (e.child !== NOSTREAM) {
        const sub = e.type === 5 ? prefix : (prefix ? `${prefix}/${e.name}` : e.name);
        walk(e.child, sub, depth + 1);
      }
    }
  };
  walk(0, '', 0);
  return { streams, fat, secSize };
}

/** محتوای یک stream کوچک ممکن است در mini-FAT باشد؛ اینجا لازم نیست چون
 *  `!_StringData` و `!_Tables` همیشه بزرگ‌اند، ولی محافظ می‌گذاریم. */
export function readCfbStream(buf, cfb, name) {
  const s = cfb.streams.get(name);
  if (!s) return null;
  const data = readSectors(buf, cfb.fat, s.start, cfb.secSize);
  if (!data) return null;
  return data.subarray(0, s.size);
}

/* ───────────────────────────── CAB reader ─────────────────────────────── */

const CAB_MAGIC = Buffer.from([0x4d, 0x53, 0x43, 0x46]); // "MSCF"

/**
 * فهرست فایل‌های یک CAB — فقط از هدر می‌خوانیم (نام‌ها فشرده نیستند).
 *
 * ── سه باگ که تست روی فایل ساختگی گرفت ─────────────────────────────────
 *  ۱) جابه‌جایی آفست: ستون `attribs` در `CFFILE` در آفست **۱۴** است، نه
 *     ۱۶؛ آن پرچم مشخص می‌کند نام به UTF-8 است. در غیر این صورت نام فارسی به `A\u0006'\u0006…` تبدیل می‌شدند.
 *  ۲) فایل ناقص: `break` می‌کردم و فهرست **کوتاه** برمی‌گرداند — یعنی
 *     «فقط ۲ فایل دارد» به‌جای «نتوانستم بخوانم». برای بررسی امنیتی،
 *     فهرست ناقص از «نامعلوم» خطرناک‌تر است.
 *  ۳) `cbFile` خوانده و دور ریخته می‌شد؛ ارزش دارد چون فایل‌های صفر بایت
 *     معمولاً یعنی بسته‌بندی ناقص.
 *
 * خروجی `null` یعنی «نتوانستم» — نه «خالی».
 */
export function listCab(buf, offset = 0) {
  if (!buf || offset < 0 || offset + 36 > buf.length) return null;
  if (!buf.subarray(offset, offset + 4).equals(CAB_MAGIC)) return null;
  const cbCabinet = buf.readUInt32LE(offset + 8);
  const coffFiles = buf.readUInt32LE(offset + 16);
  const cFolders = buf.readUInt16LE(offset + 26);
  const cFiles = buf.readUInt16LE(offset + 28);

  /* سقف واقع‌گرایانه: CAB با بیش از ۶۵٬۵۳۵ فایل معنا ندارد (فیلد ۲ بایتی) */
  if (cFiles === 0 || cFiles > 0xffff) return null;

  const end = cbCabinet > 0 ? Math.min(buf.length, offset + cbCabinet) : buf.length;
  const names = [];
  let zeroBytes = 0;
  let p = offset + coffFiles;
  for (let i = 0; i < cFiles; i++) {
    if (p + 16 > end) return null;                      /* هدر فایل ناقص */
    const cbFile = buf.readUInt32LE(p);
    if (cbFile === 0) zeroBytes++;
    const attribs = buf.readUInt16LE(p + 14);
    const isUtf = (attribs & 0x80) !== 0;                /* _A_NAME_IS_UTF */
    p += 16;

    let name;
    const z = buf.indexOf(0, p);
    if (z < 0 || z >= end) return null;
    // CAB _A_NAME_IS_UTF marks UTF-8, not UTF-16.
    name = buf.subarray(p, z).toString(isUtf ? 'utf8' : 'latin1');
    p = z + 1;
    names.push(name);
    /* فایل‌های با نام را ذخیره می‌کنیم (نام را از نام جدا) */
    void attribs;
    if (!name) return null;
  }
  return { cFiles, cFolders, names, zeroBytes };
}

/* ─────────────────────────── MSI-level API ────────────────────────────── */

/**
 * فهرست فایل‌های داخل MSI: نام‌هایی که در جدول `File` آمده‌اند به‌علاوه‌ی
 * فهرست CAB‌های چسبیده.
 */
export function inspectMsi(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }

  const cfb = readCfbStreams(buf);
  if (!cfb) return null;

  /* نام stream‌های MSI با «!» شروع می‌شوند (کدگذاری MS 97) */
  const stringData = readCfbStream(buf, cfb, '!_StringData') || readCfbStream(buf, cfb, '_StringData');
  if (!stringData) return null;

  /* دنبال نام‌های CAB و مسیرها در string pool می‌گردیم */
  const text = stringData.toString('latin1');

  /* CAB ممکن است به‌صورت stream جدا («CAB» / «Binary») یا چسبیده باشد */
  const cabs = [];
  for (const [name, meta] of cfb.streams) {
    if (/^!?CAB/i.test(name.replace(/^!/, '')) || /\.cab$/i.test(name)) {
      const data = readCfbStream(buf, cfb, name);
      if (data) {
        const l = listCab(data);
        if (l) cabs.push({ stream: name, ...l, offsetInFile: -1 });
      }
    }
  }
  /* CAB چسبیده به انتهای فایل (رایج‌ترین حالت در MSI) */
  const embedded = buf.indexOf(CAB_MAGIC);
  if (embedded > 0) {
    const l = listCab(buf, embedded);
    if (l) cabs.push({ stream: '(embedded)', ...l, offsetInFile: embedded });
  }

  /* نام‌های کوتاه ۸.۳ و نام‌های بلند در string pool هستند */
  const pool = new Set();
  for (const m of text.matchAll(/[\x20-\x7e]{3,255}/g)) pool.add(m[0]);

  return {
    streamNames: [...cfb.streams.keys()],
    stringCount: pool.size,
    cabs,
    /** هر نام فایلی که در یکی از CAB‌ها آمده */
    files: cabs.flatMap((c) => c.names),
    /** فایل‌های صفر بایت — نشانه‌ی بسته‌بندی ناقص */
    zeroBytesTotal: cabs.reduce((a, c) => a + (c.zeroBytes || 0), 0),
  };
}
