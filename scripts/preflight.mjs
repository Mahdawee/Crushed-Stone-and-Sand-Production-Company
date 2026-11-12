/**
 * پیش‌پرواز تست‌ها — «چرا این تست قرمز است؟» را قبل از شروع جواب می‌دهد.
 *
 *   node scripts/preflight.mjs
 *
 * ── چرا این فایل (دور ۳۷) ────────────────────────────────────────────────
 * در یک کلون تازه، `npm test` با پیام‌هایی مثل «بسته‌ی API برای مقایسه موجود
 * است … اول npm run build» شکست می‌خورد. آن پیام درست بود ولی **دیر** می‌آمد:
 * چند سوئیت قبل از آن سبز می‌شدند و کاربر نمی‌دانست مشکل کد است یا ساخت.
 * این فایل قبل از هر تستی می‌گوید چه چیزی ساخته نشده و چه چیزی اختیاری است.
 *
 * ⚠ این فایل هیچ چیزی نمی‌سازد و هیچ تستی را رد نمی‌کند؛ فقط گزارش می‌دهد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = (rel) => fs.existsSync(path.join(root, rel));

const REQUIRED = [
  ['node_modules', 'وابستگی‌ها', 'npm install'],
  ['apps/api/dist', 'بسته‌ی API (تست‌ها به آن نیاز دارند)', 'npm run build -w @farday/api'],
];

const OPTIONAL = [
  ['src-tauri/api/app.js', 'بسته‌ی دسکتاپ', 'npm run desktop:build (فقط برای بسته‌بندی)'],
  ['src-tauri/tools', 'کاپی ابزارها برای بسته', 'npm run desktop:build'],
  ['src-tauri/seal/reset-key.txt', 'کلید صفر کردن (gitignored)', 'روی کمپیوتر فروشنده ساخته می‌شود'],
];

const missing = [];
console.log('\n— پیش‌پرواز —');
for (const [rel, label, fix] of REQUIRED) {
  if (exists(rel)) console.log(`  ✔ ${label}`);
  else { console.log(`  ✘ ${label} نیست → ${fix}`); missing.push({ rel, fix }); }
}
for (const [rel, label, note] of OPTIONAL) {
  if (exists(rel)) console.log(`  ✔ ${label}`);
  else console.log(`  ⚠ ${label} نیست (اختیاری) — ${note}`);
}

if (missing.length) {
  console.log('\n⛔ قبل از تست، این‌ها لازم است:');
  for (const m of missing) console.log(`   • ${m.fix}`);
  console.log('   (یک بار اجرا کنید: npm install && npm run build -w @farday/api)\n');
  process.exit(1);
}
console.log('\n✅ پیش‌نیازها آماده‌اند — تست‌ها شروع می‌شوند.\n');
