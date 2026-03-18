use clap::{Parser, Subcommand};
use cortx_types::{ActionOrgan, Command, ExecutionMode};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "rtk-proxy", about = "Secure command execution proxy for cortx")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    /// Start MCP server on stdio
    Mcp {
        #[arg(short, long, default_value = "cortx-policy.toml")]
        policy: String,
        #[arg(short = 'r', long, default_value = ".")]
        root: String,
    },
    /// Execute a single command through the proxy pipeline
    Exec {
        command: String,
        #[arg(short, long, default_value = "cortx-policy.toml")]
        policy: String,
        #[arg(short = 'r', long, default_value = ".")]
        root: String,
        #[arg(short, long, default_value = "assisted")]
        mode: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    match args.command {
        Some(Cli::Exec {
            command,
            policy,
            root,
            mode,
        }) => {
            let project_root = PathBuf::from(&root).canonicalize()?;
            let proxy = rtk_proxy::Proxy::from_file(&policy, project_root.clone())?;
            let exec_mode = match mode.as_str() {
                "autonomous" => ExecutionMode::Autonomous,
                "admin" => ExecutionMode::Admin,
                _ => ExecutionMode::Assisted,
            };
            let cmd = Command {
                cmd: command,
                cwd: project_root,
                mode: exec_mode,
                task_id: None,
            };
            let result = proxy.execute(cmd).await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "status": format!("{:?}", result.status),
                    "exit_code": result.exit_code,
                    "duration_ms": result.duration_ms,
                    "tier": result.tier.as_str(),
                    "summary": result.summary,
                    "truncated": result.truncated,
                }))?
            );
        }
        Some(Cli::Mcp { policy, root }) => {
            use rmcp::ServiceExt;
            let project_root = PathBuf::from(&root).canonicalize()?;
            let proxy = rtk_proxy::Proxy::from_file(&policy, project_root.clone())?;
            let server = rtk_proxy::mcp::ProxyMcpServer::new(proxy, project_root);
            let transport = rmcp::transport::io::stdio();
            let service = server.serve(transport).await?;
            service.waiting().await?;
        }
        None => {
            eprintln!("rtk-proxy: use --help for usage");
        }
    }
    Ok(())
}
