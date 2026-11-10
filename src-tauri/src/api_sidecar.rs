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
//!     characters (e.g. `C:\Users\DELL\AppData\Local\Programs\Farday Roshan`).
//!     Paths are canonicalised and quoted where the platform needs it.

use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

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

fn port_open() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{API_PORT}").parse().unwrap(),
        Duration::from_millis(250),
    )
    .is_ok()
}

/// True when *our* API answers (not some other program that grabbed the port).
fn ours_is_running() -> bool {
    if !port_open() {
        return false;
    }
    /* Ask the API itself. A raw TCP connect is not proof: any program can
       listen on 4317 and then no window content would ever load. */
    match std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{API_PORT}").parse().unwrap(),
        Duration::from_millis(400),
    ) {
        Ok(mut stream) => {
            use std::io::{Read, Write};
            let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
            let req = format!(
                "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{API_PORT}\r\nConnection: close\r\n\r\n"
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
pub fn port_busy() -> bool {
    port_open() && !ours_is_running()
}

/* ------------------------------------------------------------------ */
/* locating the bundled files                                          */
/* ------------------------------------------------------------------ */

/// Normalises a path for use in a Windows process argument.
///
/// Windows accepts forward slashes, and using them removes the need to quote
/// paths that contain spaces — one less thing that can break for the user.
fn arg_path(p: &Path) -> std::ffi::OsString {
    let s = p.to_string_lossy().to_string();
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
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("api")); // <resource_dir>/api   (normal)
        candidates.push(dir.clone()); // resources flattened
        candidates.push(dir.join("_up_").join("api")); // bundle.resources parent
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("api")); // portable: exe + api/
            candidates.push(parent.to_path_buf());
            candidates.push(parent.join("resources").join("api"));
        }
    }
    // dev fallback: <repo>/apps/api/dist and the packaged copy <repo>/src-tauri/api
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("api"));
    if let Some(repo) = manifest.parent() {
        candidates.push(repo.join("apps/api/dist"));
    }

    for c in &candidates {
        if c.join("app.js").exists() || c.join("dist/main.js").exists() {
            return std::fs::canonicalize(c).unwrap_or_else(|_| c.clone());
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
    }
    for root in roots {
        for rel in NODE_CANDIDATES {
            let p = root.join(rel);
            if p.is_file() {
                return Some(p);
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
/* start / stop                                                        */
/* ------------------------------------------------------------------ */

pub struct Started {
    pub child: Child,
    /// A human readable description of how the API was reached, for the log.
    pub how: String,
}

/// Starts the API and returns the child process (or a clear error message).
pub fn start(app: &tauri::AppHandle, data_dir: &Path) -> Result<Started, String> {
    if ours_is_running() {
        return Err("API already running — reusing it".into());
    }
    if port_busy() {
        return Err(format!(
            "پورت {API_PORT} در اختیار برنامه دیگری است. آن برنامه را ببندید یا ویندوز را ری‌استارت کنید."
        ));
    }

    let dir = resource_dir(app);
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
       invalid handles is what makes `spawn()` fail on Windows. */
    let log_path = data_dir.join("api.log");
    let out = Stdio::from(
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("نمی‌توان فایل لاگ را باز کرد ({}): {e}", log_path.display()))?,
    );
    let err = out
        .try_clone()
        .map_err(|e| format!("نمی‌توان فایل لاگ را برای stderr باز کرد: {e}"))?;

    let mut cmd = Command::new(&program);
    cmd.arg(arg_path(&entry))
        .current_dir(&dir)
        .env("FD_DATA_DIR", data_dir)
        .env("FD_PORT", API_PORT.to_string())
        .env("FD_HOST", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("NODE_OPTIONS", "--no-warnings")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);

    #[cfg(windows)]
    {
        /* CREATE_NO_WINDOW: without it Windows may flash a console window and,
           worse, the child can fail to start from a GUI parent. */
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("اجرای سرویس داخلی ناموفق بود ({how}): {e}"))?;

    Ok(Started { child, how })
}

/// Waits (max `seconds`) until *our* API answers. Returns true when ready.
pub fn wait_until_ready(seconds: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if ours_is_running() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
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
    for port in start_port..start_port + 20 {
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
