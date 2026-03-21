use cortx::clean::clean;

#[test]
fn strip_ansi_colors() {
    let input = "\x1b[31mERROR\x1b[0m: something failed";
    assert_eq!(clean(input), "ERROR: something failed\n");
}

#[test]
fn strip_ansi_cursor_and_csi() {
    let input = "\x1b[2K\x1b[1A\x1b[32m  Compiling\x1b[0m foo v0.1.0";
    assert_eq!(clean(input), "  Compiling foo v0.1.0\n");
}

#[test]
fn passthrough_clean_text() {
    let input = "hello world";
    assert_eq!(clean(input), "hello world\n");
}

#[test]
fn dedup_consecutive_blank_lines() {
    let input = "line1\n\n\n\nline2\n\n\nline3";
    assert_eq!(clean(input), "line1\n\nline2\n\nline3\n");
}

#[test]
fn dedup_whitespace_only_lines() {
    let input = "line1\n   \n  \n\nline2";
    assert_eq!(clean(input), "line1\n\nline2\n");
}

#[test]
fn strip_carriage_return_lines() {
    let input = "Downloading...\rDownloading... 50%\rDownloading... 100%\nDone!";
    assert_eq!(clean(input), "Done!\n");
}

#[test]
fn strip_progress_bar_only_lines() {
    let input = "Building:\n[====>        ] 33%\n[========>    ] 66%\n[=============] 100%\nFinished.";
    assert_eq!(clean(input), "Building:\nFinished.\n");
}

#[test]
fn keep_percentage_in_context() {
    let input = "Coverage: 87% of lines\nTests: 100% passed";
    assert_eq!(clean(input), "Coverage: 87% of lines\nTests: 100% passed\n");
}

#[test]
fn strip_spinner_lines() {
    let input = "⠋ Loading...\n⠙ Loading...\n⠹ Loading...\nLoaded!";
    assert_eq!(clean(input), "Loaded!\n");
}
