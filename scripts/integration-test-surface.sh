#!/usr/bin/env bash
#
# End-to-end integration test for IcebergTable's Tier-2 surface:
#   - every IcebergPartitionTransform exercised on one table.
#   - multi-field sortOrder rendered in metadata.json.
#   - nested types (list, struct, map) inserted via Spark and read
#     through Spark and Athena.
#   - the field ids Glue stores at CREATE: each table declared in
#     creation order keeps its declared ids, and a table declared out of
#     creation order gets the creation-order ids.
#   - grants_test read and written as roles holding the construct's grants.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var equal to the identity running this
#     script. It's the LF grant principal AND the trust principal
#     for both grantee roles, so the script can `sts:AssumeRole`
#     them under its own creds.
#   - ArceusStack already deployed with the same `PRINCIPAL_ARN`. The
#     data-lake bucket's key and the Data Catalog key are read from the
#     account and passed to the stack as parameters.
#   - The Spark toolchain installed (scripts/spark/install-spark.sh).
#   - An Athena workgroup and query result location (scripts/athena.sh).
#
# Usage:
#   scripts/integration-test-surface.sh
#
# Optional env vars:
#   AWS_REGION — default us-east-1
#   DESTROY    — set to 1 to teardown at the end
#   ATHENA_*   — see scripts/athena.sh
#
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
DATABASE="sample_database"
STACK="IcebergSurfaceStack"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

# shellcheck source=scripts/spark/spark-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/spark/spark-env.sh"
# shellcheck source=scripts/athena.sh
source "$(dirname "${BASH_SOURCE[0]}")/athena.sh"

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

FIELD_IDS="$(dirname "${BASH_SOURCE[0]}")/field_ids.py"

assert_stored_ids() {
    local table="$1" expected="$2" stored
    stored=$(read_metadata_json "$table" | python3 "$FIELD_IDS")
    if [ "$stored" = "$expected" ]; then
        green "  ${table} ids ✓ ($stored)"
    else
        red   "  ${table} ids ✗"
        red   "    expected: $expected"
        red   "    stored:   $stored"
        exit 1
    fi
}

################################################
# Teardown leftover stack from a prior run.

header "TEARDOWN any existing IcebergSurfaceStack from a prior run"
npx cdk destroy "$STACK" --force 2>&1 | tail -5 || true
cleanup_table_prefix "transforms_test"
cleanup_table_prefix "sorted_test"
cleanup_table_prefix "nested_test"
cleanup_table_prefix "creation_order_test"
cleanup_table_prefix "grants_test"

