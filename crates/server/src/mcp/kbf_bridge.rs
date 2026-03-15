//! Convert database entities to KBF compact format.

use std::collections::HashMap;

use anyhow::{Context, Result};

use crate::db::Db;
use crate::db::models::Priority;

/// Build a KBF schema for tasks including any custom fields on the board.
///
/// Base fields: id, col, title, desc, pri, who, pos
/// Plus one field per custom field (using the field name).
pub fn task_schema(db: &Db, board_id: &str) -> Result<kbf::Schema> {
    let base = vec![
        "id".to_string(),
        "col".to_string(),
        "title".to_string(),
        "desc".to_string(),
        "pri".to_string(),
        "who".to_string(),
        "pos".to_string(),
    ];

    let custom_fields = db
        .list_custom_fields(board_id)
        .context("list custom fields for task schema")?;

    let mut fields = base;
    for cf in &custom_fields {
        fields.push(cf.name.clone());
    }

    Ok(kbf::Schema::new("task", fields))
}

/// Build a KBF schema for columns.
///
/// Fields: id, name, pos, wip, color
pub fn column_schema() -> kbf::Schema {
    kbf::Schema::new(
        "col",
        vec!["id", "name", "pos", "wip", "color"],
    )
}

/// Build a KBF schema for boards list.
///
/// Fields: id, name, desc
pub fn board_schema() -> kbf::Schema {
    kbf::Schema::new("board", vec!["id", "name", "desc"])
}

/// Encode all columns for a board in KBF format.
pub fn encode_board_columns(db: &Db, board_id: &str) -> Result<String> {
    let schema = column_schema();
    let columns = db
        .list_columns(board_id)
        .context("list columns for KBF encoding")?;

    let rows: Vec<kbf::Row> = columns
        .iter()
        .map(|c| {
            vec![
                c.id.clone(),
                c.name.clone(),
                c.position.to_string(),
                c.wip_limit.map(|w| w.to_string()).unwrap_or_default(),
                c.color.clone().unwrap_or_default(),
            ]
        })
        .collect();

    Ok(kbf::encode_full(&schema, &rows))
}

/// Encode all tasks for a board in KBF format, including custom field values.
pub fn encode_board_tasks(db: &Db, board_id: &str) -> Result<String> {
    let schema = task_schema(db, board_id)?;
    let tasks = db
        .list_tasks(board_id)
        .context("list tasks for KBF encoding")?;

    let custom_fields = db
        .list_custom_fields(board_id)
        .context("list custom fields for KBF encoding")?;

    // Batch load all custom field values for this board (avoids N+1)
    let all_cf_values = if !custom_fields.is_empty() {
        db.get_custom_field_values_for_board(board_id)
            .context("batch load custom field values")?
    } else {
        Vec::new()
    };

    // Group by task_id
    let mut cf_by_task: HashMap<&str, Vec<&crate::db::models::TaskCustomFieldValue>> =
        HashMap::new();
    for v in &all_cf_values {
        cf_by_task.entry(&v.task_id).or_default().push(v);
    }

    let mut rows: Vec<kbf::Row> = Vec::with_capacity(tasks.len());

    for task in &tasks {
        let mut row = vec![
            task.id.clone(),
            task.column_id.clone(),
            task.title.clone(),
            task.description.clone().unwrap_or_default(),
            task.priority.short().to_string(),
            task.assignee.clone().unwrap_or_default(),
            task.position.to_string(),
        ];

        // Append custom field values in the same order as the schema fields.
        if !custom_fields.is_empty() {
            let task_vals = cf_by_task.get(task.id.as_str());
            let val_map: HashMap<&str, &str> = task_vals
                .map(|vals| {
                    vals.iter()
                        .map(|v| (v.field_id.as_str(), v.value.as_str()))
                        .collect()
                })
                .unwrap_or_default();

            for cf in &custom_fields {
                row.push(
                    val_map
                        .get(cf.id.as_str())
                        .unwrap_or(&"")
                        .to_string(),
                );
            }
        }

        rows.push(row);
    }

    Ok(kbf::encode_full(&schema, &rows))
}

