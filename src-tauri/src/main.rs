// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_sidecar;

use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// حالت توسعه یا نسخه‌ی نصب‌شده؟
///
/// باگ: قبلاً `cfg!(dev)` نوشته شده بود، ولی چنین cfg‌ای در Rust وجود ندارد —
/// همیشه `false` می‌شد و در `desktop:dev` هم پوسته سعی می‌کرد سرویس داخلی را
/// خودش راه بیندازد. راه درست، تابع رسمی Tauri است:
/// `tauri::is_dev()` = «فیچر custom-protocol فعال نیست».
fn dev_mode() -> bool {
    std::env::var("FD_TAURI_DEV").is_ok() || tauri::is_dev()
}


/// اندازه و حداقل اندازه‌ی پنجره — متناسب با **همان لپ‌تاپی که برنامه رویش باز می‌شود**.
///
/// باگ (بازرسی «روی هر لپ‌تاپی»): اندازه‌ی ثابت ۱۳۶۰×۸۶۰ با حداقل ۱۰۲۴×۶۸۰
/// روی لپ‌تاپ‌های کوچک (۱۳۶۶×۷۶۸ با مقیاس ۱۲۵٪ که عملاً ~۱۰۹۳×۶۱۴ نقطه
/// منطقی می‌دهد) باعث می‌شد پنجره از صفحه بزرگ‌تر شود: عنوان/دکمه‌ها بیرون
/// صفحه و کاربر عملاً نمی‌توانست برنامه را درست ببیند.
/// حالا اندازه بر اساس مانیتور انتخاب می‌شود و حداقل اندازه هم کوچک‌تر است.
fn window_geometry(app: &tauri::App) -> ((f64, f64), (f64, f64)) {
    /* `primary_monitor` متد ذاتی `tauri::App` است — نیازی به `tauri::Manager` نیست */
    let (mut w, mut h) = (1360.0_f64, 860.0_f64);
    let (mut min_w, mut min_h) = (900.0_f64, 600.0_f64);

    /* اندازه‌ی مانیتور به پیکسل فیزیکی است؛ با scale_factor به نقطه تبدیل می‌شود */
    let mut mon_w = 0.0_f64;
    let mut mon_h = 0.0_f64;
    if let Ok(Some(mon)) = app.primary_monitor() {
        let scale = if mon.scale_factor() > 0.1 { mon.scale_factor() } else { 1.0 };
        mon_w = f64::from(mon.size().width) / scale;
        mon_h = f64::from(mon.size().height) / scale;
    }

    if mon_w > 200.0 && mon_h > 200.0 {
        /* ۹۲٪ عرض و ۸۸٪ ارتفاع — جا برای نوار وظیفه و حاشیه‌های ویندوز */
        w = (mon_w * 0.92).min(1600.0).max(720.0);
        h = (mon_h * 0.88).min(1000.0).max(520.0);
        /* حداقل اندازه نباید از خود صفحه بزرگ‌تر شود */
        min_w = 900.0_f64.min((mon_w - 40.0).max(560.0));
        min_h = 600.0_f64.min((mon_h - 60.0).max(420.0));
    }
    ((w, h), (min_w, min_h))
}

/// Holds the child process of the bundled NestJS API so that it is stopped
/// when the window closes (no orphan `node.exe` left running).
pub struct ApiProcess(pub Mutex<Option<std::process::Child>>);

/// آیا با سوئیچ `--cli` اجرا شده‌ایم؟ (ابزار نجات از روی دسکتاپ)
fn cli_mode() -> bool {
    std::env::args().any(|a| a == "--cli")
}

/// دستور `recovery` — از دکمه‌های صفحه‌ی خطا صدا زده می‌شود.
///
/// `arg` خالی = پوشه داده باز شود؛ `--reset-admin` / `--list-backups` =
/// ابزار نجات در یک پنجره‌ی کنسول اجرا شود. هیچ ورودی دلخواهی از صفحه به
/// خط فرمان داده نمی‌شود (فقط سه مقدار مجاز) تا سطح حمله باز نشود.
#[tauri::command]
fn recovery(app: tauri::AppHandle, arg: String) {
    use tauri::Manager;
    let data_dir = app
        .path()
        .app_data_dir()
        .map(|p| api_sidecar::plain_path(&p))
        .unwrap_or_else(|_| std::env::temp_dir().join("af.farday.roshan"));
    std::fs::create_dir_all(&data_dir).ok();

    if arg.is_empty() {
        /* باز کردن پوشه داده در Explorer ویندوز (بدون برنامه‌ی خارجی) */
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("explorer").arg(&data_dir).spawn();
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("xdg-open").arg(&data_dir).spawn();
        }
        return;
    }

    let extra: &[&str] = match arg.as_str() {
        "--reset-admin" => &["--reset-admin"],
        "--list-backups" => &["--list-backups"],
        _ => {
            api_sidecar::log_line(&data_dir, "درخواست نجات نامعتبر نادیده گرفته شد");
            return;
        }
    };
    if let Err(e) = api_sidecar::run_recovery(&app, &data_dir, extra) {
        api_sidecar::log_line(&data_dir, &format!("recovery: {e}"));
    }
}

