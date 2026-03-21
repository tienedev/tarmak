use clap::{Parser, Subcommand};
use std::io::{self, BufRead, Read, Write};
use std::process::{Command, Stdio};

#[derive(Parser)]
#[command(name = "cortx", version, about = "Configure Claude Code dev environment")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Configure Claude Code (hooks + MCP + plugin instructions)
    Install,
    /// Remove cortx configuration from Claude Code
    Uninstall,
    /// Check configuration status
    Doctor,
    /// PreToolUse hook handler (stdin JSON → stdout JSON)
    Hook,
    /// Execute a command and clean its output
    Exec {
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },
    /// Update cortx and/or kanwise to latest version
    Update {
        /// Component to update (cortx or kanwise). Updates all if omitted.
        component: Option<String>,
        /// Force docker mode for kanwise
        #[arg(long)]
        docker: bool,
        /// Force local mode for kanwise
        #[arg(long)]
        local: bool,
        /// Override repo path: --set-repo <component> <path>
        #[arg(long, num_args = 2, value_names = ["COMPONENT", "PATH"])]
        set_repo: Option<Vec<String>>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Install => cmd_install(),
        Commands::Uninstall => cmd_uninstall(),
        Commands::Doctor => cmd_doctor(),
        Commands::Hook => cmd_hook(),
        Commands::Exec { command } => cmd_exec(&command),
        Commands::Update { component, docker, local, set_repo } => {
            cmd_update(component.as_deref(), docker, local, set_repo);
        }
    }
}

fn cmd_install() {
    let claude_dir = cortx::config::claude_dir();
    let kanwise_path = cortx::detect_binary("kanwise");

    match cortx::install::install(&claude_dir, kanwise_path.as_deref()) {
        Ok(report) => {
            match report.hook {
                cortx::install::HookStatus::Installed => {
                    println!("✓ Hook installed (PreToolUse → cortx hook)")
                }
                cortx::install::HookStatus::AlreadyPresent => {
                    println!("✓ Hook already configured")
                }
                cortx::install::HookStatus::Migrated => {
                    println!("✓ Hook migrated (token-cleaner → cortx hook)")
                }
            }
            match report.mcp {
                cortx::install::McpStatus::Configured => {
                    println!("✓ MCP server configured (kanwise)")
                }
                cortx::install::McpStatus::AlreadyPresent => {
                    println!("✓ MCP server already configured (kanwise)")
                }
                cortx::install::McpStatus::KanwiseNotFound => {
                    println!("⚠ kanwise not found in PATH — MCP not configured");
                    println!(
                        "  Install via Docker: ghcr.io/tienedev/kanwise:latest"
                    );
                    println!(
                        "  Or build from source: https://github.com/tienedev/kanwise"
                    );
                }
            }
            println!(
                "ℹ Plugin: run these commands in Claude Code:"
            );
            println!(
                "  /plugin marketplace add tienedev/kanwise-skills"
            );
            println!(
                "  /plugin install kanwise-skills@tienedev-kanwise-skills"
            );

            // Detect component modes and write cortx.json
            let cortx_repo = cortx::detect::detect_cortx_repo();
            if let Err(e) = cortx::install::detect_and_write_config(&claude_dir, &cortx_repo, &cortx::detect::RealSystem) {
                eprintln!("⚠ could not write cortx.json: {e}");
            }
        }
        Err(e) => {
            eprintln!("cortx install: {e}");
            std::process::exit(1);
        }
    }
}

fn cmd_uninstall() {
    let claude_dir = cortx::config::claude_dir();
    match cortx::install::uninstall(&claude_dir) {
        Ok(report) => {
            match report.hook {
                cortx::install::HookRemoveStatus::Removed => println!("✓ Hook removed"),
                cortx::install::HookRemoveStatus::NotFound => {
                    println!("ℹ Hook was not installed")
                }
            }
            match report.mcp {
                cortx::install::McpRemoveStatus::Removed => {
                    println!("✓ MCP server removed (kanwise)")
                }
                cortx::install::McpRemoveStatus::NotFound => {
                    println!("ℹ MCP server was not configured")
                }
            }
            println!("ℹ To uninstall kanwise-skills, run in Claude Code:");
            println!("  /plugin uninstall kanwise-skills@tienedev-kanwise-skills");
        }
        Err(e) => {
            eprintln!("cortx uninstall: {e}");
            std::process::exit(1);
        }
    }
}

