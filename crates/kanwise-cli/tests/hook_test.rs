use kanwise_cli::hook::rewrite_hook;

#[test]
fn rewrites_bash_command() {
    let input = serde_json::json!({
        "tool_name": "Bash",
        "tool_input": { "command": "cargo test" }
    });
    let result = rewrite_hook(&input.to_string()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["command"],
        "kanwise-cli exec -- 'cargo test'"
    );
}

#[test]
fn shell_metacharacters_preserved() {
    let input = serde_json::json!({
        "tool_name": "Bash",
        "tool_input": { "command": "cd /tmp && cargo test" }
    });
    let result = rewrite_hook(&input.to_string()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["command"],
        "kanwise-cli exec -- 'cd /tmp && cargo test'"
    );
}

#[test]
fn single_quotes_in_command_escaped() {
    let input = serde_json::json!({
        "tool_name": "Bash",
        "tool_input": { "command": "echo 'hello world'" }
    });
    let result = rewrite_hook(&input.to_string()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(
        parsed["hookSpecificOutput"]["updatedInput"]["command"],
        "kanwise-cli exec -- 'echo '\\''hello world'\\'''"
    );
}

#[test]
fn anti_recursion_passthrough() {
    let input = serde_json::json!({
        "tool_name": "Bash",
        "tool_input": { "command": "kanwise-cli exec -- cargo test" }
    });
    let result = rewrite_hook(&input.to_string());
    assert!(result.is_none(), "should pass through already-wrapped commands");
}

#[test]
fn anti_recursion_legacy_token_cleaner() {
    let input = serde_json::json!({
        "tool_name": "Bash",
        "tool_input": { "command": "token-cleaner exec -- cargo test" }
    });
    let result = rewrite_hook(&input.to_string());
    assert!(result.is_none(), "should pass through legacy token-cleaner wrapped commands");
}

#[test]
fn non_bash_passthrough() {
    let input = serde_json::json!({
        "tool_name": "Edit",
        "tool_input": { "file": "foo.rs" }
    });
    let result = rewrite_hook(&input.to_string());
    assert!(result.is_none(), "should pass through non-Bash tools");
}

#[test]
fn malformed_json_passthrough() {
    let result = rewrite_hook("not json at all");
    assert!(result.is_none(), "should pass through on parse error");
}

#[test]
fn missing_command_passthrough() {
    let input = serde_json::json!({
        "tool_name": "Bash",
        "tool_input": {}
    });
    let result = rewrite_hook(&input.to_string());
    assert!(result.is_none(), "should pass through when command is missing");
}
