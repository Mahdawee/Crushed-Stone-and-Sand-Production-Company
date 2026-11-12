/**
 * پیدا کردن کامپایلر/لینکر C++ مایکروسافت (MSVC) — ماژول مشترک.
 *
 * چرا ماژول جدا: منطق پیدا کردن لینکر باید در سه جا **یکسان** باشد
 * (`build-desktop.mjs`، `doctor.mjs`، `find-msvc.mjs`)؛ نسخه‌های کپی‌شده
 * با هم فرق می‌کنند و همین باعث شد کاربر با وجود نصب کامل Build Tools،
 * پیام «link.exe پیدا نشد» بگیرد.
 *
 * ## درس واقعی (دور سیزدهم)
 * کاربر گفته بود این‌ها نصب است:
 *   • C++ Build Tools core features
 *   • Visual C++ v14 Redistributable
 *   • C++ core desktop features
 *   • MSVC v143 - VS 2022 C++ x64/x86 build tools
 *   • Windows 11 SDK (10.0.26100.9457)
 * ولی اسکریپت می‌گفت «لینکر پیدا نشد». علت: نسخه‌ی قبلی فقط مسیرهای
 * `…\Microsoft Visual Studio\2019\…` و `…\2022\…` را می‌گشت. کافی است نصب
 * جای دیگری باشد (مثلاً `\18\BuildTools` در Visual Studio 2026، یا مسیر
 * سفارشی) تا پیدا نشود.
 *
 * ## راهبرد جدید (چند لایه، هر لایه ارزان‌تر از قبلی نیست — بلکه مطمئن‌تر)
 *   ۱) `vswhere.exe -all -products * -format json` → همه‌ی نصب‌ها با نام/نسخه
 *   ۲) `vswhere -find "VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe"`
 *      (روش رسمی مایکروسافت برای پیدا کردن یک فایل داخل نصب — مستقل از
 *       چیدمان پوشه‌ها، پس با نسخه‌های آینده هم کار می‌کند)
 *   ۳) پیمایش پوشه‌ی `Microsoft Visual Studio` با **هر** نام نسخه (نه فقط ۲۰۲۲)
 *   ۴) جست‌وجوی محدود داخل خودِ نصب برای `vcvars64.bat` / `link.exe`
 *   ۵) اگر vcvars نبود ولی link.exe بود: ساختن دستی `LIB`/`INCLUDE`
 *
 * اگر هیچ‌کدام نشد، نتیجه شامل فهرست `checked` است تا کاربر (و ما) ببینیم
 * دقیقاً چه مسیرهایی بررسی شد — به‌جای پیام مبهم «پیدا نشد، —».
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/*
 * `FD_TEST_WIN32=1` فقط برای **تست** است: اجازه می‌دهد منطق جست‌وجوی ویندوز
 * را روی لینوکس/CI با ساختار پوشه‌ی ساختگی بیازماییم (چون در سندباکس
 * ویندوز و Visual Studio نداریم). در استفاده‌ی عادی هیچ تأثیری ندارد.
 */
export const isWin = process.platform === 'win32' || process.env.FD_TEST_WIN32 === '1';

/* ------------------------------------------------------------------ */
/* کمکی‌ها                                                             */
/* ------------------------------------------------------------------ */

export const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};
export const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

/** آیا فایل اجرایی در PATH هست؟ */
export function inPath(exe, env = process.env) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const hasExt = /\.(exe|cmd|bat)$/i.test(exe);
  const dirs = (env.PATH || '').split(isWin ? ';' : ':').filter(Boolean);
  for (const d of dirs) {
    for (const e of hasExt ? [''] : exts) {
      const p = path.join(d, exe + e);
      if (isFile(p)) return p;
    }
  }
  return '';
}

/** مقایسه‌ی نسخه‌ها به شکل عددی: `14.44.35207` > `14.9.1` */
export function newerVersion(a, b) {
  const n = (x) => String(x).split('.').map((v) => Number(v) || 0);
  const [a1, a2, a3, a4] = n(a);
  const [b1, b2, b3, b4] = n(b);
  return (a1 - b1) || (a2 - b2) || ((a3 || 0) - (b3 || 0)) || ((a4 || 0) - (b4 || 0));
}

