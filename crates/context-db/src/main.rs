use clap::{Parser, Subcommand};
use cortx_types::{MemoryOrgan, RecallQuery};

#[derive(Parser)]
#[command(name = "context-db", about = "Memory organ for cortx")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    /// Start MCP server on stdio
    Mcp {
        #[arg(short, long, default_value = "context.db")]
        db: String,
        #[arg(short, long)]
        project_root: Option<String>,
    },
    /// Query memory by text search
    Query {
        query: String,
        #[arg(short, long, default_value = "context.db")]
        db: String,
        #[arg(short, long)]
        project_root: Option<String>,
    },
    /// Show memory statistics
    Status {
        #[arg(short, long, default_value = "context.db")]
        db: String,
    },
    /// Run purge rules
    Purge {
        #[arg(short, long, default_value = "context.db")]
        db: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    match args.command {
        Some(Cli::Query {
            query,
            db,
            project_root,
        }) => {
            let ctx = context_db::ContextDb::new(&db, project_root).await?;
            let hints = ctx
                .recall(RecallQuery {
                    text: Some(query),
                    ..Default::default()
                })
                .await?;
            if hints.is_empty() {
                println!("No matching memories found.");
            } else {
                for h in &hints {
                    println!(
                        "[{:.0}%] {}: {}",
                        h.confidence * 100.0,
                        h.kind,
                        h.summary
                    );
                }
            }
        }
        Some(Cli::Mcp { db, project_root }) => {
            use rmcp::ServiceExt;
            let ctx = context_db::ContextDb::new(&db, project_root).await?;
            let server = context_db::mcp::MemoryMcpServer::new(ctx);
            let transport = rmcp::transport::io::stdio();
            let service = server.serve(transport).await?;
            service.waiting().await?;
        }
        Some(Cli::Status { db }) => {
            let ctx = context_db::ContextDb::new(&db, None).await?;
            let exec_count = ctx.execution_count().await?;
            let db_size = context_db::purge::db_size_bytes(ctx.db()).await?;
            println!("Executions: {exec_count}");
            println!("DB size: {:.1} KB", db_size as f64 / 1024.0);
        }
        Some(Cli::Purge { db }) => {
            let ctx = context_db::ContextDb::new(&db, None).await?;
            let chains =
                context_db::purge::purge_unconfirmed_chains(ctx.db(), 60).await?;
            let archived =
                context_db::purge::archive_low_confidence(ctx.db(), 0.1).await?;
            let old =
                context_db::purge::purge_old_executions(ctx.db(), 90).await?;
            let size =
                context_db::purge::purge_if_over_size(ctx.db(), 100 * 1024 * 1024)
                    .await?;
            println!(
                "Purged: {chains} unconfirmed chains, {archived} archived, {old} old executions, {size} size-limited"
            );
        }
        None => {
            eprintln!("context-db: use --help for usage");
        }
    }
    Ok(())
}
