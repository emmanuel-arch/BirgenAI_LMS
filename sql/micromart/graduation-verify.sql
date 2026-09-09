/* ---------------------------------------------------------------------------
   sp_CreditScoringAndGraduation — before / after, and what the ladder really is.

   Every query here is READ-ONLY. Run 1 and 2 before applying the guard, run 2
   and 3 after. Nothing in this file changes a row.

   Set @Entity to 3005 (Micromart Fintech) or 3002 (Micromart Africa). The two
   books are in very different states and the same query tells a different story
   about each — see the note at the bottom.
   --------------------------------------------------------------------------- */

DECLARE @Entity INT = 3005;


/* == 1. WHAT TONIGHT'S RUN WOULD DO ==========================================
   Replicates the procedure's own candidate logic, so these are the real
   numbers rather than an estimate. "Already at that limit" is the count the
   guard removes; "Would DROP" is the silent demotion the guard also stops.
   -------------------------------------------------------------------------- */
;WITH LastTwo AS (
    SELECT l.BorrowerId, l.Principal,
           ROW_NUMBER() OVER (PARTITION BY l.BorrowerId
                              ORDER BY l.ExpectedClearDate DESC, l.BorrowDate DESC, l.id DESC) AS rn
      FROM Serviceconnect.dbo.Loans l
     WHERE l.LoanCleared = 1 AND l.EntityId = @Entity
), Chk AS (
    SELECT BorrowerId, COUNT(*) AS ClearedCount, MIN(Principal) AS MinP, MAX(Principal) AS MaxP
      FROM LastTwo WHERE rn <= 2 GROUP BY BorrowerId
), Cand AS (
    SELECT b.ID, ISNULL(b.LoanLimit, 0) AS CurrentLimit, c.MaxP AS LastPrincipal,
           CASE WHEN b.RiskScore > 76 THEN 30.0
                WHEN b.RiskScore BETWEEN 51 AND 76 THEN 15.0 ELSE 0.0 END AS Pct
      FROM Serviceconnect.dbo.Borrowers b
      JOIN Chk c ON c.BorrowerId = b.ID
     WHERE b.EntityId = @Entity
       AND c.ClearedCount >= 2
       AND c.MinP = c.MaxP
       AND ISNULL(b.RiskScore, 0) > 50
), Calc AS (
    SELECT ID, CurrentLimit,
           LastPrincipal + CASE WHEN (LastPrincipal * Pct / 100) > 5000
                                THEN 5000 ELSE (LastPrincipal * Pct / 100) END AS NewLimit
      FROM Cand WHERE Pct > 0
)
SELECT
    COUNT(*)                                                              AS Candidates,
    SUM(CASE WHEN NewLimit  > CurrentLimit THEN 1 ELSE 0 END)             AS RealIncrease,
    SUM(CASE WHEN NewLimit  = CurrentLimit THEN 1 ELSE 0 END)             AS AlreadyAtThatLimit,
    SUM(CASE WHEN NewLimit  < CurrentLimit THEN 1 ELSE 0 END)             AS WouldBeDemoted,
    SUM(CASE WHEN NewLimit  < CurrentLimit THEN CurrentLimit - NewLimit
             ELSE 0 END)                                                  AS KesThatWouldBeRemoved
FROM Calc;


/* == 2. IS THE PROCEDURE'S WRITE ACTUALLY STICKING? ==========================
   Compares each borrower's CURRENT limit with the NewLimit the procedure last
   wrote for them. They should agree. Where the row now reads 0 but the
   procedure wrote a real number, something OUTSIDE this procedure is clearing
   Borrowers.LoanLimit between runs, and no change to the procedure will fix it.
   -------------------------------------------------------------------------- */
