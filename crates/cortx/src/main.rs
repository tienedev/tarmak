use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "cortx", about = "AI development orchestrator")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    /// Start the meta-MCP server (stdio) — exposes all 3 organs
    Serve {
        #[arg(short, long, default_value = ".")]
        project: String,
        #[arg(long, default_value = "cortx-policy.toml")]
        policy: String,
        #[arg(long, default_value = "kanwise.db")]
        kanwise_db: String,
        #[arg(long, default_value = "context.db")]
        context_db: String,
    },
    /// Show current status (budget, memory stats)
    Status {
        #[arg(long, default_value = "context.db")]
        context_db: String,
    },
    /// Verify everything is OK (DBs, policy, git)
    Doctor {
        #[arg(long, default_value = "cortx-policy.toml")]
        policy: String,
        #[arg(long, default_value = "kanwise.db")]
        kanwise_db: String,
        #[arg(long, default_value = "context.db")]
        context_db: String,
    },
    /// Restore the last git checkpoint
    Rollback,
    /// Show or edit active policy
    Policy {
        #[command(subcommand)]
        command: PolicyCommand,
    },
}

#[derive(Subcommand)]
enum PolicyCommand {
    /// Display active policy
    Show {
        #[arg(long, default_value = "cortx-policy.toml")]
        path: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    match args.command {
        Some(Cli::Serve { project, policy, kanwise_db: kw_db_path, context_db: ctx_db_path }) => {
            let project_root = PathBuf::from(&project).canonicalize()?;

            // 1. Open kanwise DB
            let kw_db = kanwise::Db::new(&kw_db_path).await?;
            let kw = kanwise::Kanwise::new(kw_db);

            // 2. Load policy + create proxy
            let proxy = rtk_proxy::Proxy::from_file(&policy, project_root.clone())?;

            // 3. Open context DB
            let mem = context_db::ContextDb::new(&ctx_db_path, Some(project_root.display().to_string())).await?;

            // 4. Wire orchestrator
            let orch = cortx::orchestrator::Orchestrator::new(kw, proxy, mem);

            // 5. Start MCP
            use rmcp::ServiceExt;
            let server = cortx::mcp::CortxMcpServer::new(orch, project_root);
            eprintln!("cortx serve: MCP server starting on stdio...");
            let transport = rmcp::transport::io::stdio();
            let service = server.serve(transport).await?;
            service.waiting().await?;
        }
        Some(Cli::Status { context_db: ctx_db_path }) => {
            if std::path::Path::new(&ctx_db_path).exists() {
                let ctx = context_db::ContextDb::new(&ctx_db_path, None).await?;
                let count = ctx.execution_count().await?;
                let size = context_db::purge::db_size_bytes(ctx.db()).await?;
                println!("Memory: {count} executions, {:.1} KB", size as f64 / 1024.0);
            } else {
                println!("No context.db found — run `cortx serve` first.");
            }
        }
        Some(Cli::Doctor { policy, kanwise_db: kw_db_path, context_db: ctx_db_path }) => {
            let mut ok = true;

            // Check policy
            print!("Policy ({policy})... ");
            match rtk_proxy::Proxy::from_file(&policy, PathBuf::from(".")) {
                Ok(_) => println!("OK"),
                Err(e) => { println!("FAIL: {e}"); ok = false; }
            }

            // Check kanwise DB
            print!("Kanwise DB ({kw_db_path})... ");
            if std::path::Path::new(&kw_db_path).exists() {
                match kanwise::Db::new(&kw_db_path).await {
                    Ok(_) => println!("OK"),
                    Err(e) => { println!("FAIL: {e}"); ok = false; }
                }
            } else {
                println!("NOT FOUND"); ok = false;
            }

            // Check context DB
            print!("Context DB ({ctx_db_path})... ");
            if std::path::Path::new(&ctx_db_path).exists() {
                match context_db::ContextDb::new(&ctx_db_path, None).await {
                    Ok(_) => println!("OK"),
                    Err(e) => { println!("FAIL: {e}"); ok = false; }
                }
            } else {
                println!("NOT FOUND (will be created on first serve)");
            }

            // Check git
            print!("Git... ");
            let git = std::process::Command::new("git").args(["status", "--porcelain"]).output();
            match git {
                Ok(o) if o.status.success() => println!("OK"),
                _ => { println!("FAIL: not a git repository"); ok = false; }
            }

            if ok { println!("\nAll checks passed."); }
            else { println!("\nSome checks failed."); std::process::exit(1); }
        }
        Some(Cli::Rollback) => {
            if rtk_proxy::git::restore_checkpoint(&std::env::current_dir()?) {
                println!("Checkpoint restored.");
            } else {
                println!("No checkpoint found.");
            }
        }
        Some(Cli::Policy { command }) => match command {
            PolicyCommand::Show { path } => {
                match std::fs::read_to_string(&path) {
                    Ok(content) => print!("{content}"),
                    Err(e) => eprintln!("Cannot read {path}: {e}"),
                }
            }
        },
        None => {
            eprintln!("cortx — AI development orchestrator");
            eprintln!("Use --help for usage");
        }
    }
    Ok(())
}
