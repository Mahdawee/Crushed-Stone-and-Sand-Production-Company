//! Starts / supervises the bundled NestJS API.
//!
//! In a packaged build the API ships as `api/node.exe` (or `api/node` on
//! Linux/macOS) next to `api/app.js` and writes its SQLite file into the
//! per-user data directory, so every Windows user gets their own database and
//! no administrator rights are needed.
//!
//! During development (`cargo tauri dev`) the API is normally started by
//! `npm run dev`, so this module simply detects an already-running instance.

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub const API_PORT: u16 = 4317;

fn api_already_running() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{API_PORT}").parse().unwrap(),
        Duration::from_millis(220),
    )
    .is_ok()
}

fn resource_dir() -> PathBuf {
    // The bundle copies `api/` into the resource directory.
    if let Ok(exe) = std::env::current_exe() {
        let beside = exe.parent().unwrap_or(Path::new(".")).join("api");
        if beside.exists() {
            return beside;
        }
    }
    // dev fallback: <repo>/apps/api
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("apps/api")
}

pub fn start(data_dir: &Path) -> Result<Child, String> {
    if api_already_running() {
        // already started by `npm run dev` — nothing to supervise
        return Err("API already running (development mode)".into());
    }

    let dir = resource_dir();
    // packaged build → <api>/app.js ; development → <repo>/apps/api/dist/main.js
    let entry = if dir.join("app.js").exists() {
        dir.join("app.js")
    } else if dir.join("dist/main.js").exists() {
        dir.join("dist/main.js")
    } else {
        return Err(format!(
            "API entry not found (looked in {}). Run `npm run build -w @farday/api` first.",
            dir.display()
        ));
    };

    let node = if cfg!(windows) { dir.join("node.exe") } else { dir.join("node") };
    let node = if node.exists() { node } else { dir.join("bin").join("node") };
    let program: PathBuf = if node.exists() {
        node
    } else {
        // fall back to a system Node (development machines)
        PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })
    };

    let child = Command::new(program)
        .arg(&entry)
        .current_dir(&dir)
        .env("FD_DATA_DIR", data_dir)
        .env("FD_PORT", API_PORT.to_string())
        .env("NODE_ENV", "production")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    Ok(child)
}

/// Waits (max `seconds`) until the API answers on its port.
pub fn wait_until_ready(seconds: u64) {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if api_already_running() {
            return;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}
