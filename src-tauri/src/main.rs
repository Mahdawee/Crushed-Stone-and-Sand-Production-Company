// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_sidecar;

use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

            // 2) start the local API (NestJS + Prisma + SQLite).
            //    When the shell already runs `npm run dev`, the API is managed by
            //    npm instead and we simply reuse it.
            match api_sidecar::start(app.handle(), &data_dir) {
                Ok(child) => {
                    *app.state::<ApiProcess>().0.lock().unwrap() = Some(child);
                }
                Err(err) => {
                    eprintln!("[farday] API sidecar could not start: {err}");
                }
            }

            // 3) the window is created HERE (not in tauri.conf.json) so it always
            //    points at a URL that actually answers:
            //      • packaged → http://127.0.0.1:4317  (the bundled API serves the UI)
            //      • dev      → http://localhost:5173   (Vite, hot reload)
            let url = if cfg!(dev) {
                std::env::var("FD_DEV_URL").unwrap_or_else(|_| "http://localhost:5173".into())
            } else {
                format!("http://127.0.0.1:{}", api_sidecar::API_PORT)
            };

            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().expect("valid URL")))
                .title("فردای روشن — مدیریت شرکت تولیدی")
                .inner_size(1360.0, 860.0)
                .min_inner_size(1024.0, 680.0)
                .resizable(true)
                .center();

            // In dev the UI may still be starting; the bundled API needs a moment.
            if !cfg!(dev) {
                api_sidecar::wait_until_ready(90);
            } else {
                let _ = &mut builder; // dev: Vite is started by beforeDevCommand
            }

            builder.build()?;
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
