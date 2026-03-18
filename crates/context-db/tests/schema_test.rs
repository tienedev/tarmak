#[tokio::test]
async fn test_schema_creation() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    let count = db.execution_count().await.unwrap();
    assert_eq!(count, 0);
}
