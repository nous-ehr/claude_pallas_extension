---
description: Pre-deployment safety check for athenahealth integrations
argument-hint: Optional path to validate (defaults to entire project)
---

# Pre-Deployment Validation

Run a comprehensive pre-deployment safety check for this athenahealth integration.

Scope: $ARGUMENTS

## Steps

1. **Run the full /review-athena code review** (all SQL, API, and config checks).

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