;WITH Newest AS (
    SELECT h.BorrowerId, h.NewLimit,
           ROW_NUMBER() OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate DESC) AS rn
      FROM dbo.LoanGraduationHistory h
     WHERE h.EntityId = @Entity
)
SELECT
    COUNT(*)                                                                       AS BorrowersWithHistory,
    SUM(CASE WHEN ISNULL(b.LoanLimit,0) =  n.NewLimit THEN 1 ELSE 0 END)           AS LimitMatchesWhatWeWrote,
    SUM(CASE WHEN ISNULL(b.LoanLimit,0) =  0 AND n.NewLimit > 0 THEN 1 ELSE 0 END) AS WipedBackToZero,
    SUM(CASE WHEN ISNULL(b.LoanLimit,0) <> 0
              AND ISNULL(b.LoanLimit,0) <> n.NewLimit THEN 1 ELSE 0 END)           AS HoldsSomeOtherValue,
    SUM(CASE WHEN ISNULL(b.LoanLimit,0) = 0 AND n.NewLimit > 0
             THEN n.NewLimit ELSE 0 END)                                           AS KesOfEarnedLimitMissing
FROM Newest n
JOIN Serviceconnect.dbo.Borrowers b ON b.ID = n.BorrowerId
WHERE n.rn = 1 AND b.EntityId = @Entity;


/* == 3. THE LADDER, WITH THE NOISE COLLAPSED =================================
   What LoanGraduationHistory means once the repeated rows are removed: one rung
   per actual movement. This is the shape the customer app and the console
   should both render — reading the table raw shows a customer ~190 identical
   rungs, which reads as a broken screen rather than as a history.

   Change @Borrower to inspect one customer.
   -------------------------------------------------------------------------- */
DECLARE @Borrower INT = 22;

;WITH Ordered AS (
    SELECT h.BorrowerId, h.PreviousLimit, h.NewLimit, h.RiskScore, h.RiskCategory,
           h.GraduationPercentage, h.ClearedLoansCount, h.GraduationDate,
           h.RepaymentHistoryScore, h.DaysInArrearsScore,
           ROW_NUMBER() OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS seq,
           LAG(h.NewLimit)      OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS PrevNewLimit,
           LAG(h.PreviousLimit) OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS PrevPrevLimit
      FROM dbo.LoanGraduationHistory h
     WHERE h.BorrowerId = @Borrower
)
SELECT GraduationDate, PreviousLimit, NewLimit,
       NewLimit - PreviousLimit AS Movement,
       RiskScore, RiskCategory, GraduationPercentage, ClearedLoansCount,
       RepaymentHistoryScore, DaysInArrearsScore
  FROM Ordered
 WHERE NewLimit <> PreviousLimit                       -- a rung must move
   AND (seq = 1                                        -- keep the first
        OR PrevNewLimit <> NewLimit                    -- or a genuinely new rung
        OR PrevPrevLimit <> PreviousLimit)
 ORDER BY GraduationDate DESC;

-- And the same thing as a count, per entity, so the size of the clean-up is
-- visible before anyone decides whether to prune the table:
SELECT EntityId,
       COUNT(*)                                                        AS RowsToday,
       SUM(CASE WHEN NewLimit  > PreviousLimit THEN 1 ELSE 0 END)      AS RowsThatMovedUp,
       SUM(CASE WHEN NewLimit  = PreviousLimit THEN 1 ELSE 0 END)      AS RowsThatMovedNothing,
       SUM(CASE WHEN NewLimit  < PreviousLimit THEN 1 ELSE 0 END)      AS RowsThatMovedDown,
       COUNT(DISTINCT BorrowerId)                                      AS Borrowers
  FROM dbo.LoanGraduationHistory
 GROUP BY EntityId
 ORDER BY EntityId;


/* == NOTE ON THE TWO BOOKS ===================================================

   3005 (Fintech) — the procedure's writes stick. Its problem is pure noise: the
   same borrower re-graduated to the same number nightly. The guard fixes this
   entirely. Note also that its last run was 2 August 2026; if that job is still
   meant to be scheduled, it has been off for over a month and every limit on
   this book is stale by that much.

   3002 (Africa) — the procedure's writes do NOT stick. Query 2 shows tens of
   thousands of borrowers whose earned limit has been reset to 0 by something
   outside this procedure. There the nightly "graduation" is the procedure
   repairing that wipe, so the guard will NOT quieten it and should not be
   expected to. Only two objects in Serviceconnect assign to Borrowers.LoanLimit
   at all — this procedure and sp_BorrowerLimitUpdate — and neither accounts for
   the volume, so the writer is application code, a job, or one of the databases
   this login cannot read (IPF, Speciality). Find it before treating 3002's
   history as a ladder.
   --------------------------------------------------------------------------- */
