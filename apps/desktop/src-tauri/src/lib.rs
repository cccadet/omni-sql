use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::Menu;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

struct BackendChild(Mutex<Option<Child>>);
struct SidecarChild(Mutex<Option<Child>>);
struct SidecarStatusState(Mutex<&'static str>);
struct AuthToken(String);

const BACKEND_PORT: u16 = 41920;
const SIDECAR_PORT: u16 = 41921;
const LOCALHOST: &str = "127.0.0.1";
const SIDECAR_SERVICE: &str = "omni-sql-sidecar";
const SIDECAR_PROTOCOL: &str = "http-json";
const SIDECAR_STATUS_EVENT: &str = "sidecar-status";
const SIDECAR_STATUS_CHECKING: &str = "checking";
const SIDECAR_STATUS_READY: &str = "ready";
const SIDECAR_STATUS_UNAVAILABLE: &str = "unavailable";

fn release_allowed_origin() -> &'static str {
    if cfg!(target_os = "windows") {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}
const CHILD_ENV_OVERRIDES: &[&str] = &[
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "CLASSPATH",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "OMNI_SQL_PORT",
    "OMNI_SQL_AUTH_TOKEN",
    "OMNI_SQL_ALLOWED_ORIGIN",
    "OMNI_SQL_DEV_KEYRING",
    "OMNI_SQL_DEV_KEYRING_FILE",
    "OMNI_SQL_SIDECAR_URL",
    "OMNI_SIDE_CAR_PORT",
];

fn ensure_port_is_free(port: u16, name: &str) -> Result<(), std::io::Error> {
    std::net::TcpListener::bind((LOCALHOST, port)).map(|listener| drop(listener)).map_err(|err| {
        std::io::Error::new(
            err.kind(),
            format!(
                "cannot start {name}: 127.0.0.1:{port} is already in use or unavailable; refusing to reuse an unknown process ({err})"
            ),
        )
    })
}

fn http_get(port: u16, path: &str, auth_token: &str) -> Result<(u16, String), String> {
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
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {auth_token}\r\nConnection: close\r\n\r\n")
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

fn generate_auth_token() -> Result<String, String> {
    // Hex keeps the value safe for both HTTP headers and child-process
    // environments without relying on an encoding crate.
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| format!("failed to generate auth token: {err}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn clear_inherited_child_overrides(command: &mut Command) {
    // Do not let the desktop environment control code loading, TLS, or the
    // JVM command line of the processes it owns.
    for variable in CHILD_ENV_OVERRIDES {
        command.env_remove(variable);
    }
}

/// Resolve a `Stdio` for a sidecar child so its stdout/stderr reach a file
/// the user can attach to a bug report. In debug builds we still inherit so
/// the dev terminal keeps showing backend/sidecar output. In release builds
/// (the Windows installer scenario) we redirect into the per-app log
/// directory so "failed to fetch" from the frontend stops being silent.
fn sidecar_log_stdio<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    file_name: &str,
) -> Stdio {
    #[cfg(debug_assertions)]
    {
        let _ = (app, file_name);
        return Stdio::inherit();
    }
    #[cfg(not(debug_assertions))]
    {
        let dir = match app.path().app_log_dir() {
            Ok(dir) => dir,
            Err(err) => {
                log::warn!("failed to resolve app log dir for sidecar logs: {err}");
                return Stdio::inherit();
            }
        };
        if let Err(err) = std::fs::create_dir_all(&dir) {
            log::warn!(
                "failed to create sidecar log dir {}: {err}",
                dir.display()
            );
            return Stdio::inherit();
        }
        let path = dir.join(file_name);
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            Ok(file) => {
                log::info!("sidecar stdio redirected to {}", path.display());
                Stdio::from(file)
            }
            Err(err) => {
                log::warn!("failed to open sidecar log {}: {err}", path.display());
                Stdio::inherit()
            }
        }
    }
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

fn sidecar_health_probe_error(status: u16, body: &str) -> String {
    format!(
        "unexpected /health response: HTTP {status}, status field {:?}, service field {:?}, protocol field {:?}",
        json_string_field(body, "status"),
        json_string_field(body, "service"),
        json_string_field(body, "protocol"),
    )
}

fn emit_sidecar_status<R: tauri::Runtime>(app: &tauri::AppHandle<R>, status: &'static str) {
    let state: tauri::State<'_, SidecarStatusState> = app.state();
    *state.0.lock().unwrap() = status;

    if let Err(err) = app.emit(SIDECAR_STATUS_EVENT, status) {
        log::warn!("failed to emit {SIDECAR_STATUS_EVENT} ({status}): {err}");
    }
}

#[tauri::command]
fn get_sidecar_status(state: tauri::State<'_, SidecarStatusState>) -> String {
    state.0.lock().unwrap().to_string()
}

#[tauri::command]
fn get_auth_token(state: tauri::State<'_, AuthToken>) -> String {
    state.0.clone()
}

fn selected_file_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    suggested_path: &str,
    save: bool,
) -> Result<PathBuf, String> {
    // The webview path is only a hint. The capability used for I/O is always
    // the path returned by the native picker, so invoke callers cannot turn
    // these commands into arbitrary filesystem primitives.
    let hint = PathBuf::from(suggested_path);
    let mut dialog = app.dialog().file().add_filter("SQL files", &["sql"]);
    if let Some(parent) = hint.parent().filter(|path| path.exists()) {
        dialog = dialog.set_directory(parent);
    }
    if let Some(name) = hint.file_name().and_then(|name| name.to_str()) {
        dialog = dialog.set_file_name(name);
    }

    let selected = if save {
        dialog.blocking_save_file()
    } else {
        dialog.blocking_pick_file()
    }
    .ok_or_else(|| "file selection cancelled".to_string())?;

    selected
        .try_into()
        .map_err(|err| format!("selected file is unavailable: {err}"))
}

#[tauri::command]
fn write_text_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let selected_path = selected_file_path(&app, &path, true)?;
    std::fs::write(selected_path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file<R: tauri::Runtime>(app: tauri::AppHandle<R>, path: String) -> Result<String, String> {
    let selected_path = selected_file_path(&app, &path, false)?;
    std::fs::read_to_string(selected_path).map_err(|e| e.to_string())
}

#[cfg(debug_assertions)]
fn workspace_root() -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf()
}

#[cfg(debug_assertions)]
fn backend_process_paths<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let root = workspace_root();
    Ok((
        PathBuf::from("node"),
        root.join("packages/backend/src/index.ts"),
        root,
    ))
}

