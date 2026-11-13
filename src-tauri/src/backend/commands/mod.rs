//! Tauri command entry points, grouped by domain.
//! Command names, signatures, and error codes match the previous single module.
mod app;
mod media;
mod media_browser;
mod project_file;
mod proxy;
mod tasks;

pub(crate) use app::*;
pub(crate) use media::*;
pub(crate) use media_browser::*;
pub(crate) use project_file::*;
pub(crate) use proxy::*;
pub(crate) use tasks::*;
