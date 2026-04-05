# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-04-05

Initial public release.

### Added

- **Kanban board** — drag-and-drop columns and tasks with @dnd-kit
- **Multiple views** — kanban, sortable list, Gantt-style timeline, sessions
- **Real-time collaboration** — CRDT sync via Yjs over WebSocket with live presence
- **Multi-user** — role-based access (Owner, Member, Viewer), invite links
- **Rich text editing** — Tiptap-based markdown editor with mentions
- **Custom fields, labels, subtasks, comments, attachments**
- **Notifications** — SSE-based real-time notifications with deadline reminders
- **Search** — full-text search across boards and tasks
- **i18n** — English and French, auto-detected from browser
- **MCP server** — stdio and SSE transports with 4 tools (query, mutate, sync, ask)
- **KBF** (Kanban Bit Format) — compact token-efficient serialization for AI
- **Atomic task claiming** — advisory locks prevent agent race conditions
- **Agent sessions** — embedded terminal (xterm.js) to run Claude Code on tasks
- **Skills plugin** — Claude Code integration (brainstorming, planning, TDD, debugging, code review)
- **TypeScript monorepo** — Turborepo, Hono, tRPC, Drizzle ORM
- **SQLite** — WAL mode, auto-migrations, zero external dependencies
- **Docker** — multi-stage build, published to ghcr.io
- **CLI** — backup, restore, export, import, user management, password reset
- **CI/CD** — GitHub Actions for lint, test, E2E, Docker publish
