use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct BackendChild(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendChild(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn Node backend as a sidecar: HTTP JSON-RPC on port 41920.
            // In dev, pnpm install already ran from the repo root; we point
            // node at packages/backend/src/index.ts (type-stripping on Node 22+).
            let manifest_dir = env!("CARGO_MANIFEST_DIR");
            // monorepo root = apps/desktop/src-tauri/../..
            let workspace_root = std::path::Path::new(manifest_dir)
                .ancestors()
                .nth(3)
                .unwrap_or_else(|| std::path::Path::new("."));
            let backend_entry = workspace_root.join("packages/backend/src/index.ts");

            log::info!("Starting backend sidecar: {}", backend_entry.display());

            let child = Command::new("node")
                .arg(&backend_entry)
                .env("OMNI_SQL_PORT", "41920")
                .stdin(Stdio::null())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| {
                    log::error!("failed to spawn Node backend: {e}");
                    e
                })?;

            let state: tauri::State<'_, BackendChild> = app.state();
            *state.0.lock().unwrap() = Some(child);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: tauri::State<'_, BackendChild> = window.state();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    log::info!("backend sidecar killed");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}