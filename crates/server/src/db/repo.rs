use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection};
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

fn parse_dt(s: &str) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

impl Db {
    pub fn create_board(&self, name: &str, description: Option<&str>) -> anyhow::Result<Board> {
        self.with_conn(|conn| {
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
                name: name.to_string(),
                description: description.map(String::from),
                created_at: parse_dt(&now),
                updated_at: parse_dt(&now),
            })
        })
    }

    pub fn get_board(&self, id: &str) -> anyhow::Result<Option<Board>> {
        self.with_conn(|conn| get_board_inner(conn, id))
    }

    pub fn list_boards(&self) -> anyhow::Result<Vec<Board>> {
        self.with_conn(|conn| {
            let mut stmt =
                conn.prepare("SELECT id, name, description, created_at, updated_at FROM boards ORDER BY created_at")?;
            let rows = stmt.query_map([], |row| {
                Ok(Board {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    created_at: parse_dt(&row.get::<_, String>(3)?),
                    updated_at: parse_dt(&row.get::<_, String>(4)?),
                })
            })?;
            let mut boards = Vec::new();
            for r in rows {
                boards.push(r?);
            }
            Ok(boards)
        })
    }

    pub fn update_board(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<Option<&str>>,
    ) -> anyhow::Result<Option<Board>> {
        self.with_conn(|conn| {
            let now = now_iso();
            if let Some(n) = name {
                conn.execute(
                    "UPDATE boards SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    params![n, now, id],
                )?;
            }
            if let Some(d) = description {
                conn.execute(
                    "UPDATE boards SET description = ?1, updated_at = ?2 WHERE id = ?3",
                    params![d, now, id],
                )?;
            }
            get_board_inner(conn, id)
        })
    }

    pub fn delete_board(&self, id: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute("DELETE FROM boards WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
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
            created_at: parse_dt(&row.get::<_, String>(3)?),
            updated_at: parse_dt::<>(&row.get::<_, String>(4)?),
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
    pub fn create_column(
        &self,
        board_id: &str,
        name: &str,
        wip_limit: Option<i64>,
        color: Option<&str>,
    ) -> anyhow::Result<Column> {
        self.with_conn(|conn| {
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
                board_id: board_id.to_string(),
                name: name.to_string(),
                position: pos,
                wip_limit,
                color: color.map(String::from),
            })
        })
    }

    pub fn list_columns(&self, board_id: &str) -> anyhow::Result<Vec<Column>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, position, wip_limit, color
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
                })
            })?;
            let mut cols = Vec::new();
            for r in rows {
                cols.push(r?);
            }
            Ok(cols)
        })
    }

    pub fn update_column(
        &self,
        id: &str,
        name: Option<&str>,
        wip_limit: Option<Option<i64>>,
        color: Option<Option<&str>>,
    ) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
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
    }

    #[allow(dead_code)]
    pub fn move_column(&self, id: &str, new_position: i64) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute(
                "UPDATE columns SET position = ?1 WHERE id = ?2",
                params![new_position, id],
            )?;
            Ok(affected > 0)
        })
    }

    pub fn delete_column(&self, id: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute("DELETE FROM columns WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
    }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

impl Db {
    pub fn create_task(
        &self,
        board_id: &str,
        column_id: &str,
        title: &str,
        description: Option<&str>,
        priority: Priority,
        assignee: Option<&str>,
    ) -> anyhow::Result<Task> {
        self.with_conn(|conn| {
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
                board_id: board_id.to_string(),
                column_id: column_id.to_string(),
                title: title.to_string(),
                description: description.map(String::from),
                priority,
                assignee: assignee.map(String::from),
                position: pos,
                created_at: parse_dt(&now),
                updated_at: parse_dt(&now),
            })
        })
    }

    pub fn get_task(&self, id: &str) -> anyhow::Result<Option<Task>> {
        self.with_conn(|conn| get_task_inner(conn, id))
    }

    pub fn list_tasks(&self, board_id: &str) -> anyhow::Result<Vec<Task>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at
                 FROM tasks WHERE board_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![board_id], map_task_row)?;
            collect_rows(rows)
        })
    }

    #[allow(dead_code)]
    pub fn list_tasks_in_column(&self, column_id: &str) -> anyhow::Result<Vec<Task>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at
                 FROM tasks WHERE column_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![column_id], map_task_row)?;
            collect_rows(rows)
        })
    }

    pub fn update_task(
        &self,
        id: &str,
        title: Option<&str>,
        description: Option<Option<&str>>,
        priority: Option<Priority>,
        assignee: Option<Option<&str>>,
    ) -> anyhow::Result<Option<Task>> {
        self.with_conn(|conn| {
            let now = now_iso();
            if let Some(t) = title {
                conn.execute(
                    "UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3",
                    params![t, now, id],
                )?;
            }
            if let Some(d) = description {
                conn.execute(
                    "UPDATE tasks SET description = ?1, updated_at = ?2 WHERE id = ?3",
                    params![d, now, id],
                )?;
            }
            if let Some(p) = priority {
                conn.execute(
                    "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
                    params![p.as_str(), now, id],
                )?;
            }
            if let Some(a) = assignee {
                conn.execute(
                    "UPDATE tasks SET assignee = ?1, updated_at = ?2 WHERE id = ?3",
                    params![a, now, id],
                )?;
            }
            get_task_inner(conn, id)
        })
    }

    pub fn move_task(
        &self,
        id: &str,
        column_id: &str,
        position: i64,
    ) -> anyhow::Result<Option<Task>> {
        self.with_conn(|conn| {
            let now = now_iso();
            conn.execute(
                "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                params![column_id, position, now, id],
            )?;
            get_task_inner(conn, id)
        })
    }

    pub fn delete_task(&self, id: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
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
        position: row.get(7)?,
        created_at: parse_dt(&row.get::<_, String>(8)?),
        updated_at: parse_dt(&row.get::<_, String>(9)?),
    })
}

