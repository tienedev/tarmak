//! board_ask — keyword-pattern query engine for natural language questions.
//!
//! Dispatches to pre-built SQL queries based on keyword matching.
//! No LLM required server-side.

use anyhow::{Context, Result};

use crate::db::Db;
use crate::db::models::Task;

use super::kbf_bridge;

pub struct AskEngine {
    db: Db,
}

impl AskEngine {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn answer(&self, board_id: &str, question: &str, format: &str) -> Result<String> {
        let q = question.to_lowercase();

        if matches_pattern(&q, &["overdue", "late", "past due", "en retard"]) {
            self.query_overdue(board_id, format)
        } else if matches_pattern(&q, &["due this week", "due soon", "cette semaine"]) {
            self.query_due_range(board_id, 7, format)
        } else if matches_pattern(&q, &["due today", "aujourd'hui"]) {
            self.query_due_range(board_id, 0, format)
        } else if matches_pattern(&q, &["unassigned", "no assignee", "sans assignee"]) {
            self.query_unassigned(board_id, format)
        } else if matches_pattern(&q, &["no label", "without label", "sans label"]) {
            self.query_no_labels(board_id, format)
        } else if matches_pattern(&q, &["blocked", "stale", "stuck"]) {
            self.query_stale(board_id, 3, format)
        } else if matches_pattern(&q, &["stats", "summary", "overview", "résumé"]) {
            self.query_stats(board_id)
        } else if matches_pattern(&q, &["high priority", "urgent", "priorité"]) {
            self.query_high_priority(board_id, format)
        } else if matches_pattern(&q, &["no due", "without date", "sans date"]) {
            self.query_no_due_date(board_id, format)
        } else {
            // Fallback: FTS5 search
            self.search_fallback(board_id, question, format)
        }
    }

    // -----------------------------------------------------------------------
    // Query methods
    // -----------------------------------------------------------------------

