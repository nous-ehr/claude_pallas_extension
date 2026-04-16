-- =============================================================================
-- Common Anti-Patterns in athenahealth DataView Queries
-- =============================================================================
-- This file shows what developers commonly get WRONG and why it matters.
-- Each anti-pattern is followed by the correct approach.
-- =============================================================================


-- ❌ ANTI-PATTERN 1: Missing soft-delete filter
-- Impact: Returns deleted/voided records mixed with active ones. Silently corrupts analytics.
-- How often: Most common mistake. Affects nearly every query.
SELECT COUNT(*) AS total_patients
FROM ATHENAHEALTH.ATHENAONE.PATIENT;
-- This count includes patients who were deleted, merged, or marked as test records.

-- ✅ CORRECT: Always filter soft-deletes
SELECT COUNT(*) AS total_active_patients
FROM ATHENAHEALTH.ATHENAONE.PATIENT
WHERE DELETEDDATETIME IS NULL
  AND DELETEDBY IS NULL;


-- ❌ ANTI-PATTERN 2: Direct PATIENTID to CHARTID join
-- Impact: Silently loses ~46% of records due to patient merges and practice transfers.
-- The query returns results that look correct but are missing almost half the data.
SELECT p.FIRSTNAME, p.LASTNAME, c.CHARTID
FROM ATHENAHEALTH.ATHENAONE.PATIENT p
JOIN ATHENAHEALTH.ATHENAONE.CHART c
    ON p.PATIENTID = c.CHARTID;  -- WRONG: These are different key spaces!

-- ✅ CORRECT: Use CLINICALENCOUNTER as bridge table
SELECT p.FIRSTNAME, p.LASTNAME, c.CHARTID
FROM ATHENAHEALTH.ATHENAONE.PATIENT p
JOIN ATHENAHEALTH.ATHENAONE.CLINICALENCOUNTER ce
    ON p.PATIENTID = ce.PATIENTID
   AND ce.DELETEDDATETIME IS NULL
JOIN ATHENAHEALTH.ATHENAONE.CHART c
    ON ce.CHARTID = c.CHARTID
   AND c.DELETEDDATETIME IS NULL
WHERE p.DELETEDDATETIME IS NULL;


-- ❌ ANTI-PATTERN 3: Missing CONTEXTID on service account
-- Impact: Query returns data for ALL practices — a compliance/privacy violation.
-- With reader accounts this is fine (implicit RLS), but with service accounts it's critical.
SELECT * FROM ATHENAHEALTH.ATHENAONE.APPOINTMENT
WHERE APPOINTMENTSTATUS = 'f';
-- On a service account, this returns appointments from EVERY practice.

-- ✅ CORRECT: Service accounts must always filter by CONTEXTID
SELECT * FROM ATHENAHEALTH.ATHENAONE.APPOINTMENT
WHERE APPOINTMENTSTATUS = 'f'
  AND CONTEXTID = 12345  -- Replace with your practice ID
  AND DELETEDDATETIME IS NULL
LIMIT 100;


-- ❌ ANTI-PATTERN 4: Wrong soft-delete column for VISITCHARGE
-- Impact: VISITCHARGE uses VOIDEDBY/VOIDEDDATETIME, not DELETEDBY/DELETEDDATETIME.
-- Filtering on DELETEDDATETIME returns all records (column may not exist or always NULL).
SELECT * FROM ATHENAHEALTH.ATHENAONE.VISITCHARGE
WHERE DELETEDDATETIME IS NULL;  -- WRONG column for this view

-- ✅ CORRECT: VISITCHARGE uses VOIDEDBY/VOIDEDDATETIME
SELECT * FROM ATHENAHEALTH.ATHENAONE.VISITCHARGE
WHERE VOIDEDBY IS NULL
  AND VOIDEDDATETIME IS NULL
LIMIT 100;


-- ❌ ANTI-PATTERN 5: No LIMIT on exploratory queries
-- Impact: Returns millions of rows, overwhelming your Snowflake warehouse credits and timeout.
SELECT * FROM ATHENAHEALTH.ATHENAONE.CLINICALNOTE
WHERE DELETEDDATETIME IS NULL;
-- CLINICALNOTE can have tens of millions of rows across all practices.

-- ✅ CORRECT: Always LIMIT exploratory queries
SELECT * FROM ATHENAHEALTH.ATHENAONE.CLINICALNOTE
WHERE DELETEDDATETIME IS NULL
LIMIT 100;
