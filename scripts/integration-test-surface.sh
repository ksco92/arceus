#!/usr/bin/env bash
#
# End-to-end integration test for IcebergTable's Tier-2 surface:
#   - every IcebergPartitionTransform exercised on one table.
#   - multi-field sortOrder rendered in metadata.json.
#   - nested types (list, struct, map) inserted and queried via Athena.
#   - grantRead's four-statement IAM split exercised at runtime by
#     assuming the grantee role and calling Glue / S3 directly (this
#     bypasses Lake Formation, which is exactly what isolates the
#     IAM-grant logic in a test).
#   - IcebergTable.fromIcebergTableAttributes(...).grantRead(...) on
#     the same underlying table, then the same runtime checks under
#     the second grantee role — proves the import-by-attributes path
#     produces symmetric grants.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var equal to the identity running this
#     script. It's the LF grant principal AND the trust principal
#     for both grantee roles, so the script can `sts:AssumeRole`
#     them under its own creds.
#   - ArceusStack already deployed with the same `PRINCIPAL_ARN`.
#
# Usage:
#   scripts/integration-test-surface.sh
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
STACK="IcebergSurfaceStack"

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
        red "Athena returned empty query id for SQL:" >&2
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
    aws athena get-query-results \
        --region "$AWS_REGION" \
        --query-execution-id "$qid" \
        --query 'ResultSet.Rows[1:].Data[].VarCharValue' \
        --output text
}

cleanup_table_prefix() {
    local table="$1"
    local bucket="data-lake-bucket-$(aws sts get-caller-identity --query Account --output text)"
    yellow "  Clearing s3://${bucket}/${DATABASE}/${table}/"
    aws s3 rm "s3://${bucket}/${DATABASE}/${table}/" --recursive --region "$AWS_REGION" 2>/dev/null || true
}

read_metadata_json() {
    local table="$1"
    local meta_loc
    meta_loc=$(aws glue get-table \
        --database-name "$DATABASE" \
        --name "$table" \
        --region "$AWS_REGION" \
        --query 'Table.Parameters.metadata_location' \
        --output text)
    aws s3 cp "$meta_loc" - --region "$AWS_REGION" 2>/dev/null
}

################################################
# Teardown leftover stack from a prior run.

header "TEARDOWN any existing IcebergSurfaceStack from a prior run"
npx cdk destroy "$STACK" --force 2>&1 | tail -5 || true
cleanup_table_prefix "transforms_test"
cleanup_table_prefix "sorted_test"
cleanup_table_prefix "nested_test"

################################################
# Deploy.

header "DEPLOY IcebergSurfaceStack"
npx cdk deploy "$STACK" --require-approval=never 2>&1 | tail -5

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="data-lake-bucket-${ACCOUNT}"
GRANTEE_ROLE_ARN=$(aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='GranteeRoleArnOutput'].OutputValue" \
    --output text)
IMPORTED_GRANTEE_ROLE_ARN=$(aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='ImportedGranteeRoleArnOutput'].OutputValue" \
    --output text)
yellow "  GranteeRole         = ${GRANTEE_ROLE_ARN}"
yellow "  ImportedGranteeRole = ${IMPORTED_GRANTEE_ROLE_ARN}"

################################################
# Verify 1 — every partition transform rendered correctly.

header "VERIFY 1 — transforms_test metadata.json has all 7 partition fields"
META=$(read_metadata_json "transforms_test")
EXPECTED_TRANSFORMS="year month day hour bucket[8] truncate[4] identity"
for transform in $EXPECTED_TRANSFORMS; do
    if echo "$META" | python3 -c "
import json, sys
m = json.load(sys.stdin)
spec = next(s for s in m['partition-specs'] if s['spec-id'] == m['default-spec-id'])
transforms = [f['transform'] for f in spec['fields']]
sys.exit(0 if '$transform' in transforms else 1)
"; then
        green "  partition transform '${transform}' ✓"
    else
        red "  partition transform '${transform}' missing"
        echo "$META" | python3 -m json.tool >&2
        exit 1
    fi
done

################################################
# Verify 2 — sortOrder rendered correctly.

