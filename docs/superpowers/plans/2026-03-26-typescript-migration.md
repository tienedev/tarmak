# Tarmak TypeScript Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Tarmak from Rust+TypeScript to a full TypeScript monorepo with Turborepo, Hono, tRPC, Better Auth, Drizzle, and Yjs.

**Architecture:** Turborepo monorepo with 3 packages (`@tarmak/shared`, `@tarmak/db`, `@tarmak/kbf`) and 3 apps (`api`, `web`, `agent`). tRPC provides end-to-end type safety. Better Auth handles authentication. Drizzle ORM with better-sqlite3 for persistence. Yjs for CRDT sync.

**Tech Stack:** Turborepo, pnpm, Hono 4, tRPC 11, Better Auth, Drizzle ORM, better-sqlite3, Yjs 13, @modelcontextprotocol/sdk, Zod, Biome, Vitest, tsup, tsx

**Spec:** `docs/superpowers/specs/2026-03-26-typescript-migration-design.md`

---

## Task 1: Scaffold Monorepo

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `biome.json`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/tsup.config.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/tsup.config.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/kbf/package.json`
- Create: `packages/kbf/tsconfig.json`
- Create: `packages/kbf/tsup.config.ts`
- Create: `packages/kbf/src/index.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/web/` (move from `frontend/`)
- Create: `apps/agent/` (move existing `agent/`)
- Modify: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "tarmak",
  "private": true,
  "packageManager": "pnpm@10.6.2",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "format": "biome format --write .",
    "check": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "turbo": "^2.4.0",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 3: Create turbo.json**

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 4: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["node_modules", "dist", ".turbo", "*.gen.ts"]
  }
}
```

- [ ] **Step 5: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 6: Create packages/shared scaffold**

`packages/shared/package.json`:
```json
{
  "name": "@tarmak/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "tsup": "^8.4.0",
    "vitest": "^4.1.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/shared/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
```

`packages/shared/src/index.ts`:
```ts
export {};
```

- [ ] **Step 7: Create packages/db scaffold**

`packages/db/package.json`:
```json
{
  "name": "@tarmak/db",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@tarmak/shared": "workspace:*",
    "better-sqlite3": "^11.8.0",
    "drizzle-orm": "^0.41.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "drizzle-kit": "^0.30.0",
    "tsup": "^8.4.0",
    "vitest": "^4.1.0"
  }
}
```

`packages/db/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["better-sqlite3"],
});
```

- [ ] **Step 8: Create packages/kbf scaffold**

`packages/kbf/package.json`:
```json
{
  "name": "@tarmak/kbf",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "tsup": "^8.4.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 9: Create apps/api scaffold**

`apps/api/package.json`:
```json
{
  "name": "@tarmak/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tarmak/shared": "workspace:*",
    "@tarmak/db": "workspace:*",
    "@tarmak/kbf": "workspace:*",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0",
    "@trpc/server": "^11.1.0",
    "better-auth": "^1.2.0",
    "drizzle-orm": "^0.41.0",
    "better-sqlite3": "^11.8.0",
    "yjs": "^13.6.0",
    "@modelcontextprotocol/sdk": "^1.27.0",
    "zod": "^3.25.0",
    "pino": "^9.6.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/uuid": "^10.0.0",
    "tsup": "^8.4.0",
    "tsx": "^4.19.0",
    "vitest": "^4.1.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`apps/api/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/trpc/router.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["better-sqlite3"],
});
```

Update `apps/api/package.json` exports to expose AppRouter type:
```json
{
  "exports": {
    ".": { "import": "./dist/index.js" },
    "./trpc": { "types": "./dist/trpc/router.d.ts" }
  }
}
```

`apps/api/src/index.ts`:
```ts
console.log("tarmak api starting...");
```

- [ ] **Step 10: Move frontend/ to apps/web/ and agent/ to apps/agent/**

```bash
# Move frontend to apps/web
mv frontend apps/web

# Move agent to apps/agent
mv agent apps/agent

# Update apps/web/package.json name to @tarmak/web
# Update apps/agent/package.json name to @tarmak/agent
# Update any relative path references
```

Update `apps/web/package.json`: change `"name"` to `"@tarmak/web"` and add `@tarmak/shared` dependency.

Update `apps/agent/package.json`: change `"name"` to `"@tarmak/agent"` and add `@tarmak/shared` dependency.

- [ ] **Step 11: Install dependencies and verify build**

```bash
pnpm install
pnpm build
pnpm typecheck
```

Run: `pnpm build`
Expected: All packages build successfully, no errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Turborepo monorepo with pnpm workspaces"
```

---

## Task 2: @tarmak/shared — Types, Schemas, Constants

**Files:**
- Create: `packages/shared/src/types/board.ts`
- Create: `packages/shared/src/types/user.ts`
- Create: `packages/shared/src/types/label.ts`
- Create: `packages/shared/src/types/comment.ts`
- Create: `packages/shared/src/types/subtask.ts`
- Create: `packages/shared/src/types/attachment.ts`
- Create: `packages/shared/src/types/custom-field.ts`
- Create: `packages/shared/src/types/notification.ts`
- Create: `packages/shared/src/types/agent.ts`
- Create: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/schemas/board.ts`
- Create: `packages/shared/src/schemas/task.ts`
- Create: `packages/shared/src/schemas/user.ts`
- Create: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/src/constants/priorities.ts`
- Create: `packages/shared/src/constants/roles.ts`
- Create: `packages/shared/src/constants/limits.ts`
- Create: `packages/shared/src/constants/index.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`
- Modify: `packages/shared/src/index.ts`

**Reference:** Port types from `crates/tarmak/src/db/models.rs` which defines: Priority, FieldType, Role, AgentSessionStatus enums and Board, Column, Task, User, Comment, Label, Subtask, Attachment, CustomField, Notification, AgentSession structs.

- [ ] **Step 1: Write type files**

`packages/shared/src/types/board.ts` — port from Rust models:
```ts
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Board {
  id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
  wip_limit: number | null;
  color: string | null;
  archived: boolean;
}

export interface Task {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: Priority;
  assignee: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived: boolean;
  locked_by: string | null;
  locked_at: string | null;
}

export interface TaskWithRelations extends Task {
  labels: Label[];
  subtask_count: SubtaskCount;
  attachment_count: number;
}

export interface SubtaskCount {
  completed: number;
  total: number;
}

export interface Activity {
  id: string;
  board_id: string;
  task_id: string;
  user_id: string;
  action: string;
  details: string | null;
  created_at: string;
}

export interface ActivityEntry extends Activity {
  user_name: string;
  is_agent: boolean;
}

export interface SearchResult {
  entity_type: string;
  entity_id: string;
  board_id: string;
  task_id: string;
  snippet: string;
  rank: number;
  archived: boolean;
}
```

Import `Label` from `./label.ts` and `SubtaskCount` is defined locally.

`packages/shared/src/types/user.ts`:
```ts
export type Role = "owner" | "member" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  is_agent: boolean;
  created_at: string;
}

export interface BoardMember {
  user_id: string;
  board_id: string;
  role: Role;
  user_name: string;
  user_email: string;
}
```

`packages/shared/src/types/label.ts`:
```ts
export interface Label {
  id: string;
  board_id: string;
  name: string;
  color: string;
  created_at: string;
}
```

