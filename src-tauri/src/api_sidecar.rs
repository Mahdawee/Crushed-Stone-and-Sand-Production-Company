//! Starts / supervises the bundled NestJS API.
//!
//! In a packaged build the API ships as `api/node.exe` (or `api/node` on
//! Linux/macOS) next to `api/app.js` and writes its SQLite file into the
//! per-user data directory, so every Windows user gets their own database and
//! no administrator rights are needed.
//!
//! Two important Windows-specific lessons are baked in here:
//!
//!  1. A windowless (`windows_subsystem = "windows"`) process must never spawn a
//!     child with inherited console handles — `spawn()` can fail with
//!     `The handle is invalid` (error 6) inside a GUI process. stdout/stderr are
//!     therefore always redirected to `api.log`.
//!  2. `node.exe` / `app.js` may live in a path with spaces or non-ASCII
//!     characters (e.g. `C:\Users\DELL\AppData\Local\Programs\Farday Roshan`
//!     یا `C:\Users\علی\...`). Paths are canonicalised and passed with forward
//!     slashes so quoting never matters.
//!
//! ## پورت: از یک پورت ثابت تا «هر پورت آزاد»
//!
//! باگ پیدا شده (بازرسی بسته‌بندی): اگر روی کمپیوتر مقصد برنامه‌ی دیگری پورت
//! 4317 را گرفته بود (یا کارخانه/برنامه‌ی دیگر)، برنامه با پیام «پورت در
//! اختیار برنامه دیگری است» بالا نمی‌آمد — یعنی «روی هر لپ‌تاپی کار می‌کند»
//! صادق نبود. حالا پورت با `FD_PORT=0` به نود سپرده می‌شود: نود خودش یک
//! پورت آزاد می‌گیرد و آن را با خط `FARDAY_PORT <n>` در `api.log` (و در
//! stdout که همان فایل است) اعلام می‌کند؛ پوسته همان را می‌خواند و پنجره را
//! به همان آدرس می‌برد. یک منبع حقیقت، بدون حدس.

use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// پورت ترجیحی — برای اینکه آدرس همیشه یکی باشد و کش مرورگر/WebView عوض نشود.
pub const API_PORT: u16 = 4317;

/* ------------------------------------------------------------------ */
/* logging (the window is GUI-only; without a file we would be blind)  */
/* ------------------------------------------------------------------ */

/// Appends one line to `<data_dir>/shell.log`. Never panics: logging must not
/// be able to take the app down.
pub fn log_line(data_dir: &Path, msg: &str) {
    use std::io::Write;
    let path = data_dir.join("shell.log");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{stamp}] {msg}");
    }
}

/* ------------------------------------------------------------------ */
/* port checks                                                         */
/* ------------------------------------------------------------------ */

/// آدرس محلی یک پورت — بدون `unwrap`.
///
/// `"127.0.0.1:4317".parse().unwrap()` عملاً هرگز شکست نمی‌خورد، ولی یک
/// `unwrap` در مسیر راه‌اندازی یعنی «اگر روزی شکست، برنامه بی‌صدا می‌میرد»
/// (همان چیزی که کاربر «غیب شدن» می‌بیند). اینجا نتیجه به Option تبدیل می‌شود.
fn api_addr(port: u16) -> Option<std::net::SocketAddr> {
    use std::net::SocketAddr;
    format!("127.0.0.1:{port}").parse::<SocketAddr>().ok()
}

fn port_open(port: u16) -> bool {
    match api_addr(port) {
        Some(addr) => TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok(),
        None => false,
    }
}

/// True when *our* API answers on `port` (not some other program that grabbed it).
pub fn ours_is_running(port: u16) -> bool {
    if !port_open(port) {
        return false;
    }
    /* Ask the API itself. A raw TCP connect is not proof: any program can
       listen on 4317 and then no window content would ever load. */
    let Some(addr) = api_addr(port) else { return false };
    match std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        Ok(mut stream) => {
            use std::io::{Read, Write};
            let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
            let req = format!(
                "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
            );
            if stream.write_all(req.as_bytes()).is_err() {
                return false;
            }
            let mut buf = [0u8; 256];
            let n = stream.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/") && head.contains("200") && head.to_lowercase().contains("ok")
        }
        Err(_) => false,
    }
}

