use std::sync::Mutex;
use tauri::Manager;

struct OpenedUrls(Mutex<Vec<tauri::Url>>);

#[tauri::command]
fn startup_pdf_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(|argument| argument.to_string_lossy().into_owned())
        .find(|argument| argument.to_lowercase().ends_with(".pdf"))
}

#[tauri::command]
fn opened_urls(app: tauri::AppHandle) -> Vec<tauri::Url> {
    app.state::<OpenedUrls>().0.lock().unwrap().clone()
}

#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Default-app settings must be changed through the operating system.".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedUrls(Mutex::new(vec![])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            startup_pdf_path,
            opened_urls,
            open_default_apps_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while building SovereignPDF")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                use tauri::Emitter;
                _app.state::<OpenedUrls>()
                    .0
                    .lock()
                    .unwrap()
                    .extend(urls.clone());
                let _ = _app.emit("opened-pdf-urls", urls);
            }
        });
}