/// Encode board metadata (info) in KBF format.
pub fn encode_board_info(db: &Db, board_id: &str) -> Result<String> {
    let board = db
        .get_board(board_id)?
        .ok_or_else(|| anyhow::anyhow!("board not found: {}", board_id))?;

    let schema = board_schema();
    let rows = vec![vec![
        board.id,
        board.name,
        board.description.unwrap_or_default(),
    ]];

    Ok(kbf::encode_full(&schema, &rows))
}

/// Encode all boards in KBF format.
pub fn encode_boards_list(db: &Db) -> Result<String> {
    let schema = board_schema();
    let boards = db.list_boards().context("list boards")?;

    let rows: Vec<kbf::Row> = boards
        .iter()
        .map(|b| {
            vec![
                b.id.clone(),
                b.name.clone(),
                b.description.clone().unwrap_or_default(),
            ]
        })
        .collect();

    Ok(kbf::encode_full(&schema, &rows))
}

/// Encode a full board snapshot: info + columns + tasks, separated by blank lines.
pub fn encode_board_all(db: &Db, board_id: &str) -> Result<String> {
    let info = encode_board_info(db, board_id)?;
    let cols = encode_board_columns(db, board_id)?;
    let tasks = encode_board_tasks(db, board_id)?;

    Ok(format!("{}\n\n{}\n\n{}", info, cols, tasks))
}