`packages/shared/src/types/comment.ts`:
```ts
export interface Comment {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string | null;
  content: string;
  created_at: string;
  updated_at: string | null;
}
```

`packages/shared/src/types/subtask.ts`:
```ts
export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}
```

`packages/shared/src/types/attachment.ts`:
```ts
export interface Attachment {
  id: string;
  task_id: string;
  board_id: string;
  uploaded_by: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  created_at: string;
}
```

`packages/shared/src/types/custom-field.ts`:
```ts
export type FieldType = "text" | "number" | "url" | "enum" | "date";

export interface CustomField {
  id: string;
  board_id: string;
  name: string;
  field_type: FieldType;
  config: string | null;
  position: number;
}

export interface TaskCustomFieldValue {
  task_id: string;
  field_id: string;
  value: string;
}
```

`packages/shared/src/types/notification.ts`:
```ts
export interface Notification {
  id: string;
  user_id: string;
  board_id: string;
  task_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
}
```

`packages/shared/src/types/agent.ts`:
```ts
export type AgentSessionStatus = "running" | "success" | "failed" | "cancelled";

export interface AgentSession {
  id: string;
  board_id: string;
  task_id: string;
  user_id: string;
  status: AgentSessionStatus;
  branch_name: string | null;
  agent_profile_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  exit_code: number | null;
  log: string | null;
}
```

`packages/shared/src/types/index.ts` — barrel export all types.

- [ ] **Step 2: Write Zod schemas**

`packages/shared/src/schemas/board.ts`:
```ts
import { z } from "zod";

export const createBoardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  repo_url: z.string().url().nullable().optional(),
});

export const updateBoardSchema = createBoardSchema.partial();

export const createColumnSchema = z.object({
  board_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  wip_limit: z.number().int().positive().nullable().optional(),
  color: z.string().max(7).nullable().optional(),
});

export const moveColumnSchema = z.object({
  column_id: z.string().uuid(),
  position: z.number().int().min(0),
});
```

`packages/shared/src/schemas/task.ts`:
```ts
import { z } from "zod";

const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const createTaskSchema = z.object({
  board_id: z.string().uuid(),
  column_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(50000).nullable().optional(),
  priority: prioritySchema.default("medium"),
  assignee: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50000).nullable().optional(),
  priority: prioritySchema.optional(),
  assignee: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export const moveTaskSchema = z.object({
  task_id: z.string().uuid(),
  column_id: z.string().uuid(),
  position: z.number().int().min(0),
});
```

`packages/shared/src/schemas/user.ts`:
```ts
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const inviteSchema = z.object({
  board_id: z.string().uuid(),
  role: z.enum(["member", "viewer"]),
});
```

- [ ] **Step 3: Write constants**

`packages/shared/src/constants/priorities.ts`:
```ts
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const PRIORITY_ORDER: Record<string, number> = {
  low: 0, medium: 1, high: 2, urgent: 3,
};
```

`packages/shared/src/constants/roles.ts`:
```ts
export const ROLES = ["owner", "member", "viewer"] as const;
export const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0, member: 1, owner: 2,
};
```

`packages/shared/src/constants/limits.ts`:
```ts
export const RATE_LIMIT_MAX = 100;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const SESSION_EXPIRY_DAYS = 30;
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_TITLE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 50000;
```

- [ ] **Step 4: Write schema tests**

`packages/shared/src/__tests__/schemas.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTaskSchema } from "../schemas/task";
import { loginSchema, registerSchema } from "../schemas/user";
import { createBoardSchema } from "../schemas/board";

describe("createTaskSchema", () => {
  it("accepts valid task", () => {
    const result = createTaskSchema.safeParse({
      board_id: "550e8400-e29b-41d4-a716-446655440000",
      column_id: "550e8400-e29b-41d4-a716-446655440001",
      title: "Fix bug",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = createTaskSchema.safeParse({
      board_id: "550e8400-e29b-41d4-a716-446655440000",
      column_id: "550e8400-e29b-41d4-a716-446655440001",
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("defaults priority to medium", () => {
    const result = createTaskSchema.parse({
      board_id: "550e8400-e29b-41d4-a716-446655440000",
      column_id: "550e8400-e29b-41d4-a716-446655440001",
      title: "Task",
    });
    expect(result.priority).toBe("medium");
  });
});

describe("loginSchema", () => {
  it("rejects short password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-email", password: "12345678" });
    expect(result.success).toBe(false);
  });
});

describe("createBoardSchema", () => {
  it("accepts valid board", () => {
    const result = createBoardSchema.safeParse({ name: "My Board" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createBoardSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/shared && pnpm test`
Expected: All schema tests pass.

- [ ] **Step 6: Update barrel export and build**

`packages/shared/src/index.ts`:
```ts
export * from "./types/index";
export * from "./schemas/index";
export * from "./constants/index";
```

Run: `pnpm build --filter=@tarmak/shared`
Expected: Build succeeds, `dist/` contains compiled output.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add types, Zod schemas, and constants

Ported from Rust models.rs — Board, Column, Task, User, Label, Comment,
Subtask, Attachment, CustomField, Notification, AgentSession types with
validation schemas and constants."
```

---

## Task 3: @tarmak/kbf — Port KBF Codec

**Files:**
- Create: `packages/kbf/src/types.ts`
- Create: `packages/kbf/src/schema.ts`
- Create: `packages/kbf/src/encode.ts`
- Create: `packages/kbf/src/decode.ts`
- Create: `packages/kbf/src/__tests__/schema.test.ts`
- Create: `packages/kbf/src/__tests__/encode.test.ts`
- Create: `packages/kbf/src/__tests__/decode.test.ts`
- Create: `packages/kbf/src/__tests__/roundtrip.test.ts`
- Modify: `packages/kbf/src/index.ts`

**Reference:** Port directly from `crates/kbf/src/` — schema.rs, encode.rs, decode.rs. The Rust tests serve as the exact test cases.

- [ ] **Step 1: Write schema types and tests**

`packages/kbf/src/types.ts`:
```ts
export type Row = string[];

export type Delta =
  | { type: "update"; id: string; field: string; value: string }
  | { type: "create"; row: Row }
  | { type: "delete"; id: string };
```

`packages/kbf/src/__tests__/schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Schema } from "../schema";

describe("Schema", () => {
  it("encodes to header format", () => {
    const schema = new Schema("task", ["id", "title", "status", "pri", "who"]);
    expect(schema.encode()).toBe("#task@v1:id,title,status,pri,who");
  });

  it("encodes with custom version", () => {
    const schema = new Schema("task", ["id", "title"], 3);
    expect(schema.encode()).toBe("#task@v3:id,title");
  });

  it("parses valid header", () => {
    const schema = Schema.parse("#task@v1:id,title,status");
    expect(schema).not.toBeNull();
    expect(schema!.entity).toBe("task");
    expect(schema!.version).toBe(1);
    expect(schema!.fields).toEqual(["id", "title", "status"]);
  });

  it("returns null for missing #", () => {
    expect(Schema.parse("task@v1:id,title")).toBeNull();
  });

  it("returns null for empty fields", () => {
    expect(Schema.parse("#task@v1:")).toBeNull();
  });

  it("finds field index", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    expect(schema.fieldIndex("title")).toBe(1);
    expect(schema.fieldIndex("missing")).toBe(-1);
  });

  it("roundtrips encode/parse", () => {
    const original = new Schema("board", ["id", "name", "cols"], 2);
    const parsed = Schema.parse(original.encode());
    expect(parsed).toEqual(original);
  });
});
```

- [ ] **Step 2: Implement Schema**

`packages/kbf/src/schema.ts`:
```ts
export class Schema {
  constructor(
    public entity: string,
    public fields: string[],
    public version: number = 1,
  ) {}

