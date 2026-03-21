use std::process::Command;

#[test]
fn exec_cleans_ansi_output() {
    let output = Command::new(env!("CARGO_BIN_EXE_kanwise-cli"))
        .args(["exec", "--", "printf '\\033[31mhello\\033[0m'"])
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "hello");
}

#[test]
fn exec_forwards_exit_code() {
    let output = Command::new(env!("CARGO_BIN_EXE_kanwise-cli"))
        .args(["exec", "--", "exit 42"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(42));
}

#[test]
fn hook_rewrites_bash_via_stdin() {
    let input = serde_json::json!({
        "tool_name": "Bash",
        "tool_input": { "command": "cargo test" }
    });
    let output = Command::new(env!("CARGO_BIN_EXE_kanwise-cli"))
        .arg("hook")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(input.to_string().as_bytes())
                .unwrap();
            child.wait_with_output()
        })
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["command"],
        "kanwise-cli exec -- 'cargo test'"
    );
}

#[test]
fn hook_passthrough_non_bash() {
    let input = serde_json::json!({
        "tool_name": "Edit",
        "tool_input": {}
    });
    let output = Command::new(env!("CARGO_BIN_EXE_kanwise-cli"))
        .arg("hook")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(input.to_string().as_bytes())
                .unwrap();
            child.wait_with_output()
        })
        .unwrap();
    assert!(
        output.stdout.is_empty(),
        "non-Bash should produce no output"
    );
    assert!(output.status.success());
}

#[test]
fn update_help_works() {
    let output = Command::new(env!("CARGO_BIN_EXE_kanwise-cli"))
        .args(["update", "--help"])
        .output()
        .expect("failed to run");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Update kanwise-cli"), "should show update help");
    assert!(stdout.contains("--docker"), "should show --docker flag");
    assert!(stdout.contains("--local"), "should show --local flag");
    assert!(stdout.contains("--set-repo"), "should show --set-repo flag");
}
