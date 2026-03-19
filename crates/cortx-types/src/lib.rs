#![allow(async_fn_in_trait)] // Traits used only with static dispatch, no dyn/Send needed.

use anyhow::Result;
use std::path::PathBuf;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

// ── Priority ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum Priority {
    Low,
    Medium,
    High,
    Urgent,
}

impl Priority {
    pub fn short(&self) -> &'static str {
        match self {
            Self::Low => "l",
            Self::Medium => "m",
            Self::High => "h",
            Self::Urgent => "u",
        }
    }

    pub fn from_short(s: &str) -> Option<Self> {
        match s {
            "l" => Some(Self::Low),
            "m" => Some(Self::Medium),
            "h" => Some(Self::High),
            "u" => Some(Self::Urgent),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }

    pub fn from_str_db(s: &str) -> Option<Self> {
        match s {
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }
}

impl std::fmt::Display for Priority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ── Core types ──

#[derive(Debug, Clone, Default)]
pub struct TaskFilter {
    pub board_id: Option<String>,
    pub label: Option<String>,
    pub priority_min: Option<Priority>,
}

#[derive(Debug, Clone)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub labels: Vec<String>,
    pub column_id: String,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Command {
    pub cmd: String,
    pub cwd: PathBuf,
    pub mode: ExecutionMode,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionMode {
    Assisted,
    Autonomous,
    Admin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Passed,
    Failed,
    Timeout,
    Blocked,
    Forbidden,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Safe,
    Monitored,
    Dangerous,
    Forbidden,
}

impl Tier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::Monitored => "monitored",
            Self::Dangerous => "dangerous",
            Self::Forbidden => "forbidden",
        }
    }

    pub fn from_str_db(s: &str) -> Option<Self> {
        match s {
            "safe" => Some(Self::Safe),
            "monitored" => Some(Self::Monitored),
            "dangerous" => Some(Self::Dangerous),
            "forbidden" => Some(Self::Forbidden),
            _ => None,
        }
    }
}

impl std::fmt::Display for Tier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Default)]
pub struct Budget {
    pub commands_remaining: u32,
    pub cpu_seconds_remaining: u32,
}

#[derive(Debug, Clone)]
pub struct CodeLocation {
    pub file: String,
    pub line: Option<u32>,
    pub msg: String,
}

#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub status: Status,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub command: String,
    pub tier: Tier,
    pub summary: String,
    pub errors: Vec<CodeLocation>,
    pub warnings: Vec<CodeLocation>,
    pub truncated: bool,
    pub budget_remaining: Budget,
    pub hints: Vec<MemoryHint>,
    pub files_touched: Vec<String>,
}

impl ExecutionResult {
    pub fn error_files(&self) -> Vec<String> {
        self.errors.iter().map(|e| e.file.clone()).collect()
    }

    pub fn error_messages(&self) -> Vec<String> {
        self.errors.iter().map(|e| e.msg.clone()).collect()
    }

    pub fn with_hints(mut self, hints: Vec<MemoryHint>) -> Self {
        self.hints = hints;
        self
    }
}

#[derive(Debug, Clone)]
pub struct ExecutionRecord {
    pub session_id: String,
    pub task_id: Option<String>,
    pub command: String,
    pub exit_code: Option<i32>,
    pub tier: Tier,
    pub duration_ms: u64,
    pub summary: String,
    pub errors: Vec<CodeLocation>,
    pub files_touched: Vec<String>,
}

// ── Memory types ──

#[derive(Debug, Clone)]
pub enum Memory {
    Execution(ExecutionRecord),
    CausalChain {
        trigger_file: String,
        trigger_error: Option<String>,
        trigger_command: Option<String>,
        resolution_files: Vec<String>,
    },
    ProjectFact {
        fact: String,
        citation: String,
        source: MemorySource,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemorySource {
    Agent,
    Proxy,
    User,
}

pub struct MemoryId(pub String);

#[derive(Debug, Clone, Default)]
pub struct RecallQuery {
    pub text: Option<String>,
    pub files: Vec<String>,
    pub error_patterns: Vec<String>,
    pub min_confidence: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct MemoryHint {
    pub kind: String,
    pub summary: String,
    pub confidence: f64,
    pub source: MemorySource,
    pub chain_id: Option<String>,
}

// ── Organ traits ──
pub trait PlanningOrgan {
    async fn get_next_task(&self, filter: TaskFilter) -> Result<Task>;
    async fn complete_task(&self, id: &str) -> Result<()>;
    async fn list_tasks(&self, board_id: &str) -> Result<Vec<Task>>;
}

pub trait ActionOrgan {
    async fn execute(&self, cmd: Command) -> Result<ExecutionResult>;
}

pub trait MemoryOrgan {
    async fn store(&self, memory: Memory) -> Result<MemoryId>;
    async fn recall(&self, query: RecallQuery) -> Result<Vec<MemoryHint>>;
    async fn last_failure_for_command(&self, command: &str) -> Result<Option<ExecutionRecord>>;
}
