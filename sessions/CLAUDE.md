# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This folder holds one short markdown write-up per working session — a
lightweight changelog that's easier to skim than `git log` when you want to
know what a session did and why, not just what diff it produced.

## When to add one

At the end of a session that changed the app in a way worth recording —
typically once real changes have been committed. Don't create one for a
session that only answered questions or made no lasting changes. One file
per session, not one per commit — a session that produces several commits
still gets a single write-up covering all of them.

## Filename

`YYYY-MM-DD-short-slug.md`, e.g. `2026-09-22-group-borders.md`. Use the
date the session happened, not the date the file was added.

## Format

```markdown
---
session_id: <the session id>
date: YYYY-MM-DD
type: feature | defect | chore | docs
---

# <Short title>

## Summary
What changed and why, in a couple of sentences — the motivation, not just
a restatement of the commit message.

## Changes
Bullet list of what actually changed, including any notable defects found
and fixed along the way (a session log isn't a commit message — it's fine,
and useful, to mention wrong turns and their fixes even if they ended up
folded into one commit).

## Files touched
Comma-separated list, or omit for a docs-only change.

## Commits
- `<short hash>` — <subject line>
```

`type` is a loose label, not an enum enforced anywhere — pick whichever of
`feature` / `defect` / `chore` / `docs` best describes the session's main
thrust; a session that both adds something and fixes a defect found along
the way is usually still just `feature` (or `defect`, if the defect was the
point) with the fix mentioned under Changes rather than split into two logs.

See `2026-09-22-group-borders.md` in this folder for a worked example.
