use regex::Regex;
use std::sync::LazyLock;

static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b\\|\x1b[^\[\]]")
        .unwrap()
});

static PROGRESS_BAR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*\[[\s=\->]+\]\s*\d*%?\s*$|^\s*\d{1,3}%\s*$").unwrap()
});

static SPINNER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷|/\-\\]\s").unwrap()
});

/// Clean a single line of output. Returns `None` if the line should be suppressed.
/// Caller must maintain `prev_blank` across calls for blank-line deduplication.
pub fn clean_line(line: &str, prev_blank: &mut bool) -> Option<String> {
    let line = ANSI_RE.replace_all(line, "");

    // Skip carriage-return overwrite lines (progress indicators).
    // Note: \r\n line endings are already stripped by lines()/BufRead::lines(),
    // so a remaining \r is always an in-line overwrite character.
    if line.contains('\r') {
        return None;
    }

    // Skip progress bars and spinners
    if PROGRESS_BAR_RE.is_match(&line) || SPINNER_RE.is_match(&line) {
        return None;
    }

    // Deduplicate consecutive blank lines
    if line.trim().is_empty() {
        if *prev_blank {
            return None;
        }
        *prev_blank = true;
        return Some(String::new());
    }

    *prev_blank = false;
    Some(line.into_owned())
}

/// Clean a complete output string. Convenience wrapper around `clean_line`.
pub fn clean(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut prev_blank = false;
    for line in input.lines() {
        if let Some(cleaned) = clean_line(line, &mut prev_blank) {
            result.push_str(&cleaned);
            result.push('\n');
        }
    }
    result
}
