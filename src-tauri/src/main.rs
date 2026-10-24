#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct ServerState(Mutex<Option<Child>>);

fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn find_resources(resource_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        resource_dir.join("resources"),
        resource_dir.to_path_buf(),
    ];
    candidates
        .into_iter()
        .find(|path| path.join("server").join("server.mjs").is_file())
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

fn can_write_directory(path: &Path) -> bool {
    if std::fs::create_dir_all(path).is_err() {
        return false;
    }
    let probe = path.join(".page-talk-write-test");
    let writable = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(probe);
    writable
}

fn choose_data_dir(app: &tauri::App) -> Result<PathBuf, String> {
    if let Some(custom) = std::env::var_os("PAGE_TALK_DATA_DIR") {
        let path = strip_verbatim(PathBuf::from(custom));
        if can_write_directory(&path) {
            return Ok(path);
        }
        return Err(format!("PAGE_TALK_DATA_DIR 不可写：{}", path.display()));
    }

    let mut candidates = Vec::new();
    if let Ok(path) = app.path().app_data_dir() {
        candidates.push(path);
    }
    if let Ok(path) = app.path().app_local_data_dir() {
        candidates.push(path);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("PageTalkData"));
        }
    }
    candidates.push(std::env::temp_dir().join("PageTalk"));

    for path in candidates {
        if can_write_directory(&path) {
            return Ok(path);
        }
    }
    Err("找不到可写的应用数据目录".to_string())
}

fn wait_for_server(port: u16) -> bool {
    for _ in 0..120 {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
            let _ = stream.write_all(
                format!(
                    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            );
            let mut buffer = [0_u8; 64];
            if stream.read(&mut buffer).is_ok() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            eprintln!("[page-talk] resource_dir={}", resource_dir.display());
            let resources = find_resources(&resource_dir).ok_or_else(|| {
                format!(
                    "找不到应用资源目录（{}）。请重新安装 Page Talk。",
                    resource_dir.display()
                )
            })?;
            let resources = strip_verbatim(resources);
            eprintln!("[page-talk] resources={}", resources.display());
            let node = resources.join("runtime").join("node.exe");
            let server = resources.join("server").join("server.mjs");
            let web = resources.join("web");
            let pdfjs = resources.join("pdfjs");
            let data_dir = choose_data_dir(app)?;
            eprintln!(
                "[page-talk] data_dir={} user={:?}",
                data_dir.display(),
                std::env::var("USERNAME")
            );
            eprintln!("[page-talk] data_dir ready");

            let port = free_port()?;
            eprintln!("[page-talk] port={port}");
            let log_path = data_dir.join("server.log");
            let log = std::fs::File::create(&log_path)?;
            let log_err = log.try_clone()?;
            eprintln!("[page-talk] log ready");

            let mut command = Command::new(&node);
            command
                .arg(&server)
                .current_dir(&resources)
                .env("PORT", port.to_string())
                .env("HOST", "127.0.0.1")
                .env("PAGE_TALK_DIST", &web)
                .env("PAGE_TALK_PDFJS_ROOT", &pdfjs)
                .env("PDF_READER_DATA_DIR", &data_dir)
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(log_err));

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                command.creation_flags(CREATE_NO_WINDOW);
            }

            eprintln!("[page-talk] spawning node={}", node.display());
            let mut child = command.spawn()?;
            eprintln!("[page-talk] node spawned pid={}", child.id());
            if !wait_for_server(port) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("本地阅读服务启动超时。日志：{}", log_path.display()).into());
            }
            eprintln!("[page-talk] server ready");
            let url = format!("http://127.0.0.1:{port}");
            eprintln!("[page-talk] opening window {url}");
            let webview_data = data_dir.join("webview");
            std::fs::create_dir_all(&webview_data)?;
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse()?),
            )
            .title("页间 · PAGE TALK")
            .inner_size(1440.0, 940.0)
            .min_inner_size(980.0, 640.0)
            .data_directory(webview_data)
            .center()
            .build();
            if let Err(error) = window {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
            app.manage(ServerState(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Page Talk");

    app.run(|app_handle, event| {
        if matches!(
            &event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(state) = app_handle.try_state::<ServerState>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
    });
}