/// True if *something* (maybe a different program) occupies the port.
pub fn port_busy(port: u16) -> bool {
    port_open(port) && !ours_is_running(port)
}

/* ------------------------------------------------------------------ */
/* locating the bundled files                                          */
/* ------------------------------------------------------------------ */

/// حذف پیشوند «مسیر verbatim» ویندوز: `\\?\C:\...` → `C:\...`.
///
/// **باگ بزرگی که همین‌جا کشف شد (گزارش کاربر):**
/// `app.path().resource_dir()` و `std::fs::canonicalize` روی ویندوز مسیر را
/// به شکل verbatim برمی‌گردانند: `\\?\C:\Users\DELL\...\_up_\api\app.js`.
/// اجرای `node.exe` با چنین آرگومانی **کار نمی‌کند**: خودِ Node پیش از اجرای
/// یک خط کد می‌میرد با
/// `Error: EISDIR: illegal operation on a directory, lstat 'C:'`
/// (در `resolveMainPath` → `realpathSync`؛ پیشوند `\\?\` باعث می‌شود ریشه‌ی
/// مسیر به‌صورت `C:` تجزیه شود). یعنی سرویس داخلی هیچ‌وقت بالا نمی‌آمد و
/// پوسته بعد از ۶۰ ثانیه «سرویس جواب نداد» می‌گفت.
/// راه‌حل استاندارد: پیشوند را برداریم و مسیر معمولی Win32 بدهیم.
///
/// به `\\?\UNC\server\share` هم رسیدگی می‌شود (`\\server\share`).
/// فرم `\\?\Volume{...}` دست نمی‌خورد چون شکل معمولی ندارد.
/// اگر مسیر معمولی از سقف ۲۶۰ کاراکتر بگذرد، پیشوند نگه داشته می‌شود
/// (وگرنه ویندوز فایل را پیدا نمی‌کند).
pub fn plain_path(p: &Path) -> PathBuf {
    if !cfg!(windows) {
        return p.to_path_buf();
    }
    let s = p.to_string_lossy().to_string();
    let stripped = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        if rest.is_empty() {
            return p.to_path_buf();
        }
        /* بدون format!: آکولاد تکی داخل رشته‌ی خام، الگوی همان باگ فرمت است */
        let mut unc = String::from("\\\\");
        unc.push_str(rest);
        unc
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        /* `\\?\C:\...` → `C:\...` — فقط شکل «حرف درایو» */
        let is_drive = rest.len() >= 2
            && rest.as_bytes()[0].is_ascii_alphabetic()
            && (rest.as_bytes()[1] == b':');
        if !is_drive {
            return p.to_path_buf();
        }
        rest.to_string()
    } else {
        return p.to_path_buf();
    };
    if stripped.len() > 259 || stripped.is_empty() {
        /* خیلی بلند است: بدون پیشوند ویندوز پیدا نمی‌کند، پس همان verbatim */
        return p.to_path_buf();
    }
    PathBuf::from(stripped)
}

/// Normalises a path for use in a Windows process argument.
///
/// Windows accepts forward slashes, and using them removes the need to quote
/// paths that contain spaces — one less thing that can break for the user.
fn arg_path(p: &Path) -> std::ffi::OsString {
    /* مهم: هر مسیری که به Node می‌رود اول از حالت verbatim در می‌آید،
       وگرنه Node با `EISDIR ... lstat 'C:'` می‌میرد. */
    let plain = plain_path(p);
    let s = plain.to_string_lossy().to_string();
    if cfg!(windows) {
        std::ffi::OsString::from(s.replace('\\', "/"))
    } else {
        std::ffi::OsString::from(s)
    }
}

/// Where the bundled API lives: `<resource_dir>/api/app.js` (+ `node.exe`).
///
/// The exact place differs between NSIS/MSI builds, portable copies and dev
/// runs, so every plausible location is checked and the first hit wins.
pub fn resource_dir(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        /* ⚠️ روی ویندوز این مسیر verbatim است (`\\?\C:\...`). اگر همین‌طور
           به Node برسد، با `EISDIR ... lstat 'C:'` می‌میرد — همان خطایی که
           کاربر در `api.log` دید. */
        bases.push(plain_path(&dir));
    }
    let dir = resource_dir_from(bases);
    /* مسیر نهایی هم باید معمولی باشد (canonicalize دوباره verbatim می‌کند) */
    plain_path(&dir)
}

