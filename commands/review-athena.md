---
description: Scan project for athenahealth anti-patterns and safety issues
argument-hint: Optional path to scan (defaults to entire project)
---

# athenahealth Code Review

Perform a comprehensive athenahealth-specific code review of this project.

Scope: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="review-athena", argSummary=<scope in one phrase>)`. Save the returned `sessionId`. **For every issue you flag during this review you MUST call `athena_report_safety_flag`** — this command is the single biggest source of safety-flag signal.

1. **Scan all relevant files** in the project (or specified path):
   - `.sql` files — DataView queries
   - `.py`, `.ts`, `.js`, `.cs`, `.java` files — API integration code
   - Config files (`.env`, `.yaml`, `.json`) — credential handling
   - Use Glob to find these files, then Read each one

2. **For each SQL file**, check against these rules:
   - [ ] Tables fully qualified (`ATHENAHEALTH.ATHENAONE.<VIEW>`)
   - [ ] Soft-delete filter present (`DELETEDDATETIME IS NULL` or `VOIDEDBY IS NULL` for VISITCHARGE) — flag `missing_soft_delete`
   - [ ] No direct PATIENTID↔CHARTID joins (call `athena_explain_join` to verify any joins found) — flag `patientid_chartid_join`
   - [ ] CONTEXTID handling documented or applied — flag `missing_contextid` if missing for service accounts
   - [ ] LIMIT clause present for exploratory queries
   - For each athenahealth table referenced, call `athena_explain_view` to verify the table exists and check for gotchas

3. **For each code file with API calls**, check:
   - [ ] OAuth token handling (not hardcoded, includes refresh logic)
   - [ ] Rate-limit retry with backoff (handles 429 responses) — flag `missing_rate_limit_retry`
   - [ ] Error handling for 400, 401, 403
   - [ ] `X-Request-Id` header present — flag `missing_x_request_id`
   - [ ] Credentials externalized (not in source code) — flag `hardcoded_credentials`
   - [ ] Uses `/changed` endpoints for sync (not full-table scans)
   - [ ] Patient search before create (no blind creates)

4. **For config files**, check:
   - [ ] No hardcoded secrets (client_id, client_secret, API keys) — flag `hardcoded_credentials`
   - [ ] Sandbox vs production properly separated
   - [ ] .env files in .gitignore

5. **Report findings** in priority order. For each finding, ALSO call `athena_report_safety_flag` with the corresponding `rule`, `severity`, `action="warned"`, `context`, and `filePath`:
   - **CRITICAL** (data loss or compliance risk): Missing soft-delete filters, unsafe joins, hardcoded credentials, missing CONTEXTID
   - **WARNING** (potential issues): Missing rate-limit retry, no error handling, missing X-Request-Id
   - **INFO** (suggestions): Missing LIMIT clause, could use CTE for clarity, could add comments

6. **Offer to fix** each issue found, starting with CRITICAL items. If the user accepts a fix, call `athena_report_safety_flag` again with `action="auto_fixed"`.

## Final step: report outcome

Call `athena_report_outcome(intent="review_code", artifactType="review", accepted=<see below>, slashCommand="/review-athena", toolsUsed=<list>, safetyFlagsFired=<total flags from steps 5–6>, sessionId=<from step 0>)`.
