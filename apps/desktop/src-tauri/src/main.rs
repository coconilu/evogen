//! Thin shell: spawn the evogen sidecar, parse its stdout handshake, expose
//! the API origin and token to the webview, and clean up on exit.
//!
//! Handshake contract (packages/cli `evogen serve`):
//!   EVOGEN_READY port=<port> token=<token> pid=<pid>
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct Connection {
    child: Child,
    origin: String,
    token: String,
}

struct Sidecar(Mutex<Option<Connection>>);

fn with_connection<R>(sidecar: &Sidecar, read: impl FnOnce(&Connection) -> R) -> Result<R, String> {
    let guard = sidecar
        .0
        .lock()
        .map_err(|_| "sidecar lock poisoned".to_string())?;
    let connection = guard
        .as_ref()
        .ok_or_else(|| "sidecar not running".to_string())?;
    Ok(read(connection))
}

#[tauri::command]
fn api_origin(sidecar: State<Sidecar>) -> Result<String, String> {
    with_connection(&sidecar, |connection| connection.origin.clone())
}

#[tauri::command]
fn api_token(sidecar: State<Sidecar>) -> Result<String, String> {
    with_connection(&sidecar, |connection| connection.token.clone())
}

fn main() {
    let sidecar_state = Sidecar(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![api_origin, api_token])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::Ready => {
                let app = app_handle.clone();
                std::thread::spawn(move || match spawn_sidecar(&app) {
                    Ok(connection) => {
                        let state = app.state::<Sidecar>();
                        if let Ok(mut guard) = state.0.lock() {
                            *guard = Some(connection);
                        }
                        eprintln!("evogen sidecar connected");
                    }
                    Err(error) => eprintln!("evogen sidecar failed to start: {error}"),
                });
            }
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                let state = app_handle.state::<Sidecar>();
                let mut guard = match state.0.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                if let Some(connection) = guard.take() {
                    kill_sidecar(connection.child);
                }
            }
            _ => {}
        });
}

/// Dev mode: EVOGEN_SIDECAR_CMD="node <abs path to cli dist>/index.js serve"
/// (first token is the program, the rest are arguments). Release mode: the
/// SEA-compiled `evogen-cli` binary bundled under resources/binaries.
fn sidecar_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let mut command = if let Ok(spec) = std::env::var("EVOGEN_SIDECAR_CMD") {
        let mut parts = spec.split_whitespace();
        let program = parts.next().ok_or("EVOGEN_SIDECAR_CMD is empty")?.to_string();
        let args: Vec<String> = parts.map(str::to_string).collect();
        let mut command = Command::new(program);
        command.args(args);
        command
    } else if cfg!(debug_assertions) {
        // plain `tauri dev` without an explicit sidecar: expect `evogen` on PATH
        let mut command = Command::new("evogen");
        command.arg("serve");
        command
    } else {
        let dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("resource dir unavailable: {error}"))?
            .join("binaries");
        let program = if cfg!(windows) {
            dir.join("evogen-cli.exe")
        } else {
            dir.join("evogen-cli")
        };
        let mut command = Command::new(program);
        command.arg("serve");
        command
    };

    command.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        // keep the helper console hidden (CREATE_NO_WINDOW)
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(command)
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<Connection, String> {
    let mut command = sidecar_command(app)?;
    let mut child = command
        .spawn()
        .map_err(|error| format!("spawn failed: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout unavailable".to_string())?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        if std::time::Instant::now() > deadline {
            kill_sidecar(child);
            return Err("sidecar handshake timeout".to_string());
        }
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                return Err("sidecar exited before handshake".to_string());
            }
            Ok(_) => {
                if let Some(fields) = line.trim().strip_prefix("EVOGEN_READY ") {
                    let map: HashMap<&str, &str> = fields
                        .split_whitespace()
                        .filter_map(|pair| pair.split_once('='))
                        .collect();
                    let port = map.get("port").ok_or("handshake missing port")?;
                    let token = map.get("token").ok_or("handshake missing token")?;
                    return Ok(Connection {
                        child,
                        origin: format!("http://127.0.0.1:{port}"),
                        token: (*token).to_string(),
                    });
                }
            }
            Err(error) => {
                kill_sidecar(child);
                return Err(format!("handshake read failed: {error}"));
            }
        }
    }
}

fn kill_sidecar(mut child: Child) {
    #[cfg(windows)]
    {
        let pid = child.id();
        // tree-kill: the sidecar may have spawned children of its own
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .output();
        let _ = child.kill();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}
