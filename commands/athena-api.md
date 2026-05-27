---
description: Generate athenahealth API integration code with proper auth, error handling, and best practices
argument-hint: Describe the API integration (e.g., "fetch patient demographics in Python" or "create appointment in TypeScript")
---

# athenahealth API Code Generator

Generate athenahealth REST API integration code with all safety rails built in.

Request: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="athena-api", argSummary=<one short non-PII sentence summarizing $ARGUMENTS>)`. Save the returned `sessionId`.

1. **Understand the workflow.** Call `athena_suggest_workflow` with the user's goal to get:
   - Recommended approach
   - Required API sequence
   - Anti-patterns to avoid
   - Related warnings

2. **Explain the clinical context.** Before writing code, explain what's actually happening in the clinic/office. For example:
   - "Appointment scheduling" → A patient calls, front desk checks availability, books a slot
   - "Patient check-in" → Patient arrives, verifies demographics, insurance is confirmed
   - This context helps the developer understand WHY the API works the way it does

3. **Get API endpoint details.** Call `athena_search_kb` with filter="api" for each endpoint needed. If a full workflow is involved, also call `athena_explain_workflow`.

4. **Generate code** with these mandatory elements:
   - OAuth2 client credentials flow with token caching
   - Base URL configuration (sandbox vs production)
   - `X-Request-Id` header (UUID) on every request
   - Rate-limit handling: exponential backoff + jitter for 429 responses
   - Error handling for 400 (bad request), 401 (auth), 403 (scope), 429 (rate limit)
   - Type definitions / data classes for request/response bodies
   - Comments explaining each API call's purpose in the workflow
   - Externalized credentials (env vars or config)

5. **Warn about anti-patterns.** If `athena_suggest_workflow` detected anti-patterns, explicitly:
   - Show what the developer might be tempted to do (the wrong way)
   - Explain why it's wrong
   - Show the correct approach
   - **Per SKILL.md, call `athena_report_safety_flag` for each anti-pattern you fire on** (`missing_rate_limit_retry`, `hardcoded_credentials`, `missing_x_request_id`, etc.). Count these for the outcome report.

6. **Language defaults:**
   - Python with `requests` unless the user specifies another language
   - For TypeScript: use `fetch` or `axios`
   - For C#: use `HttpClient`
   - Sandbox practice ID: `195900`

## Final step: report outcome

Once finished, call `athena_report_outcome(intent="generate_api_code", artifactType="code", accepted=<see below>, slashCommand="/athena-api", toolsUsed=<list>, safetyFlagsFired=<count>, sessionId=<from step 0>)`. Use `"yes"`/`"edited"`/`"no"`/`"unknown"` based on user response.
