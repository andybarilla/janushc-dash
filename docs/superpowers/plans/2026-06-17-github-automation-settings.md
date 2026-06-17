---
status: in-progress
phase: 1
updated: 2026-06-17
---

# GitHub Automation Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure GitHub settings so new `andybarilla/janushc-dash` issues are added to the existing `janushc-dash` Project and merged linked PRs close issues through native GitHub behavior.

**Architecture:** Prefer GitHub-hosted settings over repository automation. Configure the Projects v2 built-in Auto-add workflow and the repository-native linked-PR auto-close setting; add Actions/API automation only if the built-in project workflow is unavailable or insufficient.

**Tech Stack:** GitHub Projects v2 built-in workflows, GitHub repository settings, GitHub issue/PR UI, optional `gh` CLI for verification issue creation.

## Global Constraints

- Do not add `.github/workflows` files while the built-in GitHub Project and repository settings support the workflow.
- New issues opened in `andybarilla/janushc-dash` must automatically appear in the existing `janushc-dash` GitHub Project.
- Merged pull requests must close issues only through GitHub native linked-PR and closing-keyword behavior.
- Backfilling existing issues is out of scope.
- Do not commit this plan or any settings-only work unless a repo file changes and the human asks for a commit.

---

## Goal

Configure repository and project settings so `andybarilla/janushc-dash` behaves like `exit66jukebox` for issue intake and issue closure without adding repo automation files unless GitHub settings cannot support the behavior.

## Context & Decisions

| Decision | Rationale | Source |
|----------|-----------|--------|
| Extend no existing repo automation in the preferred path | Repo exploration found no `.github/workflows` files and no existing issue, PR, or Projects automation to extend. | `ref:sheer-emerald-basilisk` |
| Use GitHub Projects v2 built-in Auto-add to project workflow for new issue intake | GitHub supports project-level auto-add rules for selected repositories with `is:issue`; existing matching issues are not backfilled. | `ref:bitter-blush-seahorse` |
| Use the repository-native auto-close linked issues setting for merged PR closure | GitHub exposes `Settings → General → Issues → Auto-close issues with merged linked pull requests`; PR descriptions can close issues with keywords when targeting the default branch. | `ref:bitter-blush-seahorse` |
| Keep Actions/API automation as a fallback only | GitHub docs describe the built-in auto-add workflow as UI-configured; Actions/API automation requires a PAT or project token and should be used only if the built-in workflow cannot satisfy the repo filter. | `ref:bitter-blush-seahorse` |

## File Structure

- Existing spec: `docs/superpowers/specs/2026-06-17-github-automation-settings-design.md` — approved behavior and configuration design.
- Planned repo artifact: `docs/superpowers/plans/2026-06-17-github-automation-settings.md` — this implementation plan.
- No app files are changed in the preferred path.
- No `.github/workflows` files are changed in the preferred path.
- Conditional fallback path only: if GitHub Projects built-in Auto-add is unavailable or insufficient, create `.github/workflows/add-issues-to-project.yml` for opened-issue project intake using a PAT or project-capable token.

---

## Phase 1: Settings configuration [IN PROGRESS]

### Task 1.1: Configure Project Auto-add for new issues ← CURRENT

- [ ] Open the existing `janushc-dash` GitHub Project workflow settings.
- [ ] Configure **Auto-add to project** for repository `andybarilla/janushc-dash` with filter `is:issue`.
- [ ] Save and enable the workflow.
- [ ] Reopen the workflow settings and verify the repository, filter, and enabled state.
- [ ] Leave settings-only progress uncommitted unless the human asks for a commit.

**Files:**
- Modify: GitHub Project settings only.
- Do not modify repo files.

**UI path:**
- Open the existing `janushc-dash` GitHub Project.
- Open the project `⋯` menu.
- Select **Workflows**.
- Under **Default workflows**, open **Auto-add to project**.
- Select **Edit**.
- In **Filters**, select repository `andybarilla/janushc-dash`.
- Set the filter to `is:issue`.
- Save the workflow and turn it on.

**Expected result:**
- The Project has an enabled Auto-add workflow for repository `andybarilla/janushc-dash` with filter `is:issue`.
- The workflow applies to new matching issues created after it is enabled.
- Existing issues are not backfilled.

**Verification:**
- Reopen **Project → ⋯ → Workflows → Default workflows → Auto-add to project → Edit**.
- Confirm repository `andybarilla/janushc-dash` appears in the filter configuration.
- Confirm the filter text is exactly `is:issue`.
- Confirm the workflow state is enabled.

