use cortx_types::Tier;
use std::path::PathBuf;

#[test]
fn classify_safe_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("git status"), Tier::Safe);
}

#[test]
fn classify_monitored_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("cargo add serde"), Tier::Monitored);
}

#[test]
fn classify_dangerous_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("git push origin main"), Tier::Dangerous);
}

#[test]
fn classify_forbidden_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("rm -rf /"), Tier::Forbidden);
}

#[test]
fn classify_shell_operators_forbidden() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("echo hello && rm -rf /"), Tier::Forbidden);
}
