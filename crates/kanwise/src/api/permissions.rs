use crate::db::Db;
use crate::db::models::Role;
use super::error::ApiError;

/// Check that a user has at least the required role on a board.
/// Role hierarchy: owner > member > viewer
pub async fn require_role(db: &Db, board_id: &str, user_id: &str, min_role: Role) -> Result<Role, ApiError> {
    let role = db.get_board_member(board_id, user_id).await?
        .ok_or_else(|| ApiError::Forbidden("not a member of this board".into()))?;

    let level = role_level(&role);
    let required = role_level(&min_role);

    if level >= required {
        Ok(role)
    } else {
        Err(ApiError::Forbidden("insufficient permissions".into()))
    }
}

fn role_level(role: &Role) -> u8 {
    match role {
        Role::Owner => 3,
        Role::Member => 2,
        Role::Viewer => 1,
    }
}
