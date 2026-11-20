#!/usr/bin/env bash
#
# End-to-end integration test for IcebergTable's v2 DML surface. Deploys
# `IcebergDmlStack` once, runs scripts/spark/verify_dml.py against it, then
# reads Spark's rows and runs the same DML through Athena on account ids
# above 10, and reads the Athena rows back through Spark.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var set to the ARN of the IAM principal
#     the workflow is running as (same value passed to ArceusStack).
#   - ArceusStack already deployed with the same `PRINCIPAL_ARN`.
#   - The Spark toolchain installed (scripts/spark/install-spark.sh).
#   - An Athena workgroup and query result location (scripts/athena.sh).
#
# Usage:
#   scripts/integration-test-dml.sh
#
# Optional env vars:
#   AWS_REGION - default us-east-1
#   DESTROY    - set to 1 to teardown at the end
#   ATHENA_*   - see scripts/athena.sh
#
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
DATABASE="sample_database"
TABLE="dml_test"
STACK="IcebergDmlStack"

green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

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

# shellcheck source=scripts/spark/spark-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/spark/spark-env.sh"
# shellcheck source=scripts/athena.sh
source "$(dirname "${BASH_SOURCE[0]}")/athena.sh"
VERIFY_PROGRAM="$(dirname "${BASH_SOURCE[0]}")/spark/verify_dml.py"

################################################
################################################
# Initial deploy.

header "DEPLOY IcebergDmlStack"
npx cdk deploy "$STACK" --require-approval=never 2>&1 | tail -5

header "SPARK DML"
spark_submit "$VERIFY_PROGRAM" --phase dml

header "ATHENA reads the rows Spark wrote"
athena_expect "Spark rows" \
    "SELECT account_id, email, balance, last_updated_at FROM ${TABLE} ORDER BY account_id" \
    "account_id|email|balance|last_updated_at" \
    "1|a@example.com|100.00|2026-01-01 09:00:00.000000 UTC" \
    "2|b@example.com|250.00|2026-02-01 09:00:00.000000 UTC" \
    "3|c@example.com|333.00|2026-03-01 09:00:00.000000 UTC" \
    "5|e@example.com|500.00|2026-01-01 09:00:00.000000 UTC" \
    "6|f@example.com|600.00|2026-03-01 09:00:00.000000 UTC" \
    "7|g@example.com|700.00|2026-03-01 09:00:00.000000 UTC"
athena_expect "identifier column comment" \
    "SELECT column_name, comment FROM information_schema.columns WHERE table_schema = '${DATABASE}' AND table_name = '${TABLE}' ORDER BY ordinal_position" \
    "column_name|comment" "account_id|(PK) " "email|NULL" "balance|NULL" "last_updated_at|NULL"

OWN_ROWS="SELECT account_id, balance FROM ${TABLE} WHERE account_id > 10 ORDER BY account_id"

header "ATHENA INSERT 5 accounts"
run_athena "INSERT INTO ${TABLE} VALUES
  (11, 'k@example.com', DECIMAL '100.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (12, 'l@example.com', DECIMAL '200.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (13, 'm@example.com', DECIMAL '300.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (14, 'n@example.com', DECIMAL '400.00', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (15, 'o@example.com', DECIMAL '500.00', TIMESTAMP '2026-01-01 09:00:00 UTC')" >/dev/null
athena_expect "inserted" "$OWN_ROWS" "account_id|balance" "11|100.00" "12|200.00" "13|300.00" "14|400.00" "15|500.00"

header "ATHENA UPDATE account_id=12"
run_athena "UPDATE ${TABLE}
  SET balance = DECIMAL '250.00', last_updated_at = TIMESTAMP '2026-02-01 09:00:00 UTC'
  WHERE account_id = 12" >/dev/null
athena_expect "updated" "$OWN_ROWS" "account_id|balance" "11|100.00" "12|250.00" "13|300.00" "14|400.00" "15|500.00"

header "ATHENA DELETE account_id=14"
run_athena "DELETE FROM ${TABLE} WHERE account_id = 14" >/dev/null
PRE_MERGE=("account_id|balance" "11|100.00" "12|250.00" "13|300.00" "15|500.00")
athena_expect "deleted" "$OWN_ROWS" "${PRE_MERGE[@]}"

SNAPSHOT=$(run_athena \
    "SELECT snapshot_id, CAST(committed_at AS VARCHAR) FROM \"${TABLE}\$snapshots\" ORDER BY committed_at DESC LIMIT 1" | sed -n 2p)
IFS='|' read -r SNAPSHOT_ID SNAPSHOT_AT <<<"$SNAPSHOT"
yellow "  pre-MERGE snapshot ${SNAPSHOT_ID} committed at ${SNAPSHOT_AT}"

header "ATHENA MERGE INTO (update id=13, insert id=16 and id=17)"
run_athena "MERGE INTO ${TABLE} t
  USING (
    SELECT 13 AS account_id, 'm@example.com' AS email,
           DECIMAL '333.00' AS balance,
           TIMESTAMP '2026-03-01 09:00:00 UTC' AS last_updated_at
    UNION ALL SELECT 16, 'p@example.com', DECIMAL '600.00', TIMESTAMP '2026-03-01 09:00:00 UTC'
    UNION ALL SELECT 17, 'q@example.com', DECIMAL '700.00', TIMESTAMP '2026-03-01 09:00:00 UTC'
  ) s
  ON t.account_id = s.account_id
  WHEN MATCHED THEN UPDATE
    SET balance = s.balance, last_updated_at = s.last_updated_at
  WHEN NOT MATCHED THEN INSERT
    (account_id, email, balance, last_updated_at)
    VALUES (s.account_id, s.email, s.balance, s.last_updated_at)" >/dev/null
FINAL=("account_id|balance" "11|100.00" "12|250.00" "13|333.00" "15|500.00" "16|600.00" "17|700.00")
athena_expect "merged" "$OWN_ROWS" "${FINAL[@]}"

header "ATHENA time travel to the pre-MERGE snapshot"
athena_expect "FOR VERSION AS OF" \
    "SELECT account_id, balance FROM ${TABLE} FOR VERSION AS OF ${SNAPSHOT_ID} WHERE account_id > 10 ORDER BY account_id" \
    "${PRE_MERGE[@]}"
athena_expect "FOR TIMESTAMP AS OF" \
    "SELECT account_id, balance FROM ${TABLE} FOR TIMESTAMP AS OF TIMESTAMP '${SNAPSHOT_AT}' WHERE account_id > 10 ORDER BY account_id" \
    "${PRE_MERGE[@]}"

header "ATHENA OPTIMIZE REWRITE DATA USING BIN_PACK"
run_athena "OPTIMIZE ${TABLE} REWRITE DATA USING BIN_PACK" >/dev/null
athena_expect "latest snapshot is the rewrite" \
    "SELECT operation FROM \"${TABLE}\$snapshots\" ORDER BY committed_at DESC LIMIT 1" "operation" "replace"
athena_expect "rows unchanged" "$OWN_ROWS" "${FINAL[@]}"

header "ATHENA VACUUM"
run_athena "VACUUM ${TABLE}" >/dev/null
athena_expect "snapshots expired" "SELECT count(*) AS snapshots FROM \"${TABLE}\$snapshots\"" "snapshots" "1"
athena_expect "rows unchanged" "$OWN_ROWS" "${FINAL[@]}"

header "SPARK reads the rows Athena wrote"
spark_submit "$VERIFY_PROGRAM" --phase athena-rows

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
