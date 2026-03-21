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

/// Detect the cortx repo path from compile-time CARGO_MANIFEST_DIR.
pub fn detect_cortx_repo() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .and_then(|p| p.parent())
        .expect("CARGO_MANIFEST_DIR should have 2 parent levels")
        .to_path_buf()
}

/// Detect kanwise install mode using the cascade:
/// 1. Docker container running (with compose file)? → docker mode
/// 2. Sibling repo? → local mode
/// 3. Binary in PATH? → binary-only mode
/// 4. Not found
pub fn detect_kanwise(ctx: &dyn SystemContext, cortx_repo: &Path) -> ComponentMode {
    // 1. Docker (only if compose file exists — needed for updates)
    if let Some(image) = ctx.docker_running("kanwise") {
        let compose = cortx_repo
            .parent()
            .and_then(|parent| ctx.find_compose_file(&parent.join("kanwise")));
        if let Some(compose_file) = compose {
            return ComponentMode::Docker {
                image,
                compose_file,
                service: "kanwise".into(),
            };
        }
        // Docker running but no compose file — fall through to sibling/binary checks
    }

    // 2. Sibling repo
    if let Some(parent) = cortx_repo.parent() {
        let sibling = parent.join("kanwise");
        if ctx.path_exists(&sibling.join("Cargo.toml")) {
            return ComponentMode::Local { repo: sibling };
        }
    }

    // 3. Binary in PATH
    if let Some(path) = ctx.which("kanwise") {
        return ComponentMode::BinaryOnly { path };
    }

    // 4. Not found
    ComponentMode::NotFound
}
