//! KBF schema declaration: `#entity@vN:field1,field2,field3`

use serde::{Deserialize, Serialize};

/// A schema declaration that defines entity fields and version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Schema {
    pub entity: String,
    pub version: u32,
    pub fields: Vec<String>,
}

impl Schema {
    /// Create a new schema with version 1.
    pub fn new(entity: impl Into<String>, fields: Vec<impl Into<String>>) -> Self {
        Self {
            entity: entity.into(),
            version: 1,
            fields: fields.into_iter().map(Into::into).collect(),
        }
    }

    /// Builder method to set the version.
    pub fn with_version(mut self, version: u32) -> Self {
        self.version = version;
        self
    }

    /// Encode the schema to KBF header format.
    ///
    /// Example: `#task@v1:id,title,status,pri,who`
    pub fn encode(&self) -> String {
        format!(
            "#{}@v{}:{}",
            self.entity,
            self.version,
            self.fields.join(",")
        )
    }

    /// Parse a schema from a KBF header line.
    ///
    /// Returns `None` if the line does not match `#entity@vN:fields`.
    pub fn parse(line: &str) -> Option<Self> {
        let line = line.trim();
        let rest = line.strip_prefix('#')?;

        let at_pos = rest.find('@')?;
        let entity = &rest[..at_pos];
        if entity.is_empty() {
            return None;
        }

        let after_at = &rest[at_pos + 1..];
        let after_v = after_at.strip_prefix('v')?;

        let colon_pos = after_v.find(':')?;
        let version_str = &after_v[..colon_pos];
        let version: u32 = version_str.parse().ok()?;

        let fields_str = &after_v[colon_pos + 1..];
        if fields_str.is_empty() {
            return None;
        }

        let fields: Vec<String> = fields_str.split(',').map(|s| s.to_string()).collect();

        Some(Self {
            entity: entity.to_string(),
            version,
            fields,
        })
    }

    /// Get the index of a field by name.
    pub fn field_index(&self, name: &str) -> Option<usize> {
        self.fields.iter().position(|f| f == name)
    }

    /// Add a field and bump the version.
    pub fn add_field(&mut self, name: impl Into<String>) {
        self.fields.push(name.into());
        self.version += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode() {
        let schema = Schema::new("task", vec!["id", "title", "status", "pri", "who"]);
        assert_eq!(schema.encode(), "#task@v1:id,title,status,pri,who");
    }

    #[test]
    fn test_encode_with_version() {
        let schema = Schema::new("task", vec!["id", "title"]).with_version(3);
        assert_eq!(schema.encode(), "#task@v3:id,title");
    }

    #[test]
    fn test_parse() {
        let schema = Schema::parse("#task@v1:id,title,status").unwrap();
        assert_eq!(schema.entity, "task");
        assert_eq!(schema.version, 1);
        assert_eq!(schema.fields, vec!["id", "title", "status"]);
    }

    #[test]
    fn test_parse_invalid_missing_hash() {
        assert!(Schema::parse("task@v1:id,title").is_none());
    }

    #[test]
    fn test_parse_invalid_missing_version() {
        assert!(Schema::parse("#task@:id,title").is_none());
    }

    #[test]
    fn test_parse_invalid_empty_fields() {
        assert!(Schema::parse("#task@v1:").is_none());
    }

    #[test]
    fn test_add_field() {
        let mut schema = Schema::new("task", vec!["id", "title"]);
        assert_eq!(schema.version, 1);
        schema.add_field("status");
        assert_eq!(schema.version, 2);
        assert_eq!(schema.fields, vec!["id", "title", "status"]);
    }

    #[test]
    fn test_field_index() {
        let schema = Schema::new("task", vec!["id", "title", "status"]);
        assert_eq!(schema.field_index("id"), Some(0));
        assert_eq!(schema.field_index("title"), Some(1));
        assert_eq!(schema.field_index("status"), Some(2));
        assert_eq!(schema.field_index("missing"), None);
    }

    #[test]
    fn test_roundtrip() {
        let original = Schema::new("board", vec!["id", "name", "cols"]).with_version(2);
        let encoded = original.encode();
        let decoded = Schema::parse(&encoded).unwrap();
        assert_eq!(original, decoded);
    }
}
