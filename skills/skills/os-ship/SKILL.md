---
name: os-ship
description: Use when shipping a contribution to an open-source project. Triggered by clicking Run on a task in the "To Push" column of the Open Source Contributions board. Forks the repo, pushes the branch, and creates a PR following the project's conventions. Use this skill after the human has reviewed and approved the implementation.
---

# OS Ship

## Overview

Push the locally-committed fix to a fork and open a pull request that follows the project's contribution guidelines. The human has already reviewed the code — your job is to get it upstream cleanly.

**Announce at start:** "I'm using the os-ship skill to push the branch and create the PR."

## Context

You're running in a git worktree of the target repo. The task description contains:
- The issue URL and problem summary
- The project profile (commit format, PR template requirements, CLA info)
- The implementation summary from the dev phase

The code is already committed locally. Your job is to fork, push, and create a PR.

## Step 1: Extract Task Context

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TASK_SHORT=$(echo "$BRANCH" | sed 's|agent/||' | cut -d'-' -f1)
```

Query the board to find your task:
- `board_query` with `board_id: "list"` to find the "Open Source Contributions" board
- `board_query` with `scope: "tasks"` to find the task matching your branch

Read the task description to extract the **project profile** and **issue details**.

## Step 2: Fork and Push

```bash
# Get the upstream repo from the remote
UPSTREAM=$(git remote get-url origin)
OWNER_REPO=$(echo "$UPSTREAM" | sed 's|.*github.com[:/]||;s|\.git$||')

# Fork (idempotent — if fork exists, continues)
gh repo fork "$OWNER_REPO" --remote-only

# Add fork as remote if not already there
FORK_URL=$(gh repo view --json sshUrl -q .sshUrl 2>/dev/null || gh api user -q .login | xargs -I{} echo "git@github.com:{}/$(basename $OWNER_REPO).git")
git remote get-url fork 2>/dev/null || git remote add fork "$FORK_URL"

# Push branch to fork
git push fork "$BRANCH"
```

## Step 3: Create the Pull Request

Build the PR from the project profile and implementation summary:

1. **Check for a PR template** (`.github/PULL_REQUEST_TEMPLATE.md`). If it exists, fill it in. If not, use a clean format.

2. **Create the PR:**
   ```bash
   gh pr create \
     --repo "$OWNER_REPO" \
     --head "<your-github-username>:$BRANCH" \
     --base "<default_branch from project profile>" \
     --title "<commit format>: <short description>" \
     --body "<PR body>"
   ```

3. **PR body guidelines:**
   - Reference the issue: "Fixes #<number>" or "Closes #<number>"
   - Describe WHAT changed and WHY (not HOW — the diff shows that)
   - List the test cases you added
   - Fill in any checklist items from the PR template
   - Keep it concise — maintainers review dozens of PRs

## Step 4: Update Tarmak Task

1. **Add a ship comment:**
   ```
   board_mutate action "add_comment" with task_id, user_id, content:
   "🚀 PR submitted

   **PR:** <pr_url>
   **Repo:** <owner/repo>
   **Issue:** #<number>
   **Branch:** <branch_name>

   Now waiting for maintainer review."
   ```

2. **Set the PR URL** custom field if available:
   ```
   board_mutate action "set_field_value" with task_id, field_id: <pr_url field>, value: "<pr_url>"
   ```

3. **Move task** to the "Shipped" column:
   ```
   board_mutate action "move_task" with task_id, column_id: <Shipped column ID>
   ```

## On Failure

If the push or PR creation fails (auth issues, fork problems, CI immediately fails):

1. **Add a failure comment** explaining what went wrong
2. **Move task back** to "To Review" so the human can investigate
3. Do NOT move to Dropped — shipping failures are usually recoverable

## What Makes a Good PR

- **Follows the template.** If the project has a PR template, fill every section
- **References the issue.** Always link to the issue with "Fixes #N"
- **Clean commit history.** One focused commit with the right message format
- **No surprises.** The PR should contain exactly what was reviewed locally — nothing more, nothing less
