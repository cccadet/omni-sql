use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::Menu;
use tauri::{Emitter, Manager};

struct BackendChild(Mutex<Option<Child>>);
struct SidecarChild(Mutex<Option<Child>>);

const BACKEND_PORT: u16 = 41920;
const SIDECAR_PORT: u16 = 41921;
const SIDECAR_SERVICE: &str = "omni-sql-sidecar";
const SIDECAR_PROTOCOL: &str = "http-json";
const SIDECAR_STATUS_EVENT: &str = "sidecar-status";
const SIDECAR_STATUS_CHECKING: &str = "checking";
const SIDECAR_STATUS_READY: &str = "ready";
const SIDECAR_STATUS_UNAVAILABLE: &str = "unavailable";

fn ensure_port_is_free(port: u16, name: &str) -> Result<(), std::io::Error> {
    std::net::TcpListener::bind(("127.0.0.1", port)).map(|listener| drop(listener)).map_err(|err| {
        std::io::Error::new(
            err.kind(),
            format!(
                "cannot start {name}: 127.0.0.1:{port} is already in use or unavailable; refusing to reuse an unknown process ({err})"
            ),
        )
    })
}

fn http_get(port: u16, path: &str) -> Result<(u16, String), String> {
    use std::io::{Read, Write};

    let mut stream = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .map_err(|err| err.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|err| err.to_string())?;
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .map_err(|err| err.to_string())?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|err| err.to_string())?;
    let response = String::from_utf8_lossy(&response);
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "health response has no HTTP header/body separator".to_string())?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "health response has no HTTP status".to_string())?
        .parse::<u16>()
        .map_err(|err| format!("invalid health HTTP status: {err}"))?;
    Ok((status, body.to_string()))
}

fn json_string_field(body: &str, field: &str) -> Option<String> {
    let marker = format!("\"{field}\"");
    let value = body.split_once(&marker)?.1.trim_start();
    let value = value.strip_prefix(':')?.trim_start();
    let value = value.strip_prefix('"')?;
    Some(value.split('"').next()?.to_string())
}

fn backend_health_is_expected(status: u16, body: &str) -> bool {
    status == 200 && json_string_field(body, "status").as_deref() == Some("ok")
}

fn backend_health_probe_error(status: u16, body: &str) -> String {
    format!(
        "unexpected /health response: HTTP {status}, status field {:?}",
        json_string_field(body, "status")
    )
}

fn sidecar_health_is_expected(body: &str) -> bool {
    json_string_field(body, "status").as_deref() == Some("ok")
        && json_string_field(body, "service").as_deref() == Some(SIDECAR_SERVICE)
        && json_string_field(body, "protocol").as_deref() == Some(SIDECAR_PROTOCOL)
}

fn emit_sidecar_status<R: tauri::Runtime>(app: &tauri::AppHandle<R>, status: &'static str) {
    if let Err(err) = app.emit(SIDECAR_STATUS_EVENT, status) {
        log::warn!("failed to emit {SIDECAR_STATUS_EVENT} ({status}): {err}");
    }
}

