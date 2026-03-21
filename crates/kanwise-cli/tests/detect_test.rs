use kanwise_cli::detect::{detect_kanwise, ComponentMode, SystemContext};
use std::path::{Path, PathBuf};

struct MockSystem {
    docker_image: Option<String>,
    existing_paths: Vec<PathBuf>,
    which_result: Option<PathBuf>,
    compose_file: Option<PathBuf>,
}

impl SystemContext for MockSystem {
    fn docker_running(&self, _name: &str) -> Option<String> { self.docker_image.clone() }
    fn path_exists(&self, path: &Path) -> bool { self.existing_paths.iter().any(|p| p == path) }
    fn which(&self, _name: &str) -> Option<PathBuf> { self.which_result.clone() }
    fn find_compose_file(&self, _near: &Path) -> Option<PathBuf> { self.compose_file.clone() }
}

#[test]
fn docker_takes_priority() {
    let ctx = MockSystem {
        docker_image: Some("ghcr.io/tienedev/kanwise:latest".into()),
        existing_paths: vec![],
        which_result: None,
        compose_file: Some(PathBuf::from("/proj/docker-compose.yml")),
    };
    let result = detect_kanwise(&ctx, Path::new("/proj"));
    match result {
        ComponentMode::Docker { image, .. } => {
            assert_eq!(image, "ghcr.io/tienedev/kanwise:latest");
        }
        other => panic!("expected Docker, got {other:?}"),
    }
}

#[test]
fn local_crate_detected() {
    let ctx = MockSystem {
        docker_image: None,
        existing_paths: vec![PathBuf::from("/proj/crates/kanwise/Cargo.toml")],
        which_result: None,
        compose_file: None,
    };
    let result = detect_kanwise(&ctx, Path::new("/proj"));
    assert_eq!(result, ComponentMode::Local { repo: PathBuf::from("/proj") });
}

#[test]
fn binary_only_fallback() {
    let ctx = MockSystem {
        docker_image: None,
        existing_paths: vec![],
        which_result: Some(PathBuf::from("/usr/local/bin/kanwise")),
        compose_file: None,
    };
    let result = detect_kanwise(&ctx, Path::new("/proj"));
    assert_eq!(result, ComponentMode::BinaryOnly { path: PathBuf::from("/usr/local/bin/kanwise") });
}

#[test]
fn docker_without_compose_falls_through_to_local() {
    let ctx = MockSystem {
        docker_image: Some("ghcr.io/tienedev/kanwise:latest".into()),
        existing_paths: vec![PathBuf::from("/proj/crates/kanwise/Cargo.toml")],
        which_result: None,
        compose_file: None,
    };
    let result = detect_kanwise(&ctx, Path::new("/proj"));
    assert_eq!(result, ComponentMode::Local { repo: PathBuf::from("/proj") });
}

#[test]
fn not_found_when_nothing_matches() {
    let ctx = MockSystem {
        docker_image: None,
        existing_paths: vec![],
        which_result: None,
        compose_file: None,
    };
    let result = detect_kanwise(&ctx, Path::new("/proj"));
    assert_eq!(result, ComponentMode::NotFound);
}
