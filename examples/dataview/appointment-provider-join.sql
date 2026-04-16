-- =============================================================================
-- Appointments with Provider and Department Details
-- =============================================================================
-- Purpose: List upcoming appointments with provider names and department info
--
-- CONTEXTID: Reader = implicit RLS; Service = add CONTEXTID filter to all tables
--
-- Join Path (verified via athena_explain_join):
--   APPOINTMENT.SCHEDULINGPROVIDERID → PROVIDER.PROVIDERID
--   APPOINTMENT.DEPARTMENTID → DEPARTMENT.DEPARTMENTID
--   APPOINTMENT.PATIENTID → PATIENT.PATIENTID
--
-- Gotchas:
--   - APPOINTMENTSTATUS values: 'f' = future, '2' = checked in, '3' = checked out, 'x' = cancelled
--   - Do NOT join APPOINTMENT.PATIENTID to CHART.CHARTID — different key spaces
--   - Use APPOINTMENTTYPENAME for display, APPOINTMENTTYPEID for filtering
-- =============================================================================

WITH future_appointments AS (
    SELECT
        a.APPOINTMENTID,
        a.APPOINTMENTDATE,
        a.APPOINTMENTSTARTTIME,
        a.APPOINTMENTSTATUS,
        a.APPOINTMENTTYPENAME,
        a.PATIENTID,
        a.SCHEDULINGPROVIDERID,
        a.DEPARTMENTID,
        a.DURATION
    FROM ATHENAHEALTH.ATHENAONE.APPOINTMENT a
    WHERE a.DELETEDDATETIME IS NULL
      AND a.DELETEDBY IS NULL
      AND a.APPOINTMENTSTATUS = 'f'        -- Future appointments only
      AND a.APPOINTMENTDATE >= CURRENT_DATE()
)

SELECT
    fa.APPOINTMENTID,
    fa.APPOINTMENTDATE,
    fa.APPOINTMENTSTARTTIME,
    fa.APPOINTMENTTYPENAME,
    fa.DURATION,
    -- Patient info
    p.FIRSTNAME AS PATIENT_FIRST,
    p.LASTNAME AS PATIENT_LAST,
    -- Provider info (via verified FK)
    pr.PROVIDERFIRSTNAME,
    pr.PROVIDERLASTNAME,
    pr.SPECIALTY,
    -- Department info (via verified FK)
    d.DEPARTMENTNAME
FROM future_appointments fa
-- Join to PATIENT (verified: APPOINTMENT.PATIENTID → PATIENT.PATIENTID)
JOIN ATHENAHEALTH.ATHENAONE.PATIENT p
    ON fa.PATIENTID = p.PATIENTID
   AND p.DELETEDDATETIME IS NULL
-- Join to PROVIDER (verified: APPOINTMENT.SCHEDULINGPROVIDERID → PROVIDER.PROVIDERID)
LEFT JOIN ATHENAHEALTH.ATHENAONE.PROVIDER pr
    ON fa.SCHEDULINGPROVIDERID = pr.PROVIDERID
   AND pr.DELETEDDATETIME IS NULL
-- Join to DEPARTMENT (verified: APPOINTMENT.DEPARTMENTID → DEPARTMENT.DEPARTMENTID)
LEFT JOIN ATHENAHEALTH.ATHENAONE.DEPARTMENT d
    ON fa.DEPARTMENTID = d.DEPARTMENTID
   AND d.DELETEDDATETIME IS NULL
ORDER BY fa.APPOINTMENTDATE, fa.APPOINTMENTSTARTTIME
LIMIT 100;
