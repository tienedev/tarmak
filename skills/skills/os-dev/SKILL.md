---
name: os-dev
description: Use when implementing a fix for an open-source issue. Triggered by clicking Run on a task in the "To Dev" column of the Open Source Contributions board. The task description contains the project profile and implementation plan from the os-analyze phase. Implements the fix using TDD, commits locally, but does NOT push.
---

# OS Dev

## Overview

Implement the fix for an open-source issue following the implementation plan produced by the analysis phase. Write tests first, make the minimal change, and commit locally. Never push — that's the ship phase.

**Announce at start:** "I'm using the os-dev skill to implement the fix following the analysis plan."

## Context

You're running in a git worktree of the target repo. The task description contains:
- The issue URL and problem summary
- A **project profile** (commit format, test framework, lint commands, CI requirements)
- An **implementation plan** (files to change, tests to write, conventions to follow)

Your job is to execute that plan, commit locally, and update the Tarmak task.

## Step 1: Extract Task Context

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TASK_SHORT=$(echo "$BRANCH" | sed 's|agent/||' | cut -d'-' -f1)
```

Query the board to find your task:
- `board_query` with `board_id: "list"` to find the "Open Source Contributions" board
- `board_query` with `scope: "tasks"` to find the task matching your branch

Read the task description to extract the **project profile** and **implementation plan**.

## Step 2: Understand the Codebase

Before writing code, read the files identified in the implementation plan:
1. The files listed as "files to modify"
2. Existing tests for those files
3. Any related files that help understand the code path

Match the style of the existing code — indentation, naming conventions, import patterns.

## Step 3: Implement Using TDD

Follow this cycle strictly:

1. **Write a failing test** that demonstrates the bug or validates the expected behavior
2. **Run the test** to confirm it fails for the right reason
3. **Write the minimal fix** to make the test pass
4. **Run ALL tests** to confirm nothing is broken
5. **Run the linter** if the project has one configured (check project profile)

Use the project's existing test framework and patterns. If the project profile says "jest with `npm test`", use jest. If it says "vitest", use vitest. Match the style of existing tests exactly.

## Step 4: Self-Review

Before committing, review your changes critically:

- Does the fix actually address the issue described in the plan?
- Are there edge cases you missed?
- Does the code follow the project's style (from the project profile)?
- Are the tests meaningful — do they test behavior, not implementation?
- Is the change minimal and focused? Remove anything unnecessary.
- Would this pass the project's CI? (check the CI requirements from the profile)

## Step 5: Commit Locally

1. Stage only the files you changed: `git add <specific files>`
2. Commit using the format specified in the project profile:
   ```bash
   git commit -m "<format from project profile>: <short description> (fixes #<issue_number>)"
   ```
3. **Do NOT push.** The ship phase handles that after human review.

## Step 6: Update Tarmak Task

1. **Add a build comment** with what you did:
   ```
   board_mutate action "add_comment" with task_id, user_id, content:
   "🔨 Implementation complete

   **Changes:**
   - <bullet list of what was changed and why>

   **Tests added:**
   - <list of test cases>

   **Test results:**
   <paste relevant test output>

   **Files modified:**
   - <file1> — <what changed>
   - <file2> — <what changed>

   **Commit:** <commit hash> <commit message>

   Ready for human review. Check the diff, then move to 'To Review' when satisfied."
   ```

2. **Move task** to the "To Review" column:
   ```
   board_mutate action "move_task" with task_id, column_id: <To Review column ID>
   ```

## On Failure

If you cannot complete the implementation (tests fail persistently, issue is too complex, plan was wrong):

1. **Add a failure comment:**
   ```
   board_mutate action "add_comment" with task_id, user_id, content:
   "❌ Implementation failed

   **Reached step:** <which step>
   **Attempted approach:** <what you tried>
   **Blocker:** <specific reason>
   **Recommendation:** <drop the issue, re-analyze with different approach, or manual fix needed>"
   ```

2. **Move task** to the "Dropped" column:
   ```
   board_mutate action "move_task" with task_id, column_id: <Dropped column ID>
   ```

## What Makes a Good Implementation

- **Follows the plan.** The analysis phase did the thinking — execute it faithfully
- **Minimal diff.** Only change what's necessary. No drive-by refactors, no "improvements" to surrounding code
- **Tests first.** If you didn't write a test before the fix, you're doing it wrong
- **No push.** The human reviews the diff before anything leaves the local machine