/// مثل `resource_dir` ولی بدون نیاز به `AppHandle` — برای حالت `--cli`
/// که پنجره‌ای وجود ندارد (و حتی وقتی WebView2 خراب است باید کار کند).
pub fn resource_dir_headless() -> PathBuf {
    resource_dir_from(Vec::new())
}

/// مسیرهای «node + app.js» بدون `AppHandle` (حالت CLI).
pub fn runtime_paths_public() -> Result<(PathBuf, PathBuf), String> {
    runtime_paths_from(resource_dir_headless())
}

fn resource_dir_from(bases: Vec<PathBuf>) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();

    for dir in bases {
        candidates.push(dir.join("api")); // <resource_dir>/api   (normal)
        candidates.push(dir.clone()); // resources flattened
        candidates.push(dir.join("_up_").join("api")); // bundle.resources parent
        /*
         * NSIS (installMode=currentUser) برنامه را اینجا نصب می‌کند و منابع را
         * با ساختار `_up_` نگه می‌دارد:
         *   %LOCALAPPDATA%\Programs\Farday Roshan\_up_\api\app.js
         * مسیر منابع Tauri هم همان پوشه است، ولی حالت‌های نصب مختلف (msi،
         * نسخه‌ی قابل حمل، آپدیت) هرکدام یک پله جابه‌جا می‌شوند؛ پس همه را
         * می‌گردیم تا کاربر هرگز «app.js پیدا نشد» نبیند.
         */
        candidates.push(dir.join("_up_"));
        candidates.push(dir.join("..").join("api"));
        candidates.push(dir.join("..").join("_up_").join("api"));
    }
    if let Ok(exe) = std::env::current_exe() {
        /* `current_exe` روی ویندوز هم ممکن است verbatim باشد → معمولی شود */
        let exe = plain_path(&exe);
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("api")); // portable: exe + api/
            candidates.push(parent.to_path_buf());
            candidates.push(parent.join("resources").join("api"));
            candidates.push(parent.join("_up_").join("api"));
            candidates.push(parent.join("resources").join("_up_").join("api"));
        }
    }
    /*
     * پوشه‌ی داده‌ی کاربر — همیشه قابل نوشتن است و NSIS همیشه یک کاپی از
     * منابع را آنجا دارد. آخرین سنگر: حتی اگر نصب نیمه‌کاره باشد، برنامه
     * می‌تواند از این کاپی بالا بیاید.
     */
    if let Ok(appdata) = std::env::var("APPDATA") {
        let roaming = PathBuf::from(appdata).join("af.farday.roshan");
        candidates.push(roaming.join("api"));
        candidates.push(roaming.join("resources").join("api"));
    }
    // dev fallback: <repo>/apps/api/dist and the packaged copy <repo>/src-tauri/api
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("api"));
    if let Some(repo) = manifest.parent() {
        candidates.push(repo.join("apps/api/dist"));
    }

    for c in &candidates {
        if c.join("app.js").exists() || c.join("dist/main.js").exists() {
            let real = std::fs::canonicalize(c).unwrap_or_else(|_| c.clone());
            /* canonicalize روی ویندوز `\\?\` اضافه می‌کند؛ Node با آن کار نمی‌کند */
            return plain_path(&real);
        }
    }
    candidates.into_iter().next().unwrap_or_else(|| PathBuf::from("."))
}

const NODE_CANDIDATES: &[&str] = &[
    "node.exe",                    // packaged next to app.js (normal)
    "node/node.exe",
    "bin/node.exe",
    "resources/node.exe",
    "resources/node/node.exe",
    "_up_/node.exe",
];

fn bundled_node(dir: &Path) -> Option<PathBuf> {
    /* `dir` is the API folder; the runtime can also sit one level up, which is
       what Tauri does when `node.exe` is part of `bundle.resources`. */
    let mut roots: Vec<PathBuf> = vec![dir.to_path_buf()];
    if let Some(parent) = dir.parent() {
        roots.push(parent.to_path_buf());
        /* NSIS: `<install>\_up_\api` → node.exe در `<install>\_up_` است */
        if let Some(grand) = parent.parent() {
            roots.push(grand.to_path_buf());
        }
    }
    for root in roots {
        for rel in NODE_CANDIDATES {
            let p = root.join(rel);
            if p.is_file() {
                /* مسیر node.exe هم باید معمولی به Node/Command برسد */
                return Some(plain_path(&p));
            }
        }
    }
    None
}

