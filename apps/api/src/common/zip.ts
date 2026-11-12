import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

/**
 * ساخت ZIP بدون وابستگی بیرونی — پیشنهاد C2، دور ۴۰.
 *
 * ── چرا دست‌ساز ─────────────────────────────────────────────────────────
 * بسته‌ی نصبی باید کم‌حجم و بی‌وابستگی بماند؛ اضافه‌کردن یک کتابخانه‌ی
 * zip برای این یک کار، سطح حمله و حجم را بی‌دلیل بالا می‌برد. قالب ZIP
 * برای «چند فایل، بدون رمز، بدون ZIP64» ساده و پایدار است و با هر
 * Windows Explorer و 7-Zip باز می‌شود.
 *
 * ── چه چیزی پشتیبانی می‌شود و چه چیزی نه ────────────────────────────────
 * پشتیبانی: فایل‌های معمولی، deflate، نام UTF-8 (پرچم 0x0800 — بدون آن
 * نام‌های فارسی در ویندوز به‌هم‌ریخته می‌شوند).
 * پشتیبانی نمی‌شود: پوشه‌ی تو‌در‌تو (ما لازم نداریم)، ZIP64 (بیش از ۴ گیگ
 * یا ۶۵٬۵۳۵ فایل — برای پشتیبان یک مغازه بی‌معناست)، رمز.
 *
 * ── چرا CRC32 لازم است ──────────────────────────────────────────────────
 * ZIP بدون CRC معتبر، توسط Explorer «خراب» اعلام می‌شود. پیاده‌سازی
 * جدول‌محور استاندارد است.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** نام داخل آرشیو — با / جدا شود */
  name: string;
  /** محتوای فایل، یا مسیر روی دیسک */
  data?: Buffer;
  file?: string;
}

/** تاریخ/ساعت به قالب MS-DOS (ZIP از آن استفاده می‌کند). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const e of entries) {
    const raw = e.data ?? (e.file ? fs.readFileSync(e.file) : Buffer.alloc(0));
    /* فایل‌های خیلی کوچک یا از قبل فشرده (db) بازدهی ندارند؛ هر دو راه درست است */
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(e.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk
    central.writeUInt16LE(0, 36);          // int attrs
    central.writeUInt32LE(0, 38);          // ext attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/** نام امن داخل آرشیو — بدون مسیر مطلق، بدون `..` */
export function safeEntryName(file: string): string {
  return path.basename(file).replace(/[\\/:*?"<>|]/g, '_');
}
