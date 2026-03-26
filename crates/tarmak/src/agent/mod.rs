use anyhow::Result;
use std::process::Command;

pub fn launch_agent_server(server: &str, token: &str, port: u16, origins: &[String]) -> Result<()> {
    let origins_str = origins.join(",");
    let status = Command::new("npx")
        .arg("tsx")
        .arg("agent/src/index.ts")
        .arg("--server")
        .arg(server)
        .arg("--token")
        .arg(token)
        .arg("--port")
        .arg(port.to_string())
        .arg("--allowed-origins")
        .arg(&origins_str)
        .status()?;
    if !status.success() {
        anyhow::bail!("Agent server exited with code {:?}", status.code());
    }
    Ok(())
}
