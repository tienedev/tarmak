//! KBF decoding: full snapshots and delta updates.

use crate::encode::{Delta, Row};
use crate::schema::Schema;

/// A fully decoded KBF snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct Decoded {
    pub schema: Schema,
    pub rows: Vec<Row>,
}

/// Errors that can occur during decoding.
#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    #[error("missing schema header")]
    MissingSchema,

    #[error("invalid schema: {0}")]
    InvalidSchema(String),

    #[error("invalid row at line {line}: {msg}")]
    InvalidRow { line: usize, msg: String },

    #[error("invalid delta: {0}")]
    InvalidDelta(String),
}

/// Split a pipe-delimited line respecting escaped pipes (`\|`).
fn split_row(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if chars.peek() == Some(&'|') {
                current.push('|');
                chars.next();
                continue;
            }
            current.push(ch);
        } else if ch == '|' {
            fields.push(std::mem::take(&mut current));
        } else {
            current.push(ch);
        }
    }
    fields.push(current);
    fields
}

/// Decode a full KBF snapshot (schema header + pipe-delimited rows).
pub fn decode_full(input: &str) -> Result<Decoded, DecodeError> {
    let mut lines = input.lines();

    let first_line = lines.next().ok_or(DecodeError::MissingSchema)?;
    let schema = Schema::parse(first_line)
        .ok_or_else(|| DecodeError::InvalidSchema(first_line.to_string()))?;

    let field_count = schema.fields.len();
    let mut rows = Vec::new();

    for (i, line) in lines.enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut fields = split_row(line);

        // Pad short rows with empty strings
        while fields.len() < field_count {
            fields.push(String::new());
        }

        if fields.len() > field_count {
            return Err(DecodeError::InvalidRow {
                line: i + 2, // 1-indexed, schema is line 1
                msg: format!("expected {} fields, got {}", field_count, fields.len()),
            });
        }

        rows.push(fields);
    }

    Ok(Decoded { schema, rows })
}