    fn query_overdue(&self, board_id: &str, format: &str) -> Result<String> {
        let tasks = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at
                 FROM tasks
                 WHERE board_id = ?1 AND due_date IS NOT NULL AND due_date < date('now')
                 ORDER BY due_date ASC",
            )?;
            Self::collect_tasks(&mut stmt, &[&board_id as &dyn rusqlite::types::ToSql])
        })?;
        self.format_tasks(&tasks, "overdue tasks", format, board_id)
    }

    fn query_due_range(&self, board_id: &str, days: i64, format: &str) -> Result<String> {
        let tasks = self.db.with_conn(|conn| {
            let end_expr = if days == 0 {
                "date('now')".to_string()
            } else {
                format!("date('now', '+{days} days')")
            };
            let sql = format!(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at
                 FROM tasks
                 WHERE board_id = ?1 AND due_date IS NOT NULL AND due_date >= date('now') AND due_date <= {end_expr}
                 ORDER BY due_date ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            Self::collect_tasks(&mut stmt, &[&board_id as &dyn rusqlite::types::ToSql])
        })?;
        let label = if days == 0 { "tasks due today" } else { "tasks due this week" };
        self.format_tasks(&tasks, label, format, board_id)
    }

    fn query_unassigned(&self, board_id: &str, format: &str) -> Result<String> {
        let tasks = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at
                 FROM tasks
                 WHERE board_id = ?1 AND (assignee IS NULL OR assignee = '')
                 ORDER BY created_at DESC",
            )?;
            Self::collect_tasks(&mut stmt, &[&board_id as &dyn rusqlite::types::ToSql])
        })?;
        self.format_tasks(&tasks, "unassigned tasks", format, board_id)
    }

    fn query_no_labels(&self, board_id: &str, format: &str) -> Result<String> {
        let tasks = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT t.id, t.board_id, t.column_id, t.title, t.description, t.priority, t.assignee, t.due_date, t.position, t.created_at, t.updated_at
                 FROM tasks t
                 LEFT JOIN task_labels tl ON tl.task_id = t.id
                 WHERE t.board_id = ?1 AND tl.task_id IS NULL
                 ORDER BY t.created_at DESC",
            )?;
            Self::collect_tasks(&mut stmt, &[&board_id as &dyn rusqlite::types::ToSql])
        })?;
        self.format_tasks(&tasks, "tasks with no labels", format, board_id)
    }

    fn query_stale(&self, board_id: &str, days: i64, format: &str) -> Result<String> {
        let tasks = self.db.with_conn(|conn| {
            let sql = format!(
                "SELECT t.id, t.board_id, t.column_id, t.title, t.description, t.priority, t.assignee, t.due_date, t.position, t.created_at, t.updated_at
                 FROM tasks t
                 INNER JOIN columns c ON c.id = t.column_id
                 WHERE t.board_id = ?1
                   AND t.updated_at < datetime('now', '-{days} days')
                   AND LOWER(c.name) NOT IN ('done', 'closed', 'complete', 'completed', 'archive', 'archived')
                 ORDER BY t.updated_at ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            Self::collect_tasks(&mut stmt, &[&board_id as &dyn rusqlite::types::ToSql])
        })?;
        self.format_tasks(&tasks, "stale tasks", format, board_id)
    }

    fn query_high_priority(&self, board_id: &str, format: &str) -> Result<String> {
        let tasks = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at
                 FROM tasks
                 WHERE board_id = ?1 AND priority IN ('high', 'urgent')
                 ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END, created_at DESC",
            )?;
            Self::collect_tasks(&mut stmt, &[&board_id as &dyn rusqlite::types::ToSql])
        })?;
        self.format_tasks(&tasks, "high priority tasks", format, board_id)
    }

    fn query_no_due_date(&self, board_id: &str, format: &str) -> Result<String> {
        let tasks = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at
                 FROM tasks
                 WHERE board_id = ?1 AND due_date IS NULL
                 ORDER BY created_at DESC",
            )?;
            Self::collect_tasks(&mut stmt, &[&board_id as &dyn rusqlite::types::ToSql])
        })?;
        self.format_tasks(&tasks, "tasks with no due date", format, board_id)
    }

    fn query_stats(&self, board_id: &str) -> Result<String> {
        self.db.with_conn(|conn| {
            let board_name: String = conn.query_row(
                "SELECT name FROM boards WHERE id = ?1",
                [board_id],
                |r| r.get(0),
            ).unwrap_or_else(|_| "Unknown".to_string());

            // Total tasks per column
            let mut stmt = conn.prepare(
                "SELECT c.name, COUNT(t.id)
                 FROM columns c
                 LEFT JOIN tasks t ON t.column_id = c.id AND t.board_id = ?1
                 WHERE c.board_id = ?1
                 GROUP BY c.id, c.name
                 ORDER BY c.position",
            )?;
            let col_counts: Vec<(String, i64)> = stmt
                .query_map([board_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();

            let total: i64 = col_counts.iter().map(|(_, c)| c).sum();
            let col_summary: Vec<String> = col_counts
                .iter()
                .map(|(name, count)| format!("{count} {name}"))
                .collect();

            // Overdue count
            let overdue: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE board_id = ?1 AND due_date IS NOT NULL AND due_date < date('now')",
                [board_id],
                |r| r.get(0),
            ).unwrap_or(0);

            // Due this week
            let due_week: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE board_id = ?1 AND due_date IS NOT NULL AND due_date >= date('now') AND due_date <= date('now', '+7 days')",
                [board_id],
                |r| r.get(0),
            ).unwrap_or(0);

            // High/urgent priority
            let high_prio: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE board_id = ?1 AND priority IN ('high', 'urgent')",
                [board_id],
                |r| r.get(0),
            ).unwrap_or(0);

            // Subtask completion
            let (sub_done, sub_total): (i64, i64) = conn.query_row(
                "SELECT COALESCE(SUM(CASE WHEN s.completed = 1 THEN 1 ELSE 0 END), 0),
                        COUNT(s.id)
                 FROM subtasks s
                 INNER JOIN tasks t ON t.id = s.task_id
                 WHERE t.board_id = ?1",
                [board_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap_or((0, 0));

            // Unassigned
            let unassigned: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE board_id = ?1 AND (assignee IS NULL OR assignee = '')",
                [board_id],
                |r| r.get(0),
            ).unwrap_or(0);

            let mut lines = vec![
                format!("Board \"{}\" summary:", board_name),
                format!("- {} tasks total ({})", total, col_summary.join(", ")),
            ];
            if overdue > 0 || due_week > 0 {
                lines.push(format!("- {} overdue, {} due this week", overdue, due_week));
            }
            if high_prio > 0 {
                lines.push(format!("- {} high/urgent priority", high_prio));
            }
            if sub_total > 0 {
                let pct = if sub_total > 0 {
                    (sub_done as f64 / sub_total as f64 * 100.0).round() as i64
                } else {
                    0
                };
                lines.push(format!("- Subtask completion: {}/{} ({}%)", sub_done, sub_total, pct));
            }
            if unassigned > 0 {
                lines.push(format!("- {} unassigned tasks", unassigned));
            }

            Ok(lines.join("\n"))
        })
    }

    fn search_fallback(&self, board_id: &str, question: &str, format: &str) -> Result<String> {
        match format {
            "kbf" => kbf_bridge::encode_search_results(&self.db, board_id, question),
            "json" => {
                let results = self.db.search_board(board_id, question, 20)?;
                Ok(serde_json::to_string(&results)?)
            }
            _ => {
                // text format
                let results = self.db.search_board(board_id, question, 20)?;
                if results.is_empty() {
                    return Ok(format!("No results found for \"{}\"", question));
                }
                let mut lines = vec![format!("{} search results:", results.len())];
                for r in &results {
                    lines.push(format!("- [{}] {}: {}", r.entity_type, r.entity_id, r.snippet));
                }
                Ok(lines.join("\n"))
            }
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn collect_tasks(
        stmt: &mut rusqlite::Statement<'_>,
        params: &[&dyn rusqlite::types::ToSql],
    ) -> anyhow::Result<Vec<Task>> {
        use crate::db::models::Priority;
        use chrono::{DateTime, Utc};

        let rows = stmt.query_map(params, |row| {
            let priority_str: String = row.get(5)?;
            let priority = Priority::from_str_db(&priority_str).unwrap_or(Priority::Medium);
            let created_str: String = row.get(9)?;
            let updated_str: String = row.get(10)?;
            let created_at = DateTime::parse_from_rfc3339(&created_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let updated_at = DateTime::parse_from_rfc3339(&updated_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            Ok(Task {
                id: row.get(0)?,
                board_id: row.get(1)?,
                column_id: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                priority,
                assignee: row.get(6)?,
                due_date: row.get(7)?,
                position: row.get(8)?,
                created_at,
                updated_at,
            })
        })?;

        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    }

    fn format_tasks(&self, tasks: &[Task], label: &str, format: &str, board_id: &str) -> Result<String> {
        match format {
            "json" => Ok(serde_json::to_string(tasks).context("serialize tasks")?),
            "kbf" => {
                let schema = kbf_bridge::task_schema(&self.db, board_id)?;
                let rows: Vec<kbf::Row> = tasks
                    .iter()
                    .map(|t| {
                        vec![
                            t.id.clone(),
                            t.column_id.clone(),
                            t.title.clone(),
                            t.description.clone().unwrap_or_default(),
                            t.priority.short().to_string(),
                            t.assignee.clone().unwrap_or_default(),
                            t.position.to_string(),
                            t.due_date.clone().unwrap_or_default(),
                            String::new(), // labels (not loaded in ask queries)
                            String::new(), // subtasks count
                        ]
                    })
                    .collect();
                Ok(kbf::encode_full(&schema, &rows))
            }
            _ => {
                // text format (default)
                if tasks.is_empty() {
                    return Ok(format!("No {label}."));
                }
                let mut lines = vec![format!("{} {}:", tasks.len(), label)];
                for t in tasks {
                    let due = t.due_date.as_deref().unwrap_or("no date");
                    let who = t.assignee.as_deref().unwrap_or("unassigned");
                    lines.push(format!(
                        "- \"{}\" (due {}, assigned to {}) [{}]",
                        t.title, due, who, t.priority
                    ));
                }
                Ok(lines.join("\n"))
            }
        }
    }
}

fn matches_pattern(question: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|p| question.contains(p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Priority;

    fn test_db() -> Db {
        Db::in_memory().expect("in-memory db")
    }

    fn seed(db: &Db) -> (String, String) {
        let board = db.create_board("Test Board", Some("A test")).unwrap();
        let col = db.create_column(&board.id, "To Do", None, None).unwrap();
        (board.id, col.id)
    }

    #[test]
    fn test_matches_pattern() {
        assert!(matches_pattern("show overdue tasks", &["overdue", "late"]));
        assert!(matches_pattern("what is stale?", &["blocked", "stale"]));
        assert!(!matches_pattern("random question", &["overdue", "late"]));
    }

    #[test]
    fn test_ask_stats() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "Task A", None, Priority::High, Some("alice")).unwrap();
        db.create_task(&board_id, &col_id, "Task B", None, Priority::Low, None).unwrap();

        let engine = AskEngine::new(db);
        let result = engine.answer(&board_id, "give me a summary", "text").unwrap();
        assert!(result.contains("summary"));
        assert!(result.contains("2 tasks total"));
    }

    #[test]
    fn test_ask_unassigned() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "Orphan", None, Priority::Medium, None).unwrap();
        db.create_task(&board_id, &col_id, "Owned", None, Priority::Medium, Some("bob")).unwrap();

        let engine = AskEngine::new(db);
        let result = engine.answer(&board_id, "show unassigned tasks", "text").unwrap();
        assert!(result.contains("Orphan"));
        assert!(!result.contains("Owned"));
    }

    #[test]
    fn test_ask_high_priority() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "Critical", None, Priority::Urgent, None).unwrap();
        db.create_task(&board_id, &col_id, "Normal", None, Priority::Medium, None).unwrap();

        let engine = AskEngine::new(db);
        let result = engine.answer(&board_id, "urgent tasks", "text").unwrap();
        assert!(result.contains("Critical"));
        assert!(!result.contains("Normal"));
    }

    #[test]
    fn test_ask_json_format() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "Task X", None, Priority::High, None).unwrap();

        let engine = AskEngine::new(db);
        let result = engine.answer(&board_id, "high priority", "json").unwrap();
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["title"], "Task X");
    }

    #[test]
    fn test_ask_kbf_format() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "KBF Task", None, Priority::Urgent, None).unwrap();

        let engine = AskEngine::new(db);
        let result = engine.answer(&board_id, "urgent", "kbf").unwrap();
        assert!(result.starts_with("#task@v2:"));
        assert!(result.contains("KBF Task"));
    }

    #[test]
    fn test_ask_fallback_search() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "Authentication module", Some("Fix the login bug"), Priority::Medium, None).unwrap();

        let engine = AskEngine::new(db);
        let result = engine.answer(&board_id, "Authentication", "text").unwrap();
        assert!(result.contains("Authentication"));
    }

    #[test]
    fn test_ask_no_results() {
        let db = test_db();
        let (board_id, _col_id) = seed(&db);

        let engine = AskEngine::new(db);
        let result = engine.answer(&board_id, "show unassigned", "text").unwrap();
        assert!(result.contains("No unassigned"));
    }
}