/// A system-wide Node, used only when the bundled one is missing (dev machines).
fn system_node() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join(exe);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    /* common Windows install locations, in case PATH was not refreshed */
    if cfg!(windows) {
        for base in [
            "C:/Program Files/nodejs/node.exe",
            "C:/Program Files (x86)/nodejs/node.exe",
        ] {
            let p = PathBuf::from(base);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/* ------------------------------------------------------------------ */
/* port memory (between launches)                                      */
/* ------------------------------------------------------------------ */

/// فایل کوچکی که پورت آخرین اجرا را نگه می‌دارد.
///
/// چرا: اگر پورت ۴۳۱۷ اشغال بود و برنامه روی پورت تصادفی بالا آمد، اجرای
/// بعدی نمی‌دانست کجا را نگاه کند و یک **نمونه‌ی دوم** با همان دیتابیس
/// می‌ساخت (دو نویسنده روی یک فایل). حالا پورت در پوشه‌ی داده ذخیره می‌شود
/// و اجرای بعدی اول همان را بررسی می‌کند.
pub fn read_saved_port(data_dir: &Path) -> Option<u16> {
    let text = std::fs::read_to_string(data_dir.join("api-port")).ok()?;
    text.trim().parse::<u16>().ok().filter(|p| *p > 0)
}

pub fn save_port(data_dir: &Path, port: u16) {
    let _ = std::fs::write(data_dir.join("api-port"), port.to_string());
}

/* ------------------------------------------------------------------ */
/* start / stop                                                        */
/* ------------------------------------------------------------------ */

pub struct Started {
    pub child: Child,
    /// A human readable description of how the API was reached, for the log.
    pub how: String,
    /// پورتی که واقعاً استفاده می‌شود (ممکن است 4317 نباشد).
    pub port: u16,
}

/// پورت اعلام‌شده از سوی نود را از `api.log` می‌خواند.
///
/// نود با `FD_PORT=0` پورت آزاد می‌گیرد و `FARDAY_PORT <n>` را چاپ می‌کند.
/// این تابع آخرین خطِ `FARDAY_PORT` را برمی‌گرداند (چون لاگ append است و
/// اجراهای قبلی هم در همان فایل‌اند).
fn read_announced_port(log_path: &Path) -> Option<u16> {
    let text = std::fs::read_to_string(log_path).ok()?;
    let mut found: Option<u16> = None;
    for line in text.lines() {
        if let Some(rest) = line.split("FARDAY_PORT ").nth(1) {
            let digits: String = rest
                .trim()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(p) = digits.parse::<u16>() {
                if p > 0 {
                    found = Some(p);
                }
            }
        }
    }
    found
}

/// Starts the API and returns the child process (or a clear error message).
///
/// * اگر پورت ترجیحی (4317) آزاد است → همان استفاده می‌شود (آدرس ثابت).
/// * اگر برنامه‌ی دیگری آن را گرفته است → نود روی **هر پورت آزادی** بالا
///   می‌آید و پوسته آن را از لاگ می‌خواند. دیگر «پورت اشغال است» بن‌بست نیست.
pub fn start(app: &tauri::AppHandle, data_dir: &Path) -> Result<Started, String> {
    /*
     * یک نمونه‌ی زنده از برنامه‌ی قبلی: همان را استفاده می‌کنیم (نه دو نسخه).
     * روی پورت ترجیحی و پورت جایگزین هر دو بررسی می‌شود.
     */
    let mut known: Vec<u16> = vec![API_PORT, API_PORT + 1];
    if let Some(saved) = read_saved_port(data_dir) {
        known.insert(0, saved);
    }
    for candidate in known {
        if ours_is_running(candidate) {
            return Err(format!("API already running on {candidate} — reusing it"));
        }
    }
    let fixed_port_free = !port_open(API_PORT);

    let dir = plain_path(&resource_dir(app));
    let entry = if dir.join("app.js").exists() {
        dir.join("app.js")
    } else if dir.join("dist/main.js").exists() {
        dir.join("dist/main.js")
    } else {
        return Err(format!(
            "فایل app.js پیدا نشد (مسیر بررسی‌شده: {}). یک بار برنامه را دوباره نصب کنید.",
            dir.display()
        ));
    };

    let (program, how) = match bundled_node(&dir) {
        Some(p) => {
            let label = p.display().to_string();
            (p, format!("node همراه برنامه: {label}"))
        }
        None => match system_node() {
            Some(p) => {
                let label = p.display().to_string();
                (p, format!("Node نصب‌شده روی سیستم: {label}"))
            }
            None => {
                return Err(
                    "نه node.exe همراه برنامه بود و نه Node روی سیستم نصب است. \
                     برنامه را دوباره نصب کنید (نصب‌کننده باید node.exe را همراه داشته باشد)."
                        .into(),
                )
            }
        },
    };

    /* Both streams go to a file: a GUI process has no console, and inheriting
       invalid handles is what makes `spawn()` fail on Windows.
       `Stdio` را نمی‌توان کاپی کرد (`try_clone` روی Stdio وجود ندارد)، پس
       فایل لاگ دو بار باز می‌شود: یکی برای stdout و یکی برای stderr. */
    let log_path = data_dir.join("api.log");
    let open_log = || -> Result<std::fs::File, String> {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("نمی‌توان فایل لاگ را باز کرد ({}): {e}", log_path.display()))
    };
    let out = Stdio::from(open_log()?);
    let err = Stdio::from(open_log()?);

    /* پورت ۰ = «نود هر پورت آزادی را انتخاب کن»؛ در غیر این صورت پورت ثابت. */
    let requested_port = if fixed_port_free { API_PORT } else { 0 };
    let mut log_note = String::new();
    if !fixed_port_free {
        log_note = format!(
            "پورت {API_PORT} آزاد نیست (برنامه‌ی دیگری آن را گرفته) — نود روی پورت آزاد بعدی بالا می‌آید.\n"
        );
    }

    let mut cmd = Command::new(plain_path(&program));
    cmd.arg(arg_path(&entry))
        .current_dir(plain_path(&dir))
        .env("FD_DATA_DIR", data_dir)
        .env("FD_PORT", requested_port.to_string())
        .env("FD_HOST", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("NODE_OPTIONS", "--no-warnings")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);

    /*
     * کلید عمومی لایسنس از **داخل باینری** (مُهر) به سرویس داخلی داده می‌شود.
     * چرا: اگر کلید فقط فایل کنار برنامه بود، با Notepad عوض می‌شد و هر کسی
     * برای خودش لایسنس می‌ساخت. حالا عوض‌کردنش یعنی وصله‌کردن فایل اجرایی.
     */
    if let Some(pk) = crate::seal::unsealed_public_key() {
        cmd.env("FD_SEALED_PUBLIC_KEY", pk);
    }

    #[cfg(windows)]
    {
        /* CREATE_NO_WINDOW: without it Windows may flash a console window and,
           worse, the child can fail to start from a GUI parent. */
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    /* مسیرها را در لاگ بنویس: بدون این، اگر سرویس بالا نیاید هیچ‌کس نمی‌داند
       Node با چه آرگومانی اجرا شده است (همان چیزی که عیب‌یابی EISDIR را
       ساعت‌ها طولانی کرد). */
    log_line(
        data_dir,
        &format!(
            "اجرای سرویس: node={} · entry={} · cwd={} · port={}",
            plain_path(&program).display(),
            arg_path(&entry).to_string_lossy(),
            plain_path(&dir).display(),
            requested_port
        ),
    );

    let child = cmd
        .spawn()
        .map_err(|e| format!("اجرای سرویس داخلی ناموفق بود ({how}): {e}"))?;

    /* اگر Node در چند ثانیه‌ی اول بمیرد (مثل خطای مسیر ویندوزی)، به‌جای
       انتظار بی‌فایده‌ی ۶۰ ثانیه همان اول خبر بده. */
    let mut child = child;
    for _ in 0..12 {
        std::thread::sleep(Duration::from_millis(250));
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "سرویس داخلی بلافاصله بسته شد (کد {status}). دلیلش در api.log است."
            ));
        }
    }

    if !log_note.is_empty() {
        log_line(data_dir, log_note.trim_end());
    }
    /* پورت ثابت را همین‌جا ذخیره کن؛ پورت تصادفی بعد از آماده شدن (main) */
    if fixed_port_free {
        save_port(data_dir, API_PORT);
    }

    Ok(Started {
        child,
        how,
        port: if fixed_port_free { API_PORT } else { 0 },
    })
}

