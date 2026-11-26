// NATIVE HUB · arranque de la aplicación de escritorio.
// Fase 1: solo la ventana y el plugin para abrir enlaces externos en el navegador del sistema.
// Los comandos del núcleo (catálogo, descargas, instalación) llegan a partir de la fase 2.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error al iniciar NATIVE HUB");
}
