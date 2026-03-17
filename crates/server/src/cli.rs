use crate::db::Db;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Export / Import JSON types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct BoardExport {
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub board: ExportedBoard,
    pub columns: Vec<ExportedColumn>,
    pub tasks: Vec<ExportedTask>,
    pub labels: Vec<ExportedLabel>,
    pub task_labels: Vec<TaskLabelLink>,
    pub subtasks: Vec<ExportedSubtask>,
    pub comments: Vec<ExportedComment>,
    pub custom_fields: Vec<ExportedCustomField>,
    pub field_values: Vec<ExportedFieldValue>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedBoard {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedColumn {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub wip_limit: Option<i64>,
    pub color: Option<String>,
    pub archived: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedTask {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: String,
    pub assignee: Option<String>,
    pub due_date: Option<String>,
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedLabel {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct TaskLabelLink {
    pub task_id: String,
    pub label_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedSubtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub completed: bool,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedComment {
    pub id: String,
    pub task_id: String,
    pub user_id: String,
    pub user_name: Option<String>,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedCustomField {
    pub id: String,
    pub name: String,
    pub field_type: String,
    pub config: Option<String>,
    pub position: i64,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedFieldValue {
    pub task_id: String,
    pub field_id: String,
    pub value: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    let db = Db::new(&db_path()).await?;

    let board = db
        .get_board(board_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Board not found: {board_id}"))?;

    let columns = db.get_all_columns_for_board(board_id).await?;
    let tasks = db.get_all_tasks_for_board(board_id).await?;
    let labels = db.list_labels(board_id).await?;
    let label_links = db.get_labels_for_board_tasks(board_id).await?;
    let subtasks = db.get_subtasks_for_board(board_id).await?;
    let comments = db.get_comments_for_board(board_id).await?;
    let custom_fields = db.list_custom_fields(board_id).await?;
    let field_values = db.get_custom_field_values_for_board(board_id).await?;

    // Check for attachments and warn
    let task_count = tasks.len();
    let has_attachments = db
        .with_conn({
            let board_id = board_id.to_string();
            move |conn| {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.board_id = ?1",
                    rusqlite::params![board_id],
                    |row| row.get(0),
                )?;
                Ok(count > 0)
            }
        })
        .await?;

    if has_attachments {
        eprintln!("WARNING: Board has file attachments which are not included in the export.");
        eprintln!("Back up the uploads directory separately if needed.");
    }

    let board_name = board.name.clone();
    let export = BoardExport {
        version: 1,
        exported_at: Utc::now(),
        board: ExportedBoard {
            id: board.id,
            name: board.name,
            description: board.description,
            created_at: board.created_at,
            updated_at: board.updated_at,
        },
        columns: columns
            .into_iter()
            .map(|c| ExportedColumn {
                id: c.id,
                name: c.name,
                position: c.position,
                wip_limit: c.wip_limit,
                color: c.color,
                archived: c.archived,
            })
            .collect(),
        tasks: tasks
            .into_iter()
            .map(|t| ExportedTask {
                id: t.id,
                column_id: t.column_id,
                title: t.title,
                description: t.description,
                priority: t.priority.as_str().to_string(),
                assignee: t.assignee,
                due_date: t.due_date,
                position: t.position,
                created_at: t.created_at,
                updated_at: t.updated_at,
                archived: t.archived,
            })
            .collect(),
        labels: labels
            .into_iter()
            .map(|l| ExportedLabel {
                id: l.id,
                name: l.name,
                color: l.color,
                created_at: l.created_at,
            })
            .collect(),
        task_labels: label_links
            .into_iter()
            .map(|(task_id, label)| TaskLabelLink {
                task_id,
                label_id: label.id,
            })
            .collect(),
        subtasks: subtasks
            .into_iter()
            .map(|s| ExportedSubtask {
                id: s.id,
                task_id: s.task_id,
                title: s.title,
                completed: s.completed,
                position: s.position,
                created_at: s.created_at,
            })
            .collect(),
        comments: comments
            .into_iter()
            .map(|c| ExportedComment {
                id: c.id,
                task_id: c.task_id,
                user_id: c.user_id,
                user_name: c.user_name,
                content: c.content,
                created_at: c.created_at,
            })
            .collect(),
        custom_fields: custom_fields
            .into_iter()
            .map(|f| ExportedCustomField {
                id: f.id,
                name: f.name,
                field_type: f.field_type.as_str().to_string(),
                config: f.config,
                position: f.position,
            })
            .collect(),
        field_values: field_values
            .into_iter()
            .map(|v| ExportedFieldValue {
                task_id: v.task_id,
                field_id: v.field_id,
                value: v.value,
            })
            .collect(),
    };

    let col_count = export.columns.len();
    let label_count = export.labels.len();
    let json = serde_json::to_string_pretty(&export)?;

    match output {
        Some(path) => {
            std::fs::write(&path, &json)?;
            eprintln!(
                "Exported board {:?} ({task_count} tasks, {col_count} columns, {label_count} labels) to {path}",
                board_name
            );
        }
        None => {
            println!("{json}");
        }
    }

    Ok(())
}

pub async fn import_board(file: &str, owner_email: &str) -> anyhow::Result<()> {
    let content = std::fs::read_to_string(file)
        .map_err(|e| anyhow::anyhow!("Cannot read {file}: {e}"))?;
    let export: BoardExport = serde_json::from_str(&content)
        .map_err(|e| anyhow::anyhow!("Invalid JSON: {e}"))?;

    if export.version != 1 {
        anyhow::bail!("Unsupported export version: {}", export.version);
    }

    let db = Db::new(&db_path()).await?;

    // Look up owner
    let owner = db
        .get_user_by_email(owner_email)
        .await?
        .ok_or_else(|| anyhow::anyhow!("No user found with email: {owner_email}"))?;

    // Collect all local user IDs for FK validation on comments/assignees
    let local_users = db.list_users().await?;
    let local_user_ids: std::collections::HashSet<String> =
        local_users.into_iter().map(|u| u.id).collect();

    let owner_id = owner.id.clone();
    let board_name = export.board.name.clone();

    // Run entire import in a single transaction
    let (new_board_id, task_count, col_count, label_count) = db
        .with_conn(move |conn| {
            let tx = conn.transaction()?;

            // Build ID remapping — maps old export IDs to fresh UUIDs
            let mut id_map = std::collections::HashMap::<String, String>::new();

            // Helper: get-or-create a new UUID for an old ID
            fn remap(
                map: &mut std::collections::HashMap<String, String>,
                old: &str,
            ) -> String {
                map.entry(old.to_string())
                    .or_insert_with(|| uuid::Uuid::new_v4().to_string())
                    .clone()
            }

            // Board
            let new_board_id = remap(&mut id_map, &export.board.id);
            tx.execute(
                "INSERT INTO boards (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    new_board_id,
                    export.board.name,
                    export.board.description,
                    export.board.created_at.to_rfc3339(),
                    export.board.updated_at.to_rfc3339(),
                ],
            )?;

            // Board member (owner)
            tx.execute(
                "INSERT INTO board_members (board_id, user_id, role) VALUES (?1, ?2, ?3)",
                rusqlite::params![new_board_id, owner_id, "owner"],
            )?;

            // Columns
            let col_count = export.columns.len();
            for col in &export.columns {
                let new_id = remap(&mut id_map, &col.id);
                tx.execute(
                    "INSERT INTO columns (id, board_id, name, position, wip_limit, color, archived)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        new_id,
                        new_board_id,
                        col.name,
                        col.position,
                        col.wip_limit,
                        col.color,
                        col.archived as i64,
                    ],
                )?;
            }

            // Labels
            let label_count = export.labels.len();
            for label in &export.labels {
                let new_id = remap(&mut id_map, &label.id);
                tx.execute(
                    "INSERT INTO labels (id, board_id, name, color, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        new_id,
                        new_board_id,
                        label.name,
                        label.color,
                        label.created_at.to_rfc3339(),
                    ],
                )?;
            }

            // Custom fields
            for field in &export.custom_fields {
                let new_id = remap(&mut id_map, &field.id);
                tx.execute(
                    "INSERT INTO custom_fields (id, board_id, name, field_type, config, position)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![
                        new_id,
                        new_board_id,
                        field.name,
                        field.field_type,
                        field.config,
                        field.position,
                    ],
                )?;
            }

            // Tasks
            let task_count = export.tasks.len();
            for task in &export.tasks {
                let new_id = remap(&mut id_map, &task.id);
                let new_col_id = id_map
                    .get(&task.column_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown column_id: {}", task.column_id))?
                    .clone();
                // Null out assignee if user doesn't exist locally
                let assignee = task
                    .assignee
                    .as_ref()
                    .filter(|a| local_user_ids.contains(a.as_str()))
                    .cloned();
                tx.execute(
                    "INSERT INTO tasks (id, board_id, column_id, title, description, priority,
                                       assignee, due_date, position, created_at, updated_at, archived)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![
                        new_id,
                        new_board_id,
                        new_col_id,
                        task.title,
                        task.description,
                        task.priority,
                        assignee,
                        task.due_date,
                        task.position,
                        task.created_at.to_rfc3339(),
                        task.updated_at.to_rfc3339(),
                        task.archived as i64,
                    ],
                )?;
            }

            // Task-label associations
            for link in &export.task_labels {
                let new_task_id = id_map
                    .get(&link.task_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Unknown task_id in task_labels: {}", link.task_id)
                    })?;
                let new_label_id = id_map
                    .get(&link.label_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Unknown label_id in task_labels: {}", link.label_id)
                    })?;
                tx.execute(
                    "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
                    rusqlite::params![new_task_id, new_label_id],
                )?;
            }

            // Subtasks
            for sub in &export.subtasks {
                let new_id = remap(&mut id_map, &sub.id);
                let new_task_id = id_map
                    .get(&sub.task_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Unknown task_id in subtasks: {}", sub.task_id)
                    })?;
                tx.execute(
                    "INSERT INTO subtasks (id, task_id, title, completed, position, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![
                        new_id,
                        new_task_id,
                        sub.title,
                        sub.completed,
                        sub.position,
                        sub.created_at.to_rfc3339(),
                    ],
                )?;
            }

            // Comments — remap user_id to owner if not found locally
            // Note: user_name is not a physical column; it is resolved via JOIN at read time
            for comment in &export.comments {
                let new_id = remap(&mut id_map, &comment.id);
                let new_task_id = id_map
                    .get(&comment.task_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Unknown task_id in comments: {}", comment.task_id)
                    })?;
                let effective_user_id = if local_user_ids.contains(&comment.user_id) {
                    &comment.user_id
                } else {
                    &owner_id
                };
                tx.execute(
                    "INSERT INTO comments (id, task_id, user_id, content, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        new_id,
                        new_task_id,
                        effective_user_id,
                        comment.content,
                        comment.created_at.to_rfc3339(),
                    ],
                )?;
            }

            // Field values
            for fv in &export.field_values {
                let new_task_id = id_map
                    .get(&fv.task_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Unknown task_id in field_values: {}", fv.task_id)
                    })?;
                let new_field_id = id_map
                    .get(&fv.field_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Unknown field_id in field_values: {}", fv.field_id)
                    })?;
                tx.execute(
                    "INSERT INTO task_custom_field_values (task_id, field_id, value)
                     VALUES (?1, ?2, ?3)",
                    rusqlite::params![new_task_id, new_field_id, fv.value],
                )?;
            }

            tx.commit()?;
            Ok((new_board_id, task_count, col_count, label_count))
        })
        .await?;

    println!(
        "Imported board {:?} ({task_count} tasks, {col_count} columns, {label_count} labels)",
        board_name
    );
    println!("Board ID: {new_board_id}");

    Ok(())
}

pub async fn list_users() -> anyhow::Result<()> {
    todo!("list_users")
}
