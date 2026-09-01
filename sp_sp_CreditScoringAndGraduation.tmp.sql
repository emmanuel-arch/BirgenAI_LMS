
CREATE PROCEDURE [dbo].[sp_CreditScoringAndGraduation]
    @BorrowerId INT = NULL,  -- NULL = process all borrowers
    @EntityId INT,
    @UserId INT,
    @DebugMode BIT = 0  -- Set to 1 to see detailed output
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @ProcessedCount INT = 0;
    DECLARE @GraduatedCount INT = 0;
    DECLARE @ErrorMessage NVARCHAR(MAX);

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @DebugMode = 1 PRINT 'Procedure started with SIMPLIFIED scoring framework (2 parameters).';

        ---------------------------------------------------------------------
        -- Create temp tables to persist CTE results across different statements
        ---------------------------------------------------------------------
        IF OBJECT_ID('tempdb..#LastTwoCleared') IS NOT NULL DROP TABLE #LastTwoCleared;
        IF OBJECT_ID('tempdb..#BorrowerLoanAmountCheck') IS NOT NULL DROP TABLE #BorrowerLoanAmountCheck;
        IF OBJECT_ID('tempdb..#BorrowerFinalScores') IS NOT NULL DROP TABLE #BorrowerFinalScores;
        IF OBJECT_ID('tempdb..#GraduationCandidates') IS NOT NULL DROP TABLE #GraduationCandidates;

        ---------------------------------------------------------------------
        -- IDENTIFY up to TWO most recent CLEARED loans per borrower
        -- (same limit OR two cycles after last upgrade)
        ---------------------------------------------------------------------
        IF @DebugMode = 1 PRINT 'Identifying up to two most recent cleared loans per borrower...';

        CREATE TABLE #LastTwoCleared (
            LoanId INT,
            BorrowerId INT,
            Principal DECIMAL(18,2),
            ExpectedClearDate DATETIME,
            rn INT
        );

        INSERT INTO #LastTwoCleared (LoanId, BorrowerId, Principal, ExpectedClearDate, rn)
        SELECT 
            LoanId,
            BorrowerId,
            Principal,
            ExpectedClearDate,
            rn
        FROM (
            SELECT 
                l.id AS LoanId,
                l.BorrowerId,
                l.Principal,
                l.BorrowDate,
                l.ExpectedClearDate,
                ROW_NUMBER() OVER (PARTITION BY l.BorrowerId ORDER BY l.ExpectedClearDate DESC, l.borrowdate DESC, l.id DESC) AS rn
            FROM serviceconnect.dbo.loans l
            WHERE l.LoanCleared = 1
              AND l.EntityId = @EntityId
              AND (@BorrowerId IS NULL OR l.BorrowerId = @BorrowerId)
        ) AS ClearedLoansOrdered
        WHERE rn <= 2;

        -- Aggregate to detect whether the two most recent cleared loans have the same amount
        CREATE TABLE #BorrowerLoanAmountCheck (
            BorrowerId INT,
            ClearedLoanCount INT,
            MinPrincipal DECIMAL(18,2),
            MaxPrincipal DECIMAL(18,2)
        );

        INSERT INTO #BorrowerLoanAmountCheck (BorrowerId, ClearedLoanCount, MinPrincipal, MaxPrincipal)
        SELECT 
            BorrowerId,
            COUNT(*) AS ClearedLoanCount,
            MIN(Principal) AS MinPrincipal,
            MAX(Principal) AS MaxPrincipal
        FROM #LastTwoCleared
        GROUP BY BorrowerId;

        ---------------------------------------------------------------------
        -- STEP 1: CALCULATE CREDIT SCORES (SIMPLIFIED - 2 PARAMETERS)
        -- Repayment History: 50% weight
        -- Days in Arrears: 50% weight
        ---------------------------------------------------------------------
        IF @DebugMode = 1 PRINT 'Step 1: Calculating credit scores using SIMPLIFIED matrix (2 parameters)...';

        -- Create temp table for final scores
        CREATE TABLE #BorrowerFinalScores (
            BorrowerId INT,
            RiskScore DECIMAL(5,2),
            RiskCategory VARCHAR(20),
            RepaymentHistoryScore DECIMAL(5,2),
            DaysInArrearsScore DECIMAL(5,2),
            TotalInstallmentsUsed INT
        );

        -- Calculate and insert borrower final scores with NEW SIMPLIFIED SCORING
        INSERT INTO #BorrowerFinalScores (
            BorrowerId, 
            RepaymentHistoryScore, 
            DaysInArrearsScore, 
            RiskScore, 
            TotalInstallmentsUsed,
            RiskCategory
        )
        SELECT
            lp.BorrowerId,
            ROUND(AVG(lp.RepaymentHistoryScore), 2) AS RepaymentHistoryScore,
            ROUND(AVG(lp.DaysInArrearsScore), 2) AS DaysInArrearsScore,
            ROUND(
                (0.50 * AVG(COALESCE(lp.RepaymentHistoryScore,0))) + 
                (0.50 * AVG(COALESCE(lp.DaysInArrearsScore,0)))
            , 2) AS RiskScore,
            SUM(lp.InstallmentCountUsed) AS TotalInstallmentsUsed,
            CASE 
                WHEN ROUND(
                    (0.50 * AVG(COALESCE(lp.RepaymentHistoryScore,0))) + 
                    (0.50 * AVG(COALESCE(lp.DaysInArrearsScore,0)))
                , 2) > 76 THEN 'Minor risk'
                WHEN ROUND(
                    (0.50 * AVG(COALESCE(lp.RepaymentHistoryScore,0))) + 
                    (0.50 * AVG(COALESCE(lp.DaysInArrearsScore,0)))
                , 2) BETWEEN 51 AND 76 THEN 'Moderate'
                ELSE 'Major risk'
            END AS RiskCategory
        FROM (
            SELECT
                li.BorrowerId,
                li.LoanId,
                -- 1️⃣ REPAYMENT HISTORY (50% weight) - UPDATED SCORING
                AVG(
                    CASE
                        -- Paid 100% of installment by due date
                        WHEN li.AmountPaid >= li.InstallmentAmount THEN 100
                        -- Paid 75%-99% of installment by due date
                        WHEN li.AmountPaid >= 0.75 * li.InstallmentAmount THEN 75
                        -- Paid 50%-74% of installment by due date
                        WHEN li.AmountPaid >= 0.50 * li.InstallmentAmount THEN 50
                        -- Below 50% = 0%
                        ELSE 0
                    END
                ) AS RepaymentHistoryScore,
                
                -- 2️⃣ DAYS IN ARREARS (50% weight) - UPDATED SCORING
                AVG(
                    CASE
                        -- On or before due date (0 days late)
                        WHEN DATEDIFF(DAY, li.ExpectedDueDate, COALESCE(li.dateofpayment, GETDATE())) <= 0 THEN 100
                        -- 1-3 days late
                        WHEN DATEDIFF(DAY, li.ExpectedDueDate, COALESCE(li.dateofpayment, GETDATE())) BETWEEN 1 AND 3 THEN 30
                        -- 4-6 days late
                        WHEN DATEDIFF(DAY, li.ExpectedDueDate, COALESCE(li.dateofpayment, GETDATE())) BETWEEN 4 AND 6 THEN 10
                        -- Past 6 days = 0%
                        ELSE 0
                    END
                ) AS DaysInArrearsScore,
                
                COUNT(li.InstallmentRowId) AS InstallmentCountUsed
            FROM (
                SELECT 
                    lt.BorrowerId,
                    lt.LoanId,
                    ls.id AS InstallmentRowId,
                    ls.AmountPaid,
                    ls.InstallmentAmount,
                    ls.ExpectedDueDate,
                    ls.dateofpayment
                FROM #LastTwoCleared lt
                LEFT JOIN serviceconnect.dbo.loanschedule ls ON lt.LoanId = ls.LoanId
            ) AS li
            GROUP BY li.BorrowerId, li.LoanId
        ) AS lp
        GROUP BY lp.BorrowerId;

        -- Update borrowers table with computed RiskScore and RiskCategory
        UPDATE b
        SET 
            b.RiskScore = bfs.RiskScore,
            b.RiskCategory = bfs.RiskCategory,
            b.LastScoreUpdateDate = GETDATE(),
            b.LastScoreUpdatedBy = @UserId
        FROM serviceconnect.dbo.borrowers AS b
        INNER JOIN #BorrowerFinalScores AS bfs ON b.ID = bfs.BorrowerId
        WHERE b.EntityId = @EntityId
          AND (@BorrowerId IS NULL OR b.ID = @BorrowerId);

        SET @ProcessedCount = @@ROWCOUNT;

        IF @DebugMode = 1 
        BEGIN
            PRINT 'Step 1 Complete: Updated ' + CAST(@ProcessedCount AS VARCHAR) + ' borrower risk scores.';
            SELECT 
                BorrowerId, 
                RiskScore, 
                RiskCategory,
                RepaymentHistoryScore,
                DaysInArrearsScore,
                TotalInstallmentsUsed 
            FROM #BorrowerFinalScores
            ORDER BY BorrowerId;
        END

        ---------------------------------------------------------------------
        -- STEP 2: LOAN GRADUATION LOGIC (UPDATED THRESHOLDS)
        -- Minor risk (>76%): 30% graduation
        -- Moderate (51-76%): 15% graduation
        -- Major risk (≤50%): 0% graduation
        ---------------------------------------------------------------------
        IF @DebugMode = 1 PRINT 'Step 2: Processing loan graduations with NEW thresholds...';

        CREATE TABLE #GraduationCandidates (
            BorrowerId INT,
            CurrentLoanLimit DECIMAL(18,2),
			LastLoanPrincipal DECIMAL(18,2),
            RiskScore DECIMAL(5,2),
            RiskCategory VARCHAR(20),
            ClearedLoansCount INT,
            GraduationPercentage DECIMAL(5,2),
            NewLoanLimit DECIMAL(18,2),
            MaxIncrease DECIMAL(18,2),
            LastLoanAmount DECIMAL(18,2),
            LastLoanTerm INT,
            TotalInstallmentsUsed INT,
            RepaymentHistoryScore DECIMAL(5,2),
            DaysInArrearsScore DECIMAL(5,2)
        );

        INSERT INTO #GraduationCandidates (
            BorrowerId, 
            CurrentLoanLimit,
			LastLoanPrincipal,
            RiskScore,
            RiskCategory,
            ClearedLoansCount,
            GraduationPercentage,
            LastLoanAmount,
            LastLoanTerm,
            TotalInstallmentsUsed,
            RepaymentHistoryScore,
            DaysInArrearsScore
        )
        SELECT 
            b.ID,
            ISNULL(b.LoanLimit, 0) AS CurrentLoanLimit,
			(SELECT TOP 1 l.Principal FROM serviceconnect.dbo.loans l 
			 WHERE l.BorrowerId = b.ID AND l.LoanCleared = 1 AND l.EntityId = @EntityId
			 ORDER BY l.ExpectedClearDate DESC, l.id DESC) AS LastLoanPrincipal,
            ISNULL(b.RiskScore, 0) AS RiskScore,
            ISNULL(b.RiskCategory, 'Major risk') AS RiskCategory,
            COALESCE(clc.ClearedLoanCount, 0) AS ClearedLoansCount,
            -- NEW GRADUATION PERCENTAGES BASED ON SIMPLIFIED MATRIX
            CASE 
                WHEN b.RiskScore > 76 THEN 30.0    -- Minor risk
                WHEN b.RiskScore BETWEEN 51 AND 76 THEN 15.0  -- Moderate
                ELSE 0.0  -- Major risk (≤50%)
            END AS GraduationPercentage,
            (SELECT TOP 1 l.LoanAmount FROM serviceconnect.dbo.loans l 
             WHERE l.BorrowerId = b.ID AND l.LoanCleared = 1 AND l.EntityId = @EntityId
             ORDER BY l.ExpectedClearDate DESC, l.id DESC) AS LastLoanAmount,
            (SELECT TOP 1 DATEDIFF(DAY, l.BorrowDate, l.ExpectedClearDate) FROM serviceconnect.dbo.loans l 
             WHERE l.BorrowerId = b.ID AND l.LoanCleared = 1 AND l.EntityId = @EntityId
             ORDER BY l.ExpectedClearDate DESC, l.id DESC) AS LastLoanTerm,
            COALESCE(bfs.TotalInstallmentsUsed, 0) AS TotalInstallmentsUsed,
            COALESCE(bfs.RepaymentHistoryScore, 0) AS RepaymentHistoryScore,
            COALESCE(bfs.DaysInArrearsScore, 0) AS DaysInArrearsScore
        FROM serviceconnect.dbo.borrowers b
        LEFT JOIN #BorrowerLoanAmountCheck clc ON clc.BorrowerId = b.ID
        LEFT JOIN #BorrowerFinalScores bfs ON bfs.BorrowerId = b.ID
        WHERE b.EntityId = @EntityId
          AND (@BorrowerId IS NULL OR b.ID = @BorrowerId)
          -- Must have 2 cleared loans of same amount
          AND COALESCE(clc.ClearedLoanCount,0) >= 2
		  -- CHANGED: Check Principal amounts are equal
		  AND COALESCE(clc.MinPrincipal, -1) = COALESCE(clc.MaxPrincipal, -2)
          -- Must have score > 50% (only Minor and Moderate graduate)
          AND ISNULL(b.RiskScore,0) > 50
          AND (
                CASE 
                    WHEN ISNULL(b.RiskScore,0) > 76 THEN 30.0
                    WHEN ISNULL(b.RiskScore,0) BETWEEN 51 AND 76 THEN 15.0
                    ELSE 0.0
                END
              ) > 0;

        -- Calculate new loan limits with cap
        UPDATE #GraduationCandidates
        SET 
            MaxIncrease = (LastLoanPrincipal * GraduationPercentage / 100),
            NewLoanLimit = CASE 
                WHEN (LastLoanPrincipal * GraduationPercentage / 100) > 5000 
                THEN LastLoanPrincipal + 5000
                ELSE LastLoanPrincipal + (LastLoanPrincipal * GraduationPercentage / 100)
            END;

        IF @DebugMode = 1
        BEGIN
            PRINT 'Graduation candidate preview:';
            SELECT 
                BorrowerId, 
                CurrentLoanLimit,
				LastLoanPrincipal,
                RiskScore,
                RiskCategory,
                ClearedLoansCount,
                GraduationPercentage, 
                MaxIncrease, 
                NewLoanLimit, 
                TotalInstallmentsUsed,
                RepaymentHistoryScore,
                DaysInArrearsScore
            FROM #GraduationCandidates
            ORDER BY BorrowerId;
        END;

        -- Apply loan graduations
        UPDATE b
        SET 
            b.LoanLimit = gc.NewLoanLimit,
            b.LastGraduationDate = GETDATE(),
            b.LastGraduationBy = @UserId,
            b.PreviousLoanLimit = gc.CurrentLoanLimit,
            b.GraduationCount = ISNULL(b.GraduationCount, 0) + 1
        FROM serviceconnect.dbo.borrowers AS b
        INNER JOIN #GraduationCandidates AS gc ON b.ID = gc.BorrowerId
        WHERE gc.GraduationPercentage > 0
          AND b.EntityId = @EntityId;

        SET @GraduatedCount = @@ROWCOUNT;

        IF @DebugMode = 1 
            PRINT 'Step 2 Complete: Graduated ' + CAST(@GraduatedCount AS VARCHAR) + ' borrowers.';

        ---------------------------------------------------------------------
        -- STEP 3: LOG GRADUATION HISTORY
        ---------------------------------------------------------------------
        IF OBJECT_ID('dbo.LoanGraduationHistory', 'U') IS NOT NULL
        BEGIN
            INSERT INTO dbo.LoanGraduationHistory (
                BorrowerId, PreviousLimit, NewLimit, RiskScore, RiskCategory,
                GraduationPercentage, ClearedLoansCount, GraduationDate, 
                GraduatedBy, EntityId, RepaymentHistoryScore, DaysInArrearsScore
            )
            SELECT 
                gc.BorrowerId, gc.CurrentLoanLimit, gc.NewLoanLimit, gc.RiskScore,
                gc.RiskCategory, gc.GraduationPercentage, gc.ClearedLoansCount, 
                GETDATE(), @UserId, @EntityId,
                gc.RepaymentHistoryScore, gc.DaysInArrearsScore
            FROM #GraduationCandidates AS gc
            WHERE gc.GraduationPercentage > 0;
        END;

        ---------------------------------------------------------------------
        -- COMMIT & RETURN RESULTS
        ---------------------------------------------------------------------
        COMMIT TRANSACTION;

        -- Return summary
        SELECT 
            @ProcessedCount AS TotalBorrowersProcessed,
            @GraduatedCount AS TotalBorrowersGraduated,
            'Success' AS Status,
            'Simplified Matrix: Repayment History (50%) + Days in Arrears (50%)' AS ScoringFramework;

        -- Return detailed graduation results with breakdown
        SELECT 
            BorrowerId, 
            CurrentLoanLimit AS PreviousLimit, 
            NewLoanLimit,
            (NewLoanLimit - CurrentLoanLimit) AS IncreaseAmount, 
            RiskScore,
            RiskCategory,
            RepaymentHistoryScore,
            DaysInArrearsScore,
            GraduationPercentage, 
            ClearedLoansCount, 
            LastLoanAmount, 
            LastLoanTerm,
            TotalInstallmentsUsed, 
            CAST(LastLoanTerm * 1.5 AS INT) AS MaxNewLoanTerm
        FROM #GraduationCandidates
        WHERE GraduationPercentage > 0
        ORDER BY BorrowerId;

        -- Debug: borrowers with risk scores but not graduated
        IF @DebugMode = 1
        BEGIN
            PRINT 'Borrowers with risk scores but not graduated (sample):';
            SELECT TOP 20
                b.ID AS BorrowerId, 
                b.RiskScore,
                b.RiskCategory,
                COALESCE(bfs.RepaymentHistoryScore,0) AS RepaymentHistoryScore,
                COALESCE(bfs.DaysInArrearsScore,0) AS DaysInArrearsScore,
                COALESCE(bfs.TotalInstallmentsUsed,0) AS TotalInstallmentsUsed,
                ISNULL(clc.ClearedLoanCount,0) AS ClearedLoanCount,
                clc.MinPrincipal, 
                clc.MaxPrincipal,
                CASE 
                    WHEN ISNULL(clc.ClearedLoanCount,0) < 2 THEN 'Need 2 cleared loans'
                    WHEN COALESCE(clc.MinPrincipal, -1) <> COALESCE(clc.MaxPrincipal, -2) THEN 'Loan amounts not equal'
                    WHEN ISNULL(b.RiskScore,0) <= 50 THEN 'Score too low (Major risk)'
                    ELSE 'Check other conditions'
                END AS ReasonNotGraduated
            FROM serviceconnect.dbo.borrowers b
            LEFT JOIN #BorrowerFinalScores bfs ON bfs.BorrowerId = b.ID
            LEFT JOIN #BorrowerLoanAmountCheck clc ON clc.BorrowerId = b.ID
            WHERE b.EntityId = @EntityId
              AND (@BorrowerId IS NULL OR b.ID = @BorrowerId)
              AND b.ID NOT IN (SELECT BorrowerId FROM #GraduationCandidates WHERE GraduationPercentage > 0)
            ORDER BY b.RiskScore DESC;
        END;

        -- Cleanup temp tables
        DROP TABLE #LastTwoCleared;
        DROP TABLE #BorrowerLoanAmountCheck;
        DROP TABLE #BorrowerFinalScores;
        DROP TABLE #GraduationCandidates;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        SET @ErrorMessage = 
            'Error Number: ' + CAST(ERROR_NUMBER() AS VARCHAR) + CHAR(13) +
            'Error Message: ' + ERROR_MESSAGE() + CHAR(13) +
            'Error Line: ' + CAST(ERROR_LINE() AS VARCHAR);

        PRINT @ErrorMessage;

        SELECT 
            0 AS TotalBorrowersProcessed,
            0 AS TotalBorrowersGraduated,
            'Error' AS Status,
            @ErrorMessage AS ErrorDetails;

        THROW;
    END CATCH;
END;
