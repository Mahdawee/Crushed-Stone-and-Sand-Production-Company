// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_sidecar;

use std::sync::Mutex;
use tauri::Manager;

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
            // 1) data directory for the SQLite file (survives app updates)
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir")
                .to_path_buf();
            std::fs::create_dir_all(&data_dir).ok();

            // 2) start the local API (NestJS + Prisma + SQLite)
            match api_sidecar::start(&data_dir) {
                Ok(child) => {
                    *app.state::<ApiProcess>().0.lock().unwrap() = Some(child);
                    api_sidecar::wait_until_ready(60);
                }
                Err(err) => {
                    eprintln!("[farday] API sidecar could not start: {err}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // graceful shutdown of the local API
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