#[cfg(not(debug_assertions))]
fn backend_process_paths<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let node = if cfg!(target_os = "windows") {
        "resources/runtime/node/node.exe"
    } else {
        "resources/runtime/node/node"
    };
    Ok((
        app.path()
            .resolve(node, tauri::path::BaseDirectory::Resource)
            .map_err(|err| format!("failed to resolve bundled Node runtime: {err}"))?,
        app.path()
            .resolve(
                "resources/backend/index.mjs",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|err| format!("failed to resolve bundled backend: {err}"))?,
        app.path()
            .resolve("resources/backend", tauri::path::BaseDirectory::Resource)
            .map_err(|err| format!("failed to resolve bundled backend directory: {err}"))?,
    ))
}

#[cfg(debug_assertions)]
fn sidecar_process_paths<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
) -> Result<(PathBuf, PathBuf), String> {
    let dir = workspace_root().join("services/jvm-sidecar");
    Ok((dir.join("build/libs/omni-sql-sidecar.jar"), dir))
}

#[cfg(not(debug_assertions))]
fn sidecar_process_paths<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(PathBuf, PathBuf), String> {
    Ok((
        app.path()
            .resolve(
                "resources/sidecar/omni-sql-sidecar.jar",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|err| format!("failed to resolve bundled JVM sidecar: {err}"))?,
        app.path()
            .resolve("resources/sidecar", tauri::path::BaseDirectory::Resource)
            .map_err(|err| format!("failed to resolve bundled sidecar directory: {err}"))?,
    ))
}

#[cfg(debug_assertions)]
fn java_executable<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(PathBuf::from("java"))
}

#[cfg(all(not(debug_assertions), target_os = "windows"))]
fn java_executable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            "resources/runtime/jre/bin/java.exe",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|err| format!("failed to resolve bundled Java runtime: {err}"))
}

#[cfg(all(not(debug_assertions), target_os = "macos"))]
fn java_executable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            "resources/runtime/jre/bin/java",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|err| format!("failed to resolve bundled Java runtime: {err}"))
}

