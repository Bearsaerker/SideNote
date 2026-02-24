# SideNote duplicate comments: fix status and remaining plan

## Problem statement

The duplicate comment issue was caused by duplicate submit event paths and missing submit re-entrancy protection.

## Implemented fixes

### 1) Submit path hardening (completed)

- Removed duplicate click submit/cancel wiring in `CommentModal` and kept one click path.
- Added modal re-entrancy guard (`SubmitExecutionGuard` single in-flight submit lock).
- Disabled submit/cancel buttons during submit.
- Updated submit callback typing to support async and await (`void | Promise<void>`).
- Added submit debounce in modal trigger path.

Result:

- Single click should execute add/save once.

### 2) Identity model migration to stable ids (completed)

- Added stable `id: string` on `Comment`.
- New comments generate ids (`crypto.randomUUID()` with fallback).
- Edit/delete/resolve/unresolve now target by id.
- Legacy comments are migrated on load (backfill id/hash as needed).

Result:

- Timestamp collisions no longer break targeting.

### 3) Markdown marker collision fix (completed)

- Marker switched from timestamp-based to id-based:
    - `<!-- side-note:${id} -->`
- Markdown update/delete supports fallback to legacy timestamp marker for old entries.

Result:

- One markdown block is targeted deterministically by id.

### 4) Data/update consistency (completed)

- Comment mutations await `onCommentsChanged(...)` to avoid async race behavior.
- Added short-window duplicate suppression in `addComment` (anchor + text fingerprint).

### 5) Dev/debug workflow improvements (completed)

- Added cross-cutting debug/runtime modules:
    - `src/runtime/flags.ts`
    - `src/runtime/debug.ts`
    - `src/runtime/devAutoReload.ts`
- Debug behavior is build-mode based:
    - `npm run dev` enables debug logs and dev auto-reload behavior.
    - `npm run build` disables debug logs and dev auto-reload behavior.
- Added consolidated dev runbook:
    - [README-dev.md](../../README-dev.md)

## Known operational pitfall (resolved in docs)

If two plugin folders with the same manifest id (`side-note`) exist under `.obsidian/plugins`, Obsidian can load the wrong folder.

Best practice:

- Keep backups in `.obsidian/plugins-backups`.
- Keep only one `side-note` entry under `.obsidian/plugins`.

See:

- [README-dev.md](../../README-dev.md)

## Current task status

### Required

- [x] Stop duplicate submit execution for click flow.
- [x] Add modal submit guard and async-safe submit behavior.
- [x] Migrate comment identity to id-based operations.
- [x] Migrate markdown markers to id-based targeting with legacy fallback.
- [x] Add automated regression tests for add/save single execution.
- [x] Add automated regression tests for id-based targeting under timestamp collision.
- [x] Add automated regression tests for markdown marker update/delete targeting.

### Optional

- [x] Add duplicate suppression window in add flow.
- [x] Add build-mode debug diagnostics.
- [ ] Make duplicate suppression window configurable via settings.
- [x] Add release note entry summarizing migration + duplicate fix behavior.

## Validation checklist (manual)

- [ ] macOS: click `Add` once -> one comment and one notice.
- [ ] Keyboard: `Cmd/Ctrl+Enter` add/edit -> single execution.
- [ ] Rapid trigger attempt -> no accidental duplicate insertion.
- [ ] Markdown backup/update/delete affects the correct id-marked block.
- [ ] Optional mobile sanity check: single tap submit -> single comment.

## Release notes

- **Duplicate comment and identity hardening**
    - Fixed duplicate Add/Save execution by hardening modal submit gating (debounce + single in-flight submit)
    - Migrated operations to stable comment ids (`id`) instead of timestamp-only targeting
    - Switched markdown markers to id-based format (`<!-- side-note:<id> -->`) with legacy timestamp fallback support

## Automated tests added

- `tests/submitExecutionGuard.test.ts`
    - Unit coverage for rapid-trigger debounce and single in-flight submit lock behavior.
- `tests/modalActionBindings.integration.test.ts`
    - Integration-style coverage for modal click/touch submit wiring, debounce suppression, and cancel blocking during in-flight submit.
- `tests/commentManager.idTargeting.test.ts`
    - Regression coverage for id-based edit/delete/resolve/unresolve under identical timestamp collisions.
- `tests/markdownCommentBlocks.test.ts`
    - Regression coverage for markdown block update/delete targeting by id with legacy timestamp marker fallback.
