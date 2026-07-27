// Оболочка кассы. Вся логика — во фронтенде, здесь только окно и
// доступ к принтеру через системные средства.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("не удалось запустить Dastarhan POS");
}
