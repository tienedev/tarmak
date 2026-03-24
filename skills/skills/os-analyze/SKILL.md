---
name: os-analyze
description: Use when analyzing an open-source project before contributing. Triggered by clicking Run on a task in the "To Analyze" column of the Open Source Contributions board. Studies the project's contribution practices, analyzes the issue, and produces an implementation plan. Use this skill whenever a task description contains a GitHub issue URL and needs contribution analysis.
---

# OS Analyze

## Overview

Deeply study an open-source project to understand how it accepts contributions, then analyze a specific issue and produce a concrete implementation plan. The goal is to never submit a PR that gets rejected for process reasons — understand the project before writing a single line of code.

**Announce at start:** "I'm using the os-analyze skill to study this project's contribution practices and plan the implementation."

## Context

You're running in a git worktree of the target repo. The task description contains a GitHub issue URL and a brief problem summary. Your job is to build a "project profile" and an implementation plan, then update the Tarmak task.

## Step 1: Extract Task Context

Get the task ID and board context:

```bash
# Get task ID from branch name (format: agent/{task_short}-{session_short})
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TASK_SHORT=$(echo "$BRANCH" | sed 's|agent/||' | cut -d'-' -f1)
```

Then query the board to find your task:
- `board_query` with `board_id: "list"` to find the "Open Source Contributions" board
- `board_query` with `scope: "tasks"` to find the task matching your branch

Extract the **issue URL** from the task description (e.g., `https://github.com/owner/repo/issues/123`).

## Step 2: Study the Project

Read these files from the repo (skip any that don't exist):

1. **CONTRIBUTING.md** — the most important file. Note: PR size expectations, branch naming, commit format, CLA requirements, review process
2. **CODE_OF_CONDUCT.md** — note any specific requirements
3. **.github/PULL_REQUEST_TEMPLATE.md** — this is the checklist you'll need to satisfy
4. **.github/ISSUE_TEMPLATE/** — understand how they categorize issues
5. **package.json** — scripts section: test command, lint command, build command
6. **tsconfig.json / .eslintrc* / prettier config** — code style expectations
7. **CI config** (`.github/workflows/`) — what checks must pass

## Step 3: Analyze Recent PRs

This is where you learn what actually gets accepted vs rejected.

**5 recently merged PRs:**
```bash
gh pr list --repo owner/repo --state merged --limit 5 --json number,title,additions,deletions,files,commits
```

For each, note:
- Size (additions/deletions) — what's the typical PR size?
- Number of commits — do they squash? One commit per PR?
- Commit message format — conventional commits? Other format?
- Files changed — how focused are the changes?

**3 recently closed (not merged) PRs:**
```bash
gh pr list --repo owner/repo --state closed --limit 10 --json number,title,mergedAt,closedAt,comments
```

Filter for those where `mergedAt` is null (closed without merging). For each, read the comments to understand WHY it was rejected:
```bash
gh pr view <number> --repo owner/repo --comments
```

Common rejection reasons to watch for: too large, wrong approach, duplicate, not following guidelines, missing tests, breaking changes.

## Step 4: Deep-Read the Issue

```bash
gh issue view <number> --repo owner/repo --comments
```

Understand:
- **What's the actual problem?** (not just the title)
- **Is there a reproduction case?**
- **Has a maintainer commented?** Their comments are gold — they may hint at the desired approach
- **Are there linked PRs?** (attempted fixes that failed)
- **Labels** — bug vs feature vs docs affects the approach

## Step 5: Identify Relevant Source Files

Based on the issue, find the files you'll likely need to change:

1. Search for keywords from the issue in the codebase
2. Trace the code path from entry point to the bug
3. Find existing tests for the affected code
4. Note the test framework and test patterns used

## Step 6: Build the Implementation Plan

Write a concrete plan with:

**Project Profile:**
- Commit message format (from PR analysis)
- PR size expectations (from merged PR analysis)
- Test framework and how to run tests
- Lint/format commands
- CI requirements
- Any CLA or sign-off requirements

**Implementation Steps:**
1. What test to write first (TDD)
2. What files to modify and what changes to make
3. What conventions to follow (from the project's own code)
4. What the commit message should look like
5. What the PR description should cover (from the template)

**Risk Assessment:**
- Is this a straightforward fix or could it have side effects?
- Are there related areas that might break?
- Does the maintainer seem receptive to external contributions?

## Step 7: Update Tarmak Task

Use `board_mutate` to update the task:

1. **Update description** with the project profile + implementation plan:
   ```
   board_mutate action "update_task" with task_id, data: {
     description: "<the full project profile + implementation plan>"
   }
   ```

2. **Add a comment** with the analysis summary:
   ```
   board_mutate action "add_comment" with task_id, user_id, content:
   "📋 Analysis complete

   **Project:** <repo> (⭐ <stars>)
   **Issue:** #<number> — <title>
   **Commit format:** <format observed>
   **PR expectations:** <size, focus>
   **Test framework:** <framework>
   **Risk level:** <low/medium/high> — <why>
   **Rejection patterns:** <what to avoid>

   Plan ready for review. Move to 'To Dev' when ready to implement."
   ```

3. **Move task** to the "To Dev" column:
   ```
   board_mutate action "move_task" with task_id, column_id: <To Dev column ID>
   ```

## What Makes a Good Analysis

- **Specific, not generic.** Don't say "follow the project's conventions" — say "use conventional commits with scope: `fix(router): ...`"
- **Evidence-based.** Every recommendation should reference a specific merged PR, CONTRIBUTING.md section, or maintainer comment
- **Actionable.** The dev phase should be able to follow the plan step by step without needing to re-analyze anything
- **Honest about risk.** If the issue looks too complex or the maintainers seem unlikely to accept external PRs, say so — it's better to drop early than waste tokens on a doomed PR
