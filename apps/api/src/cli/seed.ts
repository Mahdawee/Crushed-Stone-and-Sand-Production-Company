/**
 * Seed / demo data.
 *
 *   node dist/cli/seed.js             → lookups + admin only (safe for production)
 *   node dist/cli/seed.js --demo      → also 20 employees, customers, sales…
 *   node dist/cli/seed.js --force     → run even if data already exists
 */
import { db } from '../db';
import { ensureSchemaAsync } from '../schema';
import { ensureDefaultAdmin } from '../common/auth';
import { settingsService } from '../common/settings';
import { toCalendar, pad2, monthBucket, todayISO, CalendarMode } from '../common/calendar';

const MATERIALS = [
  ['ماسه اول', 'متر مکعب'], ['ماسه دوم', 'متر مکعب'], ['ریگ', 'متر مکعب'],
  ['سنگ غرقه', 'متر مکعب'], ['خاک', 'متر مکعب'], ['۰۱۹', 'متر مکعب'],
  ['۰۲۸', 'متر مکعب'], ['۰۳۸', 'متر مکعب'], ['۰۴۸', 'متر مکعب'],
  ['۰۱۲', 'متر مکعب'], ['ماشک', 'متر مکعب'], ['کرش درشت', 'متر مکعب'],
  ['کرش نرم', 'متر مکعب'], ['جغل', 'متر مکعب'],
];
const EXPENSE_CATEGORIES = [
  ['کرایه وسایط', 'کرایه'], ['پیسکاری', 'خدمات'], ['خرید سمنت', 'مواد'],
  ['خرید روغن و فلتر', 'پرزه جات'], ['تیل و دیزل', 'سوخت'], ['برق', 'خدمات'],
  ['آب', 'خدمات'], ['خورد و خوراک کارگران', 'متفرقه'], ['ترمیم ماشینری', 'پرزه جات'],
  ['کرایه زمین', 'کرایه'], ['مالیه و عوارض', 'دولتی'], ['متفرقه', 'متفرقه'],
];
const PAYERS = [
  ['دخل', 'صندوق'], ['احمد', 'شخص'], ['مدیر مالی', 'شخص'], ['سرپرست', 'شخص'],
  ['بانک', 'بانک'], ['شرکت', 'حساب شرکت'],
];
const RECEIPT_SOURCES = [
  ['باقی داری', 'کاهش بدهی'], ['امانت', 'امانت'], ['بیانیه', 'بیانیه'], ['پیش پرداخت', 'پیش پرداخت'],
];
const CONTRACTORS = [
  ['اکتروز سبز شرکت', 'موتر شرکت'], ['باربری احمد', 'باربری'], ['دمترک شخصی', 'دمترک'],
  ['باربری کرایی', 'باربری'],
];
const MACHINERY = [
  ['سنگ شکن فکی', 'Jaw Crusher 90x60', '', 1],
  ['سرند (ویبره)', '3 طبقه', '', 2],
  ['لودر', 'LiuGong 856', 'KBL-1234', 2],
  ['کمپرسی', 'Volvo FM', 'HER-4521', 4],
  ['بگر (اکسکاواتور)', 'CAT 320', 'KDR-7788', 1],
  ['موتر آبپاش', 'Isuzu', 'KBL-9911', 1],
];

const NAMES = [
  ['احمد کریمی', 'گل احمد', 'مدیر تولید'], ['محمد رسولی', 'عبدالله', 'سرپرست کارگاه'],
  ['علی حسینی', 'حسن', 'اپراتور سنگ شکن'], ['رضا محمدی', 'محمد', 'راننده لودر'],
  ['حکمت الله نظری', 'نظر', 'راننده کمپرسی'], ['سید حسین موسوی', 'موسی', 'حسابدار'],
  ['نعمت الله شریفی', 'شریف', 'کارگر'], ['عبدالرحمن یوسفی', 'یوسف', 'کارگر'],
  ['مسعود اکبری', 'اکبر', 'برق کار'], ['فردین قاسمی', 'قاسم', 'مکانیک'],
  ['سمیع الله بارکزی', 'برکت', 'کارگر'], ['حامد نظری', 'نور', 'راننده'],
  ['کریم صافی', 'صافی', 'کارگر'], ['زلمی پوپل', 'پوپل', 'نگهبان'],
  ['بشیر احمدی', 'احمد', 'کارگر'], ['نصرالله جمالی', 'جمال', 'راننده کمپرسی'],
  ['امان الله ستانکزی', 'ستانک', 'کارگر'], ['شمس الحق یادگاری', 'یادگار', 'اپراتور'],
  ['تورجان منگل', 'منگل', 'کارگر'], ['ولی محمد زازی', 'زازی', 'نگهبان'],
];

