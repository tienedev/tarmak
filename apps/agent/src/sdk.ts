// agent/src/sdk.ts
import type { ServerMessage } from "./types.js";
import type { WebSocket } from "ws";

// Transform SDK messages to our WebSocket protocol.
// The SDK message types are loosely typed — we pattern-match on known shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformMessage(message: any): ServerMessage | null {
  if (!message || typeof message !== "object") return null;

  // ResultMessage — has .result string
  if ("result" in message && typeof message.result === "string") {
    return { type: "result", content: message.result };
  }

  // SystemMessage — init, ignore
  if (message.type === "system") {
    return null;
  }

  // ToolUseSummaryMessage — tool execution result
  if (message.type === "tool_use_summary") {
    return {
      type: "tool_result",
      tool: message.tool_name ?? "unknown",
      output: typeof message.output === "string" ? message.output : JSON.stringify(message.output ?? ""),
    };
  }

  // AssistantMessage — has .message.content array (Anthropic BetaMessage shape)
  if (message.type === "assistant" && message.message?.content) {
    const blocks = message.message.content;
    const texts: string[] = [];
    const toolUses: ServerMessage[] = [];

    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUses.push({
          type: "tool_use",
          tool: block.name ?? "unknown",
          input: block.input ?? {},
        });
      }
    }

    // Return text first if present, tool uses get sent separately
    if (texts.length > 0) {
      return { type: "assistant", content: texts.join("\n") };
    }
    if (toolUses.length > 0) {
      return toolUses[0]; // first tool_use; caller should handle multiple
    }
    return null;
  }

  // PartialAssistantMessage (streaming) — simpler shape
  if (message.type === "assistant" && typeof message.content === "string") {
    return { type: "assistant", content: message.content };
  }

  // Ignore everything else (hooks, retries, status, etc.)
  return null;
}

// Extract all server messages from a single SDK message
// (an assistant message can contain both text and multiple tool_use blocks)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformMessageAll(message: any): ServerMessage[] {
  if (!message || typeof message !== "object") return [];

  if ("result" in message && typeof message.result === "string") {
    return [{ type: "result", content: message.result }];
  }

  if (message.type === "system") return [];

  // ToolUseSummaryMessage — tool execution result
  if (message.type === "tool_use_summary") {
    return [{
      type: "tool_result",
      tool: message.tool_name ?? "unknown",
      output: typeof message.output === "string" ? message.output : JSON.stringify(message.output ?? ""),
    }];
  }

  if (message.type === "assistant" && message.message?.content) {
    const results: ServerMessage[] = [];
    for (const block of message.message.content) {
      if (block.type === "text" && block.text) {
        results.push({ type: "assistant", content: block.text });
      } else if (block.type === "tool_use") {
        results.push({
          type: "tool_use",
          tool: block.name ?? "unknown",
          input: block.input ?? {},
        });
      }
    }
    return results;
  }

  return [];
}

export function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function waitForClientMessage(
  ws: WebSocket
): Promise<{ type: string }> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        ws.off("message", onMessage);
        ws.off("close", onClose);
        resolve(parsed);
      } catch {
        // ignore malformed messages
      }
    };
    const onClose = () => {
      ws.off("message", onMessage);
      reject(new Error("WebSocket closed while waiting for approval"));
    };
    ws.on("message", onMessage);
    ws.on("close", onClose);
  });
}