**Commit guidance:**
- Do not commit for this task because it changes GitHub-hosted settings only.
- If this plan file is updated to mark progress, leave it uncommitted unless the human asks for a commit.

### Task 1.2: Verify repository auto-close setting

- [ ] Open `andybarilla/janushc-dash` repository **Settings → General**.
- [ ] Confirm **Auto-close issues with merged linked pull requests** is enabled.
- [ ] If disabled, enable and save the setting.
- [ ] Refresh the settings page and verify the setting remains enabled.
- [ ] Leave settings-only progress uncommitted unless the human asks for a commit.

**Files:**
- Modify: GitHub repository settings only if the setting is disabled.
- Do not modify repo files.

**UI path:**
- Open `https://github.com/andybarilla/janushc-dash`.
- Select **Settings**.
- Select **General**.
- In **Issues**, find **Auto-close issues with merged linked pull requests**.
- Confirm the setting is enabled.
- If it is disabled, enable it and save the setting.

**Expected result:**
- `andybarilla/janushc-dash` has **Auto-close issues with merged linked pull requests** enabled.
- PR descriptions that target the default branch can close issues with `Closes #123`, `Fixes #123`, or `Resolves #123` when merged.

**Verification:**
- Refresh **Settings → General**.
- Confirm the checkbox/toggle for **Auto-close issues with merged linked pull requests** remains enabled.

**Commit guidance:**
- Do not commit for this task because it changes GitHub-hosted settings only.
- If this plan file is updated to mark progress, leave it uncommitted unless the human asks for a commit.

---

## Phase 2: Verification [PENDING]

### Task 2.1: Verify new issue auto-add behavior

- [ ] Create a temporary `Test project auto-add` issue using the command or UI option.
- [ ] Open the existing `janushc-dash` Project and confirm the issue appears as a project item.
- [ ] Confirm no repository workflow was needed for the project add.
- [ ] Close the temporary issue with the verification comment.
- [ ] Remove the test issue item from the Project if the Project allows deleting test items.
- [ ] Leave issue/project-only progress uncommitted unless the human asks for a commit.

**Files:**
- Modify: GitHub issue tracker and GitHub Project state only.
- Do not modify repo files.

**Command option:**

```bash
gh issue create \
  --repo andybarilla/janushc-dash \
  --title "Test project auto-add" \
  --body "Temporary verification issue for GitHub Project auto-add settings. Close after confirming it appears in the janushc-dash Project."
```

**UI option:**
- Open `https://github.com/andybarilla/janushc-dash/issues/new`.
- Title: `Test project auto-add`.
- Body: `Temporary verification issue for GitHub Project auto-add settings. Close after confirming it appears in the janushc-dash Project.`
- Submit the issue.

**Expected result:**
- The new test issue is automatically added to the existing `janushc-dash` Project without any repository workflow run.

**Verification:**
- Open the existing `janushc-dash` Project.
- Search or filter for `Test project auto-add`.
- Confirm the issue appears as a project item.
- Open `https://github.com/andybarilla/janushc-dash/actions` and confirm no repository workflow was needed for the project add.
- Close the test issue after verification with comment: `Verified project auto-add behavior; closing temporary test issue.`
- If the Project allows deleting test items, remove the test issue item from the Project after closing the issue.

**Commit guidance:**
- Do not commit for this task because it changes GitHub-hosted issue/project state only.
- If this plan file is updated to mark progress, leave it uncommitted unless the human asks for a commit.

### Task 2.2: Verify PR closing-keyword behavior when safe

- [ ] Ask the human whether creating and merging a safe test PR is acceptable.
- [ ] If approved, create a temporary issue and a harmless PR targeting the default branch with `Closes #<test-issue-number>` in the PR description.
- [ ] If approved, merge the test PR and confirm GitHub closes the linked issue through native behavior.
- [ ] If no test PR is approved, document settings verification completion in execution notes.
- [ ] Confirm no repository workflow was responsible for any issue closure.
- [ ] Commit a harmless test-PR file change only if the human approves the test PR and repo file change.
- [ ] Do not merge a test PR unless the human explicitly approves the test merge.

**Files:**
- Preferred path: modify no repo files.
- Safe test PR path: only use an existing harmless branch/change if the human approves creating and merging a test PR.

**Safe verification choice:**
- Ask the human whether creating and merging a safe test PR is acceptable.
- If yes, create a temporary issue and a harmless PR targeting the default branch with the PR description `Closes #<test-issue-number>`.
- Merge the PR and confirm GitHub closes the linked issue through native behavior.
- If no, do not create a test PR.

