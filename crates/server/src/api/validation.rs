use super::error::ApiError;

pub fn validate_email(email: &str) -> Result<(), ApiError> {
    if email.len() > 254 || !email.contains('@') || email.len() < 3 {
        return Err(anyhow::anyhow!("invalid email format").into());
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

#[allow(dead_code)]
pub fn validate_title(title: &str) -> Result<(), ApiError> {
    if title.trim().is_empty() || title.len() > 500 {
        return Err(anyhow::anyhow!("title must be 1-500 characters").into());
    }
    Ok(())
}
