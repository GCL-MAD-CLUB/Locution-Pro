use super::*;
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/GCL-MAD-CLUB/LineCut/releases/latest";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LatestRelease {
    version: String,
    title: String,
    body: String,
    url: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
}

fn latest_release(release: GitHubRelease) -> LatestRelease {
    LatestRelease {
        version: release.tag_name,
        title: release.name.unwrap_or_default(),
        body: release.body.unwrap_or_default(),
        url: release.html_url,
    }
}

#[tauri::command]
pub(crate) async fn fetch_latest_release() -> CommandResult<LatestRelease> {
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("Locution-Pro/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| {
            app_error(
                ErrorCode::UpdateCheckFailed,
                format!("Failed to create the release client: {error}"),
            )
        })?;
    let response = client
        .get(LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| {
            app_error(
                ErrorCode::UpdateCheckFailed,
                format!("Failed to fetch the latest GitHub release: {error}"),
            )
        })?;
    let release = response.json::<GitHubRelease>().await.map_err(|error| {
        app_error(
            ErrorCode::UpdateResponseInvalid,
            format!("Failed to decode the latest GitHub release: {error}"),
        )
    })?;
    Ok(latest_release(release))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_response_keeps_only_public_metadata() {
        let release: GitHubRelease = serde_json::from_str(
            r###"{
                "tag_name": "v0.5.0",
                "name": "Locution Pro 0.5.0",
                "body": "## Improvements\n- Faster imports",
                "html_url": "https://github.com/GCL-MAD-CLUB/LineCut/releases/tag/v0.5.0",
                "assets": [{"browser_download_url": "https://example.com/ignored"}]
            }"###,
        )
        .unwrap();

        assert_eq!(
            latest_release(release),
            LatestRelease {
                version: "v0.5.0".into(),
                title: "Locution Pro 0.5.0".into(),
                body: "## Improvements\n- Faster imports".into(),
                url: "https://github.com/GCL-MAD-CLUB/LineCut/releases/tag/v0.5.0".into(),
            }
        );
    }

    #[test]
    fn release_response_allows_missing_title_and_notes() {
        let release: GitHubRelease = serde_json::from_str(
            r#"{
                "tag_name": "v0.5.0",
                "name": null,
                "body": null,
                "html_url": "https://github.com/GCL-MAD-CLUB/LineCut/releases/tag/v0.5.0"
            }"#,
        )
        .unwrap();

        let release = latest_release(release);
        assert_eq!(release.title, "");
        assert_eq!(release.body, "");
    }
}
