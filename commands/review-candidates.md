---
description: Review and approve/reject pending knowledge base update candidates
argument-hint: Optional filter (e.g., "pending", "all", "approved")
---

# Knowledge Base Review Queue

Review pending discoveries from the learning loop. These are high-impact changes (schema corrections, relationship discoveries, identity pattern observations) that need human approval before entering the knowledge base.

Filter: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="review-candidates", argSummary=<filter argument>)`. Save the returned `sessionId`.

1. **List pending candidates.** Call `athena_list_candidates` with status "pending" (or the user's specified filter).

2. **For each candidate, present a clear summary:**
   - **Type**: What kind of change (schema_correction, relationship_change, new_gotcha)
   - **Title**: What was discovered
   - **Description**: Full context including what interaction produced this
   - **Severity**: How impactful this is (critical, warning, info)
   - **Confidence**: Current confidence score (starts at 0.3 for inferred)
   - **Source context**: What the developer was doing when this was discovered

3. **Ask for a decision on each candidate:**
   - **Approve**: Promotes to the knowledge base with confidence 0.7 (human-reviewed). Future developers will benefit from this knowledge.
   - **Reject**: Marks as rejected with a reason. Won't enter the KB. Useful for false positives or duplicates.

4. **Execute the decision.** Call `athena_review_candidate` with the candidateId, decision, and optional note.

5. **Summarize actions taken:**
   - How many approved vs rejected
   - What knowledge was added to the KB
   - Any patterns in the queue that suggest KB gaps worth addressing

## Final step: report outcome

Call `athena_report_outcome(intent="other", artifactType="none", accepted="unknown", slashCommand="/review-candidates", toolsUsed=<list>, safetyFlagsFired=0, sessionId=<from step 0>, notes=<approved/rejected counts>)`.
