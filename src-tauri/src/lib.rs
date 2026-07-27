use std::{
    collections::{HashMap, HashSet},
    fs::OpenOptions,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

#[derive(Default)]
struct OpenedPdfState {
    pending_by_window: HashMap<String, String>,
    occupied_windows: HashSet<String>,
    next_window_id: u64,
}

struct OpenedPdfs(Mutex<OpenedPdfState>);

fn pdf_path_from_argument(argument: &str, cwd: &Path) -> Option<PathBuf> {
    let path = if argument.to_ascii_lowercase().starts_with("file:") {
        tauri::Url::parse(argument).ok()?.to_file_path().ok()?
    } else {
        PathBuf::from(argument)
    };
    let path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
        .then_some(path)
}

fn allowed_pdf_paths(
    app: &tauri::AppHandle,
    arguments: impl IntoIterator<Item = String>,
    cwd: &Path,
) -> Vec<String> {
    let scope = app.fs_scope();
    arguments
        .into_iter()
        .filter_map(|argument| pdf_path_from_argument(&argument, cwd))
        .filter_map(|path| {
            let path = path.canonicalize().unwrap_or(path);
            scope
                .allow_file(&path)
                .is_ok()
                .then(|| path.to_string_lossy().into_owned())
        })
        .collect()
}

fn queue_pdf_for_window(app: &tauri::AppHandle, window_label: &str, path: String) {
    let opened_state = app.state::<OpenedPdfs>();
    let mut opened = opened_state.0.lock().unwrap();
    opened
        .pending_by_window
        .insert(window_label.to_owned(), path.clone());
    opened.occupied_windows.insert(window_label.to_owned());
    drop(opened);
    let _ = app.emit_to(window_label, "opened-pdf-paths", vec![path]);
}

fn main_window_is_available(app: &tauri::AppHandle) -> bool {
    let opened_state = app.state::<OpenedPdfs>();
    let opened = opened_state.0.lock().unwrap();
    !opened.occupied_windows.contains("main") && !opened.pending_by_window.contains_key("main")
}

fn create_pdf_window(app: &tauri::AppHandle, path: String) -> tauri::Result<()> {
    let (label, title) = {
        let opened_state = app.state::<OpenedPdfs>();
        let mut opened = opened_state.0.lock().unwrap();
        opened.next_window_id += 1;
        let label = format!("document-{}", opened.next_window_id);
        opened.pending_by_window.insert(label.clone(), path.clone());
        opened.occupied_windows.insert(label.clone());
        let title = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| format!("{name} — SovereignPDF"))
            .unwrap_or_else(|| "SovereignPDF".into());
        (label, title)
    };

    let result = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(1280.0, 820.0)
        .min_inner_size(900.0, 600.0)
        .maximized(true)
        .build();

    if result.is_err() {
        let opened_state = app.state::<OpenedPdfs>();
        let mut opened = opened_state.0.lock().unwrap();
        opened.pending_by_window.remove(&label);
        opened.occupied_windows.remove(&label);
    }
    result.map(|_| ())
}

fn open_startup_pdfs(app: &tauri::AppHandle, paths: Vec<String>) {
    let mut paths = paths.into_iter();
    if let Some(path) = paths.next() {
        queue_pdf_for_window(app, "main", path);
    }
    for path in paths {
        if let Err(error) = create_pdf_window(app, path) {
            let _ = app.emit("open-pdf-error", error.to_string());
        }
    }
}

fn open_external_pdfs(app: &tauri::AppHandle, paths: Vec<String>) {
    let mut paths = paths.into_iter();
    if main_window_is_available(app) {
        if let Some(path) = paths.next() {
            queue_pdf_for_window(app, "main", path);
        }
    }
    for path in paths {
        if let Err(error) = create_pdf_window(app, path) {
            let _ = app.emit("open-pdf-error", error.to_string());
        }
    }
}

#[tauri::command]
fn opened_pdf_paths(app: tauri::AppHandle, window_label: String) -> Vec<String> {
    app.state::<OpenedPdfs>()
        .0
        .lock()
        .unwrap()
        .pending_by_window
        .get(&window_label)
        .cloned()
        .into_iter()
        .collect()
}

