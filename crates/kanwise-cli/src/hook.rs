/// Process a Claude Code PreToolUse hook JSON input.
/// Returns Some(json_output) if the command should be rewritten,
/// or None if it should pass through unchanged.
pub fn rewrite_hook(input: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(input).ok()?;

    let tool_name = parsed.get("tool_name")?.as_str()?;
    if tool_name != "Bash" {
        return None;
    }

    let command = parsed
        .get("tool_input")?
        .get("command")?
        .as_str()?;

    // Anti-recursion: check both cortx and legacy token-cleaner prefixes.
    // Trailing space ensures we don't match hypothetical other subcommands.
    if command.starts_with("cortx exec ") || command.starts_with("token-cleaner exec ") {
        return None;
    }

    // Shell-quote the command so metacharacters (&&, ||, ;, |, $(...))
    // are passed as a single argument to `cortx exec`, not interpreted
    // by the outer shell.
    let quoted = format!("'{}'", command.replace('\'', "'\\''"));

    let output = serde_json::json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": {
                "command": format!("cortx exec -- {quoted}")
            }
        }
    });

    Some(output.to_string())
}
