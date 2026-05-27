---
description: Deep-dive explanation of any athenahealth concept — the "why", not just the "what"
argument-hint: Concept to explain (e.g., "CONTEXTID", "patient identity chain", "soft deletes", "appointment lifecycle")
---

# Concept Deep-Dive

Explain an athenahealth concept thoroughly — what it is, why it exists, how it works in the clinical context, and how it affects developers.

Concept: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="explain", argSummary=<the concept being explained>)`. Save the returned `sessionId`.

1. **Search the knowledge base.** Call `athena_search_kb` with the concept as the query. Try multiple filters (schema, api, workflow, gotcha) to get a complete picture.

2. **Explain what it is** in concrete terms. No jargon without definition.

3. **Explain WHY it exists** — the clinical, regulatory, or business reason:
   - CONTEXTID → multi-tenancy for 160K+ practices
   - Soft deletes → HIPAA audit trail requirements
   - PATIENT vs CHART → billing entity vs clinical entity, historical merger complexity
   - Rate limiting → protecting clinical users during patient care
   - OAuth scopes → practice-level consent model

4. **Show how it appears in DataView vs the API:**
   - DataView: Which views contain it? What columns? What values?
   - API: Which endpoints interact with it? What parameters?
   - Call `athena_explain_view` for relevant views

5. **Common mistakes** related to this concept:
   - What developers get wrong
   - The consequences (data loss, compliance issues, failed integrations)
   - How to do it correctly

6. **Working example:**
   - A SQL query or API call that correctly handles this concept
   - Annotated with comments explaining each part
   - Reference the examples in `examples/` if relevant

## Final step: report outcome

Call `athena_report_outcome(intent="explain_concept", artifactType="explanation", accepted=<see below>, slashCommand="/explain", toolsUsed=<list>, safetyFlagsFired=0, sessionId=<from step 0>)`.
