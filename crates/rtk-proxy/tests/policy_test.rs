use rtk_proxy::policy::Policy;

#[test]
fn test_parse_default_policy() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    assert_eq!(policy.mode.default, "assisted");
    assert_eq!(policy.budget.max_commands_per_session, 200);
    assert_eq!(policy.budget.max_cpu_seconds, 300);
    assert!(policy.tiers.safe.contains(&"cargo test*".to_string()));
    assert!(policy.tiers.forbidden.contains(&"rm -rf *".to_string()));
}

#[test]
fn test_tier_classification() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    assert_eq!(policy.classify("cargo test"), cortx_types::Tier::Safe);
    assert_eq!(policy.classify("cargo test -- --nocapture"), cortx_types::Tier::Safe);
    assert_eq!(policy.classify("cargo add serde"), cortx_types::Tier::Monitored);
    assert_eq!(policy.classify("git push origin main"), cortx_types::Tier::Dangerous);
    assert_eq!(policy.classify("rm -rf /"), cortx_types::Tier::Forbidden);
    assert_eq!(policy.classify("sudo rm file"), cortx_types::Tier::Forbidden);
}

#[test]
fn test_shell_operator_rejection() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    assert_eq!(policy.classify("cargo test && rm -rf /"), cortx_types::Tier::Forbidden);
    assert_eq!(policy.classify("ls | grep foo"), cortx_types::Tier::Forbidden);
    assert_eq!(policy.classify("echo `whoami`"), cortx_types::Tier::Forbidden);
}

#[test]
fn test_unknown_command_defaults_to_monitored() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    assert_eq!(policy.classify("python script.py"), cortx_types::Tier::Monitored);
}
