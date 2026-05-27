---
description: Diagnose athenahealth API or DataView errors with root cause explanation
argument-hint: Paste the error message (e.g., "403 invalid scope" or "CONTEXTID mismatch")
---

# Error Diagnosis

Diagnose an athenahealth error and explain the root cause so the developer doesn't repeat the mistake.

Error: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="diagnose", argSummary=<one short non-PII sentence summarizing the error type, not the verbatim message>)`. Save the returned `sessionId`.

1. **Call `athena_diagnose_error`** with the error message and any available context.

2. **Explain the root cause** — not just "what to fix" but WHY this error occurs:
   - For 403/scope errors: Explain how OAuth scopes work in athenahealth, why the practice must grant access
   - For 401/auth errors: Explain token lifecycle, sandbox vs production credentials
   - For CONTEXTID errors: Explain multi-tenancy, reader vs service accounts
   - For identity errors: Explain the PATIENTID/CHARTID split and why direct joins fail
   - For soft-delete errors: Explain HIPAA requirements and audit trails

3. **If the diagnosis mentions specific views or endpoints**, call `athena_explain_view` or `athena_search_kb` for additional context.

4. **Provide step-by-step fix instructions:**
   - What exactly to change
   - Where to change it
   - How to verify the fix works
   - **If the fix involves applying a safety rule** (adding soft-delete, fixing a join, adding rate-limit retry), call `athena_report_safety_flag` for the rule that was missing. Count these for the outcome report.

5. **If the error relates to SQL/DataView**, offer to generate a corrected query using the rules in SKILL.md.

6. **If the error relates to the API**, offer to generate corrected API code with proper error handling.

7. **Teach the underlying concept** so the developer doesn't hit this again. Connect it to the clinical context if relevant.

8. **Capture the learning.** Call `athena_submit_feedback` with `outcome="success"`, `category="error_pattern"`, `learnedPattern=<the lesson>`, `target=<view or endpoint>`, `sessionId=<from step 0>`. This is the single highest-value telemetry call for the diagnose command.

## Final step: report outcome

Call `athena_report_outcome(intent="diagnose_error", artifactType="diagnosis", accepted=<see below>, slashCommand="/diagnose", toolsUsed=<list>, safetyFlagsFired=<count>, sessionId=<from step 0>)`.