fn main() {
    /* ── حالت CLI ─────────────────────────────────────────────────────────
     * `Farday Roshan.exe --cli` بدون پنجره‌ی گرافیکی ابزار نجات را در همین
     * کنسول اجرا می‌کند (رمزنویسی، فهرست پشتیبان‌ها، وضعیت داده). این حالت
     * حتی وقتی WebView2 خراب است هم کار می‌کند.
     */
    if cli_mode() {
        let data_dir = std::env::var("APPDATA")
            .map(|a| std::path::PathBuf::from(a).join("af.farday.roshan"))
            .unwrap_or_else(|_| std::env::temp_dir().join("af.farday.roshan"));
        std::fs::create_dir_all(&data_dir).ok();
        let (node, entry) = match api_sidecar::runtime_paths_public() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("⛔ {e}");
                std::process::exit(1);
            }
        };
        /* مسیر معمولی (بدون `\\?\`) — وگرنه Node با
           `EISDIR ... lstat 'C:'` می‌میرد. */
        let mut cmd = std::process::Command::new(api_sidecar::plain_path(&node));
        cmd.arg(api_sidecar::plain_path(&entry)).arg("--recovery");
        for extra in std::env::args().skip(2) {
            cmd.arg(extra);
        }
        cmd.env("FD_DATA_DIR", &data_dir)
            /* خروجی را کاربر باید ببیند و بخواند (پیام فارسی «رمز برگشت») */
            .env("FD_CLI_PAUSE", "1")
            .stdin(std::process::Stdio::inherit());
        /*
         * برنامه با زیرسیستم گرافیکی ساخته می‌شود (`windows_subsystem`)، پس
         * کنسولی برای ارث‌بری وجود ندارد و خروجیِ فرزند گم می‌شود. یک کنسول
         * تازه می‌سازیم: پیام‌ها دیده می‌شوند و کاربر با Enter می‌بندد.
         */
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            cmd.creation_flags(CREATE_NEW_CONSOLE);
        }
        let status = cmd.status();
        match status {
            Ok(s) => std::process::exit(s.code().unwrap_or(0)),
            Err(e) => {
                eprintln!("⛔ اجرای ابزار نجات ناموفق بود: {e}");
                std::process::exit(1);
            }
        }
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![recovery])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ApiProcess(Mutex::new(None)))
        .setup(|app| {
            // ── 1) data directory (survives app updates, per Windows user) ──
            let data_dir = app
                .path()
                .app_data_dir()
                .map(|p| api_sidecar::plain_path(&p))
                .unwrap_or_else(|_| std::env::temp_dir().join("af.farday.roshan"));
            std::fs::create_dir_all(&data_dir).ok();
            api_sidecar::log_line(
                &data_dir,
                &format!(
                    "── شروع برنامه ── نسخه {} · dev={} · data={}",
                    env!("CARGO_PKG_VERSION"),
                    dev_mode(),
                    data_dir.display()
                ),
            );

            // ── 2) show a window IMMEDIATELY ──
            //
            // مشکل گزارش‌شده: «بعد از نصب، با باز کردن دوباره غیب شد».
            // دلیلش این بود که نسخه‌های قبلی اول منتظر بالا آمدن سرویس داخلی
            // می‌ماندند (تا ۶۰ ثانیه) و *بعد* پنجره می‌ساختند؛ در این فاصله
            // کاربر فکر می‌کرد برنامه باز نشده و دوباره کلیک می‌کرد — و همین
            // باعث دو نسخه‌ی هم‌زمان و تعارض پورت می‌شد.
            //
            // حالا پنجره در کسری از ثانیه با یک صفحه‌ی «در حال آماده‌سازی»
            // باز می‌شود و خودش بعد از آماده شدن سرویس، به رابط کاربری می‌رود.
            /* اندازه بر اساس صفحه‌ی همین کمپیوتر — نه یک عدد ثابت برای همه */
            let ((win_w, win_h), (min_w, min_h)) = window_geometry(app);
            api_sidecar::log_line(
                &data_dir,
                &format!("اندازه پنجره: {win_w}×{win_h} (حداقل {min_w}×{min_h})"),
            );
            let _win = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().expect("about:blank is valid")),
            )
            .title("فردای روشن — مدیریت شرکت تولیدی")
            .inner_size(win_w, win_h)
            .min_inner_size(min_w, min_h)
            .resizable(true)
            .center()
            /* runs on every page load, but paint() only acts on about:blank,
               so the real app page is never overwritten */
            .initialization_script(SPLASH_JS)
            .build()?;

            // ── 3) start + wait in the background, then navigate ──
            //
            // رشته فقط `AppHandle` را می‌گیرد (که در Tauri برای همین کار
            // Send + Sync است) و پنجره را داخل خود رشته با برچسب «main»
            // پیدا می‌کند. اینطور هیچ‌وقت به یک ساختار غیر-Send دست نمی‌زنیم —
            // اشتباهی که کامپایل کل پروژه را می‌شکند.
            let handle = app.handle().clone();
            let data_dir_bg = data_dir.clone();
            std::thread::spawn(move || {
                let win = || handle.get_webview_window("main");

                /* اگر اسکریپت اولیه اجرا نشده باشد، صفحه‌ی «در حال آماده‌سازی»
                   را یک بار دیگر با دست می‌کشیم؛ فقط روی about: عمل می‌کند. */
                std::thread::sleep(Duration::from_millis(120));
                if let Some(w) = win() {
                    let _ = w.eval(SPLASH_JS);
                }

                let mut problem: Option<String> = None;
                /* پورتی که واقعاً استفاده می‌شود؛ نود ممکن است پورت دیگری گرفته باشد */
                let mut api_port: u16 = api_sidecar::API_PORT;

                if dev_mode() {
                    /* Vite is started by `npm run dev`; just wait for it. */
                    api_sidecar::log_line(&data_dir_bg, "حالت توسعه — سرویس خارجی");
                } else {
                    match api_sidecar::start(&handle, &data_dir_bg) {
                        Ok(started) => {
                            api_sidecar::log_line(&data_dir_bg, &format!("API: {}", started.how));
                            api_port = started.port;
                            if let Some(state) = handle.try_state::<ApiProcess>() {
                                if let Ok(mut slot) = state.0.lock() {
                                    *slot = Some(started.child);
                                }
                            }
                        }
                        Err(reason) => {
                            api_sidecar::log_line(&data_dir_bg, &format!("API start: {reason}"));
                            /* «already running» خطا نیست: سرویس از اجرای قبلی
                               زنده است و همان استفاده می‌شود. */
                            if let Some(p) = reason
                                .split("already running on ")
                                .nth(1)
                                .and_then(|s| s.split_whitespace().next())
                                .and_then(|s| s.parse::<u16>().ok())
                            {
                                api_port = p;
                            } else if !reason.contains("already running") {
                                problem = Some(reason);
                            }
                        }
                    }
                }

                /* A real HTTP answer — not just an open port.
                   `api_port == 0` یعنی نود خودش پورت آزاد گرفته و در لاگ
                   اعلام می‌کند؛ `wait_until_ready` همان را می‌خواند. */
                let ready = if dev_mode() {
                    api_sidecar::wait_until_ready(&data_dir_bg, api_sidecar::API_PORT, 40)
                } else {
                    api_sidecar::wait_until_ready(&data_dir_bg, api_port, 60)
                };
                if let Some(p) = ready {
                    if p != api_port {
                        /* برای تشخیص آینده در لاگ بماند: پورت انتخابی نود با
                           آنچه ما فرض کرده بودیم یکی نبود (نه 4317، نه 0) */
                        api_sidecar::log_line(
                            &data_dir_bg,
                            &format!("پورت اعلام‌شده {p} با پورت پیش‌بینی‌شده {api_port} فرق داشت"),
                        );
                    }
                    api_port = p;
                    /* پورت را برای اجرای بعدی نگه دار (جلوگیری از نمونه‌ی دوم) */
                    api_sidecar::save_port(&data_dir_bg, p);
                    api_sidecar::log_line(
                        &data_dir_bg,
                        &format!("API آماده است (پورت {api_port}) — بارگذاری رابط کاربری"),
                    );
                } else if problem.is_none() {
                    problem = Some(format!(
                        "سرویس داخلی در ۶۰ ثانیه جواب نداد (پورت {}).",
                        if api_port == 0 { api_sidecar::API_PORT } else { api_port }
                    ));
                }

                let Some(w) = win() else {
                    api_sidecar::log_line(&data_dir_bg, "پنجره «main» پیدا نشد — پایان");
                    return;
                };

                match problem {
                    None => {
                        let target = if dev_mode() {
                            std::env::var("FD_DEV_URL")
                                .unwrap_or_else(|_| "http://localhost:5173".into())
                        } else {
                            format!("http://127.0.0.1:{api_port}/")
                        };
                        match target.parse() {
                            Ok(url) => {
                                if let Err(e) = w.navigate(url) {
                                    api_sidecar::log_line(&data_dir_bg, &format!("navigate: {e}"));
                                }
                            }
                            Err(e) => api_sidecar::log_line(
                                &data_dir_bg,
                                &format!("آدرس نامعتبر {target}: {e}"),
                            ),
                        }
                    }
                    Some(mut reason) => {
                        if ready.is_none() && !reason.contains("جواب نداد") {
                            reason.push_str("\nسرویس داخلی هم جواب نداد.");
                        }
                        let tail = api_sidecar::tail_log(&data_dir_bg, 25);
                        /* خطاهای آشنا یک جمله‌ی فارسی می‌گیرند (متن خام هم می‌ماند) */
                        let hint = api_sidecar::log_hint(&tail)
                            .map(|h| format!("\n\n🔎 {h}"))
                            .unwrap_or_default();
                        let details = format!(
                            "{reason}{hint}\n\n— آخرین خطوط api.log —\n{tail}\n\nپوشه داده: {}",
                            data_dir_bg.display()
                        );
                        api_sidecar::log_line(&data_dir_bg, &format!("مشکل راه‌اندازی:\n{details}"));
                        let escaped = error_page(&details).replace('#', "%23");
                        let _ = w.eval(&format!(
                            "document.open();document.write(`{escaped}`);document.close();"
                        ));
                        /* متن دقیق خطا داخل صفحه نوشته شد؛ پنجره عمداً باز
                           می‌ماند تا کاربر همان را بخواند (بستن خودکار همان
                           «غیب شدن»ی است که گزارش شد). */
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                /* graceful shutdown of the local API (no orphan node.exe) */
                /* بدون unwrap: اگر قفل مسموم شده باشد، بستن پنجره نباید پنیک کند */
                if let Some(state) = window.try_state::<ApiProcess>() {
                    if let Ok(mut slot) = state.0.lock() {
                        if let Some(mut child) = slot.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Farday Roshan");
}

/// صفحه‌ی «در حال آماده‌سازی» که بلافاصله بعد از باز شدن پنجره دیده می‌شود.
///
/// این اسکریپت در هر بار بارگذاری صفحه اجرا می‌شود، ولی فقط روی `about:blank`
/// عمل می‌کند؛ پس رابط کاربری واقعی هیچ‌وقت بازنویسی نمی‌شود.
const SPLASH_JS: &str = r#"
(function () {
  if (location.protocol !== 'about:') return;
  var html = '<html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%}' +
    "body{background:#0f1720;color:#e8eef5;font-family:Tahoma,'Segoe UI',sans-serif;" +
    'display:flex;align-items:center;justify-content:center}' +
    '.b{text-align:center}.s{width:34px;height:34px;margin:0 auto 16px;border-radius:50%;' +
    'border:3px solid #2a3a48;border-top-color:#2dd4bf;animation:r .9s linear infinite}' +
    '@keyframes r{to{transform:rotate(360deg)}}' +
    'h1{font-size:1rem;margin:0 0 6px;font-weight:600}p{color:#8fa4b6;font-size:.82rem;margin:0}' +
    '</style></head><body><div class="b"><div class="s"></div>' +
    '<h1>فردای روشن</h1><p>در حال آماده‌سازی سرویس داخلی…</p></div></body></html>';
  var paint = function () {
    try { document.open(); document.write(html); document.close(); }
    catch (e) { try { document.documentElement.innerHTML = html; } catch (e2) {} }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else { paint(); }
})();
"#;

/// A self-contained RTL error page (no external assets, no network).
///
/// باگ کامپایل (گزارش کاربر): این قالب پیش‌تر با `format!` ساخته می‌شد و وقتی
/// یک بلوک جاوااسکریپت با آکولادهای تکی به آن اضافه شد، Rust همان `{` را
/// جای‌نگهدار فرمت دید و ساخت با «invalid format string: expected `}`, found `t`»
/// شکست. حالا `format!` حذف شده و جای‌نگهدار یک توکن متنی است (`@@BODY@@`):
/// آکولادهای CSS/JS نیازی به دوبار شدن ندارند و این خطا دیگر ممکن نیست.
fn error_page(details: &str) -> String {
    let body = details
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('`', "'")
        .replace('\\', "\\\\")
        .replace('\n', "<br>");
    ERROR_PAGE.replace("@@BODY@@", &body)
}

/// قالب خام صفحه‌ی خطا — عمداً بدون `format!` (بخش `error_page` را ببینید).
const ERROR_PAGE: &str = r#"<html dir="rtl" lang="fa"><head><meta charset="utf-8">
<style>
  body{margin:0;font-family:Tahoma,'Segoe UI',sans-serif;background:#0f1720;color:#e8eef5;
        display:flex;align-items:center;justify-content:center;min-height:100vh}
  .box{max-width:760px;padding:28px 30px;background:#18242f;border:1px solid #2a3a48;border-radius:16px}
  h1{font-size:1.15rem;margin:0 0 10px}
  p{color:#a9bac9;font-size:.9rem;line-height:1.9;margin:0 0 14px}
  pre{direction:ltr;text-align:left;background:#0f1720;border:1px solid #2a3a48;border-radius:10px;
       padding:12px;font-size:.76rem;line-height:1.7;max-height:260px;overflow:auto;color:#cfe0ee}
  code{background:#1e2c39;padding:1px 5px;border-radius:5px;direction:ltr;display:inline-block}
  .hint{border-inline-start:3px solid #2dd4bf;padding-inline-start:12px;color:#cfe0ee}
  .btns{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 8px}
  .btn{font-family:inherit;font-size:.85rem;padding:9px 16px;border-radius:10px;cursor:pointer;
        border:1px solid #2dd4bf;background:#12433f;color:#d7fbf6}
  .btn:hover{background:#17554f}
  .btn.ghost{border-color:#33475a;background:#1b2833;color:#cfe0ee}
  .btn.ghost:hover{background:#22323f}
</style></head><body><div class="box">
<h1>برنامه بالا نیامد — سرویس داخلی جواب نداد</h1>
<p>پنجره باز شد ولی سرویس محلی (فروشات، معاشات و …) آماده نشد، برای همین رابط کاربری بارگذاری نشد.</p>
<p class="hint">۱) برنامه را ببندید و دوباره باز کنید؛ اگر بار دوم باز شد، فقط کند بوده است.<br>
۲) اگر تکرار شد، یکی از دکمه‌های پایین را بزنید.<br>
۳) اگر باز هم نشد، این متن را برای پشتیبانی بفرستید — علت دقیق داخل آن است.</p>
<div class="btns">
  <button class="btn" onclick="__fd('--reset-admin')">بازنشانی رمز مدیر (admin / admin123)</button>
  <button class="btn" onclick="__fd('--list-backups')">دیدن پشتیبان‌های موجود</button>
  <button class="btn ghost" onclick="__fd('')">باز کردن پوشه داده و لاگ‌ها</button>
</div>
<p class="hint">اگر دکمه‌ها کار نکردند، همین کارها را از خط فرمان بزنید (بدون انترنت):<br>
<code>%LOCALAPPDATA%\Programs\Farday Roshan\Farday Roshan.exe --cli --reset-admin</code><br>
<code>%LOCALAPPDATA%\Programs\Farday Roshan\Farday Roshan.exe --cli --list-backups</code></p>
<script>
  /* این صفحه داخل پنجره‌ی Tauri است؛ invoke به پوسته می‌رسد (بدون اینترنت) */
  function __fd(arg) {
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke('recovery', { arg: arg });
        return;
      }
      alert('از خط فرمان:  "Farday Roshan.exe" --cli ' + (arg || ''));
    } catch (e) {
      alert('از خط فرمان:  "Farday Roshan.exe" --cli ' + (arg || ''));
    }
  }
  /* پیام خطای بالای صفحه را بشود کاپی کرد (پشتیبانی تلفنی) */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.tagName === 'PRE') {
      try {
        var r = document.createRange(); r.selectNodeContents(e.target);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        document.execCommand('copy');
        e.target.style.borderColor = '#2dd4bf';
      } catch (err) {}
    }
  });
</script>
<pre>@@BODY@@</pre>
<p>فایل‌های عیب‌یابی: <code>%APPDATA%\af.farday.roshan\api.log</code> و <code>shell.log</code></p>
</div></body></html>"#;
