---
description: Guided onboarding for new athenahealth developers
argument-hint: What are you building? (e.g., "marketplace app", "DataView reports", "API integration")
---

# athenahealth Developer Onboarding

A new developer needs guided onboarding for athenahealth development.

What they're building: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="onboard", argSummary=<their track in one phrase, e.g. "marketplace app">)`. Save the returned `sessionId`.

1. **Understand their goal.** Based on their input, determine which track applies:
   - **DataView/Snowflake track**: Building reports, analytics, data pipelines against DataView
   - **API integration track**: Building apps that read/write via the athenahealth REST API
   - **Marketplace app track**: Building a full marketplace application (API + DataView + certification)
   - **FHIR track**: Building FHIR R4 integrations

2. **Explain the athenahealth ecosystem** relevant to their track:
   - For DataView: Explain Snowflake, ATHENAHEALTH.ATHENAONE schema, reader vs service accounts, CONTEXTID
   - For API: Explain REST API, OAuth2, sandbox (practice 195900), rate limiting, /changed endpoints
   - For Marketplace: Both of the above + certification process, partner portal
   - For FHIR: FHIR R4 resource mapping to athenaOne tables

3. **Walk through the identity model.** This is critical for ALL tracks:
   - PATIENTID (financial/billing) vs CHARTID (clinical/medical records)
   - Why they're separate (patient merges, practice transfers)
   - CLINICALENCOUNTER as the bridge table
   - The 46% data loss danger of direct PATIENTID↔CHARTID joins
   - ENTERPRISEID for enterprise dedup (on CHART only)
   - Call `athena_explain_join` with sourceView="PATIENT" targetView="CHART" to show the real join path

4. **Show the most relevant example** from `examples/`:
   - DataView track → `examples/dataview/safe-patient-query.sql`
   - API track → `examples/api/python-oauth-template.py`
   - Read the example file and walk through it, explaining each safety measure

5. **Generate a starter template** for their specific use case:
   - Use the appropriate MCP tools to gather schema/API info
   - Generate working starter code with all safety rails baked in
   - Include comments explaining each safety measure
   - **For every safety measure you bake in, call `athena_report_safety_flag` with `action="auto_fixed"`** — the onboarding flow gets the most safety value from this.

6. **Explain the 3 most common mistakes** for their track:
   - DataView: Missing soft-delete filter, wrong join (PATIENTID↔CHARTID), missing CONTEXTID
   - API: Missing rate-limit retry, creating duplicate patients, bypassing document routing
   - Call `athena_search_kb` with filter="gotcha" for track-specific warnings

## Final step: report outcome

Call `athena_report_outcome(intent="onboard", artifactType="explanation", accepted=<see below>, slashCommand="/onboard", toolsUsed=<list>, safetyFlagsFired=<count from step 5>, sessionId=<from step 0>)`.
