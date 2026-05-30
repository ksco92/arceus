#!/usr/bin/env bash
#
# End-to-end integration test for IcebergTable schema + partition
# evolution. Drives the `IcebergEvolutionStack` through four real
# `cdk deploy`s and verifies the resulting Glue / Iceberg metadata
# after each.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var set to the ARN of an existing IAM
#     principal in this account (user, role, or federated identity).
#     Passed through to bin/arceus.ts and used as the Lake Formation
#     admin + per-table grantee on the demo Iceberg tables. The same
#     principal must also be the one running `cdk deploy` (i.e. the
#     current AWS identity) — otherwise the Athena queries the script
#     runs after deploy will fail with `Principal does not have any
#     privilege on specified resource`.
#   - ArceusStack already deployed with the SAME `PRINCIPAL_ARN` —
#     the stack registers it as the LF admin / table grantee, and a
#     mismatch makes the verify steps fail.
#
# Usage:
#   scripts/integration-test-evolution.sh
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
TABLE="evolution_test"
STACK="IcebergEvolutionStack"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

run_athena() {
    local sql="$1"
    local qid
    qid=$(aws athena start-query-execution \
        --region "$AWS_REGION" \
        --work-group "$ATHENA_WORKGROUP" \
        --query-string "$sql" \
        --query 'QueryExecutionId' \
        --output text)
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
        red "Athena query failed (state=$state):"
        aws athena get-query-execution \
            --region "$AWS_REGION" \
            --query-execution-id "$qid" \
            --query 'QueryExecution.Status.StateChangeReason' \
            --output text
        return 1
    fi
    aws athena get-query-results \
        --region "$AWS_REGION" \
        --query-execution-id "$qid" \
        --query 'ResultSet.Rows[].Data[].VarCharValue' \
        --output text
}

