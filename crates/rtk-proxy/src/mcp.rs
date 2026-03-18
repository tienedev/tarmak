use crate::proxy::Proxy;
use serde_json::Value;

pub struct ProxyMcpServer {
    pub proxy: Proxy,
}

impl ProxyMcpServer {
    pub fn new(proxy: Proxy) -> Self {
        Self { proxy }
    }

    pub fn tools_list() -> Value {
        serde_json::json!({
            "tools": [
                {
                    "name": "proxy_exec",
                    "description": "Execute a command through the secure pipeline.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string" },
                            "cwd": { "type": "string" },
                            "mode": { "type": "string", "enum": ["assisted", "autonomous", "admin"], "default": "assisted" }
                        },
                        "required": ["command"]
                    }
                },
                {
                    "name": "proxy_status",
                    "description": "Remaining budget, execution count, circuit breaker state.",
                    "inputSchema": { "type": "object", "properties": {} }
                },
                {
                    "name": "proxy_rollback",
                    "description": "Restore last git checkpoint.",
                    "inputSchema": { "type": "object", "properties": {} }
                }
            ]
        })
    }
}
