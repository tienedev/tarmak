use crate::db::Db;

fn db_path() -> String {
    std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string())
}

pub async fn backup(output: Option<String>) -> anyhow::Result<()> {
    let db_path = db_path();
    if !std::path::Path::new(&db_path).exists() {
        anyhow::bail!("Database not found at: {db_path}");
    }

    let out_path = output.unwrap_or_else(|| {
        let now = chrono::Local::now();
        format!("kanwise-backup-{}.db", now.format("%Y%m%d-%H%M%S"))
    });

    let db = Db::new(&db_path).await?;
    let out = out_path.clone();
    db.with_conn(move |conn| {
        conn.execute("VACUUM INTO ?1", rusqlite::params![out])?;
        Ok(())
    })
    .await?;

    let size = std::fs::metadata(&out_path)?.len();
    println!("Backup saved to {out_path} ({})", format_size(size));
    Ok(())
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

pub async fn restore(file: &str, force: bool) -> anyhow::Result<()> {
    let source = std::path::Path::new(file);
    if !source.exists() {
        anyhow::bail!("File not found: {file}");
    }

    // Validate it's a valid SQLite database
    let conn = rusqlite::Connection::open(file)?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    drop(conn);
    if integrity != "ok" {
        anyhow::bail!("File is not a valid SQLite database: {integrity}");
    }

    let db_path = db_path();

    // Warn if server might be running
    let wal_path = format!("{db_path}-wal");
    let shm_path = format!("{db_path}-shm");
    if std::path::Path::new(&wal_path).exists() || std::path::Path::new(&shm_path).exists() {
        eprintln!("WARNING: WAL/SHM files detected — the server may be running.");
        eprintln!("Stop the server before restoring to avoid corruption.");
    }

    if !force {
        eprint!("WARNING: This will replace the current database at {db_path}\nContinue? [y/N] ");
        let mut input = String::new();
        std::io::stdin().read_line(&mut input)?;
        if !input.trim().eq_ignore_ascii_case("y") {
            println!("Aborted.");
            return Ok(());
        }
    }

    std::fs::copy(file, &db_path)?;

    // Remove stale WAL/SHM files
    let _ = std::fs::remove_file(&wal_path);
    let _ = std::fs::remove_file(&shm_path);

    let size = std::fs::metadata(&db_path)?.len();
    println!("Database restored from {file} ({})", format_size(size));
    Ok(())
}

pub async fn export_board(board_id: &str, output: Option<String>) -> anyhow::Result<()> {
    todo!("export")
}

pub async fn import_board(file: &str, owner_email: &str) -> anyhow::Result<()> {
    todo!("import")
}

pub async fn list_users() -> anyhow::Result<()> {
    todo!("list_users")
}