const CUSTOMERS = [
  ['شرکت ساختمانی آریا', 'انجنیر سمیع', '0700111222'],
  ['احمد شاه و برادران', 'احمد شاه', '0700222333'],
  ['شرکت راهسازی پامیر', 'انجنیر فرید', '0700333444'],
  ['حاجی نصیر الدین', 'نصیر', '0700444555'],
  ['شرکت ساختمانی کابل نو', 'انجنیر وحید', '0700555666'],
  ['عبدالقادر باربری', 'قادر', '0700666777'],
  ['شرکت عمران هرات', 'انجنیر یوسف', '0700777888'],
  ['میرویس احمدزی', 'میرویس', '0700888999'],
];

async function main() {
  const demo = process.argv.includes('--demo');
  const force = process.argv.includes('--force');
  await ensureSchemaAsync(true);
  await settingsService.ensureDefaults();
  const admin = await ensureDefaultAdmin();
  if (admin.created) console.log('✔ کاربر پیش‌فرض ساخته شد: admin / admin123');

  const p = db();
  const existing: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "LookupItem"`);
  if (Number(existing?.[0]?.c) > 0 && !force) {
    console.log('ℹ فهرست‌های کشویی از قبل موجود است — رد شد.');
  } else {
    const put = async (type: string, rows: (string | number)[][]) => {
      let order = 0;
      for (const r of rows) {
        await p.$executeRawUnsafe(
          `INSERT INTO "LookupItem" ("type","name","extra","sortOrder","active") VALUES (?,?,?,?,1)`,
          type, r[0], (r[1] as string) || '', ++order,
        );
      }
    };
    await put('material', MATERIALS);
    await put('expense_category', EXPENSE_CATEGORIES);
    await put('payer', PAYERS);
    await put('receipt_source', RECEIPT_SOURCES);
    await put('contractor', CONTRACTORS);
    for (const m of MACHINERY) {
      await p.$executeRawUnsafe(
        `INSERT INTO "Machinery" ("name","model","plateNo","count","status") VALUES (?,?,?,?,'active')`,
        m[0], m[1], m[2], m[3],
      );
    }
    await p.$executeRawUnsafe(`INSERT INTO "Company" ("id") VALUES (1) ON CONFLICT("id") DO NOTHING`);
    console.log('✔ فهرست‌های کشویی، ماشینری و مشخصات شرکت آماده شد.');
  }

  if (!demo) {
    console.log('تمام. برای معلومات نمونه: node dist/cli/seed.js --demo');
    return;
  }

  const cnt: any[] = await p.$queryRawUnsafe(`SELECT COUNT(*) c FROM "Employee"`);
  if (Number(cnt?.[0]?.c) > 0 && !force) {
    console.log('ℹ کارمندان از قبل موجود است — بخش نمونه رد شد.');
    return;
  }

  const mode = (await settingsService.calendar()) as CalendarMode;
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const jy = toCalendar(iso(today), mode).jy;

  for (let i = 0; i < NAMES.length; i++) {
    const [name, father, position] = NAMES[i];
    await p.$executeRawUnsafe(
      `INSERT INTO "Employee" ("code","name","fatherName","position","hireDate","baseSalary","phone","nationalId","address","contractPeriod","status")
       VALUES (?,?,?,?,?,?,?,?,?,?,'active')`,
      String(i + 1).padStart(3, '0'), name, father, position,
      `${jy - (i % 5)}-${pad2(1 + (i % 12))}-${pad2(1 + (i % 27))}`,
      14000 + (i % 6) * 2500, `0700${String(100000 + i * 137).slice(0, 6)}`,
      `13${String(10000 + i)}`, 'ولایت کابل / ناحیه ۹', 'یک سال',
    );
  }
  console.log(`✔ ${NAMES.length} کارمند نمونه ثبت شد.`);

  for (let i = 0; i < CUSTOMERS.length; i++) {
    const [name, contact, phone] = CUSTOMERS[i];
    await p.$executeRawUnsafe(
      `INSERT INTO "Customer" ("code","name","contactPerson","phone","truckPlate","openingBalance","note")
       VALUES (?,?,?,?,?,?,?)`,
      String(i + 1).padStart(3, '0'), name, contact, phone, `KBL-${1000 + i}`, i === 3 ? 25000 : 0, '',
    );
  }
  console.log(`✔ ${CUSTOMERS.length} مشتری نمونه ثبت شد.`);

  const customers: any[] = await p.$queryRawUnsafe(`SELECT * FROM "Customer" ORDER BY "id"`);
  const materials: any[] = await p.$queryRawUnsafe(`SELECT * FROM "LookupItem" WHERE "type"='material' ORDER BY "sortOrder"`);
  const contractors: any[] = await p.$queryRawUnsafe(`SELECT * FROM "LookupItem" WHERE "type"='contractor' ORDER BY "sortOrder"`);
  const drivers = ['نصرالله', 'حامد', 'رضا', 'عبدالله', 'مسعود'];
  const destinations = ['کابل / ناحیه ۵', 'کابل / ناحیه ۱۳', 'پروژه پغمان', 'پروژه چاریکار', 'لوگر'];
  const prices = [1200, 1350, 900, 1500, 700, 800, 950, 1100, 1250, 650, 1400, 1600, 1450, 1000];
  let saleSeq = 0;
  let receiptSeq = 0;
  let expenseSeq = 0;

  for (let d = 0; d < 20; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const ds = iso(date);
    const y = toCalendar(ds, mode).jy;
    for (let k = 0; k < 3; k++) {
      const idx = (d * 3 + k) % customers.length;
      const mi = (d + k) % materials.length;
      const volume = 6 + ((d + k * 3) % 9);
      const unitPrice = prices[mi];
      const freightPerUnit = 150 + ((k * 30) % 90);
      const freightTotal = Math.round(volume * freightPerUnit * 100) / 100;
      const total = Math.round((volume * unitPrice + freightTotal) * 100) / 100;
      saleSeq += 1;
      await p.$executeRawUnsafe(
        `INSERT INTO "Sale" ("no","date","customerId","customerName","driverName","truckPlate","destination","materialId","materialName",
          "volume","unitPrice","freightPerUnit","freightTotal","total","contractorId","contractorName","paymentType","note")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `S-${y}-${String(saleSeq).padStart(4, '0')}`, ds, customers[idx].id, customers[idx].name,
        drivers[(d + k) % drivers.length], `HER-${4000 + ((d + k) % 20)}`,
        destinations[(d + k) % destinations.length], materials[mi].id, materials[mi].name,
        volume, unitPrice, freightPerUnit, freightTotal, total,
        contractors[(d + k) % contractors.length].id, contractors[(d + k) % contractors.length].name,
        k === 2 ? 'credit' : 'cash', '',
      );
    }
    if (d % 4 === 0) {
      const c = customers[d % customers.length];
      receiptSeq += 1;
      await p.$executeRawUnsafe(
        `INSERT INTO "Receipt" ("no","date","customerId","customerName","amount","relatedBillNo","sourceName","receivedBy","note")
         VALUES (?,?,?,?,?,?,?,?,?)`,
        `R-${y}-${String(receiptSeq).padStart(4, '0')}`, ds, c.id, c.name, 15000 + d * 500,
        '', 'باقی داری', 'دخل', '',
      );
    }
    if (d % 3 === 0) {
      expenseSeq += 1;
      await p.$executeRawUnsafe(
        `INSERT INTO "Expense" ("no","date","description","categoryName","purchaseBillNo","shopName","amountAfn","amountUsd","payerName","paymentType","note")
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        `E-${y}-${String(expenseSeq).padStart(4, '0')}`, ds, 'خرید تیل و فلتر موترها', 'تیل و دیزل',
        `BL-${900 + d}`, 'دوکان تیل شهزاد', 4500 + d * 120, d % 6 === 0 ? 200 : 0, 'دخل', 'cash', '',
      );
    }
  }
  console.log('✔ فروشات، رسیدات و مصارف نمونه ثبت شد.');

  // a month of attendance
  const employees: any[] = await p.$queryRawUnsafe(`SELECT * FROM "Employee" ORDER BY "id"`);
  for (let d = 0; d < 22; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const ds = iso(date);
    const dow = date.getDay(); // 5 = Friday
    for (const e of employees) {
      const status = dow === 5 ? 'friday' : (e.id + d) % 17 === 0 ? 'absent' : (e.id + d) % 23 === 0 ? 'leave' : 'present';
      await p.$executeRawUnsafe(
        `INSERT INTO "Attendance" ("employeeId","date","status","checkIn","checkOut","overtime")
         VALUES (?,?,?,?,?,?) ON CONFLICT("employeeId","date") DO NOTHING`,
        e.id, ds, status, status === 'present' ? '07:30' : '', status === 'present' ? '16:30' : '',
        status === 'present' && (e.id + d) % 5 === 0 ? 2 : 0,
      );
    }
  }
  console.log('✔ حضور و غیاب نمونه ثبت شد.');

  // payroll for the current month (paid at the end of the period)
  const b = monthBucket(todayISO(), mode);
  for (let i = 0; i < employees.length; i++) {
    const e = employees[i];
    const bonus = i % 7 === 0 ? 1500 : 0;
    const penalty = i % 11 === 0 ? 500 : 0;
    const overtimeAmount = i % 4 === 0 ? 800 : 0;
    const total = e.baseSalary + bonus + overtimeAmount - penalty;
    await p.$executeRawUnsafe(
      `INSERT INTO "Salary" ("no","periodStart","periodLabel","calendar","year","month","payDate","employeeId","employeeName",
        "baseSalary","bonus","penalty","overtimeAmount","total","payerName","paymentType","note")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT("employeeId","periodStart") DO NOTHING`,
      `P-${b.year}-${String(3000 + i).padStart(4, '0')}`, b.start, b.label, mode, b.year, b.month,
      b.end, e.id, e.name, e.baseSalary, bonus, penalty, overtimeAmount, total, 'دخل', 'cash', '',
    );
  }
  console.log(`✔ معاشات ${b.label} ثبت شد.`);
  console.log('تمام ✔  حالا وارد سیستم شوید: admin / admin123');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
