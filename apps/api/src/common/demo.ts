/**
 * داده‌ی نمونه — نصب و حذفِ موقت، از داخل خود برنامه.
 *
 * درخواست کاربر: «یک گزینه‌ی موقتِ نصب و حذف داده‌های نمونه … را [اضافه کن]».
 *
 * ## چرا این کار «بی‌خطر» است
 * داده‌ی نمونه با پرچم `isDemo = 1` در همان جدول‌های واقعی ذخیره می‌شود
 * (نه یک دیتابیس جدا). بنابراین:
 *   • در همه‌ی گزارش‌ها، فهرست‌ها و مانده‌ها **مثل داده‌ی واقعی** دیده می‌شود
 *     (کاربر می‌تواند تمرین کند و رفتار برنامه را با اعداد ببیند)،
 *   • و «حذف داده‌ی نمونه» دقیقاً و فقط همان ردیف‌ها را برمی‌دارد؛
 *     یک سند واقعی هم لمس نمی‌شود.
 *
 * ## قاعده‌های ایمنی
 *   ۱) فهرست‌های کشویی (مواد، مصارف، منبع رسید، مربوط، پرداخت‌کننده) و
 *      ماشینریِ پیش‌فرض **داده‌ی واقعی لازمِ برنامه** هستند و پاک نمی‌شوند؛
 *      فقط کارکنان/مشتریان/اسنادِ نمونه حذف می‌شوند.
 *   ۲) حذف **نرم** است (درخواست همیشگی کاربر: «حذف‌ها نرم باشند»): ردیف‌ها
 *      به «سطل بازیافت» می‌روند، پس اگر کسی اشتباه زد، قابل بازگشت است.
 *   ۳) اگر داده‌ی واقعی با داده‌ی نمونه قاطی شده باشد، هیچ چیزی حدس زده
 *      نمی‌شود: شمارش هر بخش گزارش می‌شود.
 *   ۴) اگر برنامه در حالت «داده‌ی واقعی» باشد، نصب نمونه اول یک هشدار
 *      می‌دهد (`preview`) — نصب با `force` انجام می‌شود.
 */
import { db } from '../db';
import { ensureSchemaAsync, ensureWalkInCustomer } from '../schema';
import { logActivity } from '../common/activity';
import { softDelete } from '../common/soft-delete';
import { toCalendar, pad2, monthBucket, todayISO, CalendarMode } from '../common/calendar';
import { settingsService } from '../common/settings';
import { ensureDefaultLookups } from './defaults';

