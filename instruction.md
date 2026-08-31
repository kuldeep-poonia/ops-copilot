# Execution Instructions — Ops Co-pilot

You (Gemini) are the implementation engineer on this project. These are non-negotiable rules. Follow them on every file, every commit, every function, with no exceptions. If something in a request conflicts with these rules, follow these rules and flag the conflict instead of silently picking one.

---

## 1. Zero Hallucination

- Never invent a library, API method, function signature, or configuration flag you are not certain exists. If you are not sure a package/API works the way you're about to use it, verify it (check the actual package docs, actual installed version, actual source) before writing the call.
- Never assume a file, function, or variable exists elsewhere in the codebase without opening and confirming it. Do not reference `getServiceHealth()` because it "sounds like it should exist" — check.
- If a task requires information you don't have (an API key format, a specific Prometheus metric name, a real endpoint contract), stop and ask instead of guessing plausible-looking values.
- Never fabricate example data that looks real (fake IPs, fake service names presented as if pulled from a real system, fake metric values in comments claiming to be "sample real output"). If something is illustrative, label it clearly as illustrative.

## 2. Zero Dead Code

- No unreachable code paths (an `if` branch that can never trigger, code after an unconditional `return`).
- No commented-out old code left "just in case." Delete it — git history already has it.
- No functions written for hypothetical future use that nothing currently calls. If a phase in the build plan will need it later, add it in that phase, not now.
- No `TODO` comments left unresolved at the end of a phase. Either finish the thing or don't start it.

## 3. Zero Unused Files / Functions / Imports

- Every import in every file must be used in that file. Run the linter (`go vet` / `staticcheck` for Go, `eslint` with `no-unused-vars` for JS/TS) before every commit and fix everything it flags — do not commit with known lint warnings.
- Every file in the repo must be referenced from somewhere (imported, built, or documented as an entry point). No orphan scratch files, no `test.js`, no `old_version.go`.
- Every exported/public function must have at least one real caller in the codebase (or a real test calling it, if it's a public API surface). If nothing calls it, delete it or don't add it yet.

## 4. Naming Conventions (human, senior-dev standard)

**Files & folders:**
- Lowercase, hyphen-separated for non-Go files and folders: `service-health/`, `confirm-dialog.tsx`, `tool-registry.ts`.
- Go files: lowercase, no hyphens, per Go convention: `servicehealth.go`, `toolregistry.go`.
- Folder names describe what's inside in plain words a new engineer would understand in 2 seconds: `backend/`, `frontend/`, `webmcp-tools/`, `internal/alerts/` — never `utils2/`, `misc/`, `stuff/`, `temp/`.
- No version numbers, dates, or "final"/"new"/"v2" in file or folder names. Git handles versioning.

**Code identifiers:**
- Go: exported = `PascalCase`, unexported = `camelCase`, package names short, lowercase, no underscores.
- JS/TS: variables/functions = `camelCase`, React components = `PascalCase`, constants that are truly constant = `UPPER_SNAKE_CASE`.
- Names describe intent, not type or implementation: `activeAlerts` not `alertArray`, `restartService` not `doRestart` or `handleClick2`.
- No single-letter variables except loop indices (`i`, `j`) in short, obvious loops.

## 5. Comments

- Write comments in plain sentences, the way a senior engineer explains something to a teammate — not as a wall of instructions, not as decorative separators.
- **Do not use double-dash or any decorative divider lines** (no `// ----------------`, no `// ==========`, no boxed comment headers). A comment is one or two short lines directly above the code it explains.
- Comment the *why*, not the *what*. Don't write `// increment counter` above `counter++`. Do write `// retry once before surfacing the error to the agent, since transient network blips are common here`.
- Every non-obvious function gets one short comment above it explaining its purpose and any non-obvious constraint (e.g., "must never be called without a valid confirmation token — see guardrail.go").
- No comments that restate the function name in different words.

## 6. Commit Discipline

- **One commit per file per logical change.** Do not batch five files into one commit. If you touched five files for one feature, that's five commits (or, if a change is truly indivisible across files, say so and keep it as small as possible).
- Commit messages are humanized, plain English, imperative mood, describing what changed and why — the way a real engineer writes them:
  - Good: `Add health check endpoint for service monitor`
  - Good: `Fix race condition when two restart requests hit the same service`
  - Bad: `Phase 1 - step 3`
  - Bad: `update files`
  - Bad: `WIP`
- **Never include phase numbers, step numbers, or hackathon/internal-planning language in commit messages.** The commit history should read like a real product's history, not like a checklist being ticked off.
- No empty commits, no "checkpoint" commits, no commits that only change whitespace/formatting mixed with logic changes (formatting-only changes get their own commit if needed).

## 7. GitHub Repository Setup

- Repository description (in the About section) clearly states what the product is and does, in one or two sentences — no hackathon jargon.
- Add relevant topics/tags: `webmcp`, `ai-agents`, `mcp`, `devops`, `observability`, `golang`, `react` (adjust to actual stack used).
- License file at repo root (MIT unless told otherwise), visible in the About section.
- README covers: what the product does, how to run it locally, how to deploy it, and a short WebMCP tool list with one line per tool.
- No secrets, API keys, or `.env` files ever committed. `.gitignore` must exclude them from day one, before the first commit that could contain one.

## 8. General Quality Bar

- Every piece of code you write should be something you'd be comfortable with a senior engineer reviewing line by line. If you wouldn't defend a line in a code review, don't write it.
- No placeholder/mock logic pretending to be real logic (e.g., a function named `restartService` that just logs a string and returns success without actually doing anything) — if a real integration isn't ready yet, the function should clearly fail or clearly be unimplemented, never silently pretend.
- Validate all external input at every boundary (API request bodies, WebMCP tool inputs) — never trust that the caller (including the agent) sent well-formed data.
- Handle errors explicitly. No swallowed errors (`catch {}` doing nothing, Go errors ignored with `_`).