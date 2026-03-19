use cortx::gates::GateConfig;

#[test]
fn parse_gate_config() {
    let toml_str = include_str!("../../../policies/cortx-gates.toml");
    let config = GateConfig::from_toml(toml_str).unwrap();
    assert_eq!(config.gates.tests, "cargo test --workspace");
    assert_eq!(config.gates.lint, "cargo clippy --workspace -- -D warnings");
    assert_eq!(config.gates.max_diff_lines, 500);
    assert!(config.gates.optional.contains_key("format"));
}
