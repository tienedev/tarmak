//! KBF encoding: full snapshots and delta updates.

use std::collections::HashMap;

use crate::schema::Schema;

/// A row of field values, ordered by the schema.
pub type Row = Vec<String>;

/// A delta operation on kanban data.
#[derive(Debug, Clone, PartialEq)]
pub enum Delta {
    /// Update a single field: `>id.field=value`
    Update {
        id: String,
        field: String,
        value: String,
    },
    /// Create a new row: `>val1|val2|val3+`
    Create { row: Row },
    /// Delete a row: `>id-`
    Delete { id: String },
}

/// Escape pipe characters in a value: `|` becomes `\|`.
fn escape_pipe(value: &str) -> String {
    value.replace('|', "\\|")
}

/// Encode a full snapshot: schema header followed by pipe-delimited rows.
///
/// ```text
/// #task@v1:id,title,status
/// t1|Design login|doing
/// t2|Fix bug|todo
/// ```
pub fn encode_full(schema: &Schema, rows: &[Row]) -> String {
    let mut out = schema.encode();
    for row in rows {
        out.push('\n');
        let escaped: Vec<String> = row.iter().map(|v| escape_pipe(v)).collect();
        out.push_str(&escaped.join("|"));
    }
    out
}

/// Encode a list of delta operations.
///
/// ```text
/// >t1.status=done
/// >t3|New task|todo+
/// >t2-
/// ```
pub fn encode_delta(deltas: &[Delta]) -> String {
    let mut lines = Vec::new();
    for delta in deltas {
        match delta {
            Delta::Update { id, field, value } => {
                lines.push(format!(">{}.{}={}", id, field, escape_pipe(value)));
            }
            Delta::Create { row } => {
                let escaped: Vec<String> = row.iter().map(|v| escape_pipe(v)).collect();
                lines.push(format!(">{}+", escaped.join("|")));
            }
            Delta::Delete { id } => {
                lines.push(format!(">{}-", id));
            }
        }
    }
    lines.join("\n")
}

/// Build a row from a HashMap using the schema's field order.
///
/// Missing fields are filled with empty strings.
pub fn row_from_map(schema: &Schema, map: &HashMap<String, String>) -> Row {
    schema
        .fields
        .iter()
        .map(|f| map.get(f).cloned().unwrap_or_default())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_full() {
        let schema = Schema::new("task", vec!["id", "title", "status"]);
        let rows = vec![
            vec!["t1".into(), "Design login".into(), "doing".into()],
            vec!["t2".into(), "Fix bug".into(), "todo".into()],
        ];
        let encoded = encode_full(&schema, &rows);
        assert_eq!(
            encoded,
            "#task@v1:id,title,status\nt1|Design login|doing\nt2|Fix bug|todo"
        );
    }

    #[test]
    fn test_encode_delta() {
        let deltas = vec![
            Delta::Update {
                id: "t1".into(),
                field: "status".into(),
                value: "done".into(),
            },
            Delta::Create {
                row: vec!["t3".into(), "New task".into(), "todo".into()],
            },
            Delta::Delete { id: "t2".into() },
        ];
        let encoded = encode_delta(&deltas);
        assert_eq!(encoded, ">t1.status=done\n>t3|New task|todo+\n>t2-");
    }

    #[test]
    fn test_row_from_map() {
        let schema = Schema::new("task", vec!["id", "title", "status"]);
        let mut map = HashMap::new();
        map.insert("id".into(), "t1".into());
        map.insert("title".into(), "Do stuff".into());
        // "status" intentionally missing
        let row = row_from_map(&schema, &map);
        assert_eq!(row, vec!["t1", "Do stuff", ""]);
    }

    #[test]
    fn test_escape_pipes() {
        let schema = Schema::new("task", vec!["id", "title"]);
        let rows = vec![vec!["t1".into(), "A|B".into()]];
        let encoded = encode_full(&schema, &rows);
        assert_eq!(encoded, "#task@v1:id,title\nt1|A\\|B");
    }

    #[test]
    fn test_encode_delta_with_pipe_in_value() {
        let deltas = vec![Delta::Update {
            id: "t1".into(),
            field: "title".into(),
            value: "X|Y".into(),
        }];
        let encoded = encode_delta(&deltas);
        assert_eq!(encoded, ">t1.title=X\\|Y");
    }
}