fn get_task_inner(conn: &Connection, id: &str) -> anyhow::Result<Option<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at
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
// Custom Fields
// ---------------------------------------------------------------------------

impl Db {
    pub fn create_custom_field(
        &self,
        board_id: &str,
        name: &str,
        field_type: FieldType,
        config: Option<&str>,
    ) -> anyhow::Result<CustomField> {
        self.with_conn(|conn| {
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
                board_id: board_id.to_string(),
                name: name.to_string(),
                field_type,
                config: config.map(String::from),
                position: pos,
            })
        })
    }

    pub fn list_custom_fields(&self, board_id: &str) -> anyhow::Result<Vec<CustomField>> {
        self.with_conn(|conn| {
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
    }

    pub fn set_custom_field_value(
        &self,
        task_id: &str,
        field_id: &str,
        value: &str,
    ) -> anyhow::Result<TaskCustomFieldValue> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO task_custom_field_values (task_id, field_id, value)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(task_id, field_id) DO UPDATE SET value = excluded.value",
                params![task_id, field_id, value],
            )
            .context("upsert custom field value")?;
            Ok(TaskCustomFieldValue {
                task_id: task_id.to_string(),
                field_id: field_id.to_string(),
                value: value.to_string(),
            })
        })
    }

    pub fn get_custom_field_values(
        &self,
        task_id: &str,
    ) -> anyhow::Result<Vec<TaskCustomFieldValue>> {
        self.with_conn(|conn| {
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
    }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

impl Db {
    /// Get or create the "Local User" for no-auth development mode.
    #[allow(dead_code)]
    pub fn get_or_create_local_user(&self) -> anyhow::Result<User> {
        self.with_conn(|conn| {
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
                        created_at: parse_dt(&row.get::<_, String>(5)?),
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
                        created_at: parse_dt(&now),
                    })
                }
                Err(e) => Err(e.into()),
            }
        })
    }

    pub fn create_user(
        &self,
        name: &str,
        email: &str,
        avatar_url: Option<&str>,
        is_agent: bool,
        password_hash: Option<&str>,
    ) -> anyhow::Result<User> {
        self.with_conn(|conn| {
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
                name: name.to_string(),
                email: email.to_string(),
                avatar_url: avatar_url.map(String::from),
                is_agent,
                created_at: parse_dt(&now),
            })
        })
    }

    #[allow(dead_code)]
    pub fn get_user_by_id(&self, id: &str) -> anyhow::Result<Option<User>> {
        self.with_conn(|conn| {
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
                    created_at: parse_dt(&row.get::<_, String>(5)?),
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
    }

    pub fn get_password_hash(&self, user_id: &str) -> anyhow::Result<Option<String>> {
        self.with_conn(|conn| {
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
    }

    pub fn get_user_by_email(&self, email: &str) -> anyhow::Result<Option<User>> {
        self.with_conn(|conn| {
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
                    created_at: parse_dt(&row.get::<_, String>(5)?),
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

impl Db {
    pub fn create_comment(
        &self,
        task_id: &str,
        user_id: &str,
        content: &str,
    ) -> anyhow::Result<Comment> {
        self.with_conn(|conn| {
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
                task_id: task_id.to_string(),
                user_id: user_id.to_string(),
                user_name,
                content: content.to_string(),
                created_at: parse_dt(&now),
            })
        })
    }

    pub fn list_comments(&self, task_id: &str) -> anyhow::Result<Vec<Comment>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name
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
                    created_at: parse_dt(&row.get::<_, String>(4)?),
                    user_name: row.get(5)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

impl Db {
    pub fn create_api_key(
        &self,
        user_id: &str,
        name: &str,
        key_hash: &str,
        key_prefix: &str,
    ) -> anyhow::Result<ApiKey> {
        self.with_conn(|conn| {
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
                user_id: user_id.to_string(),
                name: name.to_string(),
                key_prefix: key_prefix.to_string(),
                created_at: parse_dt(&now),
                last_used_at: None,
            })
        })
    }

    pub fn list_api_keys(&self, user_id: &str) -> anyhow::Result<Vec<ApiKey>> {
        self.with_conn(|conn| {
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
                    created_at: parse_dt(&row.get::<_, String>(4)?),
                    last_used_at: row
                        .get::<_, Option<String>>(5)?
                        .map(|s| parse_dt(&s)),
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn delete_api_key(&self, id: &str, user_id: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute(
                "DELETE FROM api_keys WHERE id = ?1 AND user_id = ?2",
                params![id, user_id],
            )?;
            Ok(affected > 0)
        })
    }

    pub fn validate_api_key(&self, key_hash: &str) -> anyhow::Result<User> {
        self.with_conn(|conn| {
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
                    created_at: parse_dt(&row.get::<_, String>(5)?),
                })
            })?;
            match rows.next() {
                Some(r) => Ok(r?),
                None => Err(anyhow::anyhow!("invalid API key")),
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Board Members
// ---------------------------------------------------------------------------

impl Db {
    pub fn get_board_member(&self, board_id: &str, user_id: &str) -> anyhow::Result<Option<Role>> {
        self.with_conn(|conn| {
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
    }

    pub fn add_board_member(&self, board_id: &str, user_id: &str, role: Role) -> anyhow::Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO board_members (board_id, user_id, role)
                 VALUES (?1, ?2, ?3)",
                params![board_id, user_id, role.as_str()],
            )
            .context("insert board_member")?;
            Ok(())
        })
    }

    pub fn list_board_members(&self, board_id: &str) -> anyhow::Result<Vec<(User, Role)>> {
        self.with_conn(|conn| {
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
                        created_at: parse_dt(&row.get::<_, String>(5)?),
                    },
                    Role::from_str_db(&role_str).unwrap_or(Role::Viewer),
                ))
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
    }

    pub fn list_user_boards(&self, user_id: &str) -> anyhow::Result<Vec<Board>> {
        self.with_conn(|conn| {
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
                    created_at: parse_dt(&row.get::<_, String>(3)?),
                    updated_at: parse_dt(&row.get::<_, String>(4)?),
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
    }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

impl Db {
    pub fn log_activity(
        &self,
        board_id: &str,
        task_id: Option<&str>,
        user_id: &str,
        action: &str,
        details: Option<&str>,
    ) -> anyhow::Result<Activity> {
        self.with_conn(|conn| {
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
                board_id: board_id.to_string(),
                task_id: task_id.map(String::from),
                user_id: user_id.to_string(),
                action: action.to_string(),
                details: details.map(String::from),
                created_at: parse_dt(&now),
            })
        })
    }
}

impl Db {
    pub fn list_activity(
        &self,
        board_id: &str,
        action_filter: Option<&str>,
        user_filter: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ActivityEntry>> {
        self.with_conn(|conn| {
            let mut sql = String::from(
                "SELECT a.id, a.board_id, a.task_id, a.user_id, COALESCE(u.name, 'Unknown') as user_name,
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
                Box::new(board_id.to_string()),
            ];
            if let Some(action) = action_filter {
                params_vec.push(Box::new(action.to_string()));
            }
            if let Some(uid) = user_filter {
                params_vec.push(Box::new(uid.to_string()));
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
                    action: row.get(5)?,
                    details: row.get(6)?,
                    created_at: parse_dt(&row.get::<_, String>(7)?),
                })
            })?;
            let mut result = Vec::new();
            for r in rows {
                result.push(r?);
            }
            Ok(result)
        })
    }
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

impl Db {
    /// Update the password hash for a user.
    pub fn set_password_hash(&self, user_id: &str, password_hash: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute(
                "UPDATE users SET password_hash = ?1 WHERE id = ?2",
                params![password_hash, user_id],
            )?;
            Ok(affected > 0)
        })
    }

    /// Delete all sessions for a user (e.g. after password reset).
    pub fn delete_user_sessions(&self, user_id: &str) -> anyhow::Result<usize> {
        self.with_conn(|conn| {
            let affected = conn.execute(
                "DELETE FROM sessions WHERE user_id = ?1",
                params![user_id],
            )?;
            Ok(affected)
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Db {
        Db::in_memory().expect("in-memory db")
    }

    /// Helper: create a board, a user, a column, and return their IDs.
    fn seed(db: &Db) -> (String, String, String) {
        let board = db.create_board("Test Board", Some("desc")).unwrap();
        let user = db
            .create_user("Alice", "alice@example.com", None, false, None)
            .unwrap();
        let col = db
            .create_column(&board.id, "To Do", None, None)
            .unwrap();
        (board.id, user.id, col.id)
    }

    // ----- Boards ----------------------------------------------------------

    #[test]
    fn test_board_crud() {
        let db = test_db();

        // Create
        let board = db.create_board("My Board", Some("A board")).unwrap();
        assert_eq!(board.name, "My Board");
        assert_eq!(board.description.as_deref(), Some("A board"));

        // Read
        let fetched = db.get_board(&board.id).unwrap().expect("board exists");
        assert_eq!(fetched.name, "My Board");

        // List
        let boards = db.list_boards().unwrap();
        assert_eq!(boards.len(), 1);

        // Update
        let updated = db
            .update_board(&board.id, Some("Renamed"), None)
            .unwrap()
            .expect("board exists");
        assert_eq!(updated.name, "Renamed");

        // Delete
        assert!(db.delete_board(&board.id).unwrap());
        assert!(db.get_board(&board.id).unwrap().is_none());
    }

    // ----- Columns ---------------------------------------------------------

    #[test]
    fn test_column_crud() {
        let db = test_db();
        let board = db.create_board("B", None).unwrap();

        // Auto-incrementing positions
        let c1 = db.create_column(&board.id, "To Do", None, None).unwrap();
        let c2 = db
            .create_column(&board.id, "In Progress", Some(3), Some("#00f"))
            .unwrap();
        let c3 = db.create_column(&board.id, "Done", None, None).unwrap();

        assert_eq!(c1.position, 0);
        assert_eq!(c2.position, 1);
        assert_eq!(c3.position, 2);
        assert_eq!(c2.wip_limit, Some(3));
        assert_eq!(c2.color.as_deref(), Some("#00f"));

        // List
        let cols = db.list_columns(&board.id).unwrap();
        assert_eq!(cols.len(), 3);

        // Update
        assert!(db.update_column(&c1.id, Some("Backlog"), None, None).unwrap());

        // Move
        assert!(db.move_column(&c3.id, 0).unwrap());

        // Delete
        assert!(db.delete_column(&c1.id).unwrap());
        assert_eq!(db.list_columns(&board.id).unwrap().len(), 2);
    }

    // ----- Tasks -----------------------------------------------------------

    #[test]
    fn test_task_crud_and_move() {
        let db = test_db();
        let (board_id, _user_id, col_id) = seed(&db);

        // Create two tasks -- positions auto-increment
        let t1 = db
            .create_task(&board_id, &col_id, "Task 1", None, Priority::Low, None)
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
            .unwrap();
        assert_eq!(t1.position, 0);
        assert_eq!(t2.position, 1);
        assert_eq!(t2.priority, Priority::Urgent);

        // Get
        let fetched = db.get_task(&t1.id).unwrap().expect("task exists");
        assert_eq!(fetched.title, "Task 1");

        // List by board
        assert_eq!(db.list_tasks(&board_id).unwrap().len(), 2);

        // List by column
        assert_eq!(db.list_tasks_in_column(&col_id).unwrap().len(), 2);

        // Update
        let updated = db
            .update_task(&t1.id, Some("Task 1 Updated"), None, Some(Priority::High), None)
            .unwrap()
            .expect("task exists");
        assert_eq!(updated.title, "Task 1 Updated");
        assert_eq!(updated.priority, Priority::High);

        // Move to a new column
        let col2 = db
            .create_column(&board_id, "Done", None, None)
            .unwrap();
        let moved = db.move_task(&t1.id, &col2.id, 0).unwrap().expect("task exists");
        assert_eq!(moved.column_id, col2.id);
        assert_eq!(moved.position, 0);

        // Delete
        assert!(db.delete_task(&t2.id).unwrap());
        assert_eq!(db.list_tasks(&board_id).unwrap().len(), 1);
    }

    // ----- Custom fields ---------------------------------------------------

    #[test]
    fn test_custom_fields() {
        let db = test_db();
        let (board_id, _user_id, col_id) = seed(&db);

        // Create field
        let field = db
            .create_custom_field(&board_id, "Story Points", FieldType::Number, None)
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
            .unwrap();
        assert_eq!(field2.position, 1);

        // List
        let fields = db.list_custom_fields(&board_id).unwrap();
        assert_eq!(fields.len(), 2);

        // Set value
        let task = db
            .create_task(&board_id, &col_id, "A task", None, Priority::Medium, None)
            .unwrap();
        db.set_custom_field_value(&task.id, &field.id, "5").unwrap();
        db.set_custom_field_value(&task.id, &field2.id, "S1").unwrap();

        // Overwrite via upsert
        db.set_custom_field_value(&task.id, &field.id, "8").unwrap();

        // Retrieve
        let vals = db.get_custom_field_values(&task.id).unwrap();
        assert_eq!(vals.len(), 2);
        let sp = vals.iter().find(|v| v.field_id == field.id).unwrap();
        assert_eq!(sp.value, "8");
    }

    // ----- Board Members ---------------------------------------------------

    #[test]
    fn test_board_member_crud() {
        let db = test_db();
        let board = db.create_board("B", None).unwrap();
        let user = db.create_user("Alice", "alice@test.com", None, false, None).unwrap();

        assert!(db.get_board_member(&board.id, &user.id).unwrap().is_none());

        db.add_board_member(&board.id, &user.id, Role::Owner).unwrap();
        let role = db.get_board_member(&board.id, &user.id).unwrap().unwrap();
        assert_eq!(role, Role::Owner);

        let boards = db.list_user_boards(&user.id).unwrap();
        assert_eq!(boards.len(), 1);
    }

    // ----- API Keys --------------------------------------------------------

    #[test]
    fn test_api_key_crud() {
        let db = test_db();
        let user = db.create_user("Alice", "alice@example.com", None, false, None).unwrap();

        let key = db.create_api_key(&user.id, "My Key", "hash123", "ok_abc").unwrap();
        assert_eq!(key.name, "My Key");

        let keys = db.list_api_keys(&user.id).unwrap();
        assert_eq!(keys.len(), 1);

        let found = db.validate_api_key("hash123").unwrap();
        assert_eq!(found.id, user.id);

        assert!(db.delete_api_key(&key.id, &user.id).unwrap());
        assert_eq!(db.list_api_keys(&user.id).unwrap().len(), 0);
    }

    // ----- Comments --------------------------------------------------------

    #[test]
    fn test_comments() {
        let db = test_db();
        let (board_id, user_id, col_id) = seed(&db);

        let task = db
            .create_task(&board_id, &col_id, "Commentable", None, Priority::Medium, None)
            .unwrap();

        db.create_comment(&task.id, &user_id, "First comment").unwrap();
        db.create_comment(&task.id, &user_id, "Second comment").unwrap();

        let comments = db.list_comments(&task.id).unwrap();
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].content, "First comment");
        assert_eq!(comments[1].content, "Second comment");
    }
}
