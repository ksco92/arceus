#!/usr/bin/env bash
#
# End-to-end integration test for IcebergTable's v2 DML surface.
# Deploys `IcebergDmlStack` once, then runs a sequence of Athena
# statements that exercise UPDATE, DELETE, MERGE INTO, time-travel
# SELECT, OPTIMIZE, and VACUUM against the same Iceberg table.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var set to the ARN of the IAM principal
#     the workflow is running as (same value passed to ArceusStack).
#   - ArceusStack already deployed with the same `PRINCIPAL_ARN`.
#
# Usage:
#   scripts/integration-test-dml.sh
#
# Optional env vars:
#   AWS_REGION       — default us-east-1
#   ATHENA_WORKGROUP — default ReadOnly
#   DESTROY          — set to 1 to teardown at the end
#
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ATHENA_WORKGROUP="${ATHENA_WORKGROUP:-ReadOnly}"
DATABASE="sample_database"
TABLE="dml_test"
STACK="IcebergDmlStack"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

run_athena() {
    local sql="$1"
    local qid
    if ! qid=$(aws athena start-query-execution \
        --region "$AWS_REGION" \
        --work-group "$ATHENA_WORKGROUP" \
        --query-string "$sql" \
        --query 'QueryExecutionId' \
        --output text 2>&1); then
        red "Athena start-query-execution failed:" >&2
        echo "$qid" >&2
        red "Query SQL:" >&2
        echo "$sql" >&2
        return 1
    fi
    if [ -z "$qid" ]; then
        red "Athena start-query-execution returned empty query id for SQL:" >&2
        echo "$sql" >&2
        return 1
    fi
    local state
    until state=$(aws athena get-query-execution \
            --region "$AWS_REGION" \
            --query-execution-id "$qid" \
            --query 'QueryExecution.Status.State' \
            --output text 2>/dev/null) \
        && [[ "$state" =~ ^(SUCCEEDED|FAILED|CANCELLED)$ ]]; do
        sleep 2
    done
    if [ "$state" != "SUCCEEDED" ]; then
        red "Athena query failed (state=$state):" >&2
        aws athena get-query-execution \
            --region "$AWS_REGION" \
            --query-execution-id "$qid" \
            --query 'QueryExecution.Status.StateChangeReason' \
            --output text >&2
        red "Query SQL:" >&2
        echo "$sql" >&2
        return 1
    fi
    # Drop the header row (Rows[0]); return only data rows.
    aws athena get-query-results \
        --region "$AWS_REGION" \
        --query-execution-id "$qid" \
        --query 'ResultSet.Rows[1:].Data[].VarCharValue' \
        --output text
}

current_snapshot_id() {
    # $snapshots metadata table returns one row per snapshot.
    # The most recent one is the current snapshot.
    run_athena "SELECT CAST(snapshot_id AS VARCHAR) FROM \"${DATABASE}\".\"${TABLE}\$snapshots\" ORDER BY committed_at DESC LIMIT 1"
}

assert_select_count() {
    local expected="$1"
    local where="$2"
    local label="$3"
    local count
    count=$(run_athena "SELECT CAST(COUNT(*) AS VARCHAR) FROM ${DATABASE}.${TABLE} ${where}")
    if [ "$count" = "$expected" ]; then
        green "  ${label} ✓ (count=${count})"
    else
        red   "  ${label} ✗"
        red   "    expected count: $expected"
        red   "    actual count:   $count"
        return 1
    fi
}

assert_value() {
    local expected="$1"
    local sql="$2"
    local label="$3"
    local actual
    actual=$(run_athena "$sql")
    if [ "$actual" = "$expected" ]; then
        green "  ${label} ✓ ($actual)"
    else
        red   "  ${label} ✗"
        red   "    expected: $expected"
        red   "    actual:   $actual"
        return 1
    fi
}

cleanup_table_prefix() {
    local bucket="data-lake-bucket-$(aws sts get-caller-identity --query Account --output text)"
    yellow "  Clearing s3://${bucket}/${DATABASE}/${TABLE}/ so the next deploy starts fresh."
    aws s3 rm "s3://${bucket}/${DATABASE}/${TABLE}/" --recursive --region "$AWS_REGION" 2>/dev/null || true
}

################################################
################################################
# Teardown any leftover stack from a prior run.

header "TEARDOWN any existing IcebergDmlStack from a prior run"
npx cdk destroy "$STACK" --force 2>&1 | tail -5 || true
cleanup_table_prefix

################################################
################################################
# Initial deploy.

header "DEPLOY IcebergDmlStack"
npx cdk deploy "$STACK" --require-approval=never 2>&1 | tail -5

################################################
################################################
# Step 1: INSERT seed rows.

