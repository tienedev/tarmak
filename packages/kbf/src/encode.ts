import type { Delta, Row } from "./types";
import type { Schema } from "./schema";

function escapePipe(value: string): string {
  return value.replaceAll("|", "\\|");
}

export function encodeFull(schema: Schema, rows: Row[]): string {
  let out = schema.encode();
  for (const row of rows) {
    out += `\n${row.map(escapePipe).join("|")}`;
  }
  return out;
}

export function encodeDelta(deltas: Delta[]): string {
  return deltas
    .map((d) => {
      switch (d.type) {
        case "update":
          return `>${d.id}.${d.field}=${escapePipe(d.value)}`;
        case "create":
          return `>${d.row.map(escapePipe).join("|")}+`;
        case "delete":
          return `>${d.id}-`;
      }
    })
    .join("\n");
}

export function rowFromMap(schema: Schema, map: Map<string, string>): Row {
  return schema.fields.map((f) => map.get(f) ?? "");
}