**Expected result if a test PR is created:**
- The PR targets the default branch.
- The PR description contains a closing keyword such as `Closes #<test-issue-number>`.
- After merge, GitHub closes the linked issue automatically.

**Verification if a test PR is created:**
- Open the linked issue after merge.
- Confirm the issue timeline shows closure by the merged PR.
- Confirm no repository workflow was responsible for closing the issue.

**Verification if no test PR is created:**
- Document in the execution notes: `Repository setting verification complete; no test PR created because a safe merge test was not approved.`
- Link to the confirmed repository setting from Task 1.2 in the notes if the UI provides a stable URL.

**Commit guidance:**
- Do not commit for settings-only verification.
- If a safe test PR requires a repo file change, use a branch dedicated to that verification, make the smallest harmless change approved by the human, and commit with `chore: verify github issue auto-close setting`.
- Do not merge a test PR unless the human explicitly approves the test merge.

---

## Phase 3: Fallback only if needed [PENDING]

### Task 3.1: Add Actions/API issue intake fallback only if built-in Auto-add fails

- [ ] Confirm the fallback trigger condition applies after built-in Auto-add configuration or verification fails.
- [ ] Get human approval before creating fallback workflow files.
- [ ] Create `.github/workflows/add-issues-to-project.yml` for opened-issue project intake only.
- [ ] Configure the workflow to add opened issues to the existing `janushc-dash` Project using a project-capable token stored as a repository secret.
- [ ] Verify a new test issue triggers the workflow and appears in the Project.
- [ ] Close/delete the test issue and remove the test project item as appropriate.
- [ ] Commit fallback files only after human approval.

**Trigger condition:**
- Use this task only if the GitHub Projects built-in Auto-add workflow is unavailable, cannot select repository `andybarilla/janushc-dash`, cannot use filter `is:issue`, or fails to add a newly opened issue after Task 2.1 verification.

**Files:**
- Conditional create: `.github/workflows/add-issues-to-project.yml`.
- Do not change app files.
- Do not create this workflow if Phase 1 and Phase 2 succeed.

**High-level implementation path:**
- Create a GitHub Actions workflow at `.github/workflows/add-issues-to-project.yml`.
- Trigger on `issues` with type `opened`.
- Add the opened issue URL to the existing `janushc-dash` Project using `actions/add-to-project` or an equivalent GraphQL `addProjectV2ItemById` call.
- Use a PAT, GitHub App token, or project-capable token stored as a repository secret because `GITHUB_TOKEN` is insufficient for Projects v2 writes.
- Grant only the minimum permissions needed for project item creation and issue/PR reads.

**Expected result:**
- Newly opened issues in `andybarilla/janushc-dash` are added to the existing `janushc-dash` Project by the fallback workflow.
- PR issue closure remains native through GitHub linked-PR behavior; do not add workflow-based issue closure unless the human approves a separate scope change.

**Verification:**
- Create a new test issue after the fallback workflow is merged and enabled.
- Confirm the workflow run succeeds.
- Confirm the test issue appears in the existing `janushc-dash` Project.
- Close/delete the test issue and remove the test project item as appropriate.

**Commit guidance if fallback files change:**

- Commit fallback files only after human approval.

```bash
git add .github/workflows/add-issues-to-project.yml docs/superpowers/plans/2026-06-17-github-automation-settings.md
git commit -m "chore(github): add project issue intake workflow"
```

---

## Notes

- 2026-06-17: Repo exploration found no existing automation or workflow files to extend, so the preferred path remains GitHub-hosted settings only. `ref:sheer-emerald-basilisk`
- 2026-06-17: GitHub supports Project auto-add for new issues and repository auto-close for merged linked PRs through native settings. `ref:bitter-blush-seahorse`

---

## Self-Review

**Spec coverage:**
- Project issue auto-add is covered by Task 1.1 and verified by Task 2.1.
- Issue closure from merged PRs is covered by Task 1.2 and conditionally verified by Task 2.2.
- Preferred path avoids `.github/workflows` changes, covered by Global Constraints and File Structure.
- Existing issue backfill remains out of scope, covered by Global Constraints and Task 1.1 expected result.
- Fallback Actions/API automation is covered only under Phase 3 with conditional path `.github/workflows/add-issues-to-project.yml`.

**Unresolved-term scan:**
- No unresolved work terms are used.
- Each task has a concrete UI path or command option where available, expected result, verification, and commit guidance.
- Exactly one task has the current-task marker.

**Consistency notes:**
- The preferred path modifies GitHub settings only.
- The fallback path is conditional and limited to issue intake automation.
- No app files are planned for modification.
