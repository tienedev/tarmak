use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Priority (re-exported from cortx-types)
// ---------------------------------------------------------------------------

pub use cortx_types::Priority;

// ---------------------------------------------------------------------------
// FieldType
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    Text,
    Number,
    Url,
    Enum,
    Date,
}

impl FieldType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Number => "number",
            Self::Url => "url",
            Self::Enum => "enum",
            Self::Date => "date",
        }
    }

    pub fn from_str_db(s: &str) -> Option<Self> {
        match s {
            "text" => Some(Self::Text),
            "number" => Some(Self::Number),
            "url" => Some(Self::Url),
            "enum" => Some(Self::Enum),
            "date" => Some(Self::Date),
            _ => None,
        }
    }
}

impl std::fmt::Display for FieldType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Member,
    Viewer,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Member => "member",
            Self::Viewer => "viewer",
        }
    }

    pub fn from_str_db(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(Self::Owner),
            "member" => Some(Self::Member),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---------------------------------------------------------------------------
// Domain structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub position: i64,
    pub wip_limit: Option<i64>,
    pub color: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub board_id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub assignee: Option<String>,
    pub due_date: Option<String>,
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub field_type: FieldType,
    pub config: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCustomFieldValue {
    pub task_id: String,
    pub field_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub is_agent: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct BoardMember {
    pub board_id: String,
    pub user_id: String,
    pub role: Role,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    pub task_id: String,
    pub user_id: String,
    pub user_name: Option<String>,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub id: String,
    pub board_id: String,
    pub task_id: Option<String>,
    pub user_id: String,
    pub action: String,
    pub details: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEntry {
    pub id: String,
    pub board_id: String,
    pub task_id: Option<String>,
    pub user_id: String,
    pub user_name: String,
    pub is_agent: bool,
    pub action: String,
    pub details: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: String,
    pub board_id: String,
    pub task_id: String,
    pub snippet: String,
    pub rank: f64,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub key_prefix: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

// ---------------------------------------------------------------------------
// Labels, Subtasks, TaskWithRelations
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub completed: bool,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtaskCount {
    pub completed: i32,
    pub total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWithRelations {
    #[serde(flatten)]
    pub task: Task,
    pub labels: Vec<Label>,
    pub subtask_count: SubtaskCount,
    pub attachment_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub board_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_key: String,
    pub uploaded_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub user_id: String,
    pub board_id: String,
    pub task_id: Option<String>,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub title: String,
    pub body: Option<String>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}