const NAMES: [string, string, string][] = [
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

const CUSTOMERS: [string, string, string][] = [
  ['شرکت ساختمانی آریا', 'انجنیر سمیع', '0700111222'],
  ['احمد شاه و برادران', 'احمد شاه', '0700222333'],
  ['شرکت راهسازی پامیر', 'انجنیر فرید', '0700333444'],
  ['حاجی نصیر الدین', 'نصیر', '0700444555'],
  ['شرکت ساختمانی کابل نو', 'انجنیر وحید', '0700555666'],
  ['عبدالقادر باربری', 'قادر', '0700666777'],
  ['شرکت عمران هرات', 'انجنیر یوسف', '0700777888'],
  ['میرویس احمدزی', 'میرویس', '0700888999'],
];

/** جدول‌هایی که ممکن است ردیف نمونه داشته باشند — به ترتيب حذف (فرزند→والد) */
const DEMO_TABLES = ['Attendance', 'Salary', 'Receipt', 'Sale', 'Expense', 'Employee', 'Customer'] as const;

/** شمارش ردیف‌های نمونه در هر جدول */
export async function demoCounts(): Promise<Record<string, number>> {
  await ensureSchemaAsync();
  const out: Record<string, number> = {};
  for (const t of DEMO_TABLES) {
    try {
      const r: any[] = await db().$queryRawUnsafe(
        `SELECT COUNT(*) n FROM "${t}" WHERE "isDemo"=1 AND COALESCE("deletedAt",'')=''`,
      );
      out[t] = Number(r?.[0]?.n) || 0;
    } catch { out[t] = 0; }
  }
  out.total = Object.values(out).reduce((a, b) => a + b, 0);
  return out;
}

/** آیا دیتابیس داده‌ی واقعی (غیرنمونه) دارد؟ */
export async function hasRealData(): Promise<{ sales: number; employees: number; customers: number }> {
  const q = async (sql: string) => Number(((await db().$queryRawUnsafe(sql)) as any[])[0]?.n) || 0;
  return {
    sales: await q(`SELECT COUNT(*) n FROM "Sale" WHERE COALESCE("isDemo",0)=0 AND COALESCE("deletedAt",'')=''`),
    employees: await q(`SELECT COUNT(*) n FROM "Employee" WHERE COALESCE("isDemo",0)=0 AND COALESCE("deletedAt",'')=''`),
    customers: await q(`SELECT COUNT(*) n FROM "Customer" WHERE COALESCE("isDemo",0)=0 AND COALESCE("deletedAt",'')='' AND COALESCE("isWalkIn",0)=0`),
  };
}

/**
 * نصب داده‌ی نمونه.
 *
 * `months` = چند ماه گذشته پوشش داده شود (۱ تا ۶). هرچه بیشتر، اسناد و
 * راپورهای بیشتری برای تمرین ساخته می‌شود؛ روی کمپیوتر قدیمی نصب کندتر است.
 */
export async function installDemo(opts: { months?: number; username?: string } = {}): Promise<{
  ok: boolean; inserted: Record<string, number>; total: number;
}> {
  await ensureSchemaAsync();
  const months = Math.min(6, Math.max(1, Number(opts.months) || 2));
  const p = db();
  const mode = (await settingsService.calendar()) as CalendarMode;
  const demoTag = `[نمونه]`;

  /* اگر از قبل نمونه هست، دوباره نساز — وگرنه اسناد تکراری می‌شوند */
  const existing = await demoCounts();
  if (existing.total > 0) {
    return { ok: false, inserted: {}, total: 0 };
  }

  const inserted: Record<string, number> = {};
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  /* ۱) کارمندان نمونه — کد از بزرگ‌ترین کد موجود ادامه می‌یابد (تصادم نکن) */
  const maxCode = Number((((await p.$queryRawUnsafe(`SELECT MAX(CAST("code" AS INTEGER)) m FROM "Employee"`)) as any[])[0]?.m) || 0);
  const empIds: any[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const [name, father, position] = NAMES[i];
    const code = String(maxCode + i + 1).padStart(3, '0');
    const jy = toCalendar(iso(today), mode).jy;
    await p.$executeRawUnsafe(
      `INSERT INTO "Employee" ("code","name","fatherName","position","hireDate","baseSalary","phone","nationalId","address","contractPeriod","status","isDemo")
       VALUES (?,?,?,?,?,?,?,?,?,?,'active',1)`,
      code, name, father, position, `${jy}-${pad2(1 + (i % 12))}-${pad2(1 + (i % 27))}`,
      14000 + (i % 6) * 2500, `0700${String(100000 + i * 137).slice(0, 6)}`,
      `13${10000 + i}`, 'ولایت کابل / ناحیه ۹', 'یک سال',
    );
    const r: any[] = await p.$queryRawUnsafe(`SELECT "id" FROM "Employee" WHERE "code"=?`, code);
    empIds.push(r?.[0]?.id);
  }
  inserted.employees = empIds.length;

  /* ۲) مشتریان نمونه */
  const custIds: any[] = [];
  const baseCust = Number((((await p.$queryRawUnsafe(`SELECT MAX(CAST("code" AS INTEGER)) m FROM "Customer" WHERE "code"<>'000'`)) as any[])[0]?.m) || 0);
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const [name, contact, phone] = CUSTOMERS[i];
    const code = String(baseCust + i + 1).padStart(3, '0');
    await p.$executeRawUnsafe(
      `INSERT INTO "Customer" ("code","name","contactPerson","phone","truckPlate","openingBalance","note","isDemo")
       VALUES (?,?,?,?,?,?,?,1)`,
      code, name, contact, phone, `KBL-${3000 + i}`, i === 3 ? 25000 : 0, demoTag,
    );
    const r: any[] = await p.$queryRawUnsafe(`SELECT "id" FROM "Customer" WHERE "code"=?`, code);
    custIds.push(r?.[0]?.id);
  }
  inserted.customers = custIds.length;

  /* ردیف «مشتری گذری» — خودِ برنامه لازم دارد؛ اگر نبود ساخته می‌شود */
  await ensureWalkInCustomer();

  /*
   * فهرست‌های پایه (مواد، دسته‌های مصرف، منابع رسید، «مربوط») باید موجود
   * باشند؛ وگرنه نمونه هیچ فروش/مصرفی نمی‌سازد — باگی که تست گرفت: نصب
   * «موفق» گزارش می‌شد ولی جدول فروش خالی می‌ماند.
   */
  await ensureDefaultLookups();
  const materials: any[] = await p.$queryRawUnsafe(`SELECT * FROM "LookupItem" WHERE "type"='material' AND "active"=1 ORDER BY "sortOrder"`);
  const contractors: any[] = await p.$queryRawUnsafe(`SELECT * FROM "LookupItem" WHERE "type"='contractor' AND "active"=1 ORDER BY "sortOrder"`);
  const drivers = ['نصرالله', 'حامد', 'رضا', 'عبدالله', 'مسعود'];
  const destinations = ['کابل / ناحیه ۵', 'کابل / ناحیه ۱۳', 'پروژه پغمان', 'پروژه چاریکار', 'لوگر'];
  const prices = [1200, 1350, 900, 1500, 700, 800, 950, 1100, 1250, 650, 1400, 1600, 1450, 1000];

  let saleSeq = 0, receiptSeq = 0, expenseSeq = 0, attSeq = 0, salSeq = 0;
  const days = months * 30;

  for (let d = 0; d < days; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const ds = iso(date);
    const y = toCalendar(ds, mode).jy;

    for (let k = 0; k < 3; k++) {
      if (!custIds.length || !materials.length) break;
      const idx = (d * 3 + k) % custIds.length;
      const mi = (d + k) % materials.length;
      const volume = 6 + ((d + k * 3) % 9);
      const unitPrice = prices[mi % prices.length];
      const freightPerUnit = 150 + ((k * 30) % 90);
      const freightTotal = Math.round(volume * freightPerUnit * 100) / 100;
      const total = Math.round((volume * unitPrice + freightTotal) * 100) / 100;
      saleSeq += 1;
      await p.$executeRawUnsafe(
        `INSERT INTO "Sale" ("no","date","customerId","customerName","driverName","truckPlate","destination","materialId","materialName",
          "volume","unitPrice","freightPerUnit","freightTotal","total","contractorId","contractorName","paymentType","note","isDemo")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        `D-S-${y}-${String(saleSeq).padStart(4, '0')}`, ds, custIds[idx], CUSTOMERS[idx % CUSTOMERS.length][0],
        drivers[(d + k) % drivers.length], `HER-${4000 + ((d + k) % 20)}`,
        destinations[(d + k) % destinations.length], materials[mi].id, materials[mi].name,
        volume, unitPrice, freightPerUnit, freightTotal, total,
        contractors.length ? contractors[(d + k) % contractors.length].id : null,
        contractors.length ? contractors[(d + k) % contractors.length].name : '',
        k === 2 ? 'credit' : 'cash', demoTag,
      );
    }

    if (d % 4 === 0 && custIds.length) {
      receiptSeq += 1;
      const c = custIds[d % custIds.length];
      await p.$executeRawUnsafe(
        `INSERT INTO "Receipt" ("no","date","customerId","customerName","amount","relatedBillNo","sourceName","receivedBy","note","isDemo")
         VALUES (?,?,?,?,?,?,?,?,?,1)`,
        `D-R-${y}-${String(receiptSeq).padStart(4, '0')}`, ds, c, CUSTOMERS[d % CUSTOMERS.length][0],
        15000 + d * 500, '', 'باقی داری', 'دخل', demoTag,
      );
    }

    if (d % 3 === 0) {
      expenseSeq += 1;
      await p.$executeRawUnsafe(
        `INSERT INTO "Expense" ("no","date","description","categoryName","purchaseBillNo","shopName","amountAfn","amountUsd","payerName","paymentType","note","isDemo")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
        `D-E-${y}-${String(expenseSeq).padStart(4, '0')}`, ds, 'خرید تیل و فلتر موترها', 'تیل و دیزل',
        `BL-${900 + d}`, 'دوکان تیل شهزاد', 4500 + d * 120, d % 6 === 0 ? 200 : 0, 'دخل', 'cash', demoTag,
      );
    }

    /* حضور و غیاب — ۲۲ روز آخر */
    if (d < 22) {
      const dow = date.getDay(); // ۵ = جمعه
      for (let i = 0; i < empIds.length; i++) {
        const eid = empIds[i];
        const status = dow === 5 ? 'friday' : (eid + d) % 17 === 0 ? 'absent' : (eid + d) % 23 === 0 ? 'leave' : 'present';
        await p.$executeRawUnsafe(
          `INSERT INTO "Attendance" ("employeeId","date","status","checkIn","checkOut","overtime","isDemo")
           VALUES (?,?,?,?,?,?,1) ON CONFLICT("employeeId","date") DO NOTHING`,
          eid, ds, status, status === 'present' ? '07:30' : '', status === 'present' ? '16:30' : '',
          status === 'present' && (eid + d) % 5 === 0 ? 2 : 0,
        );
        attSeq += 1;
      }
    }
  }
  inserted.sales = saleSeq;
  inserted.receipts = receiptSeq;
  inserted.expenses = expenseSeq;
  inserted.attendance = attSeq;

  /* ۳) معاش ماه جاری برای کارمندان نمونه */
  const b = monthBucket(todayISO(), mode);
  const emps: any[] = await p.$queryRawUnsafe(`SELECT * FROM "Employee" WHERE "isDemo"=1`);
  for (let i = 0; i < emps.length; i++) {
    const e = emps[i];
    const bonus = i % 7 === 0 ? 1500 : 0;
    const penalty = i % 11 === 0 ? 500 : 0;
    const overtimeAmount = i % 4 === 0 ? 800 : 0;
    const total = Number(e.baseSalary) + bonus + overtimeAmount - penalty;
    await p.$executeRawUnsafe(
      `INSERT INTO "Salary" ("no","periodStart","periodLabel","calendar","year","month","payDate","employeeId","employeeName",
        "baseSalary","bonus","penalty","overtimeAmount","total","payerName","paymentType","note","isDemo")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT("employeeId","periodStart") DO NOTHING`,
      `D-P-${b.year}-${String(3000 + i).padStart(4, '0')}`, b.start, b.label, mode, b.year, b.month,
      b.end, e.id, e.name, e.baseSalary, bonus, penalty, overtimeAmount, total, 'دخل', 'cash', demoTag,
    );
    salSeq += 1;
  }
  inserted.salaries = salSeq;

  const total = Object.values(inserted).reduce((a, x) => a + x, 0);
  await logActivity({
    username: opts.username || 'system',
    action: 'demo-install', entity: 'System',
    detail: `داده‌ی نمونه نصب شد — ${total} ردیف (${months} ماه)`,
  });
  return { ok: true, inserted, total };
}

