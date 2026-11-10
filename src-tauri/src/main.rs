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

/// Holds the child process of the bundled NestJS API so that it is stopped
/// when the window closes (no orphan `node.exe` left running).
pub struct ApiProcess(pub Mutex<Option<std::process::Child>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ApiProcess(Mutex::new(None)))
        .setup(|app| {
            // ── 1) data directory (survives app updates, per Windows user) ──
            let data_dir = app
                .path()
                .app_data_dir()
                .map(|p| p.to_path_buf())
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
            let splash = SPLASH_JS;
            let win = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().expect("about:blank is valid")),
            )
            .title("فردای روشن — مدیریت شرکت تولیدی")
            .inner_size(1360.0, 860.0)
            .min_inner_size(1024.0, 680.0)
            .resizable(true)
            .center()
            /* runs on every page load, but paint() only acts on about:blank,
               so the real app page is never overwritten */
            .initialization_script(splash)
            .build()?;

            // ── 3) start + wait in the background, then navigate ──
            let handle = app.handle().clone();
            let data_dir_bg = data_dir.clone();
            std::thread::spawn(move || {
                /* If the initialization script did not run (some WebView2
                   builds skip it for `about:blank`), paint it again by hand.
                   This is idempotent: it only acts while the page is about:. */
                std::thread::sleep(Duration::from_millis(120));
                let _ = win.eval(SPLASH_JS);

                let mut problem: Option<String> = None;

                if dev_mode() {
                    /* Vite is started by `npm run dev`; just wait for it. */
                    api_sidecar::log_line(&data_dir_bg, "حالت توسعه — سرویس خارجی");
                } else {
                    match api_sidecar::start(&handle, &data_dir_bg) {
                        Ok(started) => {
                            api_sidecar::log_line(&data_dir_bg, &format!("API: {}", started.how));
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
                            if !reason.contains("already running") {
                                problem = Some(reason);
                            }
                        }
                    }
                }

                /* A real HTTP answer — not just an open port. */
                let ready = api_sidecar::wait_until_ready(if dev_mode() { 40 } else { 60 });
                if ready {
                    api_sidecar::log_line(&data_dir_bg, "API آماده است — بارگذاری رابط کاربری");
                } else if problem.is_none() {
                    problem = Some(format!(
                        "سرویس داخلی در ۶۰ ثانیه جواب نداد (پورت {}).",
                        api_sidecar::API_PORT
                    ));
                }

                match problem {
                    None => {
                        let target = if dev_mode() {
                            std::env::var("FD_DEV_URL")
                                .unwrap_or_else(|_| "http://localhost:5173".into())
                        } else {
                            format!("http://127.0.0.1:{}/", api_sidecar::API_PORT)
                        };
                        match target.parse() {
                            Ok(url) => {
                                if let Err(e) = win.navigate(url) {
                                    api_sidecar::log_line(
                                        &data_dir_bg,
                                        &format!("navigate: {e}"),
                                    );
                                }
                            }
                            Err(e) => api_sidecar::log_line(
                                &data_dir_bg,
                                &format!("آدرس نامعتبر {target}: {e}"),
                            ),
                        }
                    }
                    Some(mut reason) => {
                        if !ready && !reason.contains("جواب نداد") {
                            reason.push_str("\nسرویس داخلی هم جواب نداد.");
                        }
                        let details = format!(
                            "{reason}\n\n— آخرین خطوط api.log —\n{}\n\nپوشه داده: {}",
                            api_sidecar::tail_log(&data_dir_bg, 25),
                            data_dir_bg.display()
                        );
                        api_sidecar::log_line(&data_dir_bg, &format!("مشکل راه‌اندازی:\n{details}"));
                        let escaped = error_page(&details).replace('#', "%23");
                        let _ = win.eval(&format!(
                            "document.open();document.write(`{escaped}`);document.close();"
                        ));
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                /* graceful shutdown of the local API (no orphan node.exe) */
                if let Some(state) = window.try_state::<ApiProcess>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
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
fn error_page(details: &str) -> String {
    let body = details
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('`', "'")
        .replace('\\', "\\\\")
        .replace('\n', "<br>");
    format!(
        r#"<html dir="rtl" lang="fa"><head><meta charset="utf-8">
<style>
  body{{margin:0;font-family:Tahoma,'Segoe UI',sans-serif;background:#0f1720;color:#e8eef5;
        display:flex;align-items:center;justify-content:center;min-height:100vh}}
  .box{{max-width:760px;padding:28px 30px;background:#18242f;border:1px solid #2a3a48;border-radius:16px}}
  h1{{font-size:1.15rem;margin:0 0 10px}}
  p{{color:#a9bac9;font-size:.9rem;line-height:1.9;margin:0 0 14px}}
  pre{{direction:ltr;text-align:left;background:#0f1720;border:1px solid #2a3a48;border-radius:10px;
       padding:12px;font-size:.76rem;line-height:1.7;max-height:260px;overflow:auto;color:#cfe0ee}}
  code{{background:#1e2c39;padding:1px 5px;border-radius:5px;direction:ltr;display:inline-block}}
  .hint{{border-inline-start:3px solid #2dd4bf;padding-inline-start:12px;color:#cfe0ee}}
</style></head><body><div class="box">
<h1>برنامه بالا نیامد — سرویس داخلی جواب نداد</h1>
<p>پنجره باز شد ولی سرویس محلی (فروشات، معاشات و …) آماده نشد، برای همین رابط کاربری بارگذاری نشد.</p>
<p class="hint">۱) برنامه را ببندید و دوباره باز کنید؛ اگر بار دوم باز شد، فقط کند بوده است.<br>
۲) اگر تکرار شد، یک بار <code>taskkill /IM node.exe /F</code> بزنید و دوباره باز کنید.<br>
۳) اگر باز هم نشد، این متن را برای پشتیبانی بفرستید — علت دقیق داخل آن است.</p>
<pre>{body}</pre>
<p>فایل‌های عیب‌یابی: <code>%APPDATA%\af.farday.roshan\api.log</code> و <code>shell.log</code></p>
</div></body></html>"#
    )
}