/* ------------------------------------------------------------------ */
/* Windows SDK                                                        */
/* ------------------------------------------------------------------ */

export function sdkLibRoots() {
  const roots = [];
  /*
   * مسیر پیش‌فرض + override:
   *   set FD_SDK_ROOT=D:\Windows Kits\10
   * (SDK روی درایو دیگر، یا برای تست در محیط غیرویندوز)
   */
  const bases = [];
  const override = process.env.FD_SDK_ROOT;
  if (override) bases.push(path.join(override, 'Lib'));
  bases.push(
    'C:\\Program Files (x86)\\Windows Kits\\10\\Lib',
    'C:\\Program Files\\Windows Kits\\10\\Lib',
  );
  for (const base of bases) {
    if (!isDir(base)) continue;
    let versions = [];
    try { versions = fs.readdirSync(base).filter((d) => /^10\./.test(d)); } catch { /* ignore */ }
    /*
     * مرتب‌سازی عددی — نه رشته‌ای.
     * باگ واقعی (دور پانزدهم): `sort()` پیش‌فرض رشته‌ای است، پس
     * «10.0.19041.0» بزرگ‌تر از «10.0.26100.0» شناخته می‌شد و SDK قدیمی
     * انتخاب می‌شد؛ در نتیجه `shared` (محل winapifamily.h) پیدا نمی‌شد.
     */
    versions.sort((a, b) => -newerVersion(a, b));
    for (const v of versions) roots.push({ base, version: v, dir: path.join(base, v) });
  }
  return roots;
}

/** جدیدترین نسخه‌ی Windows SDK (رشته‌ی «10.0.26100.0» یا خالی) */
export function newestWindowsSdk() {
  const first = sdkLibRoots()[0];
  return first ? first.version : '';
}

/* ------------------------------------------------------------------ */
/* vswhere                                                            */
/* ------------------------------------------------------------------ */

export function vswherePath() {
  return process.env.FD_VSWHERE
    || 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
}

function runVswhere(args) {
  const exe = vswherePath();
  if (!isFile(exe)) return { ok: false, stdout: '', exe };
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true });
  return { ok: true, stdout: r.stdout || '', exe, status: r.status };
}

/**
 * همه‌ی نصب‌های Visual Studio (هر محصول، هر نسخه) — با نام و نسخه.
 *
 * `-all` مهم است: `-latest` فقط جدیدترین نصب را می‌دهد. اگر جدیدترین نصب
 * ناقص باشد (مثلاً VS برای C#) و نصب قدیمی‌تر کامپوننت C++ داشته باشد،
 * `-latest` ما را به دام می‌اندازد. دقیقاً همین اتفاق برای کاربر افتاد.
 */
export function enumerateVsInstances() {
  const out = [];
  if (!isWin) return out;

  /* الف) JSON کامل — نام، نسخه، مسیر، کامل بودن */
  const json = runVswhere(['-all', '-products', '*', '-format', 'json', '-utf8']);
  if (json.ok && json.stdout.trim().startsWith('[')) {
    try {
      const list = JSON.parse(json.stdout);
      for (const it of list) {
        if (!it || !it.installationPath) continue;
        out.push({
          path: it.installationPath,
          displayName: it.displayName || it.productId?.id || '',
          version: it.installationVersion || '',
          isComplete: it.isComplete !== false,
          source: 'vswhere',
        });
      }
    } catch { /* JSON خراب — به سراغ روش‌های بعدی می‌رویم */ }
  }

  /* ب) اگر JSON کار نکرد، حالت متنی */
  if (!out.length) {
    const txt = runVswhere(['-all', '-products', '*', '-property', 'installationPath']);
    for (const line of (txt.stdout || '').split(/\r?\n/)) {
      const p = line.trim();
      if (p && !out.some((o) => o.path === p)) {
        out.push({ path: p, displayName: '', version: '', isComplete: true, source: 'vswhere (متنی)' });
      }
    }
  }

  return out.sort((a, b) => newerVersion(b.version, a.version));
}