################################################
# Deploy.

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="data-lake-bucket-${ACCOUNT}"
DATA_LAKE_KEY_ARN=$(aws s3api get-bucket-encryption \
    --bucket "$BUCKET" \
    --region "$AWS_REGION" \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID' \
    --output text)
CATALOG_KEY_ID=$(aws glue get-data-catalog-encryption-settings \
    --region "$AWS_REGION" \
    --query 'DataCatalogEncryptionSettings.EncryptionAtRest.SseAwsKmsKeyId' \
    --output text)
CATALOG_KEY_ARN="arn:aws:kms:${AWS_REGION}:${ACCOUNT}:key/${CATALOG_KEY_ID##*/}"

header "DEPLOY IcebergSurfaceStack"
npx cdk deploy "$STACK" --require-approval=never \
    --parameters "${STACK}:DataLakeKeyArn=${DATA_LAKE_KEY_ARN}" \
    --parameters "${STACK}:CatalogKeyArn=${CATALOG_KEY_ARN}" 2>&1 | tail -5

stack_output() {
    aws cloudformation describe-stacks \
        --region "$AWS_REGION" \
        --stack-name "$STACK" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
        --output text
}
READER_ROLE_ARN=$(stack_output ReaderRoleArnOutput)
READ_WRITER_ROLE_ARN=$(stack_output ReadWriterRoleArnOutput)
yellow "  ReaderRole     = ${READER_ROLE_ARN}"
yellow "  ReadWriterRole = ${READ_WRITER_ROLE_ARN}"

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
header "VERIFY 2a — tables declared in creation order store their declared field ids"
assert_stored_ids transforms_test "year_source:1,month_source:2,day_source:3,hour_source:4,user_id:5,email:6,value:7"
assert_stored_ids sorted_test "tenant:1,created_at:2,amount:3"
assert_stored_ids nested_test \
    "id:1,tags:2,tags.element:5,profile:3,profile.first_name:6,profile.last_name:7,profile.age:8,attrs:4,attrs.key:9,attrs.value:10"

################################################
header "VERIFY 2b — creation_order_test, declared out of creation order, stores the creation-order ids"
assert_stored_ids creation_order_test \
    "b:1,a:2,s:3,s.lst:5,s.lst.element:6,s.lst.element.p:7,m:4,m.key:8,m.value:9,m.key.k:10,m.value.v:11"

################################################
header "TEST 3 — Spark: transforms_test INSERT + count, nested_test INSERT + SELECTs"
spark_submit "$(dirname "${BASH_SOURCE[0]}")/spark/verify_surface.py"

header "TEST 4 — transforms_test partition files land in the expected S3 prefix"
if aws s3 ls "s3://${BUCKET}/${DATABASE}/transforms_test/data/" --recursive --region "$AWS_REGION" \
    | grep -q "year_source_year=2026/month_source_month=2026-03/day_source_day=2026-03-15/hour_source_hour=2026-03-15-14"; then
    green "  multi-transform partition prefix written to S3 ✓"
else
    red "  expected partition prefix not found in S3"
    aws s3 ls "s3://${BUCKET}/${DATABASE}/transforms_test/data/" --recursive --region "$AWS_REGION" | head -5
    exit 1
fi

header "TEST 4a — Athena reads the rows Spark wrote to transforms_test and nested_test"
TS="2026-03-15 14:30:00.000000 UTC"
athena_expect "transforms_test row" "SELECT * FROM transforms_test" \
    "year_source|month_source|day_source|hour_source|user_id|email|value" \
    "${TS}|${TS}|${TS}|${TS}|12345|alice@example.com|99"
athena_expect "nested_test list, struct and map values" \
    "SELECT id, cardinality(tags) AS tag_count, element_at(tags, 1) AS tag1,
       profile.first_name, profile.last_name, profile.age,
       element_at(attrs, 'country') AS country, element_at(attrs, 'tier') AS tier
     FROM nested_test ORDER BY id" \
    "id|tag_count|tag1|first_name|last_name|age|country|tier" \
    "1|3|x|Ada|Lovelace|36|UK|gold" \
    "2|1|only-one|Grace|Hopper|NULL|US|NULL"

################################################
# Test 5 — the construct's grants, under roles assumed from the
# script's own credentials.

# Restored after each assume-role hop and on exit. In CI the starting
# credentials live in env vars; in a local run they may come from a
# profile, which is unset while the assumed credentials are in use.
ORIGINAL_AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
ORIGINAL_AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
ORIGINAL_AWS_SESSION_TOKEN="${AWS_SESSION_TOKEN:-}"
ORIGINAL_AWS_PROFILE="${AWS_PROFILE-}"
ORIGINAL_AWS_PROFILE_SET="${AWS_PROFILE+1}"

assume_role_and_export() {
    local role_arn="$1"
    local session="$2"
    local creds
    creds=$(aws sts assume-role \
        --role-arn "$role_arn" \
        --role-session-name "$session" \
        --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
        --output text)
    unset AWS_PROFILE
    read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<< "$creds"
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
}

unset_assumed_role() {
    if [ -n "$ORIGINAL_AWS_ACCESS_KEY_ID" ]; then
        export AWS_ACCESS_KEY_ID="$ORIGINAL_AWS_ACCESS_KEY_ID"
        export AWS_SECRET_ACCESS_KEY="$ORIGINAL_AWS_SECRET_ACCESS_KEY"
        export AWS_SESSION_TOKEN="$ORIGINAL_AWS_SESSION_TOKEN"
    else
        unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
    fi
    if [ -n "$ORIGINAL_AWS_PROFILE_SET" ]; then
        export AWS_PROFILE="$ORIGINAL_AWS_PROFILE"
    fi
}

# A `set -e` exit between an assume and its restore would otherwise
# leave a local shell holding the assumed credentials.
trap unset_assumed_role EXIT

assert_prefix_listing() {
    local role="$1"
    if aws s3 ls "s3://${BUCKET}/${DATABASE}/grants_test/" --region "$AWS_REGION" >/dev/null 2>&1; then
        green "  ${role}: s3:ListBucket on grants_test's prefix succeeds ✓"
    else
        red "  ${role}: s3:ListBucket on grants_test's prefix failed"; exit 1
    fi
    if aws s3 ls "s3://${BUCKET}/${DATABASE}/nested_test/" --region "$AWS_REGION" >/dev/null 2>&1; then
        red "  ${role}: s3:ListBucket on nested_test's prefix succeeded — the prefix condition leaks"; exit 1
    else
        green "  ${role}: s3:ListBucket on a foreign prefix is denied ✓"
    fi
}

# expect_denied LABEL PATTERN COMMAND... passes when COMMAND fails with
# an access-denied message matching PATTERN.
expect_denied() {
    local label="$1" pattern="$2" out
    shift 2
    if out=$("$@" 2>&1); then
        red "  ${label} succeeded; expected an access denial"; exit 1
    fi
    if grep -qE "$pattern" <<< "$out"; then
        green "  ${label} is denied ✓"
        printf '    %s\n' "$(grep -oE 'not authorized to perform: [^ ]+' <<< "$out" | head -1)"
    else
        red "  ${label} failed without the expected denial:"; printf '%s\n' "$out" >&2; exit 1
    fi
}

GRANTS_SPARK="$(dirname "${BASH_SOURCE[0]}")/spark/verify_grants.py"

# The roles' policies can take a few seconds to reach STS after the deploy.
sleep 10

header "TEST 5a — ReadWriterRole (grantReadWrite, imported table) writes through Spark and Athena"
assume_role_and_export "$READ_WRITER_ROLE_ARN" "surface-integ-read-writer"
spark_submit "$GRANTS_SPARK" --phase write
run_athena "INSERT INTO grants_test VALUES (2, 'athena')" >/dev/null
green "  ReadWriterRole wrote one row through Spark and one through Athena ✓"
assert_prefix_listing ReadWriterRole
unset_assumed_role

header "TEST 5b — ReaderRole (grantRead) reads through Spark and Athena and cannot write"
assume_role_and_export "$READER_ROLE_ARN" "surface-integ-reader"
spark_submit "$GRANTS_SPARK" --phase read
athena_expect "ReaderRole reads grants_test" "SELECT id, source FROM grants_test ORDER BY id" \
    "id|source" \
    "1|spark" \
    "2|athena"
assert_prefix_listing ReaderRole
# A stale version id leaves the table unchanged even if the update were allowed.
expect_denied "ReaderRole glue:UpdateTable" 'AccessDeniedException.*glue:UpdateTable' \
    aws glue update-table --region "$AWS_REGION" --database-name "$DATABASE" \
        --table-input '{"Name":"grants_test"}' --version-id 999999
expect_denied "ReaderRole S3 write under grants_test" 'AccessDenied' \
    aws s3 cp - "s3://${BUCKET}/${DATABASE}/grants_test/data/denied.txt" --region "$AWS_REGION" <<< "denied"
unset_assumed_role

################################################
# Optional teardown.

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force 2>&1 | tail -5
    cleanup_table_prefix "transforms_test"
    cleanup_table_prefix "sorted_test"
    cleanup_table_prefix "nested_test"
    cleanup_table_prefix "creation_order_test"
    cleanup_table_prefix "grants_test"
fi

green ""
green "=== ALL SURFACE STEPS PASSED ==="
