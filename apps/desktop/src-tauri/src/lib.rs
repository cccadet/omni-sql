use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::Menu;
use tauri::Manager;

struct BackendChild(Mutex<Option<Child>>);
struct SidecarChild(Mutex<Option<Child>>);

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

            // Se já existe um backend respondendo nessa porta (ex.: sobrou de
            // um hot-reload do `cargo tauri dev` que matou o processo pai sem
            // dar tempo do `WindowEvent::Destroyed` rodar), reaproveita em vez
            // de tentar subir um segundo — evita o `EADDRINUSE` em cascata.
            let backend_already_running = std::net::TcpStream::connect_timeout(
                &"127.0.0.1:41920".parse().unwrap(),
                Duration::from_millis(200),
            )
            .is_ok();

            if backend_already_running {
                log::info!(
                    "backend sidecar já está escutando em 127.0.0.1:41920 — reaproveitando processo existente"
                );
            } else {
                let child = Command::new("node")
                    .args(["--import", "tsx"])
                    .arg(&backend_entry)
                    .current_dir(workspace_root)
                    .env("OMNI_SQL_PORT", "41920")
                    .stdin(Stdio::null())
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit())
                    .spawn()
                    .map_err(|e| {
                        log::error!("failed to spawn Node backend: {e}");
                        e
                    })?;

                // Wait a moment for the backend to bind to 127.0.0.1:41920.
                let deadline = Instant::now() + Duration::from_secs(5);
                while Instant::now() < deadline {
                    if std::net::TcpStream::connect_timeout(
                        &"127.0.0.1:41920".parse().unwrap(),
                        Duration::from_millis(100),
                    )
                    .is_ok()
                    {
                        log::info!("backend sidecar is listening on 127.0.0.1:41920");
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                if Instant::now() >= deadline {
                    log::warn!("backend sidecar did not become reachable in 5s");
                }

                let state: tauri::State<'_, BackendChild> = app.state();
                *state.0.lock().unwrap() = Some(child);
            }

            // Sidecar JVM (Fase 3, opcional): spawn assíncrono, nunca bloqueia o
            // boot da janela. Enquanto o parser tolerante (Calcite/ANTLR) não
            // existe, este processo só serve /health; o autocomplete continua
            // 100% tier1 (TS) até o endpoint /scope/resolve existir. Qualquer
            // falha aqui é best-effort — nunca deve derrubar o app.
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
            // Mesma lógica de reaproveitamento do backend Node: se já tem
            // algo respondendo em 41921 (sobra de um hot-reload anterior),
            // não tenta subir outro — é exatamente o que gerava o
            // `BindException: Address already in use` reportado.
            let sidecar_already_running = std::net::TcpStream::connect_timeout(
                &"127.0.0.1:41921".parse().unwrap(),
                Duration::from_millis(200),
            )
            .is_ok();

            if sidecar_already_running {
                log::info!(
                    "JVM sidecar (tier2) já está escutando em 127.0.0.1:41921 — reaproveitando processo existente"
                );
            } else if sidecar_jar.exists() {
                let mut cmd = Command::new("java");
                cmd.arg("-jar").arg(&sidecar_jar);
                cmd.current_dir(&sidecar_dir)
                    .env("OMNI_SIDE_CAR_PORT", "41921")
                    .stdin(Stdio::null())
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit());

                match cmd.spawn() {
                    Ok(child) => {
                        log::info!("Starting JVM sidecar (tier2, background boot)");
                        let sidecar_state: tauri::State<'_, SidecarChild> = app.state();
                        *sidecar_state.0.lock().unwrap() = Some(child);

                        // Checagem de /health roda numa thread separada: só serve
                        // pra log de diagnóstico, nunca atrasa o boot da janela.
                        std::thread::spawn(|| {
                            let deadline = Instant::now() + Duration::from_secs(30);
                            while Instant::now() < deadline {
                                if std::net::TcpStream::connect_timeout(
                                    &"127.0.0.1:41921".parse().unwrap(),
                                    Duration::from_millis(200),
                                )
                                .is_ok()
                                {
                                    log::info!("JVM sidecar (tier2) is listening on 127.0.0.1:41921");
                                    return;
                                }
                                std::thread::sleep(Duration::from_millis(300));
                            }
                            log::warn!(
                                "JVM sidecar (tier2) did not become reachable in 30s — autocomplete segue em tier1"
                            );
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
