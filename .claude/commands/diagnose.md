---
description: Diagnose athenahealth API or DataView errors with root cause explanation
argument-hint: Paste the error message (e.g., "403 invalid scope" or "CONTEXTID mismatch")
---

# Error Diagnosis

Diagnose an athenahealth error and explain the root cause so the developer doesn't repeat the mistake.

Error: $ARGUMENTS

## Steps

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

5. **If the error relates to SQL/DataView**, offer to generate a corrected query using the rules in CLAUDE.md.

6. **If the error relates to the API**, offer to generate corrected API code with proper error handling.

7. **Teach the underlying concept** so the developer doesn't hit this again. Connect it to the clinical context if relevant.
