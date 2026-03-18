pub mod api;
pub mod db;
pub mod mcp;
pub mod auth;
pub mod sync;
pub mod background;
pub mod notifications;
pub mod static_files;

pub use db::Db;
pub use notifications::NotifTx;

use cortx_types::{PlanningOrgan, Task as CortxTask, TaskFilter};

pub struct Kanwise {
    db: db::Db,
}

impl Kanwise {
    pub fn new(db: db::Db) -> Self {
        Self { db }
    }
}

impl PlanningOrgan for Kanwise {
    async fn get_next_task(&self, filter: TaskFilter) -> anyhow::Result<CortxTask> {
        let label = filter.label.as_deref().unwrap_or("ai-ready");
        let result = self
            .db
            .get_next_ai_task(filter.board_id.as_deref(), label)
            .await?;

        match result {
            Some((task, labels)) => Ok(CortxTask {
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

    async fn complete_task(&self, id: &str) -> anyhow::Result<()> {
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

    async fn list_tasks(&self, board_id: &str) -> anyhow::Result<Vec<CortxTask>> {
        let tasks = self.db.list_tasks(board_id, 1000, 0).await?;
        let mut result = Vec::with_capacity(tasks.len());
        for t in tasks {
            let labels = self.db.get_task_labels(&t.id).await?;
            let label_names: Vec<String> = labels.iter().map(|l| l.name.clone()).collect();
            result.push(CortxTask {
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