/// Decode delta lines into a list of delta operations.
///
/// Formats:
/// - `>id.field=value` -> Update
/// - `>values+` -> Create (pipe-delimited, trailing `+`)
/// - `>id-` -> Delete (trailing `-`)
pub fn decode_deltas(input: &str) -> Result<Vec<Delta>, DecodeError> {
    let mut deltas = Vec::new();

    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let rest = line
            .strip_prefix('>')
            .ok_or_else(|| DecodeError::InvalidDelta(format!("missing '>' prefix: {}", line)))?;

        if rest.is_empty() {
            return Err(DecodeError::InvalidDelta("empty delta".into()));
        }

        // Try Delete first: ends with `-` and no dots or pipes before it
        // Delete is `>id-` where id contains no dots, pipes, or `=`
        if rest.ends_with('-') && !rest.contains('.') && !rest.contains('|') && !rest.contains('=')
        {
            let id = &rest[..rest.len() - 1];
            if id.is_empty() {
                return Err(DecodeError::InvalidDelta("empty id in delete".into()));
            }
            deltas.push(Delta::Delete { id: id.into() });
            continue;
        }

        // Try Create: ends with `+` and contains no `.field=` pattern
        if rest.ends_with('+') && !rest.contains('=') {
            let row_str = &rest[..rest.len() - 1];
            let row = split_row(row_str);
            deltas.push(Delta::Create { row });
            continue;
        }

        // Must be Update: `id.field=value`
        if let Some(dot_pos) = rest.find('.') {
            let id = &rest[..dot_pos];
            let after_dot = &rest[dot_pos + 1..];
            if let Some(eq_pos) = after_dot.find('=') {
                let field = &after_dot[..eq_pos];
                let raw_value = &after_dot[eq_pos + 1..];
                // Unescape pipes in value
                let value = raw_value.replace("\\|", "|");
                deltas.push(Delta::Update {
                    id: id.into(),
                    field: field.into(),
                    value,
                });
                continue;
            }
        }

        return Err(DecodeError::InvalidDelta(format!(
            "unrecognized delta format: {}",
            line
        )));
    }

    Ok(deltas)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode::{encode_delta, encode_full};

    #[test]
    fn test_decode_full() {
        let input = "#task@v1:id,title,status\nt1|Design login|doing\nt2|Fix bug|todo";
        let decoded = decode_full(input).unwrap();
        assert_eq!(decoded.schema.entity, "task");
        assert_eq!(decoded.schema.fields, vec!["id", "title", "status"]);
        assert_eq!(decoded.rows.len(), 2);
        assert_eq!(decoded.rows[0], vec!["t1", "Design login", "doing"]);
        assert_eq!(decoded.rows[1], vec!["t2", "Fix bug", "todo"]);
    }

    #[test]
    fn test_decode_missing_schema() {
        let result = decode_full("");
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_invalid_schema() {
        let result = decode_full("not a schema\nt1|stuff");
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_escaped_pipes() {
        let input = "#task@v1:id,title\nt1|A\\|B";
        let decoded = decode_full(input).unwrap();
        assert_eq!(decoded.rows[0], vec!["t1", "A|B"]);
    }

    #[test]
    fn test_decode_deltas() {
        let input = ">t1.status=done\n>t3|New task|todo+\n>t2-";
        let deltas = decode_deltas(input).unwrap();
        assert_eq!(deltas.len(), 3);
        assert_eq!(
            deltas[0],
            Delta::Update {
                id: "t1".into(),
                field: "status".into(),
                value: "done".into(),
            }
        );
        assert_eq!(
            deltas[1],
            Delta::Create {
                row: vec!["t3".into(), "New task".into(), "todo".into()],
            }
        );
        assert_eq!(deltas[2], Delta::Delete { id: "t2".into() });
    }

    #[test]
    fn test_decode_delta_escaped_pipe_in_update() {
        let input = ">t1.title=X\\|Y";
        let deltas = decode_deltas(input).unwrap();
        assert_eq!(
            deltas[0],
            Delta::Update {
                id: "t1".into(),
                field: "title".into(),
                value: "X|Y".into(),
            }
        );
    }

    #[test]
    fn test_roundtrip_full() {
        let schema = Schema::new("task", vec!["id", "title", "status"]);
        let rows = vec![
            vec!["t1".into(), "Build UI".into(), "doing".into()],
            vec!["t2".into(), "Write tests".into(), "todo".into()],
        ];
        let encoded = encode_full(&schema, &rows);
        let decoded = decode_full(&encoded).unwrap();
        assert_eq!(decoded.schema, schema);
        assert_eq!(decoded.rows, rows);
    }

    #[test]
    fn test_roundtrip_full_with_pipes() {
        let schema = Schema::new("task", vec!["id", "title"]);
        let rows = vec![vec!["t1".into(), "A|B|C".into()]];
        let encoded = encode_full(&schema, &rows);
        let decoded = decode_full(&encoded).unwrap();
        assert_eq!(decoded.rows, rows);
    }

    #[test]
    fn test_roundtrip_deltas() {
        let deltas = vec![
            Delta::Update {
                id: "t1".into(),
                field: "status".into(),
                value: "done".into(),
            },
            Delta::Create {
                row: vec!["t3".into(), "New".into(), "todo".into()],
            },
            Delta::Delete { id: "t2".into() },
        ];
        let encoded = encode_delta(&deltas);
        let decoded = decode_deltas(&encoded).unwrap();
        assert_eq!(decoded, deltas);
    }

    #[test]
    fn test_padding_short_rows() {
        let input = "#task@v1:id,title,status,pri\nt1|Design login";
        let decoded = decode_full(input).unwrap();
        // Should pad to 4 fields
        assert_eq!(decoded.rows[0], vec!["t1", "Design login", "", ""]);
    }

    #[test]
    fn test_too_many_fields() {
        let input = "#task@v1:id,title\nt1|Design|extra|fields";
        let result = decode_full(input);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_lines_skipped() {
        let input = "#task@v1:id,title\n\nt1|Hello\n\nt2|World\n";
        let decoded = decode_full(input).unwrap();
        assert_eq!(decoded.rows.len(), 2);
    }
}