  encode(): string {
    return `#${this.entity}@v${this.version}:${this.fields.join(",")}`;
  }

  static parse(line: string): Schema | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) return null;

    const rest = trimmed.slice(1);
    const atPos = rest.indexOf("@");
    if (atPos === -1) return null;

    const entity = rest.slice(0, atPos);
    if (!entity) return null;

    const afterAt = rest.slice(atPos + 1);
    if (!afterAt.startsWith("v")) return null;

    const colonPos = afterAt.indexOf(":");
    if (colonPos === -1) return null;

    const version = Number.parseInt(afterAt.slice(1, colonPos), 10);
    if (Number.isNaN(version)) return null;

    const fieldsStr = afterAt.slice(colonPos + 1);
    if (!fieldsStr) return null;

    const fields = fieldsStr.split(",");
    return new Schema(entity, fields, version);
  }

  fieldIndex(name: string): number {
    return this.fields.indexOf(name);
  }

  addField(name: string): void {
    this.fields.push(name);
    this.version += 1;
  }
}
```

- [ ] **Step 3: Run schema tests**

Run: `cd packages/kbf && pnpm test -- schema`
Expected: All pass.

- [ ] **Step 4: Write encode tests**

`packages/kbf/src/__tests__/encode.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { encodeFull, encodeDelta, rowFromMap } from "../encode";
import { Schema } from "../schema";

describe("encodeFull", () => {
  it("encodes schema + rows", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    const rows = [
      ["t1", "Design login", "doing"],
      ["t2", "Fix bug", "todo"],
    ];
    expect(encodeFull(schema, rows)).toBe(
      "#task@v1:id,title,status\nt1|Design login|doing\nt2|Fix bug|todo",
    );
  });

  it("escapes pipes in values", () => {
    const schema = new Schema("task", ["id", "title"]);
    const rows = [["t1", "A|B"]];
    expect(encodeFull(schema, rows)).toBe("#task@v1:id,title\nt1|A\\|B");
  });
});

describe("encodeDelta", () => {
  it("encodes update, create, delete", () => {
    const deltas = [
      { type: "update" as const, id: "t1", field: "status", value: "done" },
      { type: "create" as const, row: ["t3", "New task", "todo"] },
      { type: "delete" as const, id: "t2" },
    ];
    expect(encodeDelta(deltas)).toBe(">t1.status=done\n>t3|New task|todo+\n>t2-");
  });

  it("escapes pipes in update value", () => {
    const deltas = [{ type: "update" as const, id: "t1", field: "title", value: "X|Y" }];
    expect(encodeDelta(deltas)).toBe(">t1.title=X\\|Y");
  });
});

describe("rowFromMap", () => {
  it("builds row from map using schema order", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    const map = new Map([["id", "t1"], ["title", "Do stuff"]]);
    expect(rowFromMap(schema, map)).toEqual(["t1", "Do stuff", ""]);
  });
});
```

- [ ] **Step 5: Implement encode**

`packages/kbf/src/encode.ts`:
```ts
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
```

- [ ] **Step 6: Run encode tests**

Run: `cd packages/kbf && pnpm test -- encode`
Expected: All pass.

- [ ] **Step 7: Write decode tests**

`packages/kbf/src/__tests__/decode.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeFull, decodeDeltas } from "../decode";

describe("decodeFull", () => {
  it("decodes schema + rows", () => {
    const input = "#task@v1:id,title,status\nt1|Design login|doing\nt2|Fix bug|todo";
    const decoded = decodeFull(input);
    expect(decoded.schema.entity).toBe("task");
    expect(decoded.rows).toHaveLength(2);
    expect(decoded.rows[0]).toEqual(["t1", "Design login", "doing"]);
  });

  it("handles escaped pipes", () => {
    const input = "#task@v1:id,title\nt1|A\\|B";
    const decoded = decodeFull(input);
    expect(decoded.rows[0]).toEqual(["t1", "A|B"]);
  });

  it("pads short rows", () => {
    const input = "#task@v1:id,title,status,pri\nt1|Design login";
    const decoded = decodeFull(input);
    expect(decoded.rows[0]).toEqual(["t1", "Design login", "", ""]);
  });

  it("throws on too many fields", () => {
    const input = "#task@v1:id,title\nt1|Design|extra|fields";
    expect(() => decodeFull(input)).toThrow();
  });

  it("skips empty lines", () => {
    const input = "#task@v1:id,title\n\nt1|Hello\n\nt2|World\n";
    const decoded = decodeFull(input);
    expect(decoded.rows).toHaveLength(2);
  });

  it("throws on missing schema", () => {
    expect(() => decodeFull("")).toThrow();
  });
});

describe("decodeDeltas", () => {
  it("decodes update, create, delete", () => {
    const input = ">t1.status=done\n>t3|New task|todo+\n>t2-";
    const deltas = decodeDeltas(input);
    expect(deltas).toHaveLength(3);
    expect(deltas[0]).toEqual({ type: "update", id: "t1", field: "status", value: "done" });
    expect(deltas[1]).toEqual({ type: "create", row: ["t3", "New task", "todo"] });
    expect(deltas[2]).toEqual({ type: "delete", id: "t2" });
  });

  it("unescapes pipes in update value", () => {
    const deltas = decodeDeltas(">t1.title=X\\|Y");
    expect(deltas[0]).toEqual({ type: "update", id: "t1", field: "title", value: "X|Y" });
  });
});
```

- [ ] **Step 8: Implement decode**

`packages/kbf/src/decode.ts`:
```ts
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
```

- [ ] **Step 9: Run all KBF tests**

Run: `cd packages/kbf && pnpm test`
Expected: All pass.

- [ ] **Step 10: Write roundtrip tests**

`packages/kbf/src/__tests__/roundtrip.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Schema } from "../schema";
import { encodeFull, encodeDelta } from "../encode";
import { decodeFull, decodeDeltas } from "../decode";

describe("roundtrip", () => {
  it("full encode → decode", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    const rows = [["t1", "Build UI", "doing"], ["t2", "Write tests", "todo"]];
    const decoded = decodeFull(encodeFull(schema, rows));
    expect(decoded.schema).toEqual(schema);
    expect(decoded.rows).toEqual(rows);
  });

  it("full with pipes", () => {
    const schema = new Schema("task", ["id", "title"]);
    const rows = [["t1", "A|B|C"]];
    const decoded = decodeFull(encodeFull(schema, rows));
    expect(decoded.rows).toEqual(rows);
  });

  it("delta encode → decode", () => {
    const deltas = [
      { type: "update" as const, id: "t1", field: "status", value: "done" },
      { type: "create" as const, row: ["t3", "New", "todo"] },
      { type: "delete" as const, id: "t2" },
    ];
    expect(decodeDeltas(encodeDelta(deltas))).toEqual(deltas);
  });
});
```

- [ ] **Step 11: Run full test suite and build**

Run: `cd packages/kbf && pnpm test && pnpm build`
Expected: All tests pass, build succeeds.

- [ ] **Step 12: Update barrel export and commit**

`packages/kbf/src/index.ts`:
```ts
export type { Row, Delta } from "./types";
export { Schema } from "./schema";
export { encodeFull, encodeDelta, rowFromMap } from "./encode";
export { decodeFull, decodeDeltas } from "./decode";
export type { Decoded } from "./decode";
```

```bash
git add packages/kbf/
git commit -m "feat(kbf): port KBF codec from Rust to TypeScript