/// Waits (max `seconds`) until the API answers, and returns the port it used.
///
/// اگر پورت ثابت درخواست شده باشد همان بررسی می‌شود؛ اگر نود پورت آزاد
/// گرفته باشد، هر ۲۵۰ میلی‌ثانیه لاگ خوانده می‌شود تا پورت اعلام شود.
pub fn wait_until_ready(data_dir: &Path, requested_port: u16, seconds: u64) -> Option<u16> {
    let log_path = data_dir.join("api.log");
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if requested_port != 0 {
            if ours_is_running(requested_port) {
                return Some(requested_port);
            }
        } else if let Some(p) = read_announced_port(&log_path) {
            if ours_is_running(p) {
                return Some(p);
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    /* آخرین تلاش: شاید پورت اعلام شده ولی بررسی ما دیر شده باشد */
    if requested_port == 0 {
        return read_announced_port(&log_path).filter(|p| ours_is_running(*p));
    }
    None
}

/// ترجمه‌ی «خطاهای آشنا»ی Node به یک جمله‌ی فارسی که به کاربر بگوید چه کند.
///
/// صفحه‌ی خطا در نهایت متن خام `api.log` را نشان می‌دهد (که برای پشتیبانی
/// لازم است)، ولی کاربر فارسی‌زبان باید در یک نگاه بفهمد مشکل چیست.
pub fn log_hint(tail: &str) -> Option<String> {
    if tail.contains("EISDIR") && tail.contains("lstat 'C:'") {
        /*
         * مسیر ویندوزی در **رشته‌ی خام** نوشته می‌شود.
         * چرا: در رشته‌ی معمولی Rust هر `\\` یک escape است؛ `("\\?\\C:…")`
         * روی ویندوز با `error: unknown character escape: \`C`` شکست خورد.
         * رشته‌ی خام هیچ escape‌ای پردازش نمی‌کند، پس مسیر همان‌طور که هست
         * نوشته می‌شود و اشتباه دوباره ممکن نیست.
         */
        return Some(
            concat!(
                "سرویس داخلی به‌خاطر مسیر ویندوزی (",
                r"\\?\C:\",
                "…) اجرا نشد — این خطا در نسخه‌های قدیمی بود و در نسخه‌ی فعلی رفع شده است. ",
                "اگر این پیام را می‌بینید، برنامه را یک بار دیگر نصب کنید (نصب‌کننده باید نسخه‌ی تازه باشد)."
            )
            .into(),
        );
    }
    if tail.contains("Cannot find module") {
        return Some(
            "یکی از فایل‌های سرویس داخلی ناقص نصب شده است (Cannot find module). برنامه را روی همین نسخه دوباره نصب کنید؛ داده‌های شما محفوظ می‌ماند."
                .into(),
        );
    }
    if tail.contains("EADDRINUSE") {
        return Some(
            "پورت در اختیار برنامه‌ی دیگری است. برنامه را کامل ببندید (یا یک بار ویندوز را ری‌استارت کنید) و دوباره باز کنید؛ خود برنامه پورت آزاد را پیدا می‌کند."
                .into(),
        );
    }
    if tail.contains("libsql") && tail.contains("Cannot find") {
        return Some(
            "کتابخانه‌ی دیتابیس ویندوزی همراه بسته نبوده است. برنامه را با نصب‌کننده‌ی رسمی دوباره نصب کنید."
                .into(),
        );
    }
    None
}

/// Last lines of `api.log`, for showing the user something actionable.
pub fn tail_log(data_dir: &Path, lines: usize) -> String {
    let path = data_dir.join("api.log");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return format!("(فایل لاگ پیدا نشد: {})", path.display());
    };
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

/// A rough free-port scan used when 4317 is occupied by another program.
pub fn first_free_port_from(start_port: u16) -> Option<u16> {
    /* `start_port + 20` در حالت دیباگ می‌تواند سرریز کند (پنیک) — با saturating */
    let end = start_port.saturating_add(20);
    for port in start_port..end {
        let addr = format!("127.0.0.1:{port}");
        if let Ok(addrs) = addr.to_socket_addrs() {
            if let Some(a) = addrs.into_iter().next() {
                if TcpStream::connect_timeout(&a, Duration::from_millis(120)).is_err() {
                    return Some(port);
                }
            }
        }
    }
    None
}

/* ------------------------------------------------------------------ */
/* recovery (رمز فراموش‌شده / بررسی داده — بدون WebView)               */
/* ------------------------------------------------------------------ */

/// مسیرهای پیدا‌شده‌ی `node` و `app.js` برای اجرای ابزار نجات.
fn runtime_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    runtime_paths_from(resource_dir(app))
}

fn runtime_paths_from(dir: PathBuf) -> Result<(PathBuf, PathBuf), String> {
    let entry = if dir.join("app.js").exists() {
        dir.join("app.js")
    } else if dir.join("dist/main.js").exists() {
        dir.join("dist/main.js")
    } else {
        return Err(format!("فایل app.js پیدا نشد (مسیر: {})", dir.display()));
    };
    let node = bundled_node(&dir)
        .or_else(system_node)
        .ok_or_else(|| "نه node.exe همراه برنامه بود و نه Node روی سیستم نصب است.".to_string())?;
    Ok((node, entry))
}

/// اجرای حالت `--recovery` در یک پنجره‌ی کنسول **دیدار**.
///
/// لازم است پنجره دیده شود: خروجی فارسی است و کاربر باید بخواند
/// («رمز admin به admin123 برگشت»). `CREATE_NEW_CONSOLE` در حالت
/// `windows_subsystem="windows"` پنجره‌ی واقعی می‌سازد.
///
/// خروجی به `recovery.log` هم نوشته می‌شود تا اگر پنجره فوراً بسته شد،
/// بشود بعداً دید چه شد.
pub fn run_recovery(app: &tauri::AppHandle, data_dir: &Path, extra_args: &[&str]) -> Result<(), String> {
    let (node, entry) = runtime_paths(app)?;
    let log_path = data_dir.join("recovery.log");
    let open_log = || -> Result<std::fs::File, String> {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("فایل لاگ نجات باز نشد: {e}"))
    };

    let mut cmd = Command::new(plain_path(&node));
    cmd.arg(arg_path(&entry))
        .arg("--recovery")
        .args(extra_args)
        .current_dir(plain_path(entry.parent().unwrap_or(Path::new("."))))
        .env("FD_DATA_DIR", data_dir)
        .env("NODE_ENV", "production")
        .env("NODE_OPTIONS", "--no-warnings")
        .stdin(Stdio::null())
        .stdout(Stdio::from(open_log()?))
        .stderr(Stdio::from(open_log()?));
    /* حالت نجات هم باید لایسنس را ببیند (ابزار نجات بدون لایسنس کار می‌کند) */
    if let Some(pk) = crate::seal::unsealed_public_key() {
        cmd.env("FD_SEALED_PUBLIC_KEY", pk);
    }
    /*
     * اثر انگشت نسخه‌ی «صفر کردن» (`FARDAY_RESET_KEY`).
     *
     * ⚠ دیگر **هیچ ابزاری** این مقدار را برای تأیید نمی‌خواهد: ابزار صفر
     * کردن (tools/reset-ui) با تیک «برگشت‌ناپذیر» + تایپ عبارت «صفر کردن»
     * کار می‌کند (درخواست کاربر). متغیر فقط برای این می‌ماند که پشتیبانی
     * بتواند بررسی کند نسخه مُهرشده است یا نه — جدا از کلید لایسنس.
     */
    if let Some(rk) = crate::seal::unsealed_reset_key() {
        cmd.env("FARDAY_RESET_KEY", rk);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /* 0x00000010 = CREATE_NEW_CONSOLE — پنجره‌ی کنسول واقعی */
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }

    cmd.spawn()
        .map_err(|e| format!("اجرای ابزار نجات ناموفق بود: {e}"))?;
    log_line(data_dir, "ابزار نجات اجرا شد (recovery.log)");
    Ok(())
}

/// مسیرهای «کجا را نگاه کنم» برای پیام خطا — بدون گشتن در حافظه‌ی کاربر.
pub fn paths_hint(data_dir: &Path) -> String {
    format!(
        "پوشه داده: {}\napi.log: {}\nshell.log: {}",
        data_dir.display(),
        data_dir.join("api.log").display(),
        data_dir.join("shell.log").display()
    )
}