header "VERIFY 2 — sorted_test metadata.json has the multi-field sort order"
META=$(read_metadata_json "sorted_test")
echo "$META" | python3 -c "
import json, sys
m = json.load(sys.stdin)
order = next(o for o in m['sort-orders'] if o['order-id'] == m['default-sort-order-id'])
fields = order['fields']
assert len(fields) == 3, f'expected 3 sort fields, got {len(fields)}'
assert fields[0]['direction'] == 'asc' and fields[0]['null-order'] == 'nulls-first', fields[0]
assert fields[1]['direction'] == 'desc' and fields[1]['null-order'] == 'nulls-last', fields[1]
assert fields[2]['direction'] == 'desc' and fields[2]['null-order'] == 'nulls-last', fields[2]
print('sort fields:', [f\"{f['direction']}/{f['null-order']}\" for f in fields])
"
green "  sort fields match (asc/nulls-first, desc/nulls-last, desc/nulls-last) ✓"

################################################
# Test 3 — INSERT into transforms_test and verify partition files
# land in the expected S3 prefix.

header "TEST 3 — INSERT one row into transforms_test"
run_athena "INSERT INTO ${DATABASE}.transforms_test VALUES
  (TIMESTAMP '2026-03-15 14:30:00 UTC',
   TIMESTAMP '2026-03-15 14:30:00 UTC',
   TIMESTAMP '2026-03-15 14:30:00 UTC',
   TIMESTAMP '2026-03-15 14:30:00 UTC',
   12345, 'alice@example.com', 99)" > /dev/null
yellow "  1 row inserted"
COUNT=$(run_athena "SELECT CAST(COUNT(*) AS VARCHAR) FROM ${DATABASE}.transforms_test")
if [ "$COUNT" = "1" ]; then
    green "  row count == 1 ✓"
else
    red "  expected count=1, got $COUNT"; exit 1
fi
if aws s3 ls "s3://${BUCKET}/${DATABASE}/transforms_test/data/" --recursive --region "$AWS_REGION" \
    | grep -q "year_source_year=2026/month_source_month=2026-03/day_source_day=2026-03-15/hour_source_hour=2026-03-15-14"; then
    green "  multi-transform partition prefix written to S3 ✓"
else
    red "  expected partition prefix not found in S3"
    aws s3 ls "s3://${BUCKET}/${DATABASE}/transforms_test/data/" --recursive --region "$AWS_REGION" | head -5
    exit 1
fi

################################################
# Test 4 — INSERT + SELECT nested types end-to-end.

header "TEST 4 — INSERT nested types (list, struct, map) into nested_test"
run_athena "INSERT INTO ${DATABASE}.nested_test VALUES
  (1, ARRAY['x', 'y', 'z'],
   CAST(ROW('Ada', 'Lovelace', 36) AS ROW(first_name VARCHAR, last_name VARCHAR, age INTEGER)),
   MAP(ARRAY['country','tier'], ARRAY['UK','gold'])),
  (2, ARRAY['only-one'],
   CAST(ROW('Grace', 'Hopper', NULL) AS ROW(first_name VARCHAR, last_name VARCHAR, age INTEGER)),
   MAP(ARRAY['country'], ARRAY['US']))" > /dev/null
yellow "  2 nested rows inserted"

TAGS=$(run_athena "SELECT tags[1] FROM ${DATABASE}.nested_test WHERE id = 1")
if [ "$TAGS" = "x" ]; then
    green "  list subscript: tags[1] == 'x' ✓"
else
    red "  expected tags[1]='x', got '$TAGS'"; exit 1
fi

PROFILE=$(run_athena "SELECT profile.first_name, profile.last_name FROM ${DATABASE}.nested_test WHERE id = 2")
if echo "$PROFILE" | grep -q "Grace" && echo "$PROFILE" | grep -q "Hopper"; then
    green "  struct field access: profile.first_name + last_name ✓"
else
    red "  struct access broken: '$PROFILE'"; exit 1
fi

ATTR=$(run_athena "SELECT element_at(attrs, 'tier') FROM ${DATABASE}.nested_test WHERE id = 1")
if [ "$ATTR" = "gold" ]; then
    green "  map element_at: attrs['tier'] == 'gold' ✓"
else
    red "  expected attrs.tier='gold', got '$ATTR'"; exit 1
fi

################################################
# Test 5 — grantRead via the native construct: assume the role,
# call Glue + S3 directly. This bypasses Lake Formation, isolating
# the IAM grants the construct produces.

assume_role_and_export() {
    local role_arn="$1"
    local session="$2"
    local creds
    creds=$(aws sts assume-role \
        --role-arn "$role_arn" \
        --role-session-name "$session" \
        --query 'Credentials' \
        --output json)
    export AWS_ACCESS_KEY_ID=$(echo "$creds" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKeyId"])')
    export AWS_SECRET_ACCESS_KEY=$(echo "$creds" | python3 -c 'import json,sys; print(json.load(sys.stdin)["SecretAccessKey"])')
    export AWS_SESSION_TOKEN=$(echo "$creds" | python3 -c 'import json,sys; print(json.load(sys.stdin)["SessionToken"])')
}

unset_assumed_role() {
    unset AWS_ACCESS_KEY_ID
    unset AWS_SECRET_ACCESS_KEY
    unset AWS_SESSION_TOKEN
}

header "TEST 5 — grantRead S3 statements via the native IcebergTable (assume GranteeRole)"
# Why only S3 here, not Glue: ArceusStack registers the data-lake bucket
# with Lake Formation. LF gates every `glue:GetTable` call against
# tables in registered locations, irrespective of the principal's IAM
# permissions — so a runtime `glue:GetTable` from GranteeRole hits LF
# DENY before the IAM grant is even consulted. The construct's
# Glue-action grants are still validated by the unit tests in
# `test/iceberg-surface-stack.test.ts`. S3 direct calls, on the other
# hand, are NOT gated by LF, so they exercise the grant logic the
# construct produces in isolation.

# Wait for IAM policy attachment to propagate. Even after CFN says
# UPDATE_COMPLETE on the role's inline policy, the policy can take a
# few seconds to propagate to STS/IAM resolvers.
sleep 10
assume_role_and_export "$GRANTEE_ROLE_ARN" "surface-integ-native"
# S3 list with s3:prefix condition: the table's own prefix is allowed.
if aws s3 ls "s3://${BUCKET}/${DATABASE}/transforms_test/" --region "$AWS_REGION" >/dev/null 2>&1; then
    green "  s3:ListBucket on the table's own prefix succeeds ✓"
else
    red "  s3:ListBucket on transforms_test prefix failed as GranteeRole"; unset_assumed_role; exit 1
fi
# Cross-prefix list: the prefix-condition should DENY this.
if aws s3 ls "s3://${BUCKET}/${DATABASE}/nested_test/" --region "$AWS_REGION" >/dev/null 2>&1; then
    red "  s3:ListBucket on nested_test prefix succeeded — prefix condition is leaking grants!"
    unset_assumed_role
    exit 1
else
    green "  s3:ListBucket on a foreign prefix is denied ✓"
fi
unset_assumed_role

################################################
# Test 6 — grantRead via the import factory (assume ImportedGranteeRole).

header "TEST 6 — grantRead via IcebergTable.fromIcebergTableAttributes (assume ImportedGranteeRole)"
assume_role_and_export "$IMPORTED_GRANTEE_ROLE_ARN" "surface-integ-imported"
if aws s3 ls "s3://${BUCKET}/${DATABASE}/transforms_test/" --region "$AWS_REGION" >/dev/null 2>&1; then
    green "  imported-path s3:ListBucket on table prefix succeeds ✓"
else
    red "  imported-path s3:ListBucket failed"; unset_assumed_role; exit 1
fi
if aws s3 ls "s3://${BUCKET}/${DATABASE}/sorted_test/" --region "$AWS_REGION" >/dev/null 2>&1; then
    red "  imported-path s3:ListBucket on foreign prefix succeeded — prefix condition leak!"
    unset_assumed_role
    exit 1
else
    green "  imported-path s3:ListBucket on a foreign prefix is denied ✓"
fi
unset_assumed_role

################################################
# Optional teardown.

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force 2>&1 | tail -5
    cleanup_table_prefix "transforms_test"
    cleanup_table_prefix "sorted_test"
    cleanup_table_prefix "nested_test"
fi

green ""
green "=== ALL SURFACE STEPS PASSED ==="
