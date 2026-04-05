import type { Delta, Row } from "./types";
import { Schema } from "./schema";

export interface Decoded {
  schema: Schema;
  rows: Row[];
}

function splitRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      current += "|";
      i++;
    } else if (line[i] === "|") {
      fields.push(current);
      current = "";
    } else {
      current += line[i];
    }
  }
  fields.push(current);
  return fields;
}

export function decodeFull(input: string): Decoded {
  const lines = input.split("\n");
  const first = lines[0];
  if (!first) throw new Error("missing schema header");

  const schema = Schema.parse(first);
  if (!schema) throw new Error(`invalid schema: ${first}`);

  const fieldCount = schema.fields.length;
  const rows: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = splitRow(line);
    while (fields.length < fieldCount) fields.push("");

    if (fields.length > fieldCount) {
      throw new Error(`line ${i + 1}: expected ${fieldCount} fields, got ${fields.length}`);
    }
    rows.push(fields);
  }

  return { schema, rows };
}

export function decodeDeltas(input: string): Delta[] {
  const deltas: Delta[] = [];

  for (const line of input.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!trimmed.startsWith(">")) throw new Error(`missing '>' prefix: ${trimmed}`);
    const rest = trimmed.slice(1);
    if (!rest) throw new Error("empty delta");

    // Delete: >id-
    if (rest.endsWith("-") && !rest.includes(".") && !rest.includes("|") && !rest.includes("=")) {
      deltas.push({ type: "delete", id: rest.slice(0, -1) });
      continue;
    }

    // Create: >values+
    if (rest.endsWith("+") && !rest.includes("=")) {
      deltas.push({ type: "create", row: splitRow(rest.slice(0, -1)) });
      continue;
    }

    // Update: >id.field=value
    const dotPos = rest.indexOf(".");
    if (dotPos !== -1) {
      const id = rest.slice(0, dotPos);
      const afterDot = rest.slice(dotPos + 1);
      const eqPos = afterDot.indexOf("=");
      if (eqPos !== -1) {
        const field = afterDot.slice(0, eqPos);
        const value = afterDot.slice(eqPos + 1).replaceAll("\\|", "|");
        deltas.push({ type: "update", id, field, value });
        continue;
      }
    }

    throw new Error(`unrecognized delta format: ${trimmed}`);
  }

  return deltas;
}
