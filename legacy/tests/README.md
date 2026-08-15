# Tests

Node-runnable unit tests for the pure business-logic modules under `apps-script/` (the `*Logic.gs` files — see `architecture.md` §8 for the pure-logic/IO layering these rely on). This is the genuinely automated, executable verification available without a live Google Sheet.

## Running

```
npm test
```

Runs Node's built-in test runner (`node --test`) over every `tests/unit/*.test.js` file. No dependencies to install.

## How it works

Apps Script merges every `.gs` file in the project into one shared global namespace at runtime — there's no `require`/`import` between them. `tests/helpers/loadGas.js` reproduces that: `loadGasContext([...])` loads a list of `.gs` files into one Node `vm` context in order, and returns that context so tests can call e.g. `ctx.computeDaysRemaining(...)` directly.

Some pure files are fully standalone (`DateLogic.gs`, `IdLogic.gs`, `HealthLogic.gs`, `WorkloadLogic.gs`) and only need themselves loaded. Others reference another config file's global (e.g. `TaskLogic.gs` uses `ENUMS` from `Enums.gs` and `TASK_CLOSED_STATUSES` from `DateLogic.gs`) — those tests load the whole dependency chain, matching how the real Apps Script project would see it.

**Gotcha:** objects/arrays returned from a `ctx.*` call live in the vm sandbox's own realm, so `assert.deepStrictEqual` (which checks prototype identity, not just structure) can spuriously fail against a plain object/array literal written in the test file itself — even when the two are structurally identical. Use `assert.deepEqual` (structural only) when comparing a full return value; `assert.strictEqual` on individual primitive fields is unaffected and preferred where practical.

## What's covered

- `dateLogic.test.js` — Days Remaining/Overdue/Waiting math, bucketing, monthly-generation frequency matching, and the Month-End-Close-vs-everything-else due-date rule.
- `idLogic.test.js` — sequential ID generation: empty list, gaps, cross-prefix isolation, malformed input, width overflow, regex-special-character prefixes.
- `taskLogic.test.js` — the full task status state machine (every transition class, not just the happy path) and field validation.
- `progressLogic.test.js` — Simple/Weighted Completion % including the zero-tasks and all-Cancelled edge cases, and next-deadline selection.
- `healthLogic.test.js` — every branch of the client health rule set, including threshold boundaries and the On Hold override.
- `workloadLogic.test.js` — the employee overload flag, including "no Capacity set" and "Capacity is legitimately 0" edge cases.

## What's NOT covered here

Anything that touches `SpreadsheetApp` (the `*Service.gs`/`*Engine.gs`/`*SheetBuilder.gs` files, triggers, the menu, chart building) can't run under plain Node — there's no real spreadsheet to operate on. That layer was verified during development against a throwaway, unchecked-in mock of the Sheets API (not part of this repo), but the durable, repeatable way to verify it is the manual test plan in `docs/testing.md`, run against a real spreadsheet after `clasp push` + `setupSpreadsheet()`.