header "STEP 1 — INSERT 5 seed accounts"
run_athena "INSERT INTO ${DATABASE}.${TABLE} VALUES
  (1, 'a@example.com', DECIMAL '100.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (2, 'b@example.com', DECIMAL '200.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (3, 'c@example.com', DECIMAL '300.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (4, 'd@example.com', DECIMAL '400.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (5, 'e@example.com', DECIMAL '500.00', TIMESTAMP '2026-01-01 09:00:00 UTC')" > /dev/null
yellow "  5 rows inserted"
assert_select_count 5 "" "row count after INSERT"

################################################
################################################
# Step 2: UPDATE — merge-on-read.

header "STEP 2 — UPDATE balance for account_id=2"
run_athena "UPDATE ${DATABASE}.${TABLE}
  SET balance = DECIMAL '250.00', last_updated_at = TIMESTAMP '2026-02-01 09:00:00 UTC'
  WHERE account_id = 2" > /dev/null
assert_value "250.00" \
    "SELECT CAST(balance AS VARCHAR) FROM ${DATABASE}.${TABLE} WHERE account_id = 2" \
    "balance updated"
assert_select_count 5 "" "row count unchanged after UPDATE"

################################################
################################################
# Step 3: DELETE — merge-on-read.

header "STEP 3 — DELETE account_id=4"
run_athena "DELETE FROM ${DATABASE}.${TABLE} WHERE account_id = 4" > /dev/null
assert_select_count 4 "" "row count after DELETE"
assert_select_count 0 "WHERE account_id = 4" "deleted row gone"

################################################
################################################
# Step 4: Capture the pre-MERGE snapshot id for time travel.

header "STEP 4 — Capture pre-MERGE snapshot id"
SNAPSHOT_PRE_MERGE=$(current_snapshot_id)
yellow "  pre-MERGE snapshot_id = ${SNAPSHOT_PRE_MERGE}"

################################################
################################################
# Step 5: MERGE INTO — upsert (updates id=3, inserts id=6 and id=7).

header "STEP 5 — MERGE INTO (upsert: update id=3, insert id=6 and id=7)"
run_athena "MERGE INTO ${DATABASE}.${TABLE} t
  USING (
    SELECT 3 AS account_id, 'c@example.com' AS email,
           DECIMAL '333.00' AS balance,
           TIMESTAMP '2026-03-01 09:00:00 UTC' AS last_updated_at
    UNION ALL SELECT 6, 'f@example.com', DECIMAL '600.00',
           TIMESTAMP '2026-03-01 09:00:00 UTC'
    UNION ALL SELECT 7, 'g@example.com', DECIMAL '700.00',
           TIMESTAMP '2026-03-01 09:00:00 UTC'
  ) s
  ON t.account_id = s.account_id
  WHEN MATCHED THEN UPDATE
    SET balance = s.balance, last_updated_at = s.last_updated_at
  WHEN NOT MATCHED THEN INSERT
    (account_id, email, balance, last_updated_at)
    VALUES (s.account_id, s.email, s.balance, s.last_updated_at)" > /dev/null
assert_select_count 6 "" "row count after MERGE (4 + 2 inserts)"
assert_value "333.00" \
    "SELECT CAST(balance AS VARCHAR) FROM ${DATABASE}.${TABLE} WHERE account_id = 3" \
    "id=3 updated via MERGE"
assert_select_count 1 "WHERE account_id = 6" "id=6 inserted via MERGE"
assert_select_count 1 "WHERE account_id = 7" "id=7 inserted via MERGE"

################################################
################################################
# Step 6: Time travel — pre-MERGE snapshot should still see 4 rows.

header "STEP 6 — Time travel SELECT FOR VERSION AS OF pre-MERGE"
COUNT_PRE=$(run_athena "SELECT CAST(COUNT(*) AS VARCHAR) FROM ${DATABASE}.${TABLE} FOR VERSION AS OF ${SNAPSHOT_PRE_MERGE}")
if [ "$COUNT_PRE" = "4" ]; then
    green "  time-travel count ✓ (pre-MERGE saw 4 rows)"
else
    red "  time-travel count ✗ (expected 4, got $COUNT_PRE)"
    exit 1
fi
COUNT_PRE_ID6=$(run_athena "SELECT CAST(COUNT(*) AS VARCHAR) FROM ${DATABASE}.${TABLE} FOR VERSION AS OF ${SNAPSHOT_PRE_MERGE} WHERE account_id = 6")
if [ "$COUNT_PRE_ID6" = "0" ]; then
    green "  time-travel pre-MERGE doesn't see id=6 ✓"
else
    red "  time-travel pre-MERGE leaked id=6 (got $COUNT_PRE_ID6)"
    exit 1
fi

################################################
################################################
# Step 7: OPTIMIZE — compaction. Just needs to succeed.

header "STEP 7 — OPTIMIZE REWRITE DATA USING BIN_PACK"
run_athena "OPTIMIZE ${DATABASE}.${TABLE} REWRITE DATA USING BIN_PACK" > /dev/null
green "  OPTIMIZE succeeded ✓"
assert_select_count 6 "" "row count unchanged after OPTIMIZE"

################################################
################################################
# Step 8: VACUUM — snapshot expiration. Just needs to succeed.

header "STEP 8 — VACUUM"
# Give the aggressive max-snapshot-age-ms a chance to elapse so
# VACUUM actually has snapshots to expire.
sleep 65
run_athena "VACUUM ${DATABASE}.${TABLE}" > /dev/null
green "  VACUUM succeeded ✓"
assert_select_count 6 "" "row count unchanged after VACUUM"

################################################
################################################
# Step 9: Final SELECT covers the full post-DML state.

header "STEP 9 — Final SELECT"
ROWS=$(run_athena "SELECT CAST(account_id AS VARCHAR), CAST(balance AS VARCHAR) FROM ${DATABASE}.${TABLE} ORDER BY account_id")
yellow "  final state:"
echo "$ROWS" | tr '\t' '\n' | paste -d' ' - - | sed 's/^/    /'
if echo "$ROWS" | grep -q "1" \
    && echo "$ROWS" | grep -q "250.00" \
    && echo "$ROWS" | grep -q "333.00" \
    && ! echo "$ROWS" | grep -q "^4	" \
    && echo "$ROWS" | grep -q "600.00" \
    && echo "$ROWS" | grep -q "700.00"; then
    green "  final state has the expected 6 rows with updated balances ✓"
else
    red "  final state is wrong"
    exit 1
fi

################################################
################################################
# Optional teardown.

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force 2>&1 | tail -5
    cleanup_table_prefix
fi

green ""
green "=== ALL DML STEPS PASSED ==="
