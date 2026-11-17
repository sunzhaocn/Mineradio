use anyhow::{Context, Result, ensure};
use include_dir::{Dir, include_dir};
use regex::{Captures, Regex};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::LazyLock;

static PLAYER: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../web/player");
static COMPONENT_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!-- component:([a-z0-9_/\-]+) -->").expect("component pattern"));

#[derive(Deserialize)]
struct Components {
    entry: String,
    components: BTreeMap<String, String>,
}

fn expand(source: &str, components: &Components, stack: &mut Vec<String>) -> Result<String> {
    let mut output = String::with_capacity(source.len());
    let mut end = 0;
    for token in COMPONENT_TOKEN.captures_iter(source) {
        let whole = token.get(0).expect("complete match");
        output.push_str(&source[end..whole.start()]);
        output.push_str(&component(&token, components, stack)?);
        end = whole.end();
    }
    output.push_str(&source[end..]);
    Ok(output)
}

fn component(
    token: &Captures<'_>,
    components: &Components,
    stack: &mut Vec<String>,
) -> Result<String> {
    let name = &token[1];
    ensure!(
        stack.len() < 8 && !stack.iter().any(|entry| entry == name),
        "Invalid HTML component nesting"
    );
    let path = components
        .components
        .get(name)
        .context("Missing HTML component")?;
    ensure!(
        path.starts_with("components/") && safe_path(path),
        "Invalid HTML component path"
    );
    let source = asset(path)
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .context("Invalid HTML component")?;
    stack.push(name.to_owned());
    let result = expand(source, components, stack);
    stack.pop();
    result
}

fn safe_path(path: &str) -> bool {
    !path.contains(['\\', ':', '\0'])
        && path.split('/').all(|part| !matches!(part, "" | "." | ".."))
}

pub fn asset(path: &str) -> Option<&'static [u8]> {
    if !safe_path(path)
        || matches!(
            path,
            "service-worker.js" | "offline-assets.js" | "js/features/shell/offline-shell.js"
        )
    {
        return None;
    }
    PLAYER.get_file(path).map(|file| file.contents())
}

pub fn player_page() -> Result<String> {
    let manifest = asset("components/manifest.json").context("Missing HTML component manifest")?;
    let components: Components = serde_json::from_slice(manifest)?;
    ensure!(components.entry == "index.html", "Invalid HTML entry");
    let source = std::str::from_utf8(asset("index.html").context("Missing player entry")?)?;
    expand(source, &components, &mut Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_player_loads_with_normal_navigation_and_script_manifest() {
        let html = player_page().unwrap();
        assert!(html.contains("id=\"desktop-titlebar\""));
        assert!(html.contains("js/index-loader.js"));
        assert!(!html.contains("<!-- component:"));
        assert!(asset("js/module-manifest.json").is_some());
        assert!(asset("service-worker.js").is_none());
        assert!(asset("../index.html").is_none());
    }
}