/** پوشه‌های `…\Microsoft Visual Studio\<نسخه>\<محصول>` روی دیسک — هر نسخه‌ای */
export function scanVsDirs() {
  const found = [];
  if (!isWin) return found;
  /*
   * مسیرهای پیش‌فرض ویندوز + امکان override:
   *   set FD_VS_BASE=D:\VS;E:\Tools\VS
   * (برای نصب روی درایو دیگر، یا برای تست)
   */
  const bases = (process.env.FD_VS_BASE || '')
    .split(';').map((x) => x.trim()).filter(Boolean);
  if (!bases.length) {
    bases.push(
      'C:\\Program Files\\Microsoft Visual Studio',
      'C:\\Program Files (x86)\\Microsoft Visual Studio',
    );
  }
  /*
   * این نام‌ها **نصب Visual Studio نیستند** — پوشه‌های خودِ نصب‌کننده‌اند:
   *   …\Microsoft Visual Studio\Installer\{Assets,cs,de,…}
   *   …\Microsoft Visual Studio\Shared\{GitHubProtocolHandler,…}
   * نسخه‌ی قبلی همه‌ی این‌ها را «نصب» حساب می‌کرد و در گزارش کاربر
   * ۲۰ خط «کامپوننت MSVC نصب نشده» بی‌ربط چاپ شد.
   */
  const NOT_A_PRODUCT = /^(installer|shared|common7|packages|licenses|setup)$/i;

  for (const base of bases) {
    if (!isDir(base)) continue;
    let versions = [];
    try { versions = fs.readdirSync(base); } catch { continue; }
    for (const v of versions) {
      const versionDir = path.join(base, v);
      if (!isDir(versionDir)) continue;
      /* فقط پوشه‌هایی که «مثل نسخه» هستند: 18، 2022، 2019 … */
      if (!/^\d+(\.\d+)*$/.test(v)) continue;

      let products = [];
      try { products = fs.readdirSync(versionDir); } catch { continue; }
      for (const prod of products) {
        if (NOT_A_PRODUCT.test(prod)) continue;
        const p = path.join(versionDir, prod);
        /* فقط چیزی که واقعاً یک نصب VS است (پوشه‌ی VC یا Common7 دارد) */
        if (isDir(p) && (isDir(path.join(p, 'VC')) || isDir(path.join(p, 'Common7')))) {
          found.push({ path: p, displayName: `${prod} ${v}`, version: v, isComplete: true, source: 'پیمایش پوشه' });
        }
      }
      /* گاهی خودِ پوشه‌ی نسخه، ریشه‌ی نصب است */
      if (isDir(path.join(versionDir, 'VC'))) {
        found.push({ path: versionDir, displayName: `VS ${v}`, version: v, isComplete: true, source: 'پیمایش پوشه' });
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* جست‌وجوی واقعی لینکر                                                */
/* ------------------------------------------------------------------ */

/**
 * حل مسیر بدون حساسیت به حرف بزرگ/کوچک.
 *
 * چرا لازم است: ویندوز فایل‌سیستمش case-insensitive است، ولی Node که
 * `statSync` می‌زند باید نام دقیق را بداند. در نصب واقعی کاربر پوشه
 * `Hostx64` به شکل `HostX64` بود — ساختن مسیر با حروف ثابت («Hostx64»)
 * در محیط‌های دیگر (یا با ابزارهای تست) می‌شکند.
 *
 * `resolveCi('C:\\…\\MSVC\\14.44.35207', 'bin', 'Hostx64', 'x64', 'link.exe')`
 */
export function resolveCi(base, ...segments) {
  let cur = base;
  for (const seg of segments) {
    let entries = [];
    try { entries = fs.readdirSync(cur); } catch { return ''; }
    const hit = entries.find((e) => e.toLowerCase() === seg.toLowerCase());
    if (!hit) return '';
    cur = path.join(cur, hit);
    /* آخرین بخش می‌تواند فایل **یا** پوشه باشد (مثلاً resolveCi(root,'VC','Tools','MSVC')) */
    if (!fs.existsSync(cur)) return '';
  }
  return cur;
}

/** همه‌ی نسخه‌های MSVC نصب‌شده، از جدید به قدیم */
export function msvcVersions(root) {
  const msvcRoot = resolveCi(root, 'VC', 'Tools', 'MSVC');
  if (!msvcRoot) return [];
  try {
    return fs.readdirSync(msvcRoot).filter((v) => /^\d+\./.test(v)).sort(newerVersion).reverse();
  } catch { return []; }
}

/**
 * اولین نسخه‌ی MSVC که **واقعاً link.exe دارد** را برمی‌گرداند.
 *
 * درس دور چهاردهم (نصب واقعی کاربر): دو نسخه نصب بود —
 *   • 14.51.36231  (جدیدتر، ولی پوشه‌ی bin\Hostx64\x64\link.exe نداشت)
 *   • 14.44.35207  (قدیمی‌تر، سالم)
 * نسخه‌ی قبلی فقط «جدیدترین» را می‌گرفت و چون link.exe نداشت، کل نصب را
 * رد می‌کرد. حالا از جدید به قدیم می‌گردیم و اولین سالم را برمی‌داریم.
 */
export function pickMsvc(root) {
  const msvcRoot = resolveCi(root, 'VC', 'Tools', 'MSVC');
  if (!msvcRoot) return { linkExe: '', msvcVersion: '', complete: [] };
  const complete = [];
  for (const ver of msvcVersions(root)) {
    const linkExe = resolveCi(path.join(msvcRoot, ver), 'bin', 'Hostx64', 'x64', 'link.exe');
    if (linkExe) {
      complete.push(ver);
      if (!complete.first) complete.first = ver;
      return { linkExe, msvcVersion: ver, complete };
    }
  }
  return { linkExe: '', msvcVersion: '', complete };
}

/**
 * مسیریابی vcvars.
 *
 * نکته‌ی واقعی: در نصب VS 2026 کاربر، `vcvars64.bat` **نبود** ولی
 * `vcvarsall.bat` بود. نسخه‌ی قبلی در جست‌وجوی عمیق فقط `vcvars64.bat`
 * را می‌گشت و در نتیجه LIB/INCLUDE دستی ساخته می‌شد. `vcvarsall.bat x64`
 * همان کار `vcvars64.bat` را می‌کند، پس هر دو پذیرفته می‌شوند.
 */
function findVcvars(root) {
  return resolveCi(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    || resolveCi(root, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
}

/** مسیرهای استاندارد داخل یک نصب VS */
function standardPaths(root) {
  const vcvars = findVcvars(root);
  const picked = pickMsvc(root);
  return { vcvars, msvcVersion: picked.msvcVersion, linkExe: picked.linkExe };
}

/**
 * جست‌وجوی محدود (BFS با عمق محدود) برای پیدا کردن یک فایل.
 * فقط پوشه‌های مربوط به VC بررسی می‌شوند تا سریع باشد.
 */
export function searchFile(root, target, maxDepth = 4) {
  const targetLower = target.toLowerCase();
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next = [];
    for (const dir of level) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase() === targetLower) return path.join(dir, e.name);
        /* پوشه‌های سنگین و بی‌ربط را نپیماییم */
        if (e.isDirectory() && !/^(Common7|Installer|DesignTools|Team Tools|MSBuild|Xml|jsonschema|Licenses|Setup|vb|ServiceHub|ImportExport|Extensions|Languages|SQL|NuGet|Feedback|Licenses|Resource)$/i.test(e.name)) {
          next.push(path.join(dir, e.name));
        }
      }
    }
    level = next;
  }
  return '';
}

/**
 * پیدا کردن MSVC برای یک ریشه‌ی نصب مشخص:
 * اول مسیر استاندارد، بعد جست‌وجوی محدود، بعد vswhere -find.
 */
export function resolveMsvcRoot(root) {
  const std = standardPaths(root);
  if (std.linkExe && std.vcvars) return { ...std, how: 'مسیر استاندارد' };
  if (std.linkExe && !std.vcvars) {
    /* vcvars نیست → در همان نصب دنبالش بگرد */
    const vcvars = findVcvars(root);
    return { ...std, vcvars, how: vcvars ? 'جست‌وجو در نصب' : 'لینکر بدون vcvars' };
  }
  /* چیدمان ناشناخته: خودِ link.exe را بگرد */
  const vcDir = resolveCi(root, 'VC') || root;
  const linkExe = searchFile(vcDir, 'link.exe', 8);
  if (linkExe) {
    /* مسیر: …\VC\Tools\MSVC\<ver>\bin\Hostx64\x64\link.exe */
    const parts = linkExe.split(/[\\/]/);
    const i = parts.findIndex((p) => /^MSVC$/i.test(p));
    const msvcVersion = i >= 0 ? parts[i + 1] || '' : '';
    const vcvars = searchFile(vcDir, 'vcvars64.bat', 6)
      || searchFile(root, 'vcvars64.bat', 6)
      || searchFile(vcDir, 'vcvarsall.bat', 6)
      || searchFile(root, 'vcvarsall.bat', 6);
    return { linkExe, vcvars, msvcVersion, how: 'جست‌وجوی عمیق' };
  }
  return { linkExe: '', vcvars: '', msvcVersion: '', how: '' };
}

/**
 * نتیجه‌ی نهایی جست‌وجو.
 * `checked` برای عیب‌یابی نگه داشته می‌شود (چرا پیدا نشد؟).
 */
export function findMsvc() {
  const result = {
    found: false,
    vsPath: '',
    displayName: '',
    msvcVersion: '',
    linkExe: '',
    vcvars: '',
    sdkVersion: '',
    source: '',
    how: '',
    /* آیا اصلاً Visual Studio دیده شد؟ */
    sawVisualStudio: false,
    instances: [],
    checked: [],
    vswhere: vswherePath(),
    vswhereExists: isFile(vswherePath()),
  };
  if (!isWin) return result;

  const seen = new Set();
  const tryRoot = (root, meta) => {
    const key = root.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    if (!isDir(root)) { result.checked.push({ path: root, why: 'پوشه نیست', source: meta.source }); return null; }
    result.sawVisualStudio = true;
    const found = resolveMsvcRoot(root);
    result.checked.push({
      path: root,
      why: found.linkExe ? `link.exe پیدا شد (${found.how})` : 'link.exe پیدا نشد',
      source: meta.source,
    });
    if (!found.linkExe) return null;
    return { ...meta, ...found, root };
  };

  /* ۰) مسیر دستی کاربر — همیشه اول (کاربر بهتر می‌داند) */
  for (const p of (process.env.FD_MSVC_ROOT || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const hit = tryRoot(p, { source: 'FD_MSVC_ROOT', displayName: 'مسیر دستی' });
    if (hit) return finish(result, hit);
  }

  /* ۱) همه‌ی نصب‌های vswhere (نه فقط جدیدترین) */
  const instances = enumerateVsInstances();
  result.instances = instances;
  for (const inst of instances) {
    const hit = tryRoot(inst.path, inst);
    if (hit) return finish(result, hit);
  }

  /* ۲) vswhere -find : مستقل از چیدمان پوشه‌ها */
  const pat = 'VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\link.exe';
  const found = runVswhere(['-all', '-products', '*', '-find', pat]);
  for (const line of (found.stdout || '').split(/\r?\n/)) {
    const linkExe = line.trim();
    if (!linkExe || !isFile(linkExe)) continue;
    const parts = linkExe.split(/[\\/]/);
    const i = parts.findIndex((p) => /^MSVC$/i.test(p));
    const msvcVersion = i >= 0 ? parts[i + 1] || '' : '';
    /* ریشه = بالاتر از VC */
    const vcIdx = parts.findIndex((p) => /^VC$/i.test(p));
    const root = vcIdx > 0 ? parts.slice(0, vcIdx).join('\\') : '';
    const vcvars = root
      ? [path.join(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'),
        path.join(root, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat')].find(isFile) || ''
      : '';
    result.checked.push({ path: linkExe, why: 'vswhere -find', source: 'vswhere -find' });
    result.sawVisualStudio = true;
    return finish(result, {
      source: 'vswhere -find', displayName: 'vswhere -find', root,
      linkExe, vcvars, msvcVersion, how: 'vswhere -find',
    });
  }

  /* ۳) پیمایش پوشه‌ی Visual Studio — هر نام نسخه‌ای */
  for (const inst of scanVsDirs()) {
    const hit = tryRoot(inst.path, inst);
    if (hit) return finish(result, hit);
  }

  return result;
}

function finish(result, hit) {
  return {
    ...result,
    found: true,
    sawVisualStudio: true,
    vsPath: hit.root || result.vsPath,
    displayName: hit.displayName || hit.source || '',
    msvcVersion: hit.msvcVersion || '',
    linkExe: hit.linkExe,
    vcvars: hit.vcvars || '',
    sdkVersion: newestWindowsSdk(),
    source: hit.source || '',
    how: hit.how || '',
  };
}

/* ------------------------------------------------------------------ */
/* محیط کامپایل                                                       */
/* ------------------------------------------------------------------ */

/** متغیرهایی که از vcvars لازم داریم */
const ENV_KEYS = /^(PATH|LIB|INCLUDE|LIBPATH|VCINSTALLDIR|VCToolsInstallDir|VSINSTALLDIR|WindowsSdkDir|WindowsSDKVersion|Platform|UCRTVersion|UniversalCRTSdkDir|VSCMD_ARG_TGT_ARCH|WindowsSdkBinPath|WindowsSdkVerBinPath)$/i;

/**
 * محیط کامل MSVC.
 *
 * ۱) اگر در PATH هست (Developer Command Prompt) → کاری لازم نیست.
 * ۲) وگرنه `vcvars64.bat` را اجرا و `set` را می‌خوانیم (روش رسمی).
 * ۳) اگر vcvars نبود → `LIB`/`INCLUDE` را دستی می‌سازیم (چون فقط
 *    اضافه‌کردن bin به PATH خطای `LNK1104: cannot open file 'kernel32.lib'` می‌دهد).
 */
export function msvcEnv(msvc) {
  if (!isWin) return { env: {}, how: 'غیر ویندوز' };
  if (inPath('link.exe')) return { env: {}, how: 'link.exe از قبل در PATH' };
  if (!msvc || !msvc.found) return { env: {}, how: 'MSVC پیدا نشد' };

  if (msvc.vcvars) {
    /* vcvars64.bat خودش x64 است؛ vcvarsall.bat نیاز به آرگومان x64 دارد */
    const isAll = /vcvarsall\.bat$/i.test(msvc.vcvars);
    const cmd = `call "${msvc.vcvars}"${isAll ? ' x64' : ''} >nul 2>&1 && set`;
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', cmd], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    });
    const env = {};
    for (const line of (r.stdout || '').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i <= 0) continue;
      const key = line.slice(0, i).trim();
      if (ENV_KEYS.test(key)) env[key] = line.slice(i + 1);
    }

    /*
     * آیا vcvars واقعاً کار کرد؟
     *
     * «PATH دارد» کافی نیست — `cmd.exe /s /c "... && set"` همیشه PATH خودش را
     * چاپ می‌کند، حتی اگر `call vcvars64.bat` شکست بخورد. پس همان شرطی را
     * می‌سنجیم که برای کامپایل لازم است: LIB و INCLUDE پر باشند و INCLUDE
     * پوشه‌ی `shared` را داشته باشد (محل `winapifamily.h`).
     *
     * اگر vcvars کار نکرد → به ساخت دستی می‌رویم (که همان LIB/INCLUDE کامل
     * را می‌سازد) و دلیلش را برای نمایش در لاگ برمی‌گردانیم.
     */
    const libOk = !!env.LIB && env.LIB.split(';').filter(Boolean).length >= 2;
    const incOk = !!env.INCLUDE && /[\\/]shared(;|$)/i.test(env.INCLUDE);
    if (libOk && incOk) {
      return { env, how: isAll ? 'vcvarsall x64' : 'vcvars64' };
    }
    /* ناموفق — دلیل را نگه دار و پشتیبان را استفاده کن */
    const why = (r.stderr || '').split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
    const fb = manualEnv(msvc);
    return {
      env: fb,
      how: Object.keys(fb).length ? 'ساخت دستی LIB/INCLUDE' : 'ناموفق',
      vcvarsFailed: true,
      vcvarsReason: why || `LIB=${env.LIB ? 'دارد' : 'خالی'} · INCLUDE shared=${incOk ? 'دارد' : 'ندارد'}`,
    };
  }

  /* پشتیبان: ساخت دستی LIB/INCLUDE از مسیرهایی که می‌شناسیم */
  const env = manualEnv(msvc);
  return { env, how: Object.keys(env).length ? 'ساخت دستی LIB/INCLUDE' : 'ناموفق' };
}

/**
 * ساخت دستی LIB/INCLUDE — پشتیبانِ نبودِ vcvars.
 * ساختار: `<VC>\Tools\MSVC\<ver>\lib\x64` و `<Kits>\10\Lib\<ver>\{ucrt,um}\x64`
 */
export function manualEnv(msvc) {
  const env = {};
  if (!msvc || !msvc.linkExe) return env;

  /* …\VC\Tools\MSVC\<ver>\bin\HostX64\x64\link.exe → …\VC\Tools\MSVC\<ver> */
  const binDir = path.dirname(msvc.linkExe);
  const msvcDir = path.resolve(binDir, '..', '..', '..');   /* …\VC\Tools\MSVC\<ver> */
  /* …\VC\Tools\MSVC\<ver> → up1: MSVC → up2: Tools → up3: VC */
  const vcRoot = path.resolve(msvcDir, '..', '..', '..');    /* …\BuildTools\VC  ← درست */

  /* ---- کتابخانه‌های MSVC ---- */
  const libs = [];
  for (const rel of [['lib', 'x64']]) {
    const p = resolveCi(msvcDir, ...rel);
    if (p) libs.push(p);
  }

  /* ---- هدرهای MSVC (شامل ATL/MFC اگر نصب باشد) ---- */
  const incs = [];
  for (const rel of [['include'], ['atlmfc', 'include']]) {
    const p = resolveCi(msvcDir, ...rel);
    if (p) incs.push(p);
  }

  /*
   * ---- Windows SDK ----
   *
   * باگ واقعی (دور پانزدهم): خطای
   *   windows.h(1): fatal error C1083: Cannot open include file: 'winapifamily.h'
   * یعنی INCLUDE فقط `um` و `ucrt` را داشت. فایل `winapifamily.h` در
   * پوشه‌ی `shared` است. ترتیب همان ترتیب vcvars64 است:
   *   ucrt → shared → um → winrt
   * و LIB فقط ucrt و um را لازم دارد.
   */
  const sdk = sdkLibRoots()[0];
  if (sdk) {
    /* …\Windows Kits\10\Lib\<ver> → …\Windows Kits\10\Include\<ver> */
    const kitsRoot = path.dirname(path.dirname(sdk.dir));
    const incRoot = resolveCi(kitsRoot, 'Include', sdk.version);
    for (const sub of ['ucrt', 'shared', 'um', 'winrt']) {
      const p = incRoot ? resolveCi(incRoot, sub) : '';
      if (p && !incs.includes(p)) incs.push(p);
    }
    for (const sub of ['ucrt', 'um']) {
      const p = resolveCi(sdk.dir, sub, 'x64');
      if (p && !libs.includes(p)) libs.push(p);
    }
    env.WindowsSdkDir = kitsRoot + '\\';
    env.WindowsSDKVersion = sdk.version.endsWith('\\') ? sdk.version : sdk.version + '\\';
    env.UCRTVersion = sdk.version;
    env.UniversalCRTSdkDir = kitsRoot + '\\';
  }

  if (libs.length) env.LIB = libs.join(';');
  if (incs.length) env.INCLUDE = incs.join(';');
  env.PATH = [binDir, process.env.PATH || ''].join(';');

  /* VCINSTALLDIR باید به پوشه‌ی «VC» اشاره کند، نه «VC\Tools» —
     چند build script (از جمله vswhom-sys) همین را می‌خوانند. */
  env.VCINSTALLDIR = vcRoot + '\\';
  env.VCToolsInstallDir = msvcDir + '\\';
  env.VCToolsVersion = msvc.msvcVersion || '';
  env.Platform = 'x64';
  env.VSCMD_ARG_TGT_ARCH = 'x64';
  return env;
}

/* ------------------------------------------------------------------ */
/* گزارش فارسی                                                        */
/* ------------------------------------------------------------------ */

/** یک خط خلاصه — برای doctor و build-desktop */
export function summaryLine(msvc) {
  if (!msvc || !msvc.found) return { ok: false, text: 'لینکر C++ (link.exe): پیدا نشد — ساخت شکست می‌خورد' };
  const bits = [`MSVC ${msvc.msvcVersion || '?'}`];
  if (msvc.sdkVersion) bits.push(`SDK ${msvc.sdkVersion}`);
  if (msvc.how) bits.push(msvc.how);
  return { ok: true, text: `لینکر C++ (link.exe): ${bits.join(' · ')}` };
}