fn cmd_doctor() {
    let claude_dir = cortx::config::claude_dir();
    let kanwise_path = cortx::detect_binary("kanwise");
    let cortx_path = std::env::current_exe().unwrap_or_default();

    let ctx = cortx::doctor::DoctorContext {
        claude_dir,
        cortx_version: env!("CARGO_PKG_VERSION").into(),
        cortx_path,
        kanwise_path,
    };

    match cortx::doctor::run_doctor(&ctx) {
        Ok(results) => {
            for (name, status) in results {
                match status {
                    cortx::doctor::CheckResult::Ok(msg) => println!("✓ {name}: {msg}"),
                    cortx::doctor::CheckResult::Warning(msg) => println!("⚠ {name}: {msg}"),
                }
            }
        }
        Err(e) => {
            eprintln!("cortx doctor: {e}");
            std::process::exit(1);
        }
    }
}

fn cmd_hook() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).ok();

    if let Some(output) = cortx::hook::rewrite_hook(&input) {
        io::stdout().write_all(output.as_bytes()).ok();
    }
}

fn cmd_exec(args: &[String]) {
    let joined = args.join(" ");
    let mut child = match Command::new("sh")
        .arg("-c")
        .arg(&joined)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("cortx: failed to execute: {e}");
            std::process::exit(127);
        }
    };

    // Collect stderr in a background thread (typically small)
    let child_stderr = child.stderr.take().unwrap();
    let stderr_thread = std::thread::spawn(move || io::read_to_string(child_stderr).unwrap_or_default());

    // Stream stdout line-by-line through the cleaning pipeline
    let child_stdout = child.stdout.take().unwrap();
    let reader = io::BufReader::new(child_stdout);
    let out = io::stdout();
    let mut out = out.lock();
    let mut prev_blank = false;

    for line in reader.lines().map_while(Result::ok) {
        if let Some(cleaned) = cortx::clean::clean_line(&line, &mut prev_blank) {
            let _ = writeln!(out, "{cleaned}");
        }
    }

    // Append cleaned stderr
    let stderr = stderr_thread.join().unwrap_or_default();
    for line in stderr.lines() {
        if let Some(cleaned) = cortx::clean::clean_line(line, &mut prev_blank) {
            let _ = writeln!(out, "{cleaned}");
        }
    }

    let status = child.wait().unwrap_or_else(|_| std::process::exit(1));
    std::process::exit(status.code().unwrap_or(1));
}

fn cmd_update(component: Option<&str>, docker: bool, local: bool, set_repo: Option<Vec<String>>) {
    let claude_dir = cortx::config::claude_dir();

    // Handle --set-repo
    if let Some(args) = set_repo {
        let name = &args[0];
        let path = std::path::Path::new(&args[1]);
        if !path.exists() {
            eprintln!("⚠ path does not exist: {}", path.display());
            std::process::exit(1);
        }
        let cargo_toml = if name == "cortx" || name == "kanwise" {
            path.join("Cargo.toml")
        } else {
            eprintln!("⚠ unknown component: {name} (expected cortx or kanwise)");
            std::process::exit(1);
        };
        if !cargo_toml.exists() {
            eprintln!("⚠ no Cargo.toml found at {}", path.display());
            std::process::exit(1);
        }
        // Update cortx.json
        let config_path = cortx::config::cortx_config_path(&claude_dir);
        let mut config = cortx::config::read_json(&config_path).unwrap_or_default();
        let components = config
            .as_object_mut().unwrap()
            .entry("components")
            .or_insert(serde_json::json!({}));
        let comp = components
            .as_object_mut().unwrap()
            .entry(name.to_string())
            .or_insert(serde_json::json!({}));
        comp["repo"] = serde_json::json!(path.to_string_lossy().to_string());
        comp["mode"] = serde_json::json!("local");
        cortx::config::write_json(&config_path, &config).unwrap();
        println!("✓ {name} repo set to {}", path.display());
        return;
    }

    // Determine forced mode
    let force_mode = if docker {
        Some("docker")
    } else if local {
        Some("local")
    } else {
        None
    };

    // Persist mode override if --docker or --local
    if let Some(mode) = force_mode {
        let comp_name = component.unwrap_or("kanwise");
        let config_path = cortx::config::cortx_config_path(&claude_dir);
        if let Ok(mut config) = cortx::config::read_json(&config_path)
            && let Some(components) = config.get_mut("components").and_then(|c| c.as_object_mut())
            && let Some(comp) = components.get_mut(comp_name)
        {
            comp["mode"] = serde_json::json!(mode);
            let _ = cortx::config::write_json(&config_path, &config);
        }
    }

    match cortx::update::run_update(&claude_dir, component, force_mode) {
        Ok(results) => {
            for (name, result) in results {
                match result {
                    cortx::update::UpdateResult::Updated { old_ref, new_ref } => {
                        println!("✓ {name} updated ({old_ref} → {new_ref})");
                    }
                    cortx::update::UpdateResult::AlreadyUpToDate { current_ref } => {
                        println!("✓ {name} already up to date ({current_ref})");
                    }
                    cortx::update::UpdateResult::Skipped { reason } => {
                        println!("⚠ {name}: {reason}");
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("cortx update: {e}");
            std::process::exit(1);
        }
    }
}
