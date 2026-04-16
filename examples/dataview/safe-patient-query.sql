-- =============================================================================
-- Safe Patient Demographics Query
-- =============================================================================
-- Purpose: Retrieve active patient demographics with department information
--
-- CONTEXTID Handling:
--   Reader account:  Implicit row-level security — no CONTEXTID filter needed.
--   Service account: Add WHERE p.CONTEXTID = <your_practice_id> to EVERY table.
--
-- Gotchas:
--   - DELETEDDATETIME filter excludes soft-deleted records (HIPAA audit trail)
--   - PATIENT is a financial entity; CHART is clinical. Do NOT join them directly.
--   - PATIENTSTATUS enum: 'a' = active, 'i' = inactive, 'd' = deceased
-- =============================================================================

WITH active_patients AS (
    SELECT
        p.PATIENTID,
        p.FIRSTNAME,
        p.LASTNAME,
        p.DOB,
        p.SEX,
        p.PATIENTSTATUS,
        p.DEPARTMENTID,
        p.PRIMARYPROVIDERID
    FROM ATHENAHEALTH.ATHENAONE.PATIENT p
    WHERE p.DELETEDDATETIME IS NULL       -- Exclude soft-deleted records (required for data accuracy)
      AND p.DELETEDBY IS NULL             -- Both columns must be NULL to confirm not deleted
      AND p.PATIENTSTATUS = 'a'           -- Active patients only
    -- SERVICE ACCOUNT ONLY: Uncomment the line below
    -- AND p.CONTEXTID = :practice_id
)

SELECT
    ap.PATIENTID,
    ap.FIRSTNAME,
    ap.LASTNAME,
    ap.DOB,
    ap.SEX,
    d.DEPARTMENTNAME,
    d.CITY,
    d.STATE
FROM active_patients ap
LEFT JOIN ATHENAHEALTH.ATHENAONE.DEPARTMENT d
    ON ap.DEPARTMENTID = d.DEPARTMENTID   -- Verified FK: PATIENT.DEPARTMENTID → DEPARTMENT.DEPARTMENTID
   AND d.DELETEDDATETIME IS NULL          -- Soft-delete filter on joined table too
-- SERVICE ACCOUNT ONLY: Uncomment the line below
-- AND d.CONTEXTID = :practice_id         -- CONTEXTID must match across both tables
ORDER BY ap.LASTNAME, ap.FIRSTNAME
LIMIT 100;                                 -- Always limit exploratory queries
