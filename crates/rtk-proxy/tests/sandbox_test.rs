use rtk_proxy::policy::SandboxConfig;
use rtk_proxy::sandbox::Sandbox;
use std::path::PathBuf;

fn test_config() -> SandboxConfig {
    SandboxConfig {
        default_timeout: "5s".to_string(),
        env_passthrough: vec!["PATH".to_string(), "HOME".to_string()],
        env_redact: vec![
            "*_KEY".to_string(),
            "*_TOKEN".to_string(),
            "*_SECRET".to_string(),
        ],
    }
}

#[test]
fn test_cwd_validation_allows_project_root() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    assert!(sandbox.validate_cwd(&PathBuf::from("/tmp/project")).is_ok());
    assert!(
        sandbox
            .validate_cwd(&PathBuf::from("/tmp/project/src"))
            .is_ok()
    );
}

#[test]
fn test_cwd_validation_rejects_escape() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    assert!(sandbox.validate_cwd(&PathBuf::from("/tmp")).is_err());
    assert!(sandbox.validate_cwd(&PathBuf::from("/etc")).is_err());
    assert!(
        sandbox
            .validate_cwd(&PathBuf::from("/tmp/project/../other"))
            .is_err()
    );
}

#[test]
fn test_env_filtering() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    let env = vec![
        ("PATH".to_string(), "/usr/bin".to_string()),
        ("HOME".to_string(), "/home/user".to_string()),
        ("API_KEY".to_string(), "secret123".to_string()),
        ("GITHUB_TOKEN".to_string(), "ghp_abc".to_string()),
        ("DB_SECRET".to_string(), "pass".to_string()),
        ("RANDOM_VAR".to_string(), "value".to_string()),
    ];
    let filtered = sandbox.filter_env(&env);
    let keys: Vec<&str> = filtered.iter().map(|(k, _)| k.as_str()).collect();
    assert!(keys.contains(&"PATH"));
    assert!(keys.contains(&"HOME"));
    assert!(!keys.contains(&"API_KEY"));
    assert!(!keys.contains(&"GITHUB_TOKEN"));
    assert!(!keys.contains(&"DB_SECRET"));
    assert!(!keys.contains(&"RANDOM_VAR"));
}

#[test]
fn test_timeout_parsing() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    assert_eq!(sandbox.timeout_secs(), 5);
}
