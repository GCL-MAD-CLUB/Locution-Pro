//! macOS menu bar. The frontend owns the menu model (labels, enabled and
//! checked state, handlers) and sends a serializable description whenever it
//! changes; selections come back as `application-menu` events carrying the
//! item id. Other platforms render the in-window menu and never call these.
use crate::error::*;

#[cfg(target_os = "macos")]
const APPLICATION_MENU_EVENT: &str = "application-menu";

#[tauri::command]
pub(crate) fn set_application_menu(
    app: tauri::AppHandle,
    menu: serde_json::Value,
) -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    {
        macos::install(&app, menu)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, menu);
        Err(unsupported())
    }
}

/// Text editing commands for a focused text field, sent through the AppKit
/// responder chain exactly like the standard Edit menu items would.
#[tauri::command]
pub(crate) fn perform_native_edit_action(
    app: tauri::AppHandle,
    action: String,
) -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    {
        macos::send_edit_action(&app, &action)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, action);
        Err(unsupported())
    }
}

#[cfg(not(target_os = "macos"))]
fn unsupported() -> AppError {
    app_error(
        ErrorCode::ApplicationMenuFailed,
        "Native application menus are only used on macOS",
    )
}

/// Forwards menu selections to the frontend. Registered once at startup.
#[cfg(target_os = "macos")]
pub(crate) fn forward_menu_events(app: &tauri::AppHandle) {
    use tauri::Emitter;
    app.on_menu_event(|app, event| {
        if let Err(error) = app.emit(APPLICATION_MENU_EVENT, event.id().as_ref()) {
            app_error(
                ErrorCode::EventEmitFailed,
                format!("Failed to forward the application menu selection: {error}"),
            );
        }
    });
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use serde::Deserialize;
    use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::{AppHandle, Wry};

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    enum Entry {
        Item {
            id: String,
            label: String,
            enabled: bool,
            accelerator: Option<String>,
        },
        Check {
            id: String,
            label: String,
            enabled: bool,
            checked: bool,
        },
        Submenu {
            label: String,
            enabled: bool,
            items: Vec<Entry>,
            role: Option<Role>,
        },
        Separator,
        Predefined {
            action: Predefined,
            label: String,
        },
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    enum Role {
        Window,
        Help,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    enum Predefined {
        Services,
        Hide,
        HideOthers,
        ShowAll,
        Minimize,
        Zoom,
        Fullscreen,
        Cut,
        BringAllToFront,
    }

    fn failed(context: &str, error: impl std::fmt::Display) -> AppError {
        app_error(
            ErrorCode::ApplicationMenuFailed,
            format!("{context}: {error}"),
        )
    }

    pub(super) fn install(app: &AppHandle, value: serde_json::Value) -> AppResult<()> {
        let entries: Vec<Entry> = serde_json::from_value(value)
            .map_err(|error| failed("Invalid application menu description", error))?;
        let menu =
            Menu::new(app).map_err(|error| failed("Failed to create the menu bar", error))?;
        for entry in &entries {
            let Entry::Submenu { .. } = entry else {
                return Err(failed(
                    "Invalid application menu description",
                    "top-level entries must be submenus",
                ));
            };
            let item = build(app, entry)?;
            menu.append(item.as_ref())
                .map_err(|error| failed("Failed to add a menu", error))?;
        }
        app.set_menu(menu)
            .map(|_| ())
            .map_err(|error| failed("Failed to install the menu bar", error))
    }

    fn build(app: &AppHandle, entry: &Entry) -> AppResult<Box<dyn IsMenuItem<Wry>>> {
        let item: Box<dyn IsMenuItem<Wry>> = match entry {
            Entry::Item {
                id,
                label,
                enabled,
                accelerator,
            } => Box::new(
                MenuItem::with_id(app, id, label, *enabled, accelerator.as_deref())
                    .map_err(|error| failed("Failed to create a menu item", error))?,
            ),
            Entry::Check {
                id,
                label,
                enabled,
                checked,
            } => Box::new(
                CheckMenuItem::with_id(app, id, label, *enabled, *checked, None::<&str>)
                    .map_err(|error| failed("Failed to create a menu item", error))?,
            ),
            Entry::Submenu {
                label,
                enabled,
                items,
                role,
            } => {
                let submenu = Submenu::new(app, label, *enabled)
                    .map_err(|error| failed("Failed to create a submenu", error))?;
                for child in items {
                    let child = build(app, child)?;
                    submenu
                        .append(child.as_ref())
                        .map_err(|error| failed("Failed to add a menu item", error))?;
                }
                match role {
                    Some(Role::Window) => submenu.set_as_windows_menu_for_nsapp(),
                    Some(Role::Help) => submenu.set_as_help_menu_for_nsapp(),
                    None => Ok(()),
                }
                .map_err(|error| failed("Failed to register a system menu", error))?;
                Box::new(submenu)
            }
            Entry::Separator => Box::new(
                PredefinedMenuItem::separator(app)
                    .map_err(|error| failed("Failed to create a separator", error))?,
            ),
            Entry::Predefined { action, label } => {
                let text = Some(label.as_str());
                Box::new(
                    match action {
                        Predefined::Services => PredefinedMenuItem::services(app, text),
                        Predefined::Hide => PredefinedMenuItem::hide(app, text),
                        Predefined::HideOthers => PredefinedMenuItem::hide_others(app, text),
                        Predefined::ShowAll => PredefinedMenuItem::show_all(app, text),
                        Predefined::Minimize => PredefinedMenuItem::minimize(app, text),
                        Predefined::Zoom => PredefinedMenuItem::maximize(app, text),
                        Predefined::Fullscreen => PredefinedMenuItem::fullscreen(app, text),
                        Predefined::Cut => PredefinedMenuItem::cut(app, text),
                        Predefined::BringAllToFront => {
                            PredefinedMenuItem::bring_all_to_front(app, text)
                        }
                    }
                    .map_err(|error| failed("Failed to create a system menu item", error))?,
                )
            }
        };
        Ok(item)
    }

    pub(super) fn send_edit_action(app: &AppHandle, action: &str) -> AppResult<()> {
        use objc2::runtime::Sel;
        use objc2::sel;
        let selector: Sel = match action {
            "undo" => sel!(undo:),
            "redo" => sel!(redo:),
            "cut" => sel!(cut:),
            "copy" => sel!(copy:),
            "paste" => sel!(paste:),
            "delete" => sel!(delete:),
            "selectAll" => sel!(selectAll:),
            other => {
                return Err(failed("Unknown native edit action", other));
            }
        };
        app.run_on_main_thread(move || {
            let Some(mtm) = objc2::MainThreadMarker::new() else {
                return;
            };
            let application = objc2_app_kit::NSApplication::sharedApplication(mtm);
            // SAFETY: a nil target dispatches the standard editing selector
            // to the first responder, as the system Edit menu does.
            unsafe {
                application.sendAction_to_from(selector, None, None);
            }
        })
        .map_err(|error| failed("Failed to dispatch the edit action", error))
    }
}