#[cfg(all(
    not(debug_assertions),
    not(any(target_os = "windows", target_os = "macos"))
))]
fn java_executable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            "resources/runtime/jre/bin/java",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|err| format!("failed to resolve bundled Java runtime: {err}"))
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

    let auth_token = generate_auth_token().expect("failed to create per-run auth token");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            write_text_file,
            read_text_file,
            get_sidecar_status,
            get_auth_token
        ])
        .manage(AuthToken(auth_token.clone()))
        .manage(BackendChild(Mutex::new(None)))
        .manage(SidecarChild(Mutex::new(None)))
        .manage(SidecarStatusState(Mutex::new(SIDECAR_STATUS_CHECKING)))
        .setup(move |app| {
            // The log plugin is registered in both debug and release so that
            // release/installer builds still leave a `omni-sql.log` on disk
            // when something goes wrong. In dev the default stdout target is
            // still active; in release we also add a rolling file target in
            // the per-app log directory.
            let log_plugin = {
                #[cfg(not(debug_assertions))]
                {
                    tauri_plugin_log::Builder::new()
                        .level(log::LevelFilter::Info)
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::LogDir {
                                file_name: Some("omni-sql".to_string()),
                            },
                        ))
                        .build()
                }
                #[cfg(debug_assertions)]
                {
                    tauri_plugin_log::Builder::new()
                        .level(log::LevelFilter::Info)
                        .build()
                }
            };
            app.handle().plugin(log_plugin)?;

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
            // Spawn Node backend as a sidecar: HTTP JSON-RPC on port 41920.
            // In dev, run the TypeScript backend through tsx. Some Linux Node
            // builds expose Node 22 but are compiled without native TS support.
            //
            // Never attach to a process inherited from a previous run. A port
            // probe cannot establish ownership, so an occupied fixed port is a
            // setup error instead of an invitation to reuse an unknown server.
            ensure_port_is_free(BACKEND_PORT, "Node backend")?;
            ensure_port_is_free(SIDECAR_PORT, "JVM sidecar")?;

            let (node_executable, backend_entry, backend_cwd) =
                backend_process_paths(app.handle())?;
            log::info!("Starting backend sidecar: {}", backend_entry.display());

            let mut backend_command = Command::new(&node_executable);
            clear_inherited_child_overrides(&mut backend_command);
            #[cfg(debug_assertions)]
            backend_command.args(["--import", "tsx"]);
            let child = backend_command
                    .arg(&backend_entry)
                    .current_dir(&backend_cwd)
                    .env("OMNI_SQL_PORT", BACKEND_PORT.to_string())
                    .env("OMNI_SQL_AUTH_TOKEN", &auth_token)
                    .env(
                        "OMNI_SQL_ALLOWED_ORIGIN",
                        if cfg!(debug_assertions) { "http://localhost:1420" } else { release_allowed_origin() },
                    )
                    .stdin(Stdio::null())
                    .stdout(sidecar_log_stdio(app.handle(), "backend.log"))
                    .stderr(sidecar_log_stdio(app.handle(), "backend.log"))
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
            let backend_auth_token = auth_token.clone();
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

                    match http_get(BACKEND_PORT, "/health", &backend_auth_token) {
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
            let (sidecar_jar, sidecar_dir) = sidecar_process_paths(app.handle())?;
            if sidecar_jar.exists() {
                let mut cmd = Command::new(java_executable(app.handle())?);
                clear_inherited_child_overrides(&mut cmd);
                cmd.arg("-jar").arg(&sidecar_jar);
                cmd.current_dir(&sidecar_dir)
                    .env("OMNI_SIDE_CAR_PORT", SIDECAR_PORT.to_string())
                    .env("OMNI_SQL_AUTH_TOKEN", &auth_token)
                    .stdin(Stdio::null())
                    .stdout(sidecar_log_stdio(app.handle(), "sidecar.log"))
                    .stderr(sidecar_log_stdio(app.handle(), "sidecar.log"));

                match cmd.spawn() {
                    Ok(child) => {
                        log::info!("Starting JVM sidecar (tier2, background boot)");
                        let sidecar_state: tauri::State<'_, SidecarChild> = app.state();
                        *sidecar_state.0.lock().unwrap() = Some(child);

                        // HTTP health validation runs asynchronously and verifies
                        // identity, not merely that some process owns the port.
                        let app_handle = app.handle().clone();
                        let sidecar_auth_token = auth_token.clone();
                        emit_sidecar_status(&app_handle, SIDECAR_STATUS_CHECKING);
                        std::thread::spawn(move || {
                            let deadline = Instant::now() + Duration::from_secs(30);
                            let mut last_probe_error = "no health probe completed".to_string();

                            while Instant::now() < deadline {
                                {
                                    let state: tauri::State<'_, SidecarChild> = app_handle.state();
                                    let mut guard = state.0.lock().unwrap();
                                    if let Some(child) = guard.as_mut() {
                                        match child.try_wait() {
                                            Ok(Some(status)) => {
                                                log::warn!(
                                                    "JVM sidecar exited before becoming ready with status {status}; last /health probe error: {last_probe_error}"
                                                );
                                                emit_sidecar_status(
                                                    &app_handle,
                                                    SIDECAR_STATUS_UNAVAILABLE,
                                                );
                                                return;
                                            }
                                            Ok(None) => {}
                                            Err(err) => {
                                                log::warn!(
                                                    "failed to check JVM sidecar status: {err}"
                                                );
                                            }
                                        }
                                    }
                                }

                                match http_get(SIDECAR_PORT, "/health", &sidecar_auth_token) {
                                    Ok((status, body))
                                        if status == 200 && sidecar_health_is_expected(&body) =>
                                    {
                                        log::info!("JVM sidecar health check passed on 127.0.0.1:{SIDECAR_PORT}");
                                        emit_sidecar_status(&app_handle, SIDECAR_STATUS_READY);
                                        return;
                                    }
                                    Ok((status, body)) => {
                                        last_probe_error = sidecar_health_probe_error(status, &body);
                                    }
                                    Err(err) => {
                                        last_probe_error = err;
                                    }
                                }

                                std::thread::sleep(Duration::from_millis(300));
                            }
                            log::warn!("JVM sidecar (tier2) failed its expected /health check in 30s; last /health probe error: {last_probe_error} — autocomplete segue em tier1");
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
        assert!(backend_health_is_expected(200, r#"{"status":"ok"}"#));
        assert_eq!(
            backend_health_probe_error(503, r#"{"status":"starting"}"#),
            "unexpected /health response: HTTP 503, status field Some(\"starting\")"
        );
    }

    #[test]
    fn sidecar_health_probe_reports_http_status_and_identity() {
        assert_eq!(
            sidecar_health_probe_error(
                503,
                r#"{"status":"starting","service":"other","protocol":"other"}"#
            ),
            "unexpected /health response: HTTP 503, status field Some(\"starting\"), service field Some(\"other\"), protocol field Some(\"other\")"
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

    #[test]
    fn sidecar_status_state_starts_checking_and_is_thread_safe() {
        let state = SidecarStatusState(Mutex::new(SIDECAR_STATUS_CHECKING));
        assert_eq!(*state.0.lock().unwrap(), "checking");

        *state.0.lock().unwrap() = SIDECAR_STATUS_READY;
        assert_eq!(*state.0.lock().unwrap(), "ready");
    }

    #[test]
    fn auth_tokens_are_random_256_bit_hex_values() {
        let first = generate_auth_token().unwrap();
        let second = generate_auth_token().unwrap();

        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn sidecar_endpoints_are_loopback_only() {
        assert_eq!(LOCALHOST, "127.0.0.1");
        assert_eq!(BACKEND_PORT, 41920);
        assert_eq!(SIDECAR_PORT, 41921);
    }

    #[test]
    fn release_origin_matches_the_tauri_webview_platform() {
        assert_eq!(
            release_allowed_origin(),
            if cfg!(target_os = "windows") {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
        );
        assert_ne!(release_allowed_origin(), "*");
    }

    #[test]
    fn child_environment_cannot_override_runtime_security_settings() {
        for variable in [
            "NODE_OPTIONS",
            "JAVA_TOOL_OPTIONS",
            "LD_PRELOAD",
            "OMNI_SQL_PORT",
            "OMNI_SQL_AUTH_TOKEN",
            "OMNI_SQL_ALLOWED_ORIGIN",
            "OMNI_SIDE_CAR_PORT",
        ] {
            assert!(CHILD_ENV_OVERRIDES.contains(&variable));
        }
    }

    #[test]
    fn production_csp_allows_only_the_required_origins() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().unwrap();

        assert_eq!(
            csp,
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; child-src 'self' blob:; connect-src ipc: http://ipc.localhost http://127.0.0.1:41920 http://localhost:41920"
        );

        let connect_src = csp
            .split(';')
            .find_map(|directive| directive.trim().strip_prefix("connect-src "))
            .unwrap();
        assert_eq!(
            connect_src,
            "ipc: http://ipc.localhost http://127.0.0.1:41920 http://localhost:41920"
        );
        assert!(!connect_src.contains("https:") && !connect_src.contains("ws:"));
    }
}
