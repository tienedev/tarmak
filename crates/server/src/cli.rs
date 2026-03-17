use crate::db::Db;

fn db_path() -> String {
    std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string())
}

pub async fn backup(output: Option<String>) -> anyhow::Result<()> {
    todo!("backup")
}

pub async fn restore(file: &str, force: bool) -> anyhow::Result<()> {
    todo!("restore")
}

pub async fn export_board(board_id: &str, output: Option<String>) -> anyhow::Result<()> {
    todo!("export")
}

pub async fn import_board(file: &str, owner_email: &str) -> anyhow::Result<()> {
    todo!("import")
}

pub async fn list_users() -> anyhow::Result<()> {
    todo!("list_users")
}
