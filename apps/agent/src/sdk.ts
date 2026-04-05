import type { WebSocket } from "ws";
// agent/src/sdk.ts
import type { ServerMessage } from "./types.js";

// The SDK message types are loosely typed — we pattern-match on known shapes.
type SdkMessage = Record<string, unknown>;

export function transformMessage(message: unknown): ServerMessage | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as SdkMessage;

  if (typeof msg.result === "string") {
    return { type: "result", content: msg.result };
  }

  if (msg.type === "system") return null;

  if (msg.type === "tool_use_summary") {
    return {
      type: "tool_result",
      tool: (msg.tool_name as string) ?? "unknown",
      output: typeof msg.output === "string" ? msg.output : JSON.stringify(msg.output ?? ""),
    };
  }

  const inner = msg.message as SdkMessage | undefined;
  if (msg.type === "assistant" && inner?.content) {
    const blocks = inner.content as SdkMessage[];
    const texts: string[] = [];
    const toolUses: ServerMessage[] = [];

    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUses.push({
          type: "tool_use",
          tool: (block.name as string) ?? "unknown",
          input: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    if (texts.length > 0) {
      return { type: "assistant", content: texts.join("\n") };
    }
    if (toolUses.length > 0) {
      return toolUses[0] ?? null;
    }
    return null;
  }

  if (msg.type === "assistant" && typeof msg.content === "string") {
    return { type: "assistant", content: msg.content };
  }

  return null;
}

// Extract all server messages from a single SDK message
// (an assistant message can contain both text and multiple tool_use blocks)
export function transformMessageAll(message: unknown): ServerMessage[] {
  if (!message || typeof message !== "object") return [];
  const msg = message as SdkMessage;

  if (typeof msg.result === "string") {
    return [{ type: "result", content: msg.result }];
  }

  if (msg.type === "system") return [];

  if (msg.type === "tool_use_summary") {
    return [
      {
        type: "tool_result",
        tool: (msg.tool_name as string) ?? "unknown",
        output: typeof msg.output === "string" ? msg.output : JSON.stringify(msg.output ?? ""),
      },
    ];
  }

  const inner = msg.message as SdkMessage | undefined;
  if (msg.type === "assistant" && inner?.content) {
    const results: ServerMessage[] = [];
    for (const block of inner.content as SdkMessage[]) {
      if (block.type === "text" && typeof block.text === "string") {
        results.push({ type: "assistant", content: block.text });
      } else if (block.type === "tool_use") {
        results.push({
          type: "tool_use",
          tool: (block.name as string) ?? "unknown",
          input: (block.input as Record<string, unknown>) ?? {},
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

export function waitForClientMessage(ws: WebSocket): Promise<{ type: string }> {
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
