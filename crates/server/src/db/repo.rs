use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use super::Db;
use super::models::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn parse_dt(s: &str) -> Result<chrono::DateTime<Utc>, rusqlite::Error> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(e),
            )
        })
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_board(&self, name: &str, description: Option<&str>) -> anyhow::Result<Board> {
        let name = name.to_string();
        let description = description.map(String::from);
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            conn.execute(
                "INSERT INTO boards (id, name, description, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, name, description, now, now],
            )
            .context("insert board")?;
            Ok(Board {
                id,
                name,
                description,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            })
        })
        .await
    }

    pub async fn get_board(&self, id: &str) -> anyhow::Result<Option<Board>> {
        let id = id.to_string();
        self.with_conn(move |conn| get_board_inner(conn, &id)).await
    }

    pub async fn list_boards(&self) -> anyhow::Result<Vec<Board>> {
        self.with_conn(move |conn| {
            let mut stmt =
                conn.prepare("SELECT id, name, description, created_at, updated_at FROM boards ORDER BY created_at")?;
            let rows = stmt.query_map([], |row| {
                Ok(Board {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    created_at: parse_dt(&row.get::<_, String>(3)?)?,
                    updated_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            let mut boards = Vec::new();
            for r in rows {
                boards.push(r?);
            }
            Ok(boards)
        })
        .await
    }

    pub async fn update_board(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<Option<&str>>,
    ) -> anyhow::Result<Option<Board>> {
        let id = id.to_string();
        let name = name.map(String::from);
        let description = description.map(|d| d.map(String::from));
        self.with_conn(move |conn| {
            let mut sets = Vec::new();
            let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            if let Some(n) = name {
                sets.push("name = ?");
                values.push(Box::new(n));
            }
            if let Some(d) = description {
                sets.push("description = ?");
                values.push(Box::new(d));
            }

            if !sets.is_empty() {
                let now = now_iso();
                sets.push("updated_at = ?");
                values.push(Box::new(now));
                values.push(Box::new(id.clone()));

                let sql = format!(
                    "UPDATE boards SET {} WHERE id = ?",
                    sets.join(", ")
                );
                let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                    values.iter().map(|v| v.as_ref()).collect();
                conn.execute(&sql, param_refs.as_slice())?;
            }

            get_board_inner(conn, &id)
        })
        .await
    }

    pub async fn delete_board(&self, id: &str) -> anyhow::Result<bool> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute("DELETE FROM boards WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
        .await
    }
}

fn get_board_inner(conn: &Connection, id: &str) -> anyhow::Result<Option<Board>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at, updated_at FROM boards WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(Board {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: parse_dt(&row.get::<_, String>(3)?)?,
            updated_at: parse_dt(&row.get::<_, String>(4)?)?,
        })
    })?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_column(
        &self,
        board_id: &str,
        name: &str,
        wip_limit: Option<i64>,
        color: Option<&str>,
    ) -> anyhow::Result<Column> {
        let board_id = board_id.to_string();
        let name = name.to_string();
        let color = color.map(String::from);
        self.with_conn(move |conn| {
            let id = new_id();
            let pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM columns WHERE board_id = ?1",
                    params![board_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO columns (id, board_id, name, position, wip_limit, color)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, board_id, name, pos, wip_limit, color],
            )
            .context("insert column")?;
            Ok(Column {
                id,
                board_id,
                name,
                position: pos,
                wip_limit,
                color,
                archived: false,
            })
        })
        .await
    }

    pub async fn list_columns(&self, board_id: &str) -> anyhow::Result<Vec<Column>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, position, wip_limit, color, archived
                 FROM columns WHERE board_id = ?1 AND archived = 0 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                Ok(Column {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    position: row.get(3)?,
                    wip_limit: row.get(4)?,
                    color: row.get(5)?,
                    archived: row.get::<_, i64>(6)? != 0,
                })
            })?;
            let mut cols = Vec::new();
            for r in rows {
                cols.push(r?);
            }
            Ok(cols)
        })
        .await
    }

    pub async fn update_column(
        &self,
        id: &str,
        name: Option<&str>,
        wip_limit: Option<Option<i64>>,
        color: Option<Option<&str>>,
    ) -> anyhow::Result<bool> {
        let id = id.to_string();
        let name = name.map(String::from);
        let color = color.map(|c| c.map(String::from));
        self.with_conn(move |conn| {
            let mut affected = 0usize;
            if let Some(n) = name {
                affected += conn.execute(
                    "UPDATE columns SET name = ?1 WHERE id = ?2",
                    params![n, id],
                )?;
            }
            if let Some(w) = wip_limit {
                affected += conn.execute(
                    "UPDATE columns SET wip_limit = ?1 WHERE id = ?2",
                    params![w, id],
                )?;
            }
            if let Some(c) = color {
                affected += conn.execute(
                    "UPDATE columns SET color = ?1 WHERE id = ?2",
                    params![c, id],
                )?;
            }
            Ok(affected > 0)
        })
        .await
    }

    pub async fn move_column(&self, id: &str, new_position: i64) -> anyhow::Result<bool> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute(
                "UPDATE columns SET position = ?1 WHERE id = ?2",
                params![new_position, id],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    pub async fn delete_column(&self, id: &str) -> anyhow::Result<bool> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute("DELETE FROM columns WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_task(
        &self,
        board_id: &str,
        column_id: &str,
        title: &str,
        description: Option<&str>,
        priority: Priority,
        assignee: Option<&str>,
    ) -> anyhow::Result<Task> {
        let board_id = board_id.to_string();
        let column_id = column_id.to_string();
        let title = title.to_string();
        let description = description.map(String::from);
        let assignee = assignee.map(String::from);
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            let pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE column_id = ?1",
                    params![column_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO tasks (id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![id, board_id, column_id, title, description, priority.as_str(), assignee, pos, now, now],
            )
            .context("insert task")?;
            Ok(Task {
                id,
                board_id,
                column_id,
                title,
                description,
                priority,
                assignee,
                due_date: None,
                position: pos,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                archived: false,
            })
        })
        .await
    }

    pub async fn get_task(&self, id: &str) -> anyhow::Result<Option<Task>> {
        let id = id.to_string();
        self.with_conn(move |conn| get_task_inner(conn, &id)).await
    }

    pub async fn list_tasks(&self, board_id: &str, limit: i64, offset: i64) -> anyhow::Result<Vec<Task>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived
                 FROM tasks WHERE board_id = ?1 AND archived = 0 ORDER BY position LIMIT ?2 OFFSET ?3",
            )?;
            let rows = stmt.query_map(params![board_id, limit, offset], map_task_row)?;
            collect_rows(rows)
        })
        .await
    }

    #[allow(dead_code)]
    pub async fn list_tasks_in_column(&self, column_id: &str) -> anyhow::Result<Vec<Task>> {
        let column_id = column_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived
                 FROM tasks WHERE column_id = ?1 AND archived = 0 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![column_id], map_task_row)?;
            collect_rows(rows)
        })
        .await
    }

    pub async fn update_task(
        &self,
        id: &str,
        title: Option<&str>,
        description: Option<Option<&str>>,
        priority: Option<Priority>,
        assignee: Option<Option<&str>>,
        due_date: Option<Option<&str>>,
    ) -> anyhow::Result<Option<Task>> {
        let id = id.to_string();
        let title = title.map(String::from);
        let description = description.map(|d| d.map(String::from));
        let assignee = assignee.map(|a| a.map(String::from));
        let due_date = due_date.map(|d| d.map(String::from));
        self.with_conn(move |conn| {
            let mut sets = Vec::new();
            let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            if let Some(t) = title {
                sets.push("title = ?");
                values.push(Box::new(t));
            }
            if let Some(d) = description {
                sets.push("description = ?");
                values.push(Box::new(d));
            }
            if let Some(p) = priority {
                sets.push("priority = ?");
                values.push(Box::new(p.as_str().to_string()));
            }
            if let Some(a) = assignee {
                sets.push("assignee = ?");
                values.push(Box::new(a));
            }
            if let Some(d) = due_date {
                sets.push("due_date = ?");
                values.push(Box::new(d));
            }

            if !sets.is_empty() {
                let now = now_iso();
                sets.push("updated_at = ?");
                values.push(Box::new(now));
                values.push(Box::new(id.clone()));

                let sql = format!(
                    "UPDATE tasks SET {} WHERE id = ?",
                    sets.join(", ")
                );
                let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                    values.iter().map(|v| v.as_ref()).collect();
                conn.execute(&sql, param_refs.as_slice())?;
            }

            get_task_inner(conn, &id)
        })
        .await
    }

    pub async fn move_task(
        &self,
        id: &str,
        column_id: &str,
        position: i64,
    ) -> anyhow::Result<Option<Task>> {
        let id = id.to_string();
        let column_id = column_id.to_string();
        self.with_conn(move |conn| {
            let now = now_iso();
            conn.execute(
                "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                params![column_id, position, now, id],
            )?;
            get_task_inner(conn, &id)
        })
        .await
    }

    pub async fn delete_task(&self, id: &str) -> anyhow::Result<bool> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
        .await
    }
}

fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let priority_str: String = row.get(5)?;
    Ok(Task {
        id: row.get(0)?,
        board_id: row.get(1)?,
        column_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        priority: Priority::from_str_db(&priority_str).unwrap_or(Priority::Medium),
        assignee: row.get(6)?,
        due_date: row.get(7)?,
        position: row.get(8)?,
        created_at: parse_dt(&row.get::<_, String>(9)?)?,
        updated_at: parse_dt(&row.get::<_, String>(10)?)?,
        archived: row.get::<_, i64>(11)? != 0,
    })
}

fn get_task_inner(conn: &Connection, id: &str) -> anyhow::Result<Option<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived
         FROM tasks WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_task_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

fn collect_rows(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<Task>>,
) -> anyhow::Result<Vec<Task>> {
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_label(&self, board_id: &str, name: &str, color: &str) -> anyhow::Result<Label> {
        let board_id = board_id.to_string();
        let name = name.to_string();
        let color = color.to_string();
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            conn.execute(
                "INSERT INTO labels (id, board_id, name, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, board_id, name, color, now],
            ).context("insert label")?;
            Ok(Label {
                id,
                board_id,
                name,
                color,
                created_at: Utc::now(),
            })
        })
        .await
    }

    pub async fn list_labels(&self, board_id: &str) -> anyhow::Result<Vec<Label>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, color, created_at FROM labels WHERE board_id = ?1 ORDER BY created_at",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                Ok(Label {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
        .await
    }

    pub async fn get_label(&self, id: &str) -> anyhow::Result<Option<Label>> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, color, created_at FROM labels WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], |row| {
                Ok(Label {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .await
    }

    pub async fn update_label(&self, id: &str, name: Option<&str>, color: Option<&str>) -> anyhow::Result<bool> {
        let id = id.to_string();
        let name = name.map(String::from);
        let color = color.map(String::from);
        self.with_conn(move |conn| {
            let mut sets = Vec::new();
            let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            if let Some(n) = name {
                sets.push("name = ?");
                values.push(Box::new(n));
            }
            if let Some(c) = color {
                sets.push("color = ?");
                values.push(Box::new(c));
            }
            if sets.is_empty() { return Ok(false); }
            values.push(Box::new(id));
            let sql = format!("UPDATE labels SET {} WHERE id = ?", sets.join(", "));
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
            let affected = conn.execute(&sql, param_refs.as_slice())?;
            Ok(affected > 0)
        })
        .await
    }

    pub async fn delete_label(&self, id: &str) -> anyhow::Result<bool> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute("DELETE FROM labels WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
        .await
    }

    pub async fn add_task_label(&self, task_id: &str, label_id: &str) -> anyhow::Result<()> {
        let task_id = task_id.to_string();
        let label_id = label_id.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
                params![task_id, label_id],
            ).context("add task label")?;
            Ok(())
        })
        .await
    }

    pub async fn remove_task_label(&self, task_id: &str, label_id: &str) -> anyhow::Result<bool> {
        let task_id = task_id.to_string();
        let label_id = label_id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute(
                "DELETE FROM task_labels WHERE task_id = ?1 AND label_id = ?2",
                params![task_id, label_id],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    pub async fn get_task_labels(&self, task_id: &str) -> anyhow::Result<Vec<Label>> {
        let task_id = task_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT l.id, l.board_id, l.name, l.color, l.created_at
                 FROM labels l
                 INNER JOIN task_labels tl ON tl.label_id = l.id
                 WHERE tl.task_id = ?1
                 ORDER BY l.name",
            )?;
            let rows = stmt.query_map(params![task_id], |row| {
                Ok(Label {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
        .await
    }

    /// Batch load labels for all tasks in a board (avoids N+1).
    pub async fn get_labels_for_board_tasks(&self, board_id: &str) -> anyhow::Result<Vec<(String, Label)>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT tl.task_id, l.id, l.board_id, l.name, l.color, l.created_at
                 FROM task_labels tl
                 INNER JOIN labels l ON l.id = tl.label_id
                 WHERE l.board_id = ?1
                 ORDER BY l.name",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                let task_id: String = row.get(0)?;
                let label = Label {
                    id: row.get(1)?,
                    board_id: row.get(2)?,
                    name: row.get(3)?,
                    color: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                };
                Ok((task_id, label))
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_subtask(&self, task_id: &str, title: &str) -> anyhow::Result<Subtask> {
        let task_id = task_id.to_string();
        let title = title.to_string();
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            let position: i32 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM subtasks WHERE task_id = ?1",
                    params![task_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO subtasks (id, task_id, title, completed, position, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
                params![id, task_id, title, position, now],
            ).context("insert subtask")?;
            Ok(Subtask {
                id,
                task_id,
                title,
                completed: false,
                position,
                created_at: Utc::now(),
            })
        })
        .await
    }

    pub async fn list_subtasks(&self, task_id: &str) -> anyhow::Result<Vec<Subtask>> {
        let task_id = task_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, title, completed, position, created_at FROM subtasks WHERE task_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![task_id], |row| {
                Ok(Subtask {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i32>(3)? != 0,
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
        .await
    }

    pub async fn get_subtask(&self, id: &str) -> anyhow::Result<Option<Subtask>> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, title, completed, position, created_at FROM subtasks WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], |row| {
                Ok(Subtask {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i32>(3)? != 0,
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .await
    }

    pub async fn update_subtask(
        &self,
        id: &str,
        title: Option<&str>,
        completed: Option<bool>,
        position: Option<i32>,
    ) -> anyhow::Result<Option<Subtask>> {
        let id = id.to_string();
        let title = title.map(String::from);
        self.with_conn(move |conn| {
            let mut sets = Vec::new();
            let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            if let Some(t) = title {
                sets.push("title = ?");
                values.push(Box::new(t));
            }
            if let Some(c) = completed {
                sets.push("completed = ?");
                values.push(Box::new(c as i32));
            }
            if let Some(p) = position {
                sets.push("position = ?");
                values.push(Box::new(p));
            }
            if !sets.is_empty() {
                values.push(Box::new(id.clone()));
                let sql = format!("UPDATE subtasks SET {} WHERE id = ?", sets.join(", "));
                let param_refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
                conn.execute(&sql, param_refs.as_slice())?;
            }
            // Return updated subtask
            let mut stmt = conn.prepare(
                "SELECT id, task_id, title, completed, position, created_at FROM subtasks WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], |row| {
                Ok(Subtask {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i32>(3)? != 0,
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .await
    }

    pub async fn delete_subtask(&self, id: &str) -> anyhow::Result<bool> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute("DELETE FROM subtasks WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
        .await
    }

    /// Get subtask counts for all tasks in a board (avoids N+1).
    pub async fn get_subtask_counts_for_board(&self, board_id: &str) -> anyhow::Result<Vec<(String, SubtaskCount)>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT s.task_id, COUNT(*) as total, SUM(s.completed) as done
                 FROM subtasks s
                 INNER JOIN tasks t ON t.id = s.task_id
                 WHERE t.board_id = ?1
                 GROUP BY s.task_id",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                let task_id: String = row.get(0)?;
                let total: i32 = row.get(1)?;
                let completed: i32 = row.get(2)?;
                Ok((task_id, SubtaskCount { completed, total }))
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Custom Fields
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_custom_field(
        &self,
        board_id: &str,
        name: &str,
        field_type: FieldType,
        config: Option<&str>,
    ) -> anyhow::Result<CustomField> {
        let board_id = board_id.to_string();
        let name = name.to_string();
        let config = config.map(String::from);
        self.with_conn(move |conn| {
            let id = new_id();
            let pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM custom_fields WHERE board_id = ?1",
                    params![board_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO custom_fields (id, board_id, name, field_type, config, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, board_id, name, field_type.as_str(), config, pos],
            )
            .context("insert custom_field")?;
            Ok(CustomField {
                id,
                board_id,
                name,
                field_type,
                config,
                position: pos,
            })
        })
        .await
    }

    pub async fn list_custom_fields(&self, board_id: &str) -> anyhow::Result<Vec<CustomField>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, field_type, config, position
                 FROM custom_fields WHERE board_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                let ft_str: String = row.get(3)?;
                Ok(CustomField {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    field_type: FieldType::from_str_db(&ft_str).unwrap_or(FieldType::Text),
                    config: row.get(4)?,
                    position: row.get(5)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn set_custom_field_value(
        &self,
        task_id: &str,
        field_id: &str,
        value: &str,
    ) -> anyhow::Result<TaskCustomFieldValue> {
        let task_id = task_id.to_string();
        let field_id = field_id.to_string();
        let value = value.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO task_custom_field_values (task_id, field_id, value)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(task_id, field_id) DO UPDATE SET value = excluded.value",
                params![task_id, field_id, value],
            )
            .context("upsert custom field value")?;
            Ok(TaskCustomFieldValue {
                task_id,
                field_id,
                value,
            })
        })
        .await
    }

    pub async fn get_custom_field_values(
        &self,
        task_id: &str,
    ) -> anyhow::Result<Vec<TaskCustomFieldValue>> {
        let task_id = task_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT task_id, field_id, value
                 FROM task_custom_field_values WHERE task_id = ?1",
            )?;
            let rows = stmt.query_map(params![task_id], |row| {
                Ok(TaskCustomFieldValue {
                    task_id: row.get(0)?,
                    field_id: row.get(1)?,
                    value: row.get(2)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await
    }

    /// Batch-load all custom field values for every task in a board (avoids N+1).
    pub async fn get_custom_field_values_for_board(
        &self,
        board_id: &str,
    ) -> anyhow::Result<Vec<TaskCustomFieldValue>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT tcfv.task_id, tcfv.field_id, tcfv.value
                 FROM task_custom_field_values tcfv
                 JOIN tasks t ON t.id = tcfv.task_id
                 WHERE t.board_id = ?1",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                Ok(TaskCustomFieldValue {
                    task_id: row.get(0)?,
                    field_id: row.get(1)?,
                    value: row.get(2)?,
                })
            })?;
            let mut result = Vec::new();
            for r in rows {
                result.push(r?);
            }
            Ok(result)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

impl Db {
    /// Get or create the "Local User" for no-auth development mode.
    #[allow(dead_code)]
    pub async fn get_or_create_local_user(&self) -> anyhow::Result<User> {
        self.with_conn(move |conn| {
            // Try to find the first non-agent user
            let existing = conn.query_row(
                "SELECT id, name, email, avatar_url, is_agent, created_at
                 FROM users WHERE is_agent = 0 ORDER BY created_at LIMIT 1",
                [],
                |row| {
                    let is_agent: i64 = row.get(4)?;
                    Ok(User {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        avatar_url: row.get(3)?,
                        is_agent: is_agent != 0,
                        created_at: parse_dt(&row.get::<_, String>(5)?)?,
                    })
                },
            );
            match existing {
                Ok(user) => Ok(user),
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    // No user exists — create one
                    let id = new_id();
                    let now = now_iso();
                    conn.execute(
                        "INSERT INTO users (id, name, email, avatar_url, is_agent, created_at)
                         VALUES (?1, ?2, ?3, NULL, 0, ?4)",
                        params![id, "Local User", "local@localhost", now],
                    ).context("insert local user")?;
                    Ok(User {
                        id,
                        name: "Local User".to_string(),
                        email: "local@localhost".to_string(),
                        avatar_url: None,
                        is_agent: false,
                        created_at: Utc::now(),
                    })
                }
                Err(e) => Err(e.into()),
            }
        })
        .await
    }

    pub async fn create_user(
        &self,
        name: &str,
        email: &str,
        avatar_url: Option<&str>,
        is_agent: bool,
        password_hash: Option<&str>,
    ) -> anyhow::Result<User> {
        let name = name.to_string();
        let email = email.to_string();
        let avatar_url = avatar_url.map(String::from);
        let password_hash = password_hash.map(String::from);
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            conn.execute(
                "INSERT INTO users (id, name, email, avatar_url, is_agent, password_hash, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, name, email, avatar_url, is_agent as i64, password_hash, now],
            )
            .context("insert user")?;
            Ok(User {
                id,
                name,
                email,
                avatar_url,
                is_agent,
                created_at: Utc::now(),
            })
        })
        .await
    }

    #[allow(dead_code)]
    pub async fn get_user_by_id(&self, id: &str) -> anyhow::Result<Option<User>> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, email, avatar_url, is_agent, created_at
                 FROM users WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], |row| {
                let is_agent: i64 = row.get(4)?;
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    avatar_url: row.get(3)?,
                    is_agent: is_agent != 0,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .await
    }

    pub async fn get_password_hash(&self, user_id: &str) -> anyhow::Result<Option<String>> {
        let user_id = user_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT password_hash FROM users WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![user_id], |row| {
                row.get::<_, Option<String>>(0)
            })?;
            match rows.next() {
                Some(r) => Ok(r?),
                None => Ok(None),
            }
        })
        .await
    }

    pub async fn get_user_by_email(&self, email: &str) -> anyhow::Result<Option<User>> {
        let email = email.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, email, avatar_url, is_agent, created_at
                 FROM users WHERE email = ?1",
            )?;
            let mut rows = stmt.query_map(params![email], |row| {
                let is_agent: i64 = row.get(4)?;
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    avatar_url: row.get(3)?,
                    is_agent: is_agent != 0,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_comment(
        &self,
        task_id: &str,
        user_id: &str,
        content: &str,
    ) -> anyhow::Result<Comment> {
        let task_id = task_id.to_string();
        let user_id = user_id.to_string();
        let content = content.to_string();
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            conn.execute(
                "INSERT INTO comments (id, task_id, user_id, content, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, task_id, user_id, content, now],
            )
            .context("insert comment")?;
            // Look up user name for the response
            let user_name: Option<String> = conn
                .query_row("SELECT name FROM users WHERE id = ?1", params![user_id], |r| r.get(0))
                .ok();
            Ok(Comment {
                id,
                task_id,
                user_id,
                user_name,
                content,
                created_at: Utc::now(),
                updated_at: None,
            })
        })
        .await
    }

    pub async fn list_comments(&self, task_id: &str) -> anyhow::Result<Vec<Comment>> {
        let task_id = task_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
                 FROM comments c
                 LEFT JOIN users u ON u.id = c.user_id
                 WHERE c.task_id = ?1 ORDER BY c.created_at",
            )?;
            let rows = stmt.query_map(params![task_id], |row| {
                Ok(Comment {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    user_id: row.get(2)?,
                    content: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                    user_name: row.get(5)?,
                    updated_at: row.get::<_, Option<String>>(6)?
                        .as_deref()
                        .map(parse_dt)
                        .transpose()?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn get_comment(&self, comment_id: &str) -> anyhow::Result<Option<Comment>> {
        let comment_id = comment_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
                 FROM comments c
                 LEFT JOIN users u ON u.id = c.user_id
                 WHERE c.id = ?1",
            )?;
            let comment = stmt
                .query_row(params![comment_id], |row| {
                    Ok(Comment {
                        id: row.get(0)?,
                        task_id: row.get(1)?,
                        user_id: row.get(2)?,
                        content: row.get(3)?,
                        created_at: parse_dt(&row.get::<_, String>(4)?)?,
                        user_name: row.get(5)?,
                        updated_at: row.get::<_, Option<String>>(6)?
                            .as_deref()
                            .map(parse_dt)
                            .transpose()?,
                    })
                })
                .optional()?;
            Ok(comment)
        })
        .await
    }

    pub async fn update_comment(&self, comment_id: &str, content: &str) -> anyhow::Result<Option<Comment>> {
        let comment_id = comment_id.to_string();
        let content = content.to_string();
        self.with_conn(move |conn| {
            let now = now_iso();
            let rows = conn.execute(
                "UPDATE comments SET content = ?1, updated_at = ?2 WHERE id = ?3",
                params![content, now, comment_id],
            )?;
            if rows == 0 {
                return Ok(None);
            }
            let mut stmt = conn.prepare(
                "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
                 FROM comments c
                 LEFT JOIN users u ON u.id = c.user_id
                 WHERE c.id = ?1",
            )?;
            let comment = stmt
                .query_row(params![comment_id], |row| {
                    Ok(Comment {
                        id: row.get(0)?,
                        task_id: row.get(1)?,
                        user_id: row.get(2)?,
                        content: row.get(3)?,
                        created_at: parse_dt(&row.get::<_, String>(4)?)?,
                        user_name: row.get(5)?,
                        updated_at: row.get::<_, Option<String>>(6)?
                            .as_deref()
                            .map(parse_dt)
                            .transpose()?,
                    })
                })
                .optional()?;
            Ok(comment)
        })
        .await
    }

    pub async fn delete_comment(&self, comment_id: &str) -> anyhow::Result<bool> {
        let comment_id = comment_id.to_string();
        self.with_conn(move |conn| {
            let rows = conn.execute(
                "DELETE FROM comments WHERE id = ?1",
                params![comment_id],
            )?;
            Ok(rows > 0)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

impl Db {
    pub async fn create_api_key(
        &self,
        user_id: &str,
        name: &str,
        key_hash: &str,
        key_prefix: &str,
    ) -> anyhow::Result<ApiKey> {
        let user_id = user_id.to_string();
        let name = name.to_string();
        let key_hash = key_hash.to_string();
        let key_prefix = key_prefix.to_string();
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            conn.execute(
                "INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, user_id, name, key_hash, key_prefix, now],
            )
            .context("insert api_key")?;
            Ok(ApiKey {
                id,
                user_id,
                name,
                key_prefix,
                created_at: Utc::now(),
                last_used_at: None,
            })
        })
        .await
    }

    pub async fn list_api_keys(&self, user_id: &str) -> anyhow::Result<Vec<ApiKey>> {
        let user_id = user_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, user_id, name, key_prefix, created_at, last_used_at
                 FROM api_keys WHERE user_id = ?1 ORDER BY created_at",
            )?;
            let rows = stmt.query_map(params![user_id], |row| {
                Ok(ApiKey {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    name: row.get(2)?,
                    key_prefix: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                    last_used_at: row
                        .get::<_, Option<String>>(5)?
                        .map(|s| parse_dt(&s)).transpose()?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn delete_api_key(&self, id: &str, user_id: &str) -> anyhow::Result<bool> {
        let id = id.to_string();
        let user_id = user_id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute(
                "DELETE FROM api_keys WHERE id = ?1 AND user_id = ?2",
                params![id, user_id],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    pub async fn validate_api_key(&self, key_hash: &str) -> anyhow::Result<User> {
        let key_hash = key_hash.to_string();
        self.with_conn(move |conn| {
            let now = now_iso();
            conn.execute(
                "UPDATE api_keys SET last_used_at = ?1 WHERE key_hash = ?2",
                params![now, key_hash],
            )?;
            let mut stmt = conn.prepare(
                "SELECT u.id, u.name, u.email, u.avatar_url, u.is_agent, u.created_at
                 FROM api_keys ak
                 JOIN users u ON u.id = ak.user_id
                 WHERE ak.key_hash = ?1",
            )?;
            let mut rows = stmt.query_map(params![key_hash], |row| {
                let is_agent: i64 = row.get(4)?;
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    avatar_url: row.get(3)?,
                    is_agent: is_agent != 0,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(r?),
                None => Err(anyhow::anyhow!("invalid API key")),
            }
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Board Members
// ---------------------------------------------------------------------------

impl Db {
    pub async fn get_board_member(&self, board_id: &str, user_id: &str) -> anyhow::Result<Option<Role>> {
        let board_id = board_id.to_string();
        let user_id = user_id.to_string();
        self.with_conn(move |conn| {
            let result = conn.query_row(
                "SELECT role FROM board_members WHERE board_id = ?1 AND user_id = ?2",
                params![board_id, user_id],
                |row| {
                    let role_str: String = row.get(0)?;
                    Ok(role_str)
                },
            );
            match result {
                Ok(role_str) => Ok(Role::from_str_db(&role_str)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(e.into()),
            }
        })
        .await
    }

    pub async fn add_board_member(&self, board_id: &str, user_id: &str, role: Role) -> anyhow::Result<()> {
        let board_id = board_id.to_string();
        let user_id = user_id.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO board_members (board_id, user_id, role)
                 VALUES (?1, ?2, ?3)",
                params![board_id, user_id, role.as_str()],
            )
            .context("insert board_member")?;
            Ok(())
        })
        .await
    }

    pub async fn list_board_members(&self, board_id: &str) -> anyhow::Result<Vec<(User, Role)>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT u.id, u.name, u.email, u.avatar_url, u.is_agent, u.created_at, bm.role
                 FROM board_members bm
                 JOIN users u ON u.id = bm.user_id
                 WHERE bm.board_id = ?1
                 ORDER BY u.name",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                let role_str: String = row.get(6)?;
                Ok((
                    User {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        avatar_url: row.get(3)?,
                        is_agent: row.get(4)?,
                        created_at: parse_dt(&row.get::<_, String>(5)?)?,
                    },
                    Role::from_str_db(&role_str).unwrap_or(Role::Viewer),
                ))
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
        .await
    }

    pub async fn list_user_boards(&self, user_id: &str) -> anyhow::Result<Vec<Board>> {
        let user_id = user_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT b.id, b.name, b.description, b.created_at, b.updated_at
                 FROM boards b
                 JOIN board_members bm ON bm.board_id = b.id
                 WHERE bm.user_id = ?1
                 ORDER BY b.created_at",
            )?;
            let rows = stmt.query_map(params![user_id], |row| {
                Ok(Board {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    created_at: parse_dt(&row.get::<_, String>(3)?)?,
                    updated_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

impl Db {
    pub async fn log_activity(
        &self,
        board_id: &str,
        task_id: Option<&str>,
        user_id: &str,
        action: &str,
        details: Option<&str>,
    ) -> anyhow::Result<Activity> {
        let board_id = board_id.to_string();
        let task_id = task_id.map(String::from);
        let user_id = user_id.to_string();
        let action = action.to_string();
        let details = details.map(String::from);
        self.with_conn(move |conn| {
            let id = new_id();
            let now = now_iso();
            conn.execute(
                "INSERT INTO activity (id, board_id, task_id, user_id, action, details, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, board_id, task_id, user_id, action, details, now],
            )
            .context("insert activity")?;
            Ok(Activity {
                id,
                board_id,
                task_id,
                user_id,
                action,
                details,
                created_at: Utc::now(),
            })
        })
        .await
    }
}

impl Db {
    pub async fn list_activity(
        &self,
        board_id: &str,
        action_filter: Option<&str>,
        user_filter: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ActivityEntry>> {
        let board_id = board_id.to_string();
        let action_filter = action_filter.map(String::from);
        let user_filter = user_filter.map(String::from);
        self.with_conn(move |conn| {
            let mut sql = String::from(
                "SELECT a.id, a.board_id, a.task_id, a.user_id, COALESCE(u.name, 'Unknown') as user_name,
                        COALESCE(u.is_agent, 0) as is_agent,
                        a.action, a.details, a.created_at
                 FROM activity a
                 LEFT JOIN users u ON u.id = a.user_id
                 WHERE a.board_id = ?1",
            );
            let mut param_idx = 2;
            if action_filter.is_some() {
                sql.push_str(&format!(" AND a.action = ?{param_idx}"));
                param_idx += 1;
            }
            if user_filter.is_some() {
                sql.push_str(&format!(" AND a.user_id = ?{param_idx}"));
                param_idx += 1;
            }
            sql.push_str(&format!(
                " ORDER BY a.created_at DESC LIMIT ?{} OFFSET ?{}",
                param_idx,
                param_idx + 1
            ));

            let mut stmt = conn.prepare(&sql)?;

            let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
                Box::new(board_id),
            ];
            if let Some(action) = action_filter {
                params_vec.push(Box::new(action));
            }
            if let Some(uid) = user_filter {
                params_vec.push(Box::new(uid));
            }
            params_vec.push(Box::new(limit));
            params_vec.push(Box::new(offset));

            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params_vec.iter().map(|p| p.as_ref()).collect();

            let rows = stmt.query_map(param_refs.as_slice(), |row| {
                Ok(ActivityEntry {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    task_id: row.get(2)?,
                    user_id: row.get(3)?,
                    user_name: row.get(4)?,
                    is_agent: row.get::<_, i64>(5)? != 0,
                    action: row.get(6)?,
                    details: row.get(7)?,
                    created_at: parse_dt(&row.get::<_, String>(8)?)?,
                })
            })?;
            let mut result = Vec::new();
            for r in rows {
                result.push(r?);
            }
            Ok(result)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

impl Db {
    /// Full-text search across tasks, comments, and subtasks for a board.
    pub async fn search_board(
        &self,
        board_id: &str,
        query: &str,
        limit: i64,
        include_archived: bool,
    ) -> anyhow::Result<Vec<SearchResult>> {
        let board_id = board_id.to_string();
        let query = query.to_string();
        self.with_conn(move |conn| {
            let archive_filter = if include_archived {
                ""
            } else {
                " AND task_id IN (SELECT id FROM tasks WHERE archived = 0)"
            };
            let sql = format!(
                "SELECT entity_type, entity_id, board_id, task_id,
                        snippet(search_index, 4, '<mark>', '</mark>', '...', 32) as snippet,
                        rank,
                        COALESCE((SELECT archived FROM tasks WHERE id = task_id), 0) as archived
                 FROM search_index
                 WHERE search_index MATCH ?1 AND board_id = ?2{archive_filter}
                 ORDER BY rank
                 LIMIT ?3"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![query, board_id, limit], |row| {
                Ok(SearchResult {
                    entity_type: row.get(0)?,
                    entity_id: row.get(1)?,
                    board_id: row.get(2)?,
                    task_id: row.get(3)?,
                    snippet: sanitize_snippet(&row.get::<_, String>(4)?),
                    rank: row.get(5)?,
                    archived: row.get::<_, i64>(6)? != 0,
                })
            })?;
            let mut result = Vec::new();
            for r in rows {
                result.push(r?);
            }
            Ok(result)
        })
        .await
    }
}

/// Sanitize an FTS5 snippet: escape all HTML except `<mark>` and `</mark>`.
fn sanitize_snippet(raw: &str) -> String {
    // 1. Replace our known markers with placeholders
    let s = raw
        .replace("<mark>", "\x00MARK_OPEN\x00")
        .replace("</mark>", "\x00MARK_CLOSE\x00");
    // 2. Escape all remaining HTML
    let s = s
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    // 3. Restore markers
    s.replace("\x00MARK_OPEN\x00", "<mark>")
        .replace("\x00MARK_CLOSE\x00", "</mark>")
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

impl Db {
    pub async fn archive_task(&self, task_id: &str) -> anyhow::Result<bool> {
        let task_id = task_id.to_string();
        self.with_conn(move |conn| {
            let updated = conn.execute(
                "UPDATE tasks SET archived = 1, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![task_id, now_iso()],
            )?;
            Ok(updated > 0)
        })
        .await
    }

    pub async fn unarchive_task(&self, task_id: &str) -> anyhow::Result<bool> {
        let task_id = task_id.to_string();
        self.with_conn(move |conn| {
            let col_archived: bool = conn.query_row(
                "SELECT c.archived FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ?1",
                rusqlite::params![task_id],
                |row| Ok(row.get::<_, i64>(0)? != 0),
            ).unwrap_or(false);

            if col_archived {
                let board_id: String = conn.query_row(
                    "SELECT board_id FROM tasks WHERE id = ?1",
                    rusqlite::params![task_id],
                    |row| row.get(0),
                )?;
                let first_col: Option<String> = conn.query_row(
                    "SELECT id FROM columns WHERE board_id = ?1 AND archived = 0 ORDER BY position ASC LIMIT 1",
                    rusqlite::params![board_id],
                    |row| row.get(0),
                ).ok();
                if let Some(col_id) = first_col {
                    conn.execute(
                        "UPDATE tasks SET column_id = ?2 WHERE id = ?1",
                        rusqlite::params![task_id, col_id],
                    )?;
                }
            }

            let updated = conn.execute(
                "UPDATE tasks SET archived = 0, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![task_id, now_iso()],
            )?;
            Ok(updated > 0)
        })
        .await
    }

    pub async fn archive_column(&self, column_id: &str) -> anyhow::Result<i64> {
        let column_id = column_id.to_string();
        self.with_conn(move |conn| {
            let now = now_iso();
            conn.execute(
                "UPDATE columns SET archived = 1 WHERE id = ?1",
                rusqlite::params![column_id],
            )?;
            let task_count = conn.execute(
                "UPDATE tasks SET archived = 1, updated_at = ?2 WHERE column_id = ?1",
                rusqlite::params![column_id, now],
            )?;
            Ok(task_count as i64)
        })
        .await
    }

    pub async fn unarchive_column(&self, column_id: &str) -> anyhow::Result<i64> {
        let column_id = column_id.to_string();
        self.with_conn(move |conn| {
            let now = now_iso();
            conn.execute(
                "UPDATE columns SET archived = 0 WHERE id = ?1",
                rusqlite::params![column_id],
            )?;
            let task_count = conn.execute(
                "UPDATE tasks SET archived = 0, updated_at = ?2 WHERE column_id = ?1",
                rusqlite::params![column_id, now],
            )?;
            Ok(task_count as i64)
        })
        .await
    }

    pub async fn list_archived(&self, board_id: &str) -> anyhow::Result<(Vec<Task>, Vec<Column>)> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived
                 FROM tasks WHERE board_id = ?1 AND archived = 1 ORDER BY updated_at DESC"
            )?;
            let rows = stmt.query_map(params![board_id], map_task_row)?;
            let tasks = collect_rows(rows)?;

            let mut cstmt = conn.prepare(
                "SELECT id, board_id, name, position, wip_limit, color, archived
                 FROM columns WHERE board_id = ?1 AND archived = 1 ORDER BY position"
            )?;
            let crows = cstmt.query_map(params![board_id], |row| {
                Ok(Column {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    position: row.get(3)?,
                    wip_limit: row.get(4)?,
                    color: row.get(5)?,
                    archived: row.get::<_, i64>(6)? != 0,
                })
            })?;
            let mut columns = Vec::new();
            for r in crows { columns.push(r?); }

            Ok((tasks, columns))
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

impl Db {
    #[allow(clippy::too_many_arguments)]
    pub async fn create_attachment(&self, id: &str, task_id: &str, board_id: &str,
        filename: &str, mime_type: &str, size_bytes: i64, storage_key: &str,
        uploaded_by: Option<&str>) -> anyhow::Result<Attachment> {
        let id = id.to_string();
        let task_id = task_id.to_string();
        let board_id = board_id.to_string();
        let filename = filename.to_string();
        let mime_type = mime_type.to_string();
        let storage_key = storage_key.to_string();
        let uploaded_by = uploaded_by.map(String::from);
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO attachments (id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by],
            )?;
            let att = conn.query_row(
                "SELECT id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at
                 FROM attachments WHERE id = ?1",
                params![id],
                |row| Ok(Attachment {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    board_id: row.get(2)?,
                    filename: row.get(3)?,
                    mime_type: row.get(4)?,
                    size_bytes: row.get(5)?,
                    storage_key: row.get(6)?,
                    uploaded_by: row.get(7)?,
                    created_at: parse_dt(&row.get::<_, String>(8)?)?,
                }),
            )?;
            Ok(att)
        })
        .await
    }

    pub async fn list_attachments(&self, task_id: &str) -> anyhow::Result<Vec<Attachment>> {
        let task_id = task_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at
                 FROM attachments WHERE task_id = ?1 ORDER BY created_at DESC"
            )?;
            let rows = stmt.query_map(params![task_id], |row| {
                Ok(Attachment {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    board_id: row.get(2)?,
                    filename: row.get(3)?,
                    mime_type: row.get(4)?,
                    size_bytes: row.get(5)?,
                    storage_key: row.get(6)?,
                    uploaded_by: row.get(7)?,
                    created_at: parse_dt(&row.get::<_, String>(8)?)?,
                })
            })?;
            let mut result = Vec::new();
            for r in rows { result.push(r?); }
            Ok(result)
        })
        .await
    }

    pub async fn get_attachment(&self, attachment_id: &str) -> anyhow::Result<Option<Attachment>> {
        let attachment_id = attachment_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at
                 FROM attachments WHERE id = ?1"
            )?;
            let mut rows = stmt.query_map(params![attachment_id], |row| {
                Ok(Attachment {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    board_id: row.get(2)?,
                    filename: row.get(3)?,
                    mime_type: row.get(4)?,
                    size_bytes: row.get(5)?,
                    storage_key: row.get(6)?,
                    uploaded_by: row.get(7)?,
                    created_at: parse_dt(&row.get::<_, String>(8)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .await
    }

    pub async fn delete_attachment(&self, attachment_id: &str) -> anyhow::Result<bool> {
        let attachment_id = attachment_id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute(
                "DELETE FROM attachments WHERE id = ?1",
                params![attachment_id],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    pub async fn get_attachment_counts_for_board(&self, board_id: &str) -> anyhow::Result<Vec<(String, i32)>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT task_id, COUNT(*) as cnt FROM attachments
                 WHERE board_id = ?1
                 GROUP BY task_id"
            )?;
            let rows = stmt.query_map(rusqlite::params![board_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            })?;
            let mut result = Vec::new();
            for r in rows { result.push(r?); }
            Ok(result)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

impl Db {
    /// Update the password hash for a user.
    pub async fn set_password_hash(&self, user_id: &str, password_hash: &str) -> anyhow::Result<bool> {
        let user_id = user_id.to_string();
        let password_hash = password_hash.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute(
                "UPDATE users SET password_hash = ?1 WHERE id = ?2",
                params![password_hash, user_id],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    /// Delete all sessions for a user (e.g. after password reset).
    pub async fn delete_user_sessions(&self, user_id: &str) -> anyhow::Result<usize> {
        let user_id = user_id.to_string();
        self.with_conn(move |conn| {
            let affected = conn.execute(
                "DELETE FROM sessions WHERE user_id = ?1",
                params![user_id],
            )?;
            Ok(affected)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Session cleanup
// ---------------------------------------------------------------------------

impl Db {
    /// Delete all sessions that have expired. Returns the number of deleted rows.
    pub async fn cleanup_expired_sessions(&self) -> anyhow::Result<usize> {
        let now = chrono::Utc::now().to_rfc3339();
        self.with_conn(move |conn| {
            let count = conn.execute(
                "DELETE FROM sessions WHERE expires_at <= ?1",
                rusqlite::params![now],
            )?;
            Ok(count)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// CRDT state persistence
// ---------------------------------------------------------------------------

impl Db {
    /// Save the encoded Y.Doc state for a board.
    pub async fn save_crdt_state(&self, board_id: &str, state: &[u8]) -> anyhow::Result<()> {
        let board_id = board_id.to_string();
        let state = state.to_vec();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO board_crdt_state (board_id, state, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(board_id) DO UPDATE SET state = ?2, updated_at = ?3",
                params![board_id, state, now_iso()],
            )
            .context("save crdt state")?;
            Ok(())
        })
        .await
    }

    /// Load the stored Y.Doc state for a board, if any.
    pub async fn load_crdt_state(&self, board_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT state FROM board_crdt_state WHERE board_id = ?1",
            )?;
            let mut rows = stmt.query_map(params![board_id], |row| {
                row.get::<_, Vec<u8>>(0)
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

impl Db {
    pub async fn list_users(&self) -> anyhow::Result<Vec<User>> {
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, email, avatar_url, is_agent, created_at
                 FROM users ORDER BY created_at",
            )?;
            let rows = stmt.query_map([], |row| {
                let is_agent: i64 = row.get(4)?;
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    avatar_url: row.get(3)?,
                    is_agent: is_agent != 0,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            let mut users = Vec::new();
            for r in rows {
                users.push(r?);
            }
            Ok(users)
        })
        .await
    }

    pub async fn get_all_columns_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Column>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, position, wip_limit, color, archived
                 FROM columns WHERE board_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                Ok(Column {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    position: row.get(3)?,
                    wip_limit: row.get(4)?,
                    color: row.get(5)?,
                    archived: row.get::<_, i64>(6)? != 0,
                })
            })?;
            let mut cols = Vec::new();
            for r in rows {
                cols.push(r?);
            }
            Ok(cols)
        })
        .await
    }

    pub async fn get_all_tasks_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Task>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority,
                        assignee, due_date, position, created_at, updated_at, archived
                 FROM tasks WHERE board_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![board_id], map_task_row)?;
            collect_rows(rows)
        })
        .await
    }

    pub async fn get_comments_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Comment>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
                 FROM comments c
                 JOIN tasks t ON t.id = c.task_id
                 LEFT JOIN users u ON u.id = c.user_id
                 WHERE t.board_id = ?1
                 ORDER BY c.created_at",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                Ok(Comment {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    user_id: row.get(2)?,
                    content: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                    user_name: row.get(5)?,
                    updated_at: row.get::<_, Option<String>>(6)?
                        .as_deref()
                        .map(parse_dt)
                        .transpose()?,
                })
            })?;
            let mut comments = Vec::new();
            for r in rows {
                comments.push(r?);
            }
            Ok(comments)
        })
        .await
    }

    pub async fn get_subtasks_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Subtask>> {
        let board_id = board_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT s.id, s.task_id, s.title, s.completed, s.position, s.created_at
                 FROM subtasks s
                 JOIN tasks t ON t.id = s.task_id
                 WHERE t.board_id = ?1
                 ORDER BY s.position",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                Ok(Subtask {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i32>(3)? != 0,
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            let mut subtasks = Vec::new();
            for r in rows {
                subtasks.push(r?);
            }
            Ok(subtasks)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> Db {
        Db::in_memory().await.expect("in-memory db")
    }

    /// Helper: create a board, a user, a column, and return their IDs.
    async fn seed(db: &Db) -> (String, String, String) {
        let board = db.create_board("Test Board", Some("desc")).await.unwrap();
        let user = db
            .create_user("Alice", "alice@example.com", None, false, None)
            .await
            .unwrap();
        let col = db
            .create_column(&board.id, "To Do", None, None)
            .await
            .unwrap();
        (board.id, user.id, col.id)
    }

    // ----- Boards ----------------------------------------------------------

    #[tokio::test]
    async fn test_board_crud() {
        let db = test_db().await;

        // Create
        let board = db.create_board("My Board", Some("A board")).await.unwrap();
        assert_eq!(board.name, "My Board");
        assert_eq!(board.description.as_deref(), Some("A board"));

        // Read
        let fetched = db.get_board(&board.id).await.unwrap().expect("board exists");
        assert_eq!(fetched.name, "My Board");

        // List
        let boards = db.list_boards().await.unwrap();
        assert_eq!(boards.len(), 1);

        // Update
        let updated = db
            .update_board(&board.id, Some("Renamed"), None)
            .await
            .unwrap()
            .expect("board exists");
        assert_eq!(updated.name, "Renamed");

        // Delete
        assert!(db.delete_board(&board.id).await.unwrap());
        assert!(db.get_board(&board.id).await.unwrap().is_none());
    }

    // ----- Columns ---------------------------------------------------------

    #[tokio::test]
    async fn test_column_crud() {
        let db = test_db().await;
        let board = db.create_board("B", None).await.unwrap();

        // Auto-incrementing positions
        let c1 = db.create_column(&board.id, "To Do", None, None).await.unwrap();
        let c2 = db
            .create_column(&board.id, "In Progress", Some(3), Some("#00f"))
            .await
            .unwrap();
        let c3 = db.create_column(&board.id, "Done", None, None).await.unwrap();

        assert_eq!(c1.position, 0);
        assert_eq!(c2.position, 1);
        assert_eq!(c3.position, 2);
        assert_eq!(c2.wip_limit, Some(3));
        assert_eq!(c2.color.as_deref(), Some("#00f"));

        // List
        let cols = db.list_columns(&board.id).await.unwrap();
        assert_eq!(cols.len(), 3);

        // Update
        assert!(db.update_column(&c1.id, Some("Backlog"), None, None).await.unwrap());

        // Move
        assert!(db.move_column(&c3.id, 0).await.unwrap());

        // Delete
        assert!(db.delete_column(&c1.id).await.unwrap());
        assert_eq!(db.list_columns(&board.id).await.unwrap().len(), 2);
    }

    // ----- Tasks -----------------------------------------------------------

    #[tokio::test]
    async fn test_task_crud_and_move() {
        let db = test_db().await;
        let (board_id, _user_id, col_id) = seed(&db).await;

        // Create two tasks -- positions auto-increment
        let t1 = db
            .create_task(&board_id, &col_id, "Task 1", None, Priority::Low, None)
            .await
            .unwrap();
        let t2 = db
            .create_task(
                &board_id,
                &col_id,
                "Task 2",
                Some("Details"),
                Priority::Urgent,
                Some("alice"),
            )
            .await
            .unwrap();
        assert_eq!(t1.position, 0);
        assert_eq!(t2.position, 1);
        assert_eq!(t2.priority, Priority::Urgent);

        // Get
        let fetched = db.get_task(&t1.id).await.unwrap().expect("task exists");
        assert_eq!(fetched.title, "Task 1");

        // List by board
        assert_eq!(db.list_tasks(&board_id, i64::MAX, 0).await.unwrap().len(), 2);

        // List by column
        assert_eq!(db.list_tasks_in_column(&col_id).await.unwrap().len(), 2);

        // Update
        let updated = db
            .update_task(&t1.id, Some("Task 1 Updated"), None, Some(Priority::High), None, None)
            .await
            .unwrap()
            .expect("task exists");
        assert_eq!(updated.title, "Task 1 Updated");
        assert_eq!(updated.priority, Priority::High);

        // Move to a new column
        let col2 = db
            .create_column(&board_id, "Done", None, None)
            .await
            .unwrap();
        let moved = db.move_task(&t1.id, &col2.id, 0).await.unwrap().expect("task exists");
        assert_eq!(moved.column_id, col2.id);
        assert_eq!(moved.position, 0);

        // Delete
        assert!(db.delete_task(&t2.id).await.unwrap());
        assert_eq!(db.list_tasks(&board_id, i64::MAX, 0).await.unwrap().len(), 1);
    }

    // ----- Custom fields ---------------------------------------------------

    #[tokio::test]
    async fn test_custom_fields() {
        let db = test_db().await;
        let (board_id, _user_id, col_id) = seed(&db).await;

        // Create field
        let field = db
            .create_custom_field(&board_id, "Story Points", FieldType::Number, None)
            .await
            .unwrap();
        assert_eq!(field.name, "Story Points");
        assert_eq!(field.field_type, FieldType::Number);
        assert_eq!(field.position, 0);

        // Second field auto-increments position
        let field2 = db
            .create_custom_field(
                &board_id,
                "Sprint",
                FieldType::Enum,
                Some(r#"{"options":["S1","S2"]}"#),
            )
            .await
            .unwrap();
        assert_eq!(field2.position, 1);

        // List
        let fields = db.list_custom_fields(&board_id).await.unwrap();
        assert_eq!(fields.len(), 2);

        // Set value
        let task = db
            .create_task(&board_id, &col_id, "A task", None, Priority::Medium, None)
            .await
            .unwrap();
        db.set_custom_field_value(&task.id, &field.id, "5").await.unwrap();
        db.set_custom_field_value(&task.id, &field2.id, "S1").await.unwrap();

        // Overwrite via upsert
        db.set_custom_field_value(&task.id, &field.id, "8").await.unwrap();

        // Retrieve
        let vals = db.get_custom_field_values(&task.id).await.unwrap();
        assert_eq!(vals.len(), 2);
        let sp = vals.iter().find(|v| v.field_id == field.id).unwrap();
        assert_eq!(sp.value, "8");
    }

    // ----- Board Members ---------------------------------------------------

    #[tokio::test]
    async fn test_board_member_crud() {
        let db = test_db().await;
        let board = db.create_board("B", None).await.unwrap();
        let user = db.create_user("Alice", "alice@test.com", None, false, None).await.unwrap();

        assert!(db.get_board_member(&board.id, &user.id).await.unwrap().is_none());

        db.add_board_member(&board.id, &user.id, Role::Owner).await.unwrap();
        let role = db.get_board_member(&board.id, &user.id).await.unwrap().unwrap();
        assert_eq!(role, Role::Owner);

        let boards = db.list_user_boards(&user.id).await.unwrap();
        assert_eq!(boards.len(), 1);
    }

    // ----- API Keys --------------------------------------------------------

    #[tokio::test]
    async fn test_api_key_crud() {
        let db = test_db().await;
        let user = db.create_user("Alice", "alice@example.com", None, false, None).await.unwrap();

        let key = db.create_api_key(&user.id, "My Key", "hash123", "ok_abc").await.unwrap();
        assert_eq!(key.name, "My Key");

        let keys = db.list_api_keys(&user.id).await.unwrap();
        assert_eq!(keys.len(), 1);

        let found = db.validate_api_key("hash123").await.unwrap();
        assert_eq!(found.id, user.id);

        assert!(db.delete_api_key(&key.id, &user.id).await.unwrap());
        assert_eq!(db.list_api_keys(&user.id).await.unwrap().len(), 0);
    }

    // ----- Comments --------------------------------------------------------

    #[tokio::test]
    async fn test_comments() {
        let db = test_db().await;
        let (board_id, user_id, col_id) = seed(&db).await;

        let task = db
            .create_task(&board_id, &col_id, "Commentable", None, Priority::Medium, None)
            .await
            .unwrap();

        db.create_comment(&task.id, &user_id, "First comment").await.unwrap();
        db.create_comment(&task.id, &user_id, "Second comment").await.unwrap();

        let comments = db.list_comments(&task.id).await.unwrap();
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].content, "First comment");
        assert_eq!(comments[1].content, "Second comment");
    }

    // ----- Session cleanup -------------------------------------------------

    #[tokio::test]
    async fn cleanup_expired_sessions_removes_old() {
        let db = Db::in_memory().await.unwrap();
        let user = db.create_user("test", "test@test.com", None, false, Some("hash")).await.unwrap();

        let token = crate::auth::generate_token();
        let token_hash = crate::auth::hash_token(&token);
        let expired = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        db.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![uuid::Uuid::new_v4().to_string(), user.id, token_hash, expired],
            )?;
            Ok(())
        }).await.unwrap();

        let count = db.cleanup_expired_sessions().await.unwrap();
        assert_eq!(count, 1);

        let count = db.cleanup_expired_sessions().await.unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn concurrent_reads() {
        let db = test_db().await;
        let board = db.create_board("Concurrent", None).await.unwrap();

        // Spawn 10 concurrent reads
        let mut handles = vec![];
        for _ in 0..10 {
            let db = db.clone();
            let board_id = board.id.clone();
            handles.push(tokio::spawn(async move {
                db.get_board(&board_id).await.unwrap()
            }));
        }

        for handle in handles {
            let result = handle.await.unwrap();
            assert!(result.is_some());
        }
    }

    // ----- Export helpers ---------------------------------------------------

    #[tokio::test]
    async fn list_users_returns_all() {
        let db = test_db().await;
        db.create_user("Alice", "a@test.com", None, false, Some("hash")).await.unwrap();
        db.create_user("Bob", "b@test.com", None, true, None).await.unwrap();
        let users = db.list_users().await.unwrap();
        assert_eq!(users.len(), 2);
        assert_eq!(users[0].name, "Alice");
        assert!(users[1].is_agent);
    }

    #[tokio::test]
    async fn get_all_columns_for_board_includes_archived() {
        let db = test_db().await;
        let board = db.create_board("Test", None).await.unwrap();
        db.create_column(&board.id, "Active", None, None).await.unwrap();
        let col2 = db.create_column(&board.id, "Archived", None, None).await.unwrap();
        db.archive_column(&col2.id).await.unwrap();

        // list_columns excludes archived
        let cols = db.list_columns(&board.id).await.unwrap();
        assert_eq!(cols.len(), 1);

        // get_all_columns_for_board includes archived
        let all_cols = db.get_all_columns_for_board(&board.id).await.unwrap();
        assert_eq!(all_cols.len(), 2);
    }

    #[tokio::test]
    async fn get_all_tasks_for_board_includes_archived() {
        let db = test_db().await;
        let (board_id, _user_id, col_id) = seed(&db).await;
        let task = db.create_task(&board_id, &col_id, "Task 1", None, Priority::Medium, None).await.unwrap();
        db.archive_task(&task.id).await.unwrap();
        db.create_task(&board_id, &col_id, "Task 2", None, Priority::Low, None).await.unwrap();

        let all = db.get_all_tasks_for_board(&board_id).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn get_comments_for_board_returns_all() {
        let db = test_db().await;
        let (board_id, user_id, col_id) = seed(&db).await;
        let t1 = db.create_task(&board_id, &col_id, "T1", None, Priority::Medium, None).await.unwrap();
        let t2 = db.create_task(&board_id, &col_id, "T2", None, Priority::Medium, None).await.unwrap();
        db.create_comment(&t1.id, &user_id, "Comment 1").await.unwrap();
        db.create_comment(&t2.id, &user_id, "Comment 2").await.unwrap();

        let comments = db.get_comments_for_board(&board_id).await.unwrap();
        assert_eq!(comments.len(), 2);
    }

    #[tokio::test]
    async fn get_subtasks_for_board_returns_all() {
        let db = test_db().await;
        let (board_id, _user_id, col_id) = seed(&db).await;
        let t1 = db.create_task(&board_id, &col_id, "T1", None, Priority::Medium, None).await.unwrap();
        db.create_subtask(&t1.id, "Sub 1").await.unwrap();
        db.create_subtask(&t1.id, "Sub 2").await.unwrap();

        let subtasks = db.get_subtasks_for_board(&board_id).await.unwrap();
        assert_eq!(subtasks.len(), 2);
    }
}
