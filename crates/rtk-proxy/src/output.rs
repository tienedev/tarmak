use cortx_types::CodeLocation;
use regex::Regex;
use std::sync::LazyLock;

use crate::policy::OutputConfig;

pub struct OutputProcessor {
    max_lines: usize,
    keep_head: usize,
    keep_tail: usize,
    redact_regexes: Vec<Regex>,
}

pub struct ParsedOutput {
    pub summary: String,
    pub errors: Vec<CodeLocation>,
    pub warnings: Vec<CodeLocation>,
}

impl OutputProcessor {
    pub fn new(config: &OutputConfig) -> Self {
        let redact_regexes = config
            .redact_patterns
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();
        Self {
            max_lines: config.max_lines,
            keep_head: config.keep_head,
            keep_tail: config.keep_tail,
            redact_regexes,
        }
    }

    pub fn truncate(&self, output: &str) -> (String, bool) {
        let lines: Vec<&str> = output.lines().collect();
        if lines.len() <= self.max_lines {
            return (output.to_string(), false);
        }
        let head: Vec<&str> = lines[..self.keep_head].to_vec();
        let tail: Vec<&str> = lines[lines.len() - self.keep_tail..].to_vec();
        let omitted = lines.len() - self.keep_head - self.keep_tail;
        let mut result = head.join("\n");
        result.push_str(&format!("\n\n... ({omitted} lines omitted) ...\n\n"));
        result.push_str(&tail.join("\n"));
        (result, true)
    }

    pub fn redact(&self, output: &str) -> String {
        let mut result = output.to_string();
        for re in &self.redact_regexes {
            result = re.replace_all(&result, "[REDACTED]").to_string();
        }
        result
    }

    #[allow(dead_code)]
    pub fn process(&self, output: &str) -> (String, bool) {
        let redacted = self.redact(output);
        self.truncate(&redacted)
    }
}

static CARGO_PANIC_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"panicked at ([^:]+):(\d+):\d+:\n(.+)").unwrap());

static CARGO_SUMMARY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored").unwrap()
});

pub fn parse_cargo_test(output: &str) -> ParsedOutput {
    let mut errors = Vec::new();
    for cap in CARGO_PANIC_RE.captures_iter(output) {
        errors.push(CodeLocation {
            file: cap[1].to_string(),
            line: cap[2].parse().ok(),
            msg: cap[3].trim().to_string(),
        });
    }
    let summary = if let Some(cap) = CARGO_SUMMARY_RE.captures(output) {
        format!(
            "{} passed; {} failed; {} ignored",
            &cap[1], &cap[2], &cap[3]
        )
    } else {
        String::new()
    };
    ParsedOutput {
        summary,
        errors,
        warnings: Vec::new(),
    }
}
