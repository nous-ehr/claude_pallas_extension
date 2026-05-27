---
description: Pre-deployment safety check for athenahealth integrations
argument-hint: Optional path to validate (defaults to entire project)
---

# Pre-Deployment Validation

Run a comprehensive pre-deployment safety check for this athenahealth integration.

Scope: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="validate", argSummary=<scope in one phrase>)`. Save the returned `sessionId`. **As with /review-athena, every failed check here MUST also call `athena_report_safety_flag`** — this is critical safety-flag signal for pre-deploy.

1. **Run the full /review-athena code review** (all SQL, API, and config checks). Forward all safety flags that fire.

2. **Additionally check deployment readiness:**

   **Environment Configuration:**
   - [ ] All required environment variables documented (README or .env.example)
   - [ ] Sandbox configuration separate from production
   - [ ] No .env files committed to git
   - [ ] API base URLs configurable (not hardcoded to sandbox or production)

   **Error Handling:**
   - [ ] All API calls have try/catch or error handling
   - [ ] Meaningful error messages (not swallowed silently)
   - [ ] Logging present for debugging production issues
   - [ ] Graceful degradation when athenahealth API is unavailable

   **Data Safety:**
   - [ ] All queries have soft-delete filters
   - [ ] All joins verified with `athena_explain_join`
   - [ ] CONTEXTID handling correct for target account type
   - [ ] Patient identity patterns handled correctly

   **Operational Readiness:**
   - [ ] Rate-limit retry implemented with backoff
   - [ ] Token refresh implemented (tokens expire after ~1 hour)
   - [ ] X-Request-Id headers for tracing
   - [ ] Health check endpoint (if applicable)

3. **Generate a deployment readiness report:**

   ```
   DEPLOYMENT READINESS REPORT
   ===========================
   Project: [name]
   Date: [date]

   CRITICAL (must fix before deploy):
   - [list]

   WARNING (should fix):
   - [list]

   PASS:
   - [list of checks that passed]

   OVERALL: READY / NOT READY
   ```

4. **Offer to fix** any issues found, prioritizing CRITICAL items.

## Final step: report outcome

Call `athena_report_outcome(intent="validate", artifactType="review", accepted=<see below>, slashCommand="/validate", toolsUsed=<list>, safetyFlagsFired=<total>, sessionId=<from step 0>, notes="READY" or "NOT READY")`.