/**
 * حذف داده‌ی نمونه — **نرم**.
 *
 * فقط ردیف‌های `isDemo=1` به سطل بازیافت می‌روند. ردیف‌های واقعی، فهرست‌های
 * کشویی، ماشینری پیش‌فرض و «مشتری گذری» دست نمی‌خورند.
 */
export async function removeDemo(opts: { username?: string } = {}): Promise<{
  ok: boolean; removed: Record<string, number>; total: number;
}> {
  await ensureSchemaAsync();
  const p = db();
  const removed: Record<string, number> = {};
  /*
   * ترتیب مهم است: اول اسناد فرزند (حضور، معاش، رسید، بل، مصرف)، بعد
   * کارمند/مشتری. با حذف نرم، کلید خارجی هم مشکلی نمی‌سازد، ولی همین ترتیب
   * گزارشِ شمارش را قابل‌فهم می‌کند.
   */
  for (const t of DEMO_TABLES) {
    const rows: any[] = await p.$queryRawUnsafe(
      `SELECT "id" FROM "${t}" WHERE "isDemo"=1 AND COALESCE("deletedAt",'')=''`,
    );
    if (!rows?.length) { removed[t] = 0; continue; }
    /*
     * «مشتری گذری» هرگز حذف نمی‌شود، حتی اگر روزی پرچم نمونه بگیرد؛
     * فروش‌های بدون مشتری به آن اشاره می‌کنند.
     */
    for (const r of rows) {
      const id = Number(r.id);
      if (t === 'Customer') {
        const w: any[] = await p.$queryRawUnsafe(`SELECT "isWalkIn" FROM "Customer" WHERE "id"=?`, id);
        if (Number(w?.[0]?.isWalkIn) === 1) continue;
      }
      await softDelete(t as any, id, { reason: 'حذف داده‌ی نمونه', username: opts.username });
    }
    removed[t] = rows.length;
  }
  const total = Object.values(removed).reduce((a, x) => a + x, 0);
  if (total > 0) {
    await logActivity({
      username: opts.username || 'system',
      action: 'demo-remove', entity: 'System',
      detail: `داده‌ی نمونه حذف شد — ${total} ردیف به سطل بازیافت رفت`,
    });
  }
  return { ok: true, removed, total };
}
