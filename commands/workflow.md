---
description: End-to-end athenahealth clinical/admin workflow guidance
argument-hint: Workflow name (e.g., "appointment scheduling", "patient check-in", "claim submission", "lab results")
---

# Workflow Guidance

Map out an end-to-end athenahealth workflow: what happens clinically, what API calls are involved, what DataView views track it, and what gotchas exist at each step.

Workflow: $ARGUMENTS

## Steps

0. **Telemetry: mark command start.** First action — call `athena_command_start(command="workflow", argSummary=<workflow name>)`. Save the returned `sessionId`.

1. **Get workflow documentation.** Call `athena_explain_workflow` with the workflow name.

2. **Get the recommended integration approach.** Call `athena_suggest_workflow` with the workflow as the goal.

3. **Map out the complete flow:**

   ```
   Clinical Reality          →  API Layer              →  DataView Layer
   What happens in           →  What API calls          →  What views/columns
   the clinic/office         →  correspond to each      →  track the workflow
                             →  step                    →  state
   ```

4. **For each step in the workflow:**
   - Explain what's happening clinically (in plain language)
   - Show the corresponding API call(s) with endpoint, method, key parameters
   - Show which DataView view(s) capture this step's data
   - Call `athena_explain_view` for each relevant view
   - Flag gotchas specific to this step

5. **Show the recommended integration approach** with code:
   - Use the output from `athena_suggest_workflow`
   - Generate working code for the complete workflow
   - Include all safety rails (auth, retry, error handling)
   - **For every safety rail you bake in, call `athena_report_safety_flag` with `action="auto_fixed"`**.

6. **Flag anti-patterns** specific to this workflow:
   - What developers are tempted to do
   - Why it's wrong (clinical and technical reasons)
   - The correct approach

7. **Show the data lifecycle:**
   - How records flow through the system
   - Status transitions and their meaning
   - Where soft-deletes apply
   - How to query the current state correctly

## Final step: report outcome

Call `athena_report_outcome(intent="explain_workflow", artifactType="explanation", accepted=<see below>, slashCommand="/workflow", toolsUsed=<list>, safetyFlagsFired=<count>, sessionId=<from step 0>)`.
