#!/usr/bin/env node
/**
 * کلید «صفر کردن سیستم» — ساخته می‌شود، مُهر می‌شود، برای مالک نگه داشته می‌شود.
 *
 *   node scripts/reset-key.mjs            وضعیت کلید
 *   node scripts/reset-key.mjs --ensure   ساخت (اگر نبود) + کاپی برای مالک
 *
 * ## چرا این کلید
 * ابزار بیرونی `tools/reset-ui` می‌تواند کل داده‌ی مشتری را پاک کند. این اختیار
 * نباید با «هر کسی که فایل‌ها را دارد» باشد. کلید:
 *   ۱) هنگام ساخت داخل فایل اجرایی **مُهر** می‌شود (`src-tauri/seal/reset-key.txt`
 *      → `build.rs` → `SEALED_RESET_KEY`).
 *   ۲) مالک آن را از نسخه‌ی نصب‌شده می‌گیرد:
 *      `Farday Roshan.exe --cli --print-reset-key`
 *      یا از `license-keys/reset-key.txt` روی کمپیوتر خودش (کاپی محلی این اسکریپت).
 *
 * ## چرا در git نیست
 * همان قاعده‌ی کلید خصوصی لایسنس: `license-keys/` و فایل کلید صفر کردن
 * (`.gitignore`) کامیت نمی‌شوند. نسخه‌ای که از مخزن بدون این کلید ساخته شود،
 * ابزار صفر کردن روی آن کار نمی‌کند و پیام روشن می‌دهد — بهتر از یک کلید
 * عمومیِ لو رفته.
 *
 * ⚠ اگر کلید عوض شود، نسخه‌های نصب‌شده‌ی قبلی کلید قبلی را دارند: برای تحویل
 * سیستمِ آن‌ها باید همان کلید قبلی را نگه دارید (فایل‌ها بکاپ می‌شوند).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sealFile = path.join(root, 'src-tauri', 'seal', 'reset-key.txt');
const ownerDir = path.join(root, 'license-keys');
const ownerFile = path.join(ownerDir, 'reset-key.txt');

const ensure = process.argv.includes('--ensure');
const force = process.argv.includes('--force');

const exists = fs.existsSync(sealFile);
const read = () => (exists ? fs.readFileSync(sealFile, 'utf8').trim() : '');
const fingerprint = (k) => (k ? crypto.createHash('sha256').update(k).digest('hex').slice(0, 16) : '');

if (!exists || force) {
  if (!ensure && !force) {
    console.log('ℹ کلید صفر کردن ساخته نشده است.');
    console.log('  برای ساخت: node scripts/reset-key.mjs --ensure');
    console.log('  (بدون این کلید، ابزار tools/reset-ui روی نسخه‌ی مُهرشده کار نمی‌کند.)');
    process.exit(0);
  }
  if (exists && force) {
    const backup = `${sealFile}.bak-${Date.now()}`;
    fs.copyFileSync(sealFile, backup);
    console.log(`⚠ کلید قبلی در ${path.basename(backup)} نگه داشته شد (نسخه‌های نصب‌شده‌ی قبلی با آن کار می‌کنند).`);
  }
  const key = 'FRD-RESET-' + crypto.randomBytes(24).toString('hex').toUpperCase();
  fs.mkdirSync(path.dirname(sealFile), { recursive: true });
  fs.writeFileSync(sealFile, key + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.mkdirSync(ownerDir, { recursive: true });
  fs.writeFileSync(ownerFile, key + '\n', { encoding: 'utf8', mode: 0o600 });
  console.log('✔ کلید «صفر کردن سیستم» ساخته شد و در فایل اجرایی مُهر می‌شود.');
  console.log(`  اثر انگشت: ${fingerprint(key)}`);
  console.log(`  برای مالک: ${path.relative(root, ownerFile)} ${'⚠ کامیت نکنید'}`);
  process.exit(0);
}

const key = read();
console.log('✔ کلید صفر کردن موجود است.');
console.log(`  اثر انگشت: ${fingerprint(key)}`);
console.log(`  مسیر: ${path.relative(root, sealFile)} (کامیت نمی‌شود)`);
console.log(`  مالک: ${path.relative(root, ownerFile)}`);
console.log('\n  گرفتن کلید از نسخه‌ی نصب‌شده:');
console.log('    Farday Roshan.exe --cli --print-reset-key');
