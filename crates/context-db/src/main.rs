use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "context-db", about = "Memory organ for cortx")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    Mcp {
        #[arg(short, long, default_value = "context.db")]
        db: String,
    },
    Query {
        query: String,
        #[arg(short, long, default_value = "context.db")]
        db: String,
    },
}

fn main() {
    let args = Args::parse();
    match args.command {
        Some(Cli::Query { query, db }) => {
            println!("context-db query: \"{query}\" (db: {db})");
            println!("Full implementation deferred to Phase 4");
        }
        Some(Cli::Mcp { db }) => {
            println!("context-db mcp: db={db}");
            println!("Full MCP implementation deferred to Phase 4");
        }
        None => println!("context-db: use --help for usage"),
    }
}