table_column_names() {
    META_LOC=$(aws glue get-table \
        --database-name "$DATABASE" \
        --name "$TABLE" \
        --region "$AWS_REGION" \
        --query 'Table.Parameters.metadata_location' \
        --output text)
    aws s3 cp "$META_LOC" - --region "$AWS_REGION" 2>/dev/null \
        | python3 -c "
import json, sys
m = json.load(sys.stdin)
current_schema = next(s for s in m['schemas'] if s['schema-id'] == m['current-schema-id'])
current_spec = next(s for s in m['partition-specs'] if s['spec-id'] == m['default-spec-id'])
print('schema-id', m['current-schema-id'])
print('last-column-id', m['last-column-id'])
print('schemas-count', len(m['schemas']))
print('partition-spec-fields', ','.join(f['name'] for f in current_spec['fields']))
print('columns', ','.join(f\"{f['id']}:{f['name']}\" for f in current_schema['fields']))
"
}

assert_columns() {
    local expected="$1"
    local actual
    actual=$(table_column_names | grep ^columns | cut -d' ' -f2)
    if [ "$actual" = "$expected" ]; then
        green "  columns ✓ ($actual)"
    else
        red   "  columns ✗"
        red   "    expected: $expected"
        red   "    actual:   $actual"
        return 1
    fi
}

assert_partitions() {
    local expected="$1"
    local actual
    actual=$(table_column_names | grep ^partition-spec-fields | cut -d' ' -f2)
    if [ "$actual" = "$expected" ]; then
        green "  partitions ✓ ($actual)"
    else
        red   "  partitions ✗"
        red   "    expected: $expected"
        red   "    actual:   $actual"
        return 1
    fi
}

deploy_step() {
    local step="$1"
    header "STEP $step — cdk deploy"
    npx cdk deploy "$STACK" \
        --require-approval=never \
        --region "$AWS_REGION" \
        --context "evolutionStep=$step" 2>&1 | tail -3
}

################################################
################################################
# Always start from a clean slate so partition-spec history from a
# prior run can't confuse Athena's planner.

header "TEARDOWN any existing IcebergEvolutionStack from a prior run"
npx cdk destroy "$STACK" --force --region "$AWS_REGION" 2>&1 | tail -3 || true
yellow "  Also clearing the table's S3 prefix so Iceberg starts fresh."
aws s3 rm "s3://data-lake-bucket-$(aws sts get-caller-identity --query Account --output text)/${DATABASE}/${TABLE}/" \
    --region "$AWS_REGION" --recursive 2>&1 | tail -3 || true

################################################
################################################
# Step 1: initial deploy (3 columns, 1 partition).

deploy_step 1

header "VERIFY step 1"
assert_columns "1:customer_id,2:email,3:signed_up_at"
assert_partitions "signed_up_at_day"

header "INSERT seed rows"
run_athena "INSERT INTO ${DATABASE}.${TABLE} VALUES
  (10, 'a@example.com', TIMESTAMP '2026-01-01 09:00:00 UTC'),
  (11, 'b@example.com', TIMESTAMP '2026-01-02 09:00:00 UTC'),
  (12, 'c@example.com', TIMESTAMP '2026-01-03 09:00:00 UTC')" > /dev/null
yellow "  3 rows inserted"

################################################
################################################
# Step 2: ADD column `region` (id 4). Partition spec unchanged.

deploy_step 2

header "VERIFY step 2 (ADD column)"
assert_columns "1:customer_id,2:email,3:signed_up_at,4:region"
assert_partitions "signed_up_at_day"

header "VERIFY old rows are preserved with region=NULL"
ROWS=$(run_athena "SELECT customer_id, region FROM ${DATABASE}.${TABLE} ORDER BY customer_id")
if echo "$ROWS" | grep -q '^.*10' && echo "$ROWS" | grep -q '^.*12'; then
    green "  pre-existing rows readable ✓"
else
    red "  pre-existing rows missing"; echo "$ROWS"; exit 1
fi

run_athena "INSERT INTO ${DATABASE}.${TABLE} VALUES
  (13, 'd@example.com', TIMESTAMP '2026-02-01 09:00:00 UTC', 'us-east-1')" > /dev/null
yellow "  inserted 1 row carrying region='us-east-1'"

################################################
################################################
# Step 3: RENAME column `email` -> `contact_email` (id 2 preserved)
# AND ADD partition bucket(8)(customer_id).

deploy_step 3

header "VERIFY step 3 (RENAME column + ADD partition)"
assert_columns "1:customer_id,2:contact_email,3:signed_up_at,4:region"
assert_partitions "signed_up_at_day,customer_id_bucket"

ROWS=$(run_athena "SELECT contact_email FROM ${DATABASE}.${TABLE} WHERE customer_id = 10")
if echo "$ROWS" | grep -q 'a@example.com'; then
    green "  rename preserved data ✓"
else
    red "  rename lost data"; echo "$ROWS"; exit 1
fi

################################################
################################################
# Step 4: DROP column `region` (id 4 stays retired) and DROP partition
# bucket(8)(customer_id). The column `region` is NOT a partition
# source, and the bucket partition's source column `customer_id` is
# NOT being dropped, so neither change requires Iceberg's
# void-transform intermediate.

deploy_step 4

header "VERIFY step 4 (DROP column + DROP partition)"
assert_columns "1:customer_id,2:contact_email,3:signed_up_at"
assert_partitions "signed_up_at_day"

LAST_ID=$(table_column_names | grep ^last-column-id | cut -d' ' -f2)
if [ "$LAST_ID" = "4" ]; then
    green "  last-column-id stays at 4 — id reuse protection ✓"
else
    red "  last-column-id changed to $LAST_ID; expected 4"; exit 1
fi

ROWS=$(run_athena "SELECT customer_id, contact_email FROM ${DATABASE}.${TABLE} ORDER BY customer_id")
COUNT=$(echo "$ROWS" | tr '\t' '\n' | grep -c '^[0-9][0-9]$' || true)
if [ "$COUNT" -ge 4 ]; then
    green "  all 4 pre-existing rows queryable after drop ✓"
else
    red "  expected at least 4 rows, got $COUNT"; echo "$ROWS"; exit 1
fi

################################################
################################################
# Optional teardown.

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force --region "$AWS_REGION" 2>&1 | tail -3
fi

header "ALL EVOLUTION STEPS PASSED"
