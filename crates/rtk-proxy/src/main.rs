use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "rtk-proxy", about = "Secure command execution proxy for cortx")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    Mcp {
        #[arg(short, long, default_value = "cortx-policy.toml")]
        policy: String,
        #[arg(short = 'r', long, default_value = ".")]
        root: String,
    },
    Exec {
        command: String,
        #[arg(short, long, default_value = "cortx-policy.toml")]
        policy: String,
        #[arg(short = 'r', long, default_value = ".")]
        root: String,
    },
}

fn main() {
    let args = Args::parse();
    match args.command {
        Some(Cli::Exec {
            command,
            policy,
            root,
        }) => {
            println!("rtk-proxy exec: {command} (policy: {policy}, root: {root})");
            println!("Full MCP implementation deferred to Phase 4");
        }
        Some(Cli::Mcp { policy, root }) => {
            println!("rtk-proxy mcp: policy={policy}, root={root}");
            println!("Full MCP implementation deferred to Phase 4");
        }
        None => println!("rtk-proxy: use --help for usage"),
    }
}
