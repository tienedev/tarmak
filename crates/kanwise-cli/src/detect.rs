use std::path::{Path, PathBuf};

/// Result of auto-detecting a component's install mode.
#[derive(Debug, Clone, PartialEq)]
pub enum ComponentMode {
    Local { repo: PathBuf },
    Docker { image: String, compose_file: PathBuf, service: String },
    BinaryOnly { path: PathBuf },
    NotFound,
}

/// Abstraction for external system queries (testable).
pub trait SystemContext {
    fn docker_running(&self, name: &str) -> Option<String>;
    fn path_exists(&self, path: &Path) -> bool;
    fn which(&self, name: &str) -> Option<PathBuf>;
    fn find_compose_file(&self, near: &Path) -> Option<PathBuf>;
}

/// Real system context that shells out to actual commands.
pub struct RealSystem;

impl SystemContext for RealSystem {
    fn docker_running(&self, name: &str) -> Option<String> {
        std::process::Command::new("docker")
            .args(["ps", "--filter", &format!("name={name}"), "--format", "{{.Image}}"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            })
    }

    fn path_exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn which(&self, name: &str) -> Option<PathBuf> {
        crate::detect_binary(name)
    }

    fn find_compose_file(&self, near: &Path) -> Option<PathBuf> {
        let candidate = near.join("docker-compose.yml");
        if candidate.exists() { Some(candidate) } else { None }
    }
}

/// Detect the workspace root from compile-time CARGO_MANIFEST_DIR.
/// In the monorepo, CARGO_MANIFEST_DIR is `crates/kanwise-cli/`, so 2 parents up
/// gives the workspace root.
pub fn detect_workspace_root() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .and_then(|p| p.parent())
        .expect("CARGO_MANIFEST_DIR should have 2 parent levels")
        .to_path_buf()
}

/// Detect kanwise install mode using the cascade:
/// 1. Docker container running (with compose file at workspace root)? → docker mode
/// 2. Local crate in workspace? → local mode
/// 3. Binary in PATH? → binary-only mode
/// 4. Not found
pub fn detect_kanwise(ctx: &dyn SystemContext, workspace_root: &Path) -> ComponentMode {
    // 1. Docker (only if compose file exists — needed for updates)
    if let Some(image) = ctx.docker_running("kanwise") {
        let compose = ctx.find_compose_file(workspace_root);
        if let Some(compose_file) = compose {
            return ComponentMode::Docker {
                image,
                compose_file,
                service: "kanwise".into(),
            };
        }
        // Docker running but no compose file — fall through to local/binary checks
    }

    // 2. Local crate in workspace
    if ctx.path_exists(&workspace_root.join("crates/kanwise/Cargo.toml")) {
        return ComponentMode::Local { repo: workspace_root.to_path_buf() };
    }

    // 3. Binary in PATH
    if let Some(path) = ctx.which("kanwise") {
        return ComponentMode::BinaryOnly { path };
    }

    // 4. Not found
    ComponentMode::NotFound
}
