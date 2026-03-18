use rtk_proxy::output::OutputProcessor;
use rtk_proxy::policy::OutputConfig;

fn test_config() -> OutputConfig {
    OutputConfig {
        max_lines: 10,
        keep_head: 3,
        keep_tail: 3,
        redact_patterns: vec![
            r"(?i)(api[_-]?key|token|secret|password)\s*[=:]\s*\S+".to_string(),
            r"sk-[a-zA-Z0-9]{20,}".to_string(),
            r"ghp_[a-zA-Z0-9]{36}".to_string(),
        ],
    }
}

#[test]
fn test_truncation() {
    let processor = OutputProcessor::new(&test_config());
    let lines: Vec<String> = (1..=20).map(|i| format!("line {i}")).collect();
    let input = lines.join("\n");
    let (output, truncated) = processor.truncate(&input);
    assert!(truncated);
    assert!(output.contains("line 1"));
    assert!(output.contains("line 2"));
    assert!(output.contains("line 3"));
    assert!(output.contains("line 20"));
    assert!(output.contains("line 19"));
    assert!(output.contains("line 18"));
    assert!(!output.contains("line 10"));
}

#[test]
fn test_no_truncation_for_short_output() {
    let processor = OutputProcessor::new(&test_config());
    let input = "line 1\nline 2\nline 3";
    let (output, truncated) = processor.truncate(input);
    assert!(!truncated);
    assert_eq!(output, input);
}

#[test]
fn test_secret_redaction() {
    let processor = OutputProcessor::new(&test_config());
    let input = "API_KEY = sk-abcdefghijklmnopqrstuvwxyz123456\nNormal line\npassword: mysecret123";
    let redacted = processor.redact(input);
    assert!(!redacted.contains("sk-abcdefghijklmnopqrstuvwxyz123456"));
    assert!(redacted.contains("[REDACTED]"));
    assert!(redacted.contains("Normal line"));
    assert!(!redacted.contains("mysecret123"));
}

#[test]
fn test_cargo_test_error_parsing() {
    let output = r#"
running 3 tests
test auth::test_login ... FAILED
test auth::test_signup ... ok
test db::test_query ... FAILED

failures:

---- auth::test_login stdout ----
thread 'auth::test_login' panicked at src/auth.rs:42:5:
assertion failed: token.is_valid()

---- db::test_query stdout ----
thread 'db::test_query' panicked at src/db/repo.rs:187:10:
called `Result::unwrap()` on an `Err` value

test result: FAILED. 1 passed; 2 failed; 0 ignored
"#;
    let parsed = rtk_proxy::output::parse_cargo_test(output);
    assert_eq!(parsed.errors.len(), 2);
    assert_eq!(parsed.errors[0].file, "src/auth.rs");
    assert_eq!(parsed.errors[0].line, Some(42));
    assert!(parsed.summary.contains("2 failed"));
}
