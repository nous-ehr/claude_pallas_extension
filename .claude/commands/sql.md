---
description: Generate safe DataView SQL with CONTEXTID handling, soft-delete filters, and correct joins
argument-hint: Describe what you want to query (e.g., "active appointments with provider names for this week")
---

# DataView SQL Generator

Generate safe Snowflake SQL for athenahealth DataView. Safety is paramount — incorrect joins silently lose data.

Request: $ARGUMENTS

## Steps

1. **Identify all views needed.** Parse the request to determine which DataView views are required. If unsure, call `athena_search_kb` with filter="schema" to find relevant views.

2. **Get schema details.** For each view, call `athena_explain_view` with:
   - includeColumns: true
   - includeRelationships: true
   - includeGotchas: true

3. **Verify all joins.** For each pair of views that need joining, call `athena_explain_join` to get the verified join path. **Never guess join columns.** If `athena_explain_join` returns identity pattern warnings, follow them exactly.

4. **Generate the SQL** following these mandatory rules:
   - Fully qualify all tables: `ATHENAHEALTH.ATHENAONE.<VIEW>`
   - Include `WHERE DELETEDDATETIME IS NULL` (or `VOIDEDBY IS NULL` for VISITCHARGE) on every table
   - Add `LIMIT 100` for exploratory queries
   - Use CTEs for multi-step logic
   - Add a comment block at the top:
     ```sql
     -- Query: [what it does]
     -- CONTEXTID: Reader account = implicit RLS (no filter needed)
     --            Service account = add WHERE CONTEXTID = <practice_id>
     -- Gotchas: [any warnings from the KB]
     ```
   - Add inline comments on joins explaining the relationship

5. **Teach the developer.** After the SQL, explain:
   - WHY each safety measure exists (not just what it does)
   - What would go wrong without each measure (e.g., "Without the soft-delete filter, this query would include cancelled appointments that were voided by staff")
   - Any gotchas specific to the views used

6. **Review the generated SQL** against all gotchas returned by the tools. Flag any remaining risks.