#[tauri::command]
fn mark_window_document_open(app: tauri::AppHandle, window_label: String) {
    let opened_state = app.state::<OpenedPdfs>();
    let mut opened = opened_state.0.lock().unwrap();
    opened.pending_by_window.remove(&window_label);
    opened.occupied_windows.insert(window_label);
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

fn atomic_temp_path(target: &Path) -> Result<PathBuf, String> {
    if !target
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("Only PDF files can be written.".into());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "The selected PDF path has no parent folder.".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The selected PDF file name is invalid.".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    Ok(parent.join(format!(".{file_name}.{}.{}.tmp", std::process::id(), nonce)))
}

fn replace_pdf_file(temporary: &Path, target: &Path) -> Result<(), String> {
    if temporary.parent() != target.parent() {
        return Err("The temporary file must be beside the destination PDF.".into());
    }
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The destination PDF file name is invalid.".to_string())?;
    let temporary_name = temporary
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The temporary PDF file name is invalid.".to_string())?;
    if !temporary_name.starts_with(&format!(".{target_name}.")) || !temporary_name.ends_with(".tmp")
    {
        return Err("The temporary PDF path is not valid for this destination.".into());
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(temporary)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Could not flush the temporary PDF: {error}"))?;
    std::fs::rename(temporary, target)
        .map_err(|error| format!("Could not replace the destination PDF: {error}"))
}

#[tauri::command]
fn prepare_atomic_pdf_write(
    app: tauri::AppHandle,
    path: String,
    approved_path: Option<String>,
) -> Result<String, String> {
    let target = Path::new(&path);
    let scope = app.fs_scope();
    if !scope.is_allowed(target) {
        let approved = approved_path
            .as_deref()
            .map(Path::new)
            .filter(|approved| scope.is_allowed(approved) && approved.parent() == target.parent());
        if approved.is_none() {
            return Err("The selected PDF path is outside the approved file scope.".into());
        }
        scope
            .allow_file(target)
            .map_err(|error| error.to_string())?;
    }
    let temporary = atomic_temp_path(target)?;
    scope
        .allow_file(&temporary)
        .map_err(|error| error.to_string())?;
    Ok(temporary.to_string_lossy().into_owned())
}

#[tauri::command]
fn finish_atomic_pdf_write(
    app: tauri::AppHandle,
    temporary_path: String,
    path: String,
) -> Result<(), String> {
    let scope = app.fs_scope();
    if !scope.is_allowed(&temporary_path) || !scope.is_allowed(&path) {
        return Err("The PDF paths are outside the approved file scope.".into());
    }
    replace_pdf_file(Path::new(&temporary_path), Path::new(&path))
}

#[tauri::command]
fn cancel_atomic_pdf_write(app: tauri::AppHandle, temporary_path: String) -> Result<(), String> {
    if !app.fs_scope().is_allowed(&temporary_path) {
        return Err("The temporary PDF path is outside the approved file scope.".into());
    }
    match std::fs::remove_file(temporary_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let paths = allowed_pdf_paths(&app, args, Path::new(&cwd));
                open_external_pdfs(&app, paths);
            });
        }))
        .manage(OpenedPdfs(Mutex::new(OpenedPdfState::default())))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            let args = std::env::args_os()
                .skip(1)
                .map(|argument| argument.to_string_lossy().into_owned());
            let paths = allowed_pdf_paths(app.handle(), args, &cwd);
            open_startup_pdfs(app.handle(), paths);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            opened_pdf_paths,
            mark_window_document_open,
            open_default_apps_settings,
            prepare_atomic_pdf_write,
            finish_atomic_pdf_write,
            cancel_atomic_pdf_write
        ])
        .build(tauri::generate_context!())
        .expect("error while building SovereignPDF")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let app = _app.clone();
                let cwd = std::env::current_dir().unwrap_or_default();
                tauri::async_runtime::spawn(async move {
                    let paths =
                        allowed_pdf_paths(&app, urls.into_iter().map(|url| url.to_string()), &cwd);
                    open_external_pdfs(&app, paths);
                });
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{atomic_temp_path, pdf_path_from_argument, replace_pdf_file};
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn accepts_pdf_paths_case_insensitively() {
        let path = pdf_path_from_argument("Example.PDF", Path::new("documents")).unwrap();
        assert_eq!(path, Path::new("documents").join("Example.PDF"));
    }

    #[test]
    fn rejects_non_pdf_arguments() {
        assert!(pdf_path_from_argument("--verbose", Path::new("documents")).is_none());
        assert!(pdf_path_from_argument("notes.txt", Path::new("documents")).is_none());
    }

    #[test]
    fn atomically_replaces_a_pdf_without_touching_the_original_early() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder = std::env::temp_dir().join(format!("sovereignpdf-test-{nonce}"));
        fs::create_dir_all(&folder).unwrap();
        let target = folder.join("document.pdf");
        fs::write(&target, b"original").unwrap();
        let temporary = atomic_temp_path(&target).unwrap();
        fs::write(&temporary, b"replacement").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"original");
        replace_pdf_file(&temporary, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"replacement");
        assert!(!temporary.exists());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn desktop_capability_allows_the_native_close_commands() {
        let capability = include_str!("../capabilities/default.json");
        for permission in [
            "core:window:allow-close",
            "core:window:allow-destroy",
            "core:window:allow-set-title",
        ] {
            assert!(
                capability.contains(permission),
                "desktop capability is missing {permission}"
            );
        }
    }
}
