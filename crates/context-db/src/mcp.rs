use serde_json::Value;

pub fn tools_list() -> Value {
    serde_json::json!({
        "tools": [
            {
                "name": "memory_store",
                "description": "Store a fact, causal chain, or execution event.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "type": { "type": "string", "enum": ["fact", "causal_chain", "execution"] },
                        "data": { "type": "object" }
                    },
                    "required": ["type", "data"]
                }
            },
            {
                "name": "memory_recall",
                "description": "Search memory (FTS5 + confidence ranking).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string" },
                        "files": { "type": "array", "items": { "type": "string" } },
                        "min_confidence": { "type": "number" }
                    }
                }
            },
            {
                "name": "memory_status",
                "description": "Memory stats: counts, stale entries, DB size.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
    })
}
