pub mod api;
pub mod auth;
pub mod background;
pub mod cli;
pub mod db;
pub mod mcp;
pub mod notifications;
pub mod server;
pub mod static_files;
pub mod sync;

pub use db::Db;
pub use notifications::NotifTx;

use db::models::Priority;

#[derive(Debug, Clone)]
pub struct TaskSummary {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub labels: Vec<String>,
    pub column_id: String,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TaskFilter {
    pub board_id: Option<String>,
    pub label: Option<String>,
    pub priority_min: Option<Priority>,
}

pub struct DecomposeTask {
    pub title: String,
    pub description: String,
    pub priority: Priority,
    pub depends_on: Vec<usize>,
}

pub struct Kanwise {
    db: db::Db,
}

impl Kanwise {
    pub fn new(db: db::Db) -> Self {
        Self { db }
    }

    pub fn db(&self) -> &db::Db {
        &self.db
    }

    /// Atomically claim the next ai-ready task for an agent.
    pub async fn claim_task(
        &self,
        board_id: &str,
        agent_id: &str,
    ) -> anyhow::Result<Option<TaskSummary>> {
        match self.db.claim_task(board_id, agent_id).await? {
            Some((task, labels)) => Ok(Some(TaskSummary {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                labels,
                column_id: task.column_id,
                due_date: task.due_date,
            })),
            None => Ok(None),
        }
    }

    /// Release a claimed task back to the pool.
    pub async fn release_task(&self, task_id: &str, _reason: &str) -> anyhow::Result<()> {
        self.db.release_task(task_id).await
    }

    /// Claim a specific task by ID for an agent.
    /// Returns None if the task doesn't exist or is already locked.
    pub async fn claim_specific_task(
        &self,
        task_id: &str,
        agent_id: &str,
    ) -> anyhow::Result<Option<TaskSummary>> {
        match self.db.claim_specific_task(task_id, agent_id).await? {
            Some((task, labels)) => Ok(Some(TaskSummary {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                labels,
                column_id: task.column_id,
                due_date: task.due_date,
            })),
            None => Ok(None),
        }
    }

    /// Decompose an objective into ordered tasks on a board.
    /// Validates DAG (no cycles), creates tasks in the first column with ai-ready label.
    pub async fn decompose(
        &self,
        _objective: &str,
        board_id: &str,
        tasks: Vec<DecomposeTask>,
    ) -> anyhow::Result<Vec<String>> {
        // Validate DAG: topological sort to detect cycles
        let n = tasks.len();
        let mut in_degree = vec![0usize; n];
        let mut adj: Vec<Vec<usize>> = vec![vec![]; n];
        for (i, t) in tasks.iter().enumerate() {
            for &dep in &t.depends_on {
                anyhow::ensure!(dep < n, "dependency index {dep} out of bounds");
                adj[dep].push(i);
                in_degree[i] += 1;
            }
        }
        let mut queue: std::collections::VecDeque<usize> = in_degree
            .iter()
            .enumerate()
            .filter(|&(_, d)| *d == 0)
            .map(|(i, _)| i)
            .collect();
        let mut visited = 0usize;
        while let Some(node) = queue.pop_front() {
            visited += 1;
            for &next in &adj[node] {
                in_degree[next] -= 1;
                if in_degree[next] == 0 {
                    queue.push_back(next);
                }
            }
        }
        anyhow::ensure!(visited == n, "cyclic dependencies detected");

        // Get the first column for the board
        let columns = self.db.list_columns(board_id).await?;
        let first_col = columns
            .first()
            .ok_or_else(|| anyhow::anyhow!("no columns found for board {board_id}"))?;

        // Prepare tasks for batch creation
        let batch: Vec<(String, String, String)> = tasks
            .into_iter()
            .map(|t| (t.title, t.description, t.priority.as_str().to_string()))
            .collect();

        self.db
            .create_tasks_batch(board_id, &first_col.id, batch)
            .await
    }

    /// Get the next task matching the given filter.
    pub async fn get_next_task(&self, filter: TaskFilter) -> anyhow::Result<TaskSummary> {
        let label = filter.label.as_deref().unwrap_or("ai-ready");
        let result = self
            .db
            .get_next_ai_task(filter.board_id.as_deref(), label)
            .await?;

        match result {
            Some((task, labels)) => Ok(TaskSummary {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                labels,
                column_id: task.column_id,
                due_date: task.due_date,
            }),
            None => anyhow::bail!("No task found matching filter"),
        }
    }

    /// Complete a task by moving it to the last column.
    pub async fn complete_task(&self, id: &str) -> anyhow::Result<()> {
        let task_id = id.to_string();
        let task_data = self
            .db
            .get_task(&task_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Task not found: {task_id}"))?;
        let columns = self.db.list_columns(&task_data.board_id).await?;
        let done_col = columns
            .last()
            .ok_or_else(|| anyhow::anyhow!("No columns found for board"))?;
        self.db.move_task(&task_id, &done_col.id, 0).await?;
        Ok(())
    }

    /// List all tasks for a board as summaries with labels.
    pub async fn list_tasks_summary(&self, board_id: &str) -> anyhow::Result<Vec<TaskSummary>> {
        let tasks = self.db.list_tasks(board_id, 1000, 0).await?;
        let mut result = Vec::with_capacity(tasks.len());
        for t in tasks {
            let labels = self.db.get_task_labels(&t.id).await?;
            let label_names: Vec<String> = labels.iter().map(|l| l.name.clone()).collect();
            result.push(TaskSummary {
                id: t.id,
                title: t.title,
                description: t.description,
                priority: t.priority,
                labels: label_names,
                column_id: t.column_id,
                due_date: t.due_date,
            });
        }
        Ok(result)
    }
}