Schema, encode, decode with full roundtrip tests.
Ported from crates/kbf/ with identical test coverage."
```

---

## Task 4: @tarmak/db — Schema + Connection

**Files:**
- Create: `packages/db/src/schema/boards.ts`
- Create: `packages/db/src/schema/columns.ts`
- Create: `packages/db/src/schema/tasks.ts`
- Create: `packages/db/src/schema/users.ts`
- Create: `packages/db/src/schema/labels.ts`
- Create: `packages/db/src/schema/comments.ts`
- Create: `packages/db/src/schema/subtasks.ts`
- Create: `packages/db/src/schema/attachments.ts`
- Create: `packages/db/src/schema/custom-fields.ts`
- Create: `packages/db/src/schema/notifications.ts`
- Create: `packages/db/src/schema/crdt.ts`
- Create: `packages/db/src/schema/agent.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/connection.ts`
- Create: `packages/db/src/__tests__/connection.test.ts`
- Create: `packages/db/drizzle.config.ts`
- Modify: `packages/db/src/index.ts`

**Reference:** Port schema from `crates/tarmak/src/db/migrations.rs` (10 migrations, 14+ tables). Match existing SQLite column names and types exactly for data migration compatibility.

- [ ] **Step 1: Write Drizzle schema files**

One file per entity matching the migration definitions in migrations.rs. Example for the core tables:

`packages/db/src/schema/boards.ts`:
```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  repo_url: text("repo_url"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
```

`packages/db/src/schema/columns.ts`:
```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";

export const columns = sqliteTable("columns", {
  id: text("id").primaryKey(),
  board_id: text("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  wip_limit: integer("wip_limit"),
  color: text("color"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});
```

`packages/db/src/schema/tasks.ts`:
```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";
import { columns } from "./columns";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  board_id: text("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  column_id: text("column_id").notNull().references(() => columns.id),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  assignee: text("assignee"),
  due_date: text("due_date"),
  position: integer("position").notNull().default(0),
  created_at: text("created_at").notNull().default("(datetime('now'))"),
  updated_at: text("updated_at").notNull().default("(datetime('now'))"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  locked_by: text("locked_by"),
  locked_at: text("locked_at"),
});
```

Continue for all remaining tables: `users.ts`, `labels.ts` (labels + task_labels), `comments.ts`, `subtasks.ts`, `attachments.ts`, `custom-fields.ts` (custom_fields + task_custom_field_values), `notifications.ts`, `crdt.ts` (board_crdt_state), `agent.ts` (agent_sessions). Plus `users.ts` includes: users, board_members, invite_links, sessions, api_keys.

`packages/db/src/schema/index.ts` — re-export all tables + define relations.

- [ ] **Step 2: Write connection module**

`packages/db/src/connection.ts`:
```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index";

export type DB = ReturnType<typeof createDb>;

export function createDb(path: string = ":memory:") {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}
```

- [ ] **Step 3: Write connection test**

`packages/db/src/__tests__/connection.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../connection";
import { boards } from "../schema/boards";

describe("createDb", () => {
  it("creates in-memory database", () => {
    const db = createDb();
    expect(db).toBeDefined();
  });

  it("can insert and query a board after migration", () => {
    const db = createDb();
    migrateDb(db); // Push schema to in-memory DB

    db.insert(boards).values({
      id: "test-1",
      name: "Test Board",
    }).run();

    const result = db.select().from(boards).all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Board");
  });
});
```

Update `connection.ts` to add a `migrateDb` helper:
```ts
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export function migrateDb(db: DB) {
  migrate(db, { migrationsFolder: "./src/migrations" });
}
```

For tests, use `migrateDb(db)` in setup. For production, call `migrateDb` at server startup.

- [ ] **Step 4: Run test**

Run: `cd packages/db && pnpm test -- connection`
Expected: Tests pass.

- [ ] **Step 5: Add FTS5 raw SQL migration**

Create `packages/db/src/migrations/0001_fts5.sql` — must match existing Rust V5 migration exactly:
```sql
-- FTS5 search index (cannot be expressed in Drizzle schema DSL)
-- Matches existing schema from Rust migrations.rs V5
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  entity_type, entity_id, board_id, task_id, content,
  tokenize='porter unicode61'
);

-- Task triggers
CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
END;

-- Comment triggers
CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('comment', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE ON comments BEGIN
  DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('comment', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
  DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
END;

-- Subtask triggers
CREATE TRIGGER IF NOT EXISTS subtasks_ai AFTER INSERT ON subtasks BEGIN
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('subtask', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.title);
END;

CREATE TRIGGER IF NOT EXISTS subtasks_ad AFTER DELETE ON subtasks BEGIN
  DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
END;
```

- [ ] **Step 6: Build and commit**

Run: `cd packages/db && pnpm build`
Expected: Build succeeds.

```bash
git add packages/db/
git commit -m "feat(db): Drizzle schema + connection for all 14 tables

Matches existing SQLite schema from Rust migrations v1-v10.
Includes FTS5 virtual table and triggers as raw SQL migration."
```

---

## Task 5: @tarmak/db — Core Repos (boards, columns, tasks)

**Files:**
- Create: `packages/db/src/repo/boards.ts`
- Create: `packages/db/src/repo/columns.ts`
- Create: `packages/db/src/repo/tasks.ts`
- Create: `packages/db/src/__tests__/repo/boards.test.ts`
- Create: `packages/db/src/__tests__/repo/columns.test.ts`
- Create: `packages/db/src/__tests__/repo/tasks.test.ts`

**Reference:** Port from `crates/tarmak/src/db/repo.rs`. Each repo function takes `db: DB` as first parameter.

- [ ] **Step 1: Write board repo tests**

Test creating, listing, getting, updating, deleting boards. Test duplicate board with relations.

- [ ] **Step 2: Implement board repo**

CRUD functions: `createBoard`, `getBoard`, `listBoards`, `updateBoard`, `deleteBoard`, `duplicateBoard`, `addMember`, `removeMember`, `listMembers`, `getMemberRole`.

- [ ] **Step 3: Run board repo tests**

Run: `cd packages/db && pnpm test -- boards`
Expected: All pass.

- [ ] **Step 4: Write column repo tests**

Test creating, listing, moving (reorder positions), archiving/unarchiving columns.

- [ ] **Step 5: Implement column repo**

Functions: `createColumn`, `listColumns`, `updateColumn`, `deleteColumn`, `moveColumn`, `archiveColumn`, `unarchiveColumn`.

- [ ] **Step 6: Run column repo tests**

Run: `cd packages/db && pnpm test -- columns`

- [ ] **Step 7: Write task repo tests**

Test CRUD, move between columns, claim/release with advisory locks, position management.

- [ ] **Step 8: Implement task repo**

Functions: `createTask`, `getTask`, `getTaskWithRelations`, `listTasks`, `updateTask`, `deleteTask`, `moveTask`, `claimTask`, `releaseTask`, `duplicateTask`. Claiming uses `locked_by`/`locked_at` columns with atomic UPDATE WHERE locked_by IS NULL pattern.

- [ ] **Step 9: Run task repo tests**

Run: `cd packages/db && pnpm test -- tasks`

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/repo/ packages/db/src/__tests__/
git commit -m "feat(db): core repos — boards, columns, tasks

CRUD + advisory lock claiming for tasks, column reordering,
board duplication with relations."
```

---

## Task 6: @tarmak/db — Relation Repos

**Files:**
- Create: `packages/db/src/repo/labels.ts`
- Create: `packages/db/src/repo/comments.ts`
- Create: `packages/db/src/repo/subtasks.ts`
- Create: `packages/db/src/repo/attachments.ts`
- Create: `packages/db/src/repo/custom-fields.ts`
- Create: tests for each

**Reference:** Port label attach/detach, comment CRUD, subtask CRUD with position, attachment CRUD, custom field CRUD + values.

- [ ] **Step 1: Write tests for labels, comments, subtasks**
- [ ] **Step 2: Implement label, comment, subtask repos**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Write tests for attachments, custom fields**
- [ ] **Step 5: Implement attachment, custom field repos**
- [ ] **Step 6: Run all relation repo tests**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(db): relation repos — labels, comments, subtasks, attachments, custom fields"
```

---

## Task 7: @tarmak/db — Specialized Repos

**Files:**
- Create: `packages/db/src/repo/notifications.ts`
- Create: `packages/db/src/repo/search.ts`
- Create: `packages/db/src/repo/archive.ts`
- Create: `packages/db/src/repo/agent.ts`
- Create: `packages/db/src/repo/crdt.ts`
- Create: tests for each

**Reference:** Notification CRUD + unread count, FTS5 search, archive/unarchive (tasks + columns), agent session CRUD, CRDT state load/save.

- [ ] **Step 1: Write tests for notifications, search**
- [ ] **Step 2: Implement notification + search repos**

Search uses raw SQL for FTS5: `SELECT task_id, title, snippet(search_index, 2, '<b>', '</b>', '...', 32) FROM search_index WHERE search_index MATCH ? AND board_id = ?`

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Write tests for archive, agent, crdt**
- [ ] **Step 5: Implement archive, agent, crdt repos**

CRDT repo: `loadState(boardId)` returns `Uint8Array | null`, `saveState(boardId, state: Uint8Array)` stores binary CRDT state.

- [ ] **Step 6: Run all specialized repo tests**
- [ ] **Step 7: Update packages/db/src/index.ts barrel export**

Export: `createDb`, `DB` type, all schema tables, all repo functions.

- [ ] **Step 8: Build and commit**

```bash
pnpm build --filter=@tarmak/db
git commit -m "feat(db): specialized repos — notifications, search, archive, agent, crdt"
```

---

## Task 8: apps/api — Hono + Middleware + Better Auth

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/middleware/security.ts`
- Create: `apps/api/src/middleware/rate-limit.ts`
- Create: `apps/api/src/middleware/static.ts`
- Create: `apps/api/src/auth/config.ts`
- Create: `apps/api/src/__tests__/app.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write Hono app with security middleware**

`apps/api/src/app.ts`:
```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { securityHeaders } from "./middleware/security";
import { createDb } from "@tarmak/db";

export function createApp(dbPath?: string) {
  const db = createDb(dbPath);

  const app = new Hono();

  // CORS
  const origins = (process.env.TARMAK_ALLOWED_ORIGINS ?? "http://localhost:3000").split(",");
  app.use("*", cors({ origin: origins, credentials: true }));

  // Security headers
  app.use("*", securityHeaders());

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  return { app, db };
}
```

`apps/api/src/middleware/security.ts`:
```ts
import { createMiddleware } from "hono/factory";

export function securityHeaders() {
  return createMiddleware(async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  });
}
```

- [ ] **Step 2: Configure Better Auth**

`apps/api/src/auth/config.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, invitation, organization } from "better-auth/plugins";
import type { DB } from "@tarmak/db";

export function createAuth(db: DB) {
  return betterAuth({
    database: drizzleAdapter(db),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 30 * 24 * 60 * 60 }, // 30 days
    plugins: [
      apiKey({ prefix: "ok_" }),
      invitation(),
      organization(),
    ],
  });
}
```

- [ ] **Step 3: Wire up entry point**

`apps/api/src/index.ts`:
```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";

const { app } = createApp(dbPath);

console.log(`tarmak api listening on port ${port}`);
serve({ fetch: app.fetch, port });
```

- [ ] **Step 4: Write smoke test**

`apps/api/src/__tests__/app.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

describe("app", () => {
  it("responds to health check", async () => {
    const { app } = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("sets security headers", async () => {
    const { app } = createApp();
    const res = await app.request("/health");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
```

- [ ] **Step 5: Run test and verify**

Run: `cd apps/api && pnpm test`
Expected: Health check and security header tests pass.

- [ ] **Step 6: Create pino logger**

`apps/api/src/logger.ts`:
```ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino-pretty" }
    : undefined,
});
```

Use `logger.info()`, `logger.error()` etc. throughout the app instead of `console.log`.

- [ ] **Step 7: Add vitest.config.ts to all packages**

Each package/app needs a vitest config for workspace resolution. Example for `apps/api`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
  },
});
```

Create similar configs in `packages/shared/`, `packages/db/`, `packages/kbf/`.

- [ ] **Step 8: Better Auth compatibility check**

Before proceeding, verify:
1. Better Auth's `organization()` plugin supports board-level membership (not just global orgs). If not, keep custom `board_members` table and use Better Auth only for auth (email/password, sessions).
2. Better Auth's `apiKey()` plugin supports the existing `ok_` prefix format. If not, keep custom API key management.
3. Better Auth creates its own tables — ensure they don't conflict with the existing `users`/`sessions` tables. May need to configure table name prefixes.

Document findings and adjust `auth/config.ts` accordingly.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(api): Hono app scaffold with security middleware and Better Auth"
```

---

## Task 9: apps/api — tRPC Scaffold + Service Layer

**Files:**
- Create: `apps/api/src/trpc/context.ts`
- Create: `apps/api/src/trpc/router.ts`
- Create: `apps/api/src/trpc/middleware/auth.ts`
- Create: `apps/api/src/trpc/middleware/roles.ts`
- Create: `apps/api/src/services/task.ts`
- Create: `apps/api/src/services/board.ts`
- Create: `apps/api/src/__tests__/trpc-scaffold.test.ts`

**Reference:** tRPC context provides `{ db, user, session }`. Service layer ports orchestration from `crates/tarmak/src/lib.rs` Tarmak struct.

- [ ] **Step 1: Create tRPC context**

`apps/api/src/trpc/context.ts`:
```ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { DB } from "@tarmak/db";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export interface Context {
  db: DB;
  user: { id: string; name: string; email: string } | null;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return { ...shape, data: { ...shape.data } };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
```

- [ ] **Step 2: Create auth middleware**

`apps/api/src/trpc/middleware/auth.ts`:
```ts
import { TRPCError } from "@trpc/server";
import { middleware, publicProcedure } from "../context";

const isAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = publicProcedure.use(isAuthed);
```

`apps/api/src/trpc/middleware/roles.ts`:
```ts
import { TRPCError } from "@trpc/server";
import { middleware } from "../context";
import { ROLE_HIERARCHY } from "@tarmak/shared";
import type { Role } from "@tarmak/shared";

export function requireRole(minimumRole: Role) {
  return middleware(async ({ ctx, next, rawInput }) => {
    // Board role check logic — looks up board_id from input, checks member role
    // Implementation depends on how board_id is passed in each procedure
    return next({ ctx });
  });
}
```

- [ ] **Step 3: Create TaskService**

`apps/api/src/services/task.ts` — port orchestration from `lib.rs` Tarmak struct:
```ts
import type { DB } from "@tarmak/db";
import * as taskRepo from "@tarmak/db/repo/tasks";
import * as columnRepo from "@tarmak/db/repo/columns";

export class TaskService {
  constructor(private db: DB) {}

  /** Atomically claim next available task on a board */
  async claimTask(boardId: string, agentId: string) {
    return taskRepo.claimTask(this.db, boardId, agentId);
  }

  /** Release a claimed task */
  async releaseTask(taskId: string, reason?: string) {
    return taskRepo.releaseTask(this.db, taskId);
  }

  /** Claim a specific task by ID */
  async claimSpecificTask(taskId: string, agentId: string) {
    return taskRepo.claimSpecificTask(this.db, taskId, agentId);
  }

  /** Decompose an objective into subtasks with DAG validation */
  async decompose(objectiveId: string, boardId: string, tasks: DecomposeInput[]) {
    // Validate DAG — topological sort to detect cycles
    validateDag(tasks);
    // Create tasks in first column
    const columns = columnRepo.listColumns(this.db, boardId);
    const firstColumn = columns.sort((a, b) => a.position - b.position)[0];
    if (!firstColumn) throw new Error("Board has no columns");
    // Create each task...
  }

  /** Move task to last column (complete) */
  async completeTask(taskId: string) {
    const task = taskRepo.getTask(this.db, taskId);
    if (!task) throw new Error("Task not found");
    const columns = columnRepo.listColumns(this.db, task.board_id);
    const lastColumn = columns.sort((a, b) => b.position - a.position)[0];
    if (lastColumn) {
      taskRepo.moveTask(this.db, taskId, lastColumn.id, 0);
    }
  }
}

interface DecomposeInput {
  title: string;
  description?: string;
  priority?: string;
  depends_on?: number[];
}

/** Topological sort to validate no cycles in task dependencies */
function validateDag(tasks: DecomposeInput[]): void {
  const n = tasks.length;
  const inDegree = new Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (const dep of tasks[i].depends_on ?? []) {
      if (dep < 0 || dep >= n) throw new Error(`Invalid dependency index: ${dep}`);
      adj[dep].push(i);
      inDegree[i]++;
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  if (visited !== n) throw new Error("Cycle detected in task dependencies");
}
```

- [ ] **Step 4: Create root router**

`apps/api/src/trpc/router.ts`:
```ts
import { router } from "./context";

// Sub-routers will be added in subsequent tasks
export const appRouter = router({});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Write scaffold test**

Test that tRPC context can be created and a basic procedure works.

- [ ] **Step 6: Run tests and commit**

```bash
git commit -m "feat(api): tRPC scaffold with auth middleware and TaskService

Context, protected procedures, role middleware.
TaskService with claim/release/decompose/complete (DAG validation)."
```

---

## Task 10: apps/api — Board & Column Procedures

**Files:**
- Create: `apps/api/src/trpc/procedures/boards.ts`
- Create: `apps/api/src/trpc/procedures/columns.ts`
- Create: `apps/api/src/__tests__/procedures/boards.test.ts`
- Create: `apps/api/src/__tests__/procedures/columns.test.ts`
- Modify: `apps/api/src/trpc/router.ts`

**Reference:** Port from `crates/tarmak/src/api/boards.rs` and `columns.rs`. Use tRPC caller for tests.

- [ ] **Step 1: Write board procedure tests using tRPC caller**
- [ ] **Step 2: Implement board procedures** (create, list, get, update, delete, duplicate, members)
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Write column procedure tests**
- [ ] **Step 5: Implement column procedures** (create, list, update, delete, move, archive/unarchive)
- [ ] **Step 6: Run tests and commit**

---

## Task 11: apps/api — Task Procedures

**Files:**
- Create: `apps/api/src/trpc/procedures/tasks.ts`
- Create: `apps/api/src/__tests__/procedures/tasks.test.ts`
- Modify: `apps/api/src/trpc/router.ts`

- [ ] **Step 1: Write task procedure tests**
- [ ] **Step 2: Implement task procedures** (create, get, list, update, delete, move, duplicate, claim, release)
- [ ] **Step 3: Run tests and commit**

---

## Task 12: apps/api — Relation Procedures

**Files:**
- Create: `apps/api/src/trpc/procedures/labels.ts`
- Create: `apps/api/src/trpc/procedures/comments.ts`
- Create: `apps/api/src/trpc/procedures/subtasks.ts`
- Create: `apps/api/src/trpc/procedures/attachments.ts`
- Create: `apps/api/src/trpc/procedures/custom-fields.ts`
- Create: tests for each
- Modify: `apps/api/src/trpc/router.ts`

**Note:** Attachments use Hono multipart route (not tRPC) for file upload. The tRPC procedure handles metadata listing/deletion only. The upload route is mounted directly on the Hono app.

- [ ] **Step 1: Write tests for labels, comments, subtasks**
- [ ] **Step 2: Implement label, comment, subtask procedures**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Write tests for attachments, custom fields**
- [ ] **Step 5: Implement attachment (Hono multipart upload + tRPC metadata), custom field procedures**
- [ ] **Step 6: Run tests and commit**

---

## Task 13: apps/api — Remaining Procedures

**Files:**
- Create: `apps/api/src/trpc/procedures/notifications.ts`
- Create: `apps/api/src/trpc/procedures/search.ts`
- Create: `apps/api/src/trpc/procedures/archive.ts`
- Create: `apps/api/src/trpc/procedures/agent.ts`
- Create: `apps/api/src/trpc/procedures/activity.ts`
- Create: tests for each
- Modify: `apps/api/src/trpc/router.ts`

- [ ] **Step 1: Implement notifications** (list, markRead, createStreamTicket)
- [ ] **Step 2: Implement search** (FTS5 query)
- [ ] **Step 3: Implement archive** (archive/unarchive tasks + columns, list archived)
- [ ] **Step 4: Implement agent session procedures** (create, get, update, list, cancel)
- [ ] **Step 5: Implement activity** (list board activity)
- [ ] **Step 6: Run all procedure tests and commit**

---

## Task 14: apps/api — WebSocket Sync (Yjs)

**Files:**
- Create: `apps/api/src/sync/ws.ts`
- Create: `apps/api/src/sync/doc-manager.ts`
- Create: `apps/api/src/__tests__/sync.test.ts`
- Modify: `apps/api/src/app.ts` (mount WS route)

**Reference:** Port from `crates/tarmak/src/sync/ws.rs` and `doc.rs`. Use native Yjs (not Yrs).

- [ ] **Step 1: Implement DocManager**

`apps/api/src/sync/doc-manager.ts`:
```ts
import * as Y from "yjs";
import type { DB } from "@tarmak/db";
import * as crdtRepo from "@tarmak/db/repo/crdt";

export class DocManager {
  private docs = new Map<string, Y.Doc>();

  constructor(private db: DB) {}

  getOrCreate(boardId: string): Y.Doc {
    let doc = this.docs.get(boardId);
    if (doc) return doc;

    doc = new Y.Doc();
    this.docs.set(boardId, doc);
    return doc;
  }

  initFromDb(boardId: string): Y.Doc {
    const doc = this.getOrCreate(boardId);
    const state = crdtRepo.loadState(this.db, boardId);
    if (state) {
      Y.applyUpdate(doc, state);
    }
    return doc;
  }

  encodeFullState(boardId: string): Uint8Array {
    const doc = this.getOrCreate(boardId);
    return Y.encodeStateAsUpdate(doc);
  }

  persist(boardId: string): void {
    const doc = this.docs.get(boardId);
    if (!doc) return;
    const state = Y.encodeStateAsUpdate(doc);
    crdtRepo.saveState(this.db, boardId, Buffer.from(state));
  }

  remove(boardId: string): void {
    const doc = this.docs.get(boardId);
    if (doc) {
      doc.destroy();
      this.docs.delete(boardId);
    }
  }
}
```

- [ ] **Step 2: Implement WebSocket handler**

`apps/api/src/sync/ws.ts` — handles WebSocket upgrade, auth check, Yjs sync protocol, broadcast relay, debounced persistence (1s minimum interval).

- [ ] **Step 3: Mount on Hono app, write tests**
- [ ] **Step 4: Run tests and commit**

```bash
git commit -m "feat(api): WebSocket sync with Yjs CRDT

DocManager for per-board Y.Doc lifecycle.
Broadcast relay, debounced persistence, token auth."
```

---

## Task 15: apps/api — Notification SSE + Background Jobs

**Files:**
- Create: `apps/api/src/notifications/broadcaster.ts`
- Create: `apps/api/src/background/deadlines.ts`
- Create: `apps/api/src/background/sessions.ts`
- Modify: `apps/api/src/app.ts`

**Reference:** Port SSE ticket-based auth from `crates/tarmak/src/api/notifications.rs`. Background jobs from `background.rs`.

- [ ] **Step 1: Implement broadcaster** (EventEmitter wrapping per-user notification channels)
- [ ] **Step 2: Add SSE endpoint with ticket auth** (Hono streaming response)
- [ ] **Step 3: Implement deadline checker** (setInterval, queries overdue tasks, sends notifications)
- [ ] **Step 4: Implement session cleanup** (setInterval, deletes expired sessions)
- [ ] **Step 5: Run tests and commit**

---

## Task 16: apps/api — MCP Server

**Files:**
- Create: `apps/api/src/mcp/server.ts`
- Create: `apps/api/src/mcp/tools/board-query.ts`
- Create: `apps/api/src/mcp/tools/board-mutate.ts`
- Create: `apps/api/src/mcp/tools/board-sync.ts`
- Create: `apps/api/src/mcp/tools/board-ask.ts`
- Create: `apps/api/src/mcp/transport.ts`
- Create: `apps/api/src/__tests__/mcp.test.ts`
- Modify: `apps/api/src/index.ts` (add --mcp flag)

**Reference:** Port from `crates/tarmak/src/mcp/tools.rs` and `board_ask.rs`. Use `@modelcontextprotocol/sdk`.

- [ ] **Step 1: Create McpServer with 4 tool registrations**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export function createMcpServer(db: DB) {
  const server = new McpServer({ name: "tarmak", version: "1.0.0" });

  server.tool("board_query", "Query kanban board state", { /* zod schema */ }, async (params) => {
    // Dispatch to board-query handler
  });

  server.tool("board_mutate", "Modify kanban board state", { /* zod schema */ }, async (params) => {
    // Dispatch to board-mutate handler
  });

  server.tool("board_sync", "Sync board state via KBF deltas", { /* zod schema */ }, async (params) => {
    // Dispatch to board-sync handler
  });

  server.tool("board_ask", "Ask natural language questions about board", { /* zod schema */ }, async (params) => {
    // Dispatch to board-ask handler
  });

  return server;
}
```

- [ ] **Step 2: Implement board_query handler** (list boards, tasks, columns, labels in KBF or JSON)
- [ ] **Step 3: Implement board_mutate handler** (30+ actions from tools.rs)
- [ ] **Step 4: Implement board_sync handler** (KBF delta apply)
- [ ] **Step 5: Implement board_ask handler** (NLP pattern matching from board_ask.rs)
- [ ] **Step 6: Add stdio + Streamable HTTP transports**

```ts
// Stdio mode (--mcp flag)
const transport = new StdioServerTransport();
await server.connect(transport);

// HTTP mode (mounted on Hono)
// Use @modelcontextprotocol/sdk StreamableHTTPServerTransport
```

- [ ] **Step 7: Write MCP tests, run and commit**

```bash
git commit -m "feat(api): MCP server with 4 tools — query, mutate, sync, ask

Stdio + Streamable HTTP transports.
KBF integration for token-efficient responses.
NLP board queries with FTS5 fallback."
```

---

## Task 17: apps/api — CLI

**Files:**
- Create: `apps/api/src/cli/backup.ts`
- Create: `apps/api/src/cli/restore.ts`
- Create: `apps/api/src/cli/export.ts`
- Create: `apps/api/src/cli/import.ts`
- Create: `apps/api/src/cli/users.ts`
- Modify: `apps/api/src/index.ts` (add CLI subcommand parsing)

**Reference:** Port from `crates/tarmak/src/cli.rs`. Use process.argv or a lightweight CLI lib.

- [ ] **Step 1: Implement backup** (copy SQLite file atomically)
- [ ] **Step 2: Implement restore** (restore from backup file)
- [ ] **Step 3: Implement export** (dump all boards as JSON)
- [ ] **Step 4: Implement import** (load boards from JSON)
- [ ] **Step 5: Implement users** (list users, reset password)
- [ ] **Step 6: Wire CLI dispatch in index.ts**

```ts
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "serve": /* start HTTP server */ break;
  case "mcp": /* start MCP stdio */ break;
  case "agent": /* start agent server */ break;
  case "backup": /* ... */ break;
  case "restore": /* ... */ break;
  case "export": /* ... */ break;
  case "import": /* ... */ break;
  case "users": /* ... */ break;
  default: /* serve */ break;
}
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(api): CLI commands — backup, restore, export, import, users"
```

---

## Task 18: apps/web — tRPC Client + Store Migration

**Files:**
- Create: `apps/web/src/lib/trpc.ts`
- Delete: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/stores/board.ts`
- Modify: `apps/web/src/stores/auth.ts`
- Modify: `apps/web/src/stores/notifications.ts`
- Modify: `apps/web/src/stores/agent.ts`
- Modify: all pages and components that import from `lib/api`
- Modify: `apps/web/package.json` (add tRPC deps)

**Reference:** Replace all `api.xyz()` calls with `trpc.xyz.query()` / `trpc.xyz.mutate()`.

- [ ] **Step 1: Add tRPC dependencies**

```bash
cd apps/web && pnpm add @trpc/client @trpc/react-query @tanstack/react-query
```

- [ ] **Step 2: Create tRPC client**

`apps/web/src/lib/trpc.ts`:
```ts
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
// AppRouter must be exported from apps/api/src/index.ts
// and declared in apps/api/package.json exports:
//   "exports": { "./trpc": { "types": "./dist/trpc/router.d.ts" } }
import type { AppRouter } from "@tarmak/api/trpc";

export const trpc = createTRPCReact<AppRouter>();

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/trpc`,
        headers() {
          const token = localStorage.getItem("token");
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
```

- [ ] **Step 3: Wrap app with tRPC + QueryClient providers**

Update `apps/web/src/main.tsx` to wrap with `trpc.Provider` and `QueryClientProvider`.

- [ ] **Step 4: Migrate board store**

Replace all `api.getBoards()`, `api.createBoard()`, etc. with `trpc.boards.list.query()`, `trpc.boards.create.mutate()`. Remove the fetch-based API client.

- [ ] **Step 5: Migrate auth store**

Better Auth provides a client SDK. Replace manual login/register/token handling.

- [ ] **Step 6: Migrate remaining stores and components**

Search for all `import.*from.*lib/api` and replace with tRPC calls. Update components that call store actions.

- [ ] **Step 7: Delete lib/api.ts**
- [ ] **Step 8: Run frontend tests and verify**

Run: `cd apps/web && pnpm test && pnpm build`
Expected: All tests pass, build succeeds.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(web): migrate from REST api.ts to tRPC client

Replace all manual fetch calls with type-safe tRPC procedures.
Add @trpc/react-query + @tanstack/react-query providers."
```

---

## Task 19: apps/agent — Hono Migration

**Files:**
- Modify: `apps/agent/src/server.ts`
- Modify: `apps/agent/src/index.ts`
- Modify: `apps/agent/package.json`

**Reference:** Replace Fastify with Hono. Keep all other modules (sdk, config, detect, callback, worktree, repo-cache, token) unchanged.

- [ ] **Step 1: Replace Fastify deps with Hono**

```bash
cd apps/agent && pnpm remove fastify @fastify/cors @fastify/websocket && pnpm add hono @hono/node-server
```

- [ ] **Step 2: Rewrite server.ts with Hono**

Replace Fastify route/plugin API with Hono equivalents:
- `fastify.register(cors)` → `app.use("*", cors(...))`
- `fastify.get("/ws", { websocket: true })` → Hono WebSocket upgrade
- `fastify.post("/sessions")` → `app.post("/sessions", ...)`
- `fastify.listen()` → `serve({ fetch: app.fetch, port })`

Keep all business logic (session management, tool registration, worktree management) identical.

- [ ] **Step 3: Run agent tests and verify**

Run: `cd apps/agent && pnpm test && pnpm build`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent): migrate from Fastify to Hono

Same functionality, consistent framework across all apps."
```

---

## Task 20: Docker + CI + Makefile

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml` (new, replaces backend.yml + frontend.yml)
- Modify: `.github/workflows/e2e.yml`
- Modify: `.github/workflows/deploy.yml`
- Delete: `.github/workflows/backend.yml`
- Delete: `.github/workflows/frontend.yml`

- [ ] **Step 1: Rewrite Dockerfile**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/apps/api/dist/ apps/api/dist/
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/apps/web/dist/ apps/web/dist/
RUN pnpm install --prod --frozen-lockfile

ENV PORT=4000
ENV DATABASE_PATH=/data/tarmak.db
EXPOSE 4000

CMD ["node", "apps/api/dist/index.js"]
```

- [ ] **Step 2: Update Makefile**

```makefile
.PHONY: dev back front agent build clean install kill help

dev:
	pnpm dev

back:
	pnpm --filter=@tarmak/api dev

front:
	pnpm --filter=@tarmak/web dev

agent:
	pnpm --filter=@tarmak/agent dev

build:
	pnpm build

clean:
	rm -rf node_modules packages/*/dist apps/*/dist .turbo packages/*/.turbo apps/*/.turbo

install:
	pnpm install

kill:
	-pkill -f "tsx watch" 2>/dev/null || true
	-pkill -f "vite" 2>/dev/null || true

test:
	pnpm test

lint:
	pnpm lint

help:
	@echo "dev     - Start all dev servers"
	@echo "back    - Backend only"
	@echo "front   - Frontend only"
	@echo "agent   - Agent server only"
	@echo "build   - Production build"
	@echo "test    - Run all tests"
	@echo "lint    - Lint all packages"
	@echo "clean   - Clean artifacts"
	@echo "install - Install dependencies"
	@echo "kill    - Kill dev processes"
```

- [ ] **Step 3: Create unified CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 4: Update e2e.yml and deploy.yml**

Adapt to new build commands (pnpm instead of cargo).

- [ ] **Step 5: Delete old backend.yml and frontend.yml**
- [ ] **Step 6: Commit**

```bash
git commit -m "chore: update Docker, CI, and Makefile for TypeScript monorepo"
```

---

## Task 21: Data Migration + Cleanup

**Files:**
- Delete: `crates/` (entire directory)
- Delete: `Cargo.toml`, `Cargo.lock`
- Delete: `.cargo/`
- Modify: `.gitignore` (remove Rust-specific entries)
- Modify: `CLAUDE.md` (update for new architecture)

- [ ] **Step 1: Test data migration path**

Using the old Rust binary (if still available):
```bash
# Export from old system
./target/release/tarmak export --output boards-export.json

# Start new TS server
cd apps/api && pnpm dev

# Import into new system
node apps/api/dist/index.js import --input boards-export.json
```

Verify data integrity: check board counts, task counts, member associations.

- [ ] **Step 2: Remove Rust crates**

```bash
rm -rf crates/ Cargo.toml Cargo.lock .cargo/ rust-toolchain.toml
```

- [ ] **Step 3: Update .gitignore**

Remove Rust entries (`target/`, `*.rs.bk`), keep Node entries.

- [ ] **Step 4: Update CLAUDE.md and .env.example**

Update architecture section, commands section, and patterns to reflect the new TypeScript monorepo.

Update `.env.example` to add `BETTER_AUTH_SECRET` and remove any Rust-specific vars.

- [ ] **Step 5: Create seed.ts**

`packages/db/src/seed.ts` — dev seed data for testing:
```ts
import { createDb, migrateDb } from "./connection";
import * as boardRepo from "./repo/boards";
import * as columnRepo from "./repo/columns";

export function seedDb(db: DB) {
  // Create a demo board with columns
  boardRepo.createBoard(db, { id: "demo", name: "Demo Board" });
  columnRepo.createColumn(db, { id: "col-1", board_id: "demo", name: "Backlog", position: 0 });
  columnRepo.createColumn(db, { id: "col-2", board_id: "demo", name: "In Progress", position: 1 });
  columnRepo.createColumn(db, { id: "col-3", board_id: "demo", name: "Done", position: 2 });
}
```

- [ ] **Step 6: Final full build + test**

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Expected: Everything passes with zero Rust dependencies.

- [ ] **Step 7: Commit**

```bash
git commit -m "chore: remove Rust crates, complete TypeScript migration

Full monorepo: Turborepo + Hono + tRPC + Better Auth + Drizzle.
All 14 SQLite tables, 4 MCP tools, WebSocket CRDT sync preserved."
```
