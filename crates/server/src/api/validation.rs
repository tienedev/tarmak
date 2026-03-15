use super::error::ApiError;

pub fn validate_email(email: &str) -> Result<(), ApiError> {
    if email.len() > 254 || email.len() < 3 {
        return Err(anyhow::anyhow!("invalid email format").into());
    }
    // Must have exactly one @ with non-empty local and domain parts
    let at_pos = email.find('@');
    let last_at = email.rfind('@');
    match (at_pos, last_at) {
        (Some(p), Some(l)) if p == l && p > 0 && p < email.len() - 1 => {
            let domain = &email[p + 1..];
            if !domain.contains('.') || domain.starts_with('.') || domain.ends_with('.') {
                return Err(anyhow::anyhow!("invalid email format").into());
            }
        }
        _ => return Err(anyhow::anyhow!("invalid email format").into()),
    }
    Ok(())
}

pub fn validate_name(name: &str) -> Result<(), ApiError> {
    if name.trim().is_empty() || name.len() > 100 {
        return Err(anyhow::anyhow!("name must be 1-100 characters").into());
    }
    Ok(())
}

pub fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.len() < 8 || password.len() > 128 {
        return Err(anyhow::anyhow!("password must be 8-128 characters").into());
    }
    Ok(())
}

pub fn validate_title(title: &str) -> Result<(), ApiError> {
    if title.trim().is_empty() || title.len() > 500 {
        return Err(anyhow::anyhow!("title must be 1-500 characters").into());
    }
    Ok(())
}