// Leitura/escrita de abas salvas como `.sql`. O caminho vem sempre do diálogo
// nativo (plugin `dialog`) ou de uma sessão restaurada, nunca de input livre
// do usuário — por isso um comando de app simples (sem escopo declarado via
// plugin `fs`) é suficiente aqui.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK on some Wayland setups crashes during surface setup when the
    // DMABuf renderer is active. Keep Wayland, but opt out of that renderer
    // path unless the user already set an override.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Alguns drivers Mesa/Wayland falham ao criar o contexto EGL/ZINK
    // ("failed to choose pdev", "failed to create dri2 screen") e deixam a
    // janela em branco. Em dev, forçar rendering por software evita esse
    // problema em ambientes virtuais/headless sem afetar releases.
    #[cfg(all(target_os = "linux", debug_assertions))]
    if std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
        std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_text_file, read_text_file])
        .manage(BackendChild(Mutex::new(None)))
        .manage(SidecarChild(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // O ícone do bundle (tauri.conf.json `bundle.icon`) tem o texto
            // "Omni SQL" e é o que o Windows usa para o .exe/instalador/Explorer.
            // Em tamanhos pequenos (barra de tarefas, título da janela) o texto
            // fica ilegível, então trocamos o ícone da janela em runtime por
            // uma versão simplificada, sem texto.
            #[cfg(not(target_os = "linux"))]
            if let Some(window) = app.get_webview_window("main") {
                let window_icon = tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/icon-window.png"
                ))?;
                if let Err(err) = window.set_icon(window_icon) {
                    log::warn!("failed to set runtime window icon: {err}");
                }
            }

            // Menu padrão com operações de edição (Cut/Copy/Paste/Select All).
            // Sem isto, atalhos de clipboard como Ctrl+V podem não funcionar no
            // webview do Tauri, especialmente em diálogos de formulário.
            if let Some(window) = app.get_webview_window("main") {
                match Menu::default(app.handle()) {
                    Ok(menu) => {
                        if let Err(err) = window.set_menu(menu) {
                            log::warn!("failed to set window menu: {err}");
                        }
                    }
                    Err(err) => log::warn!("failed to create default menu: {err}"),
                }
            }

            // Spawn Node backend as a sidecar: HTTP JSON-RPC on port 41920.
            // In dev, run the TypeScript backend through tsx. Some Linux Node
            // builds expose Node 22 but are compiled without native TS support.
            let manifest_dir = env!("CARGO_MANIFEST_DIR");
            // monorepo root = apps/desktop/src-tauri/../..
            let workspace_root = std::path::Path::new(manifest_dir)
                .ancestors()
                .nth(3)
                .unwrap_or_else(|| std::path::Path::new("."));
            let backend_entry = workspace_root.join("packages/backend/src/index.ts");

            log::info!("Starting backend sidecar: {}", backend_entry.display());

            // Spawn Node backend as a sidecar: HTTP JSON-RPC on port 41920.
            // In dev, run the TypeScript backend through tsx. Some Linux Node
            // builds expose Node 22 but are compiled without native TS support.
            //
            // Never attach to a process inherited from a previous run. A port
            // probe cannot establish ownership, so an occupied fixed port is a
            // setup error instead of an invitation to reuse an unknown server.
            ensure_port_is_free(BACKEND_PORT, "Node backend")?;
            ensure_port_is_free(SIDECAR_PORT, "JVM sidecar")?;

            let child = Command::new("node")
                    .args(["--import", "tsx"])
                    .arg(&backend_entry)
                    .current_dir(workspace_root)
                    .env("OMNI_SQL_PORT", BACKEND_PORT.to_string())
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

            // Readiness remains asynchronous and checks the actual HTTP service.
            // Keep the child in managed state so window teardown can still kill it;
            // the readiness thread observes its exit through that same state.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(30);
                let mut last_probe_error = "no health probe completed".to_string();

                while Instant::now() < deadline {
                    {
                        let state: tauri::State<'_, BackendChild> = app_handle.state();
                        let mut guard = state.0.lock().unwrap();
                        if let Some(child) = guard.as_mut() {
                            match child.try_wait() {
                                Ok(Some(status)) => {
                                    log::warn!(
                                        "backend sidecar exited before becoming ready with status {status}"
                                    );
                                    return;
                                }
                                Ok(None) => {}
                                Err(err) => {
                                    log::warn!("failed to check backend sidecar status: {err}");
                                }
                            }
                        }
                    }

                    match http_get(BACKEND_PORT, "/health") {
                        Ok((status, body)) if backend_health_is_expected(status, &body) =>
                        {
                            log::info!("backend sidecar health check passed on 127.0.0.1:{BACKEND_PORT}");
                            return;
                        }
                        Ok((status, body)) => {
                            last_probe_error = backend_health_probe_error(status, &body);
                        }
                        Err(err) => {
                            last_probe_error = err;
                        }
                    }

                    std::thread::sleep(Duration::from_millis(100));
                }

                log::warn!(
                    "backend sidecar did not become ready in 30s; last /health probe error: {last_probe_error}"
                );
            });

            // Sidecar JVM (Fase 3, opcional): spawn assíncrono, nunca bloqueia o
            // boot da janela. Ele expõe /scope/resolve para as colunas de CTE;
            // falhas continuam sendo tratadas pelo backend como fallback tier1.
            //
            // Roda o jar já compilado direto (`java -jar`), NUNCA via `gradlew
            // run`: o wrapper do Gradle sobe um Daemon que sobrevive à morte
            // do processo que o lançou, então `child.kill()` no window-destroy
            // não mata o processo real que segura a porta — ele fica órfão e
            // trava a próxima subida com `BindException: Address already in
            // use`. `java -jar` é um processo comum, sem Daemon, que o kill
            // mata de verdade. Gere/atualize o jar com `./gradlew jar`.
            let sidecar_dir = workspace_root.join("services/jvm-sidecar");
            let sidecar_jar = sidecar_dir.join("build/libs/omni-sql-sidecar.jar");
            if sidecar_jar.exists() {
                let mut cmd = Command::new("java");
                cmd.arg("-jar").arg(&sidecar_jar);
                cmd.current_dir(&sidecar_dir)
                    .env("OMNI_SIDE_CAR_PORT", SIDECAR_PORT.to_string())
                    .stdin(Stdio::null())
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit());

                match cmd.spawn() {
                    Ok(child) => {
                        log::info!("Starting JVM sidecar (tier2, background boot)");
                        let sidecar_state: tauri::State<'_, SidecarChild> = app.state();
                        *sidecar_state.0.lock().unwrap() = Some(child);

                        // HTTP health validation runs asynchronously and verifies
                        // identity, not merely that some process owns the port.
                        let app_handle = app.handle().clone();
                        emit_sidecar_status(&app_handle, SIDECAR_STATUS_CHECKING);
                        std::thread::spawn(move || {
                            let deadline = Instant::now() + Duration::from_secs(30);
                            while Instant::now() < deadline {
                                if let Ok((status, body)) = http_get(SIDECAR_PORT, "/health") {
                                    if status == 200 && sidecar_health_is_expected(&body) {
                                        log::info!("JVM sidecar health check passed on 127.0.0.1:{SIDECAR_PORT}");
                                        emit_sidecar_status(&app_handle, SIDECAR_STATUS_READY);
                                    return;
                                    }
                                }
                                std::thread::sleep(Duration::from_millis(300));
                            }
                            log::warn!("JVM sidecar (tier2) failed its expected /health check in 30s — autocomplete segue em tier1");
                            emit_sidecar_status(&app_handle, SIDECAR_STATUS_UNAVAILABLE);
                        });
                    }
                    Err(e) => {
                        log::warn!(
                            "failed to spawn JVM sidecar (tier2 fica indisponível, autocomplete segue em tier1): {e}"
                        );
                    }
                }
            } else {
                log::info!(
                    "JVM sidecar jar não encontrado (rode services/jvm-sidecar/bootstrap.sh e depois ./gradlew jar) — autocomplete segue em tier1"
                );
            }

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

                let sidecar_state: tauri::State<'_, SidecarChild> = window.state();
                let mut sidecar_guard = sidecar_state.0.lock().unwrap();
                if let Some(mut child) = sidecar_guard.take() {
                    let _ = child.kill();
                    log::info!("JVM sidecar killed");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_health_requires_the_expected_identity() {
        let expected = r#"{"status":"ok","service":"omni-sql-sidecar","protocol":"http-json"}"#;
        assert!(sidecar_health_is_expected(expected));
        assert!(!sidecar_health_is_expected(
            r#"{"status":"ok","service":"other","protocol":"http-json"}"#
        ));
        assert!(!sidecar_health_is_expected(
            r#"{"status":"ok","service":"omni-sql-sidecar","protocol":"other"}"#
        ));
    }

    #[test]
    fn backend_health_probe_reports_non_ready_responses() {
        assert!(backend_health_is_expected(
            200,
            r#"{"status":"ok"}"#
        ));
        assert_eq!(
            backend_health_probe_error(503, r#"{"status":"starting"}"#),
            "unexpected /health response: HTTP 503, status field Some(\"starting\")"
        );
    }

    #[test]
    fn sidecar_status_event_contract_is_stable() {
        assert_eq!(SIDECAR_STATUS_EVENT, "sidecar-status");
        assert_eq!(
            [
                SIDECAR_STATUS_CHECKING,
                SIDECAR_STATUS_READY,
                SIDECAR_STATUS_UNAVAILABLE,
            ],
            ["checking", "ready", "unavailable"]
        );
        assert_eq!(
            serde_json::to_string(SIDECAR_STATUS_READY).unwrap(),
            r#""ready""#
        );
    }
}
