//! OnePhylogeny desktop: files the user picks, NCBI requests, and running an allow-listed tree builder as a separate program.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

/// The only programs the interface may run.
const ALLOWED: [&str; 2] = ["iqtree3", "iqtree2"];
/// Apps opened from Finder don't inherit a shell's PATH, so look where package managers install.
const SEARCH: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

fn locate(tool: &str) -> Result<PathBuf, String> {
    if !ALLOWED.contains(&tool) {
        return Err(format!("{tool} is not an allowed tool"));
    }
    SEARCH
        .iter()
        .map(|dir| PathBuf::from(dir).join(tool))
        .find(|path| path.is_file())
        .ok_or_else(|| format!("{tool} was not found"))
}

#[derive(Serialize)]
struct ToolOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
async fn tool_version(tool: String) -> Result<Option<String>, String> {
    let Ok(path) = locate(&tool) else { return Ok(None) };
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(path).arg("--version").output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&output.stdout);
        Ok(Some(text.lines().find(|l| !l.trim().is_empty()).unwrap_or("unknown version").to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_tool(tool: String, args: Vec<String>, cwd: String) -> Result<ToolOutput, String> {
    let path = locate(&tool)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(path).args(args).current_dir(cwd).output().map_err(|e| e.to_string())?;
        Ok(ToolOutput {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![tool_version, run_tool])
        .run(tauri::generate_context!())
        .expect("error while running OnePhylogeny");
}

#[cfg(test)]
mod tests {
    use super::locate;

    #[test]
    fn refuses_tools_outside_the_allow_list() {
        assert!(locate("sh").unwrap_err().contains("not an allowed tool"));
        assert!(locate("/bin/sh").unwrap_err().contains("not an allowed tool"));
    }
}