/// Convert a Priority from its short code for use in mutations.
pub fn priority_from_short_or_full(s: &str) -> Option<Priority> {
    Priority::from_short(s).or_else(|| Priority::from_str_db(s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{FieldType, Priority};

    fn test_db() -> Db {
        Db::in_memory().expect("in-memory db")
    }

    fn seed(db: &Db) -> (String, String) {
        let board = db.create_board("Test Board", Some("A test board")).unwrap();
        let col = db
            .create_column(&board.id, "To Do", Some(5), Some("#ff0"))
            .unwrap();
        (board.id, col.id)
    }

    #[test]
    fn test_task_schema_base_fields() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        let schema = task_schema(&db, &board_id).unwrap();
        assert_eq!(schema.entity, "task");
        assert_eq!(schema.version, 1);
        assert_eq!(
            schema.fields,
            vec!["id", "col", "title", "desc", "pri", "who", "pos"]
        );
    }

    #[test]
    fn test_task_schema_with_custom_fields() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        db.create_custom_field(&board_id, "points", FieldType::Number, None)
            .unwrap();
        db.create_custom_field(&board_id, "sprint", FieldType::Text, None)
            .unwrap();

        let schema = task_schema(&db, &board_id).unwrap();
        assert_eq!(
            schema.fields,
            vec!["id", "col", "title", "desc", "pri", "who", "pos", "points", "sprint"]
        );
    }

    #[test]
    fn test_encode_board_tasks_basic() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);

        let t1 = db
            .create_task(&board_id, &col_id, "Design login", None, Priority::High, Some("alice"))
            .unwrap();
        let t2 = db
            .create_task(&board_id, &col_id, "Fix bug", Some("Urgent fix"), Priority::Low, None)
            .unwrap();

        let encoded = encode_board_tasks(&db, &board_id).unwrap();
        let lines: Vec<&str> = encoded.lines().collect();

        // First line is the schema header
        assert_eq!(lines[0], "#task@v1:id,col,title,desc,pri,who,pos");

        // Second line is first task
        assert!(lines[1].starts_with(&t1.id));
        assert!(lines[1].contains("Design login"));
        assert!(lines[1].contains("|h|")); // high priority short code
        assert!(lines[1].contains("|alice|"));

        // Third line is second task
        assert!(lines[2].starts_with(&t2.id));
        assert!(lines[2].contains("Fix bug"));
        assert!(lines[2].contains("|l|")); // low priority short code
    }

    #[test]
    fn test_encode_board_tasks_with_custom_field_values() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);

        let field = db
            .create_custom_field(&board_id, "points", FieldType::Number, None)
            .unwrap();

        let task = db
            .create_task(&board_id, &col_id, "Task A", None, Priority::Medium, None)
            .unwrap();
        db.set_custom_field_value(&task.id, &field.id, "5").unwrap();

        let encoded = encode_board_tasks(&db, &board_id).unwrap();
        let lines: Vec<&str> = encoded.lines().collect();

        assert_eq!(lines[0], "#task@v1:id,col,title,desc,pri,who,pos,points");
        // The task row should end with "|5" for the points value
        assert!(lines[1].ends_with("|5"), "Expected row to end with |5, got: {}", lines[1]);
    }

    #[test]
    fn test_encode_board_columns() {
        let db = test_db();
        let (board_id, _col_id) = seed(&db);

        // seed already created one column; add another
        db.create_column(&board_id, "Done", None, None).unwrap();

        let encoded = encode_board_columns(&db, &board_id).unwrap();
        let lines: Vec<&str> = encoded.lines().collect();

        assert_eq!(lines[0], "#col@v1:id,name,pos,wip,color");
        assert!(lines[1].contains("|To Do|"));
        assert!(lines[1].contains("|5|")); // wip_limit
        assert!(lines[1].contains("|#ff0")); // color
        assert!(lines[2].contains("|Done|"));
    }

    #[test]
    fn test_encode_boards_list() {
        let db = test_db();
        db.create_board("Board A", Some("First")).unwrap();
        db.create_board("Board B", None).unwrap();

        let encoded = encode_boards_list(&db).unwrap();
        let lines: Vec<&str> = encoded.lines().collect();

        assert_eq!(lines[0], "#board@v1:id,name,desc");
        assert!(lines[1].contains("|Board A|First"));
        assert!(lines[2].contains("|Board B|"));
    }

    #[test]
    fn test_encode_board_info() {
        let db = test_db();
        let board = db.create_board("My Board", Some("description")).unwrap();

        let encoded = encode_board_info(&db, &board.id).unwrap();
        let lines: Vec<&str> = encoded.lines().collect();

        assert_eq!(lines[0], "#board@v1:id,name,desc");
        assert!(lines[1].contains(&board.id));
        assert!(lines[1].contains("|My Board|description"));
    }

    #[test]
    fn test_encode_board_info_not_found() {
        let db = test_db();
        let result = encode_board_info(&db, "nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_encode_board_all() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "A task", None, Priority::Medium, None)
            .unwrap();

        let encoded = encode_board_all(&db, &board_id).unwrap();

        // Should contain all three section headers separated by blank lines
        assert!(encoded.contains("#board@v1:"));
        assert!(encoded.contains("#col@v1:"));
        assert!(encoded.contains("#task@v1:"));
        // Sections separated by double newlines
        assert!(encoded.contains("\n\n"));
    }

    #[test]
    fn test_encode_empty_board() {
        let db = test_db();
        let board = db.create_board("Empty", None).unwrap();

        let tasks = encode_board_tasks(&db, &board.id).unwrap();
        // Should just be the schema header, no data rows
        assert_eq!(tasks, "#task@v1:id,col,title,desc,pri,who,pos");

        let cols = encode_board_columns(&db, &board.id).unwrap();
        assert_eq!(cols, "#col@v1:id,name,pos,wip,color");
    }

    #[test]
    fn test_priority_from_short_or_full() {
        assert_eq!(priority_from_short_or_full("h"), Some(Priority::High));
        assert_eq!(priority_from_short_or_full("high"), Some(Priority::High));
        assert_eq!(priority_from_short_or_full("l"), Some(Priority::Low));
        assert_eq!(priority_from_short_or_full("low"), Some(Priority::Low));
        assert_eq!(priority_from_short_or_full("invalid"), None);
    }
}
