use crate::backend::default_cache_root;
use crate::{DEFAULT_FFMPEG_PROGRAM, DEFAULT_FFPROBE_PROGRAM};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Appearance {
    #[default]
    Darkest,
    Dark,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Preferences {
    #[serde(default)]
    pub(crate) appearance: Appearance,
    #[serde(default = "default_enabled")]
    pub(crate) show_home_on_startup: bool,
    #[serde(default = "default_enabled")]
    pub(crate) auto_save_enabled: bool,
    #[serde(default = "default_enabled")]
    pub(crate) auto_save_current_project: bool,
    #[serde(default)]
    pub(crate) auto_save_dir: String,
    pub(crate) cache_dir: String,
    pub(crate) ffmpeg_path: String,
    pub(crate) ffprobe_path: String,
    #[serde(default = "default_auto_save_interval_minutes")]
    pub(crate) auto_save_interval_minutes: u32,
    #[serde(default = "default_auto_save_max_snapshots")]
    pub(crate) auto_save_max_snapshots: u32,
}

const fn default_enabled() -> bool {
    true
}

const fn default_auto_save_interval_minutes() -> u32 {
    5
}

const fn default_auto_save_max_snapshots() -> u32 {
    20
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            appearance: Appearance::default(),
            show_home_on_startup: true,
            auto_save_enabled: true,
            auto_save_current_project: true,
            auto_save_dir: default_cache_root()
                .join("Locution Pro Auto-Save")
                .to_string_lossy()
                .into_owned(),
            cache_dir: default_cache_root().to_string_lossy().into_owned(),
            ffmpeg_path: DEFAULT_FFMPEG_PROGRAM.to_string(),
            ffprobe_path: DEFAULT_FFPROBE_PROGRAM.to_string(),
            auto_save_interval_minutes: default_auto_save_interval_minutes(),
            auto_save_max_snapshots: default_auto_save_max_snapshots(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_defaults_for_older_preferences_and_round_trips_each_mode() {
        let legacy = r#"{"cache_dir":"cache","ffmpeg_path":"ffmpeg","ffprobe_path":"ffprobe"}"#;
        let preferences: Preferences = serde_json::from_str(legacy).unwrap();
        assert_eq!(preferences.appearance, Appearance::Darkest);
        assert_eq!(Preferences::default().appearance, Appearance::Darkest);
        for (appearance, name) in [
            (Appearance::Darkest, "darkest"),
            (Appearance::Dark, "dark"),
            (Appearance::Light, "light"),
        ] {
            let preferences = Preferences {
                appearance,
                ..Preferences::default()
            };
            let value = serde_json::to_value(&preferences).unwrap();
            assert_eq!(value["appearance"], name);
            let restored: Preferences = serde_json::from_value(value).unwrap();
            assert_eq!(restored.appearance, appearance);
        }
    }

    #[test]
    fn unknown_appearance_is_rejected() {
        let mut value = serde_json::to_value(Preferences::default()).unwrap();
        value["appearance"] = serde_json::json!("unknown");
        assert!(serde_json::from_value::<Preferences>(value).is_err());
    }
}
