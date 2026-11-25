#!/usr/bin/env bash
#
# End-to-end integration test for IcebergTable schema + partition
# evolution. Drives the `IcebergEvolutionStack` through twelve real
# `cdk deploy`s and verifies the resulting Glue / Iceberg metadata
# after each, then the rows and column shape through Spark and Athena.
# The step 11 deploy fails by design and rolls back.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var set to the ARN of an existing IAM
#     principal in this account (user, role, or federated identity).
#     Passed through to bin/arceus.ts and used as the Lake Formation
#     admin + per-table grantee on the demo Iceberg tables. The same
#     principal must also be the one running `cdk deploy` (i.e. the
#     current AWS identity) — otherwise the Spark steps the script
#     runs after deploy will fail with `Principal does not have any
#     privilege on specified resource`.
#   - ArceusStack already deployed with the SAME `PRINCIPAL_ARN` —
#     the stack registers it as the LF admin / table grantee, and a
#     mismatch makes the verify steps fail.
#   - The Spark toolchain installed (scripts/spark/install-spark.sh).
#   - An Athena workgroup and query result location (scripts/athena.sh).
#
# Usage:
#   scripts/integration-test-evolution.sh
#
# Optional env vars:
#   AWS_REGION — default us-east-1
#   DESTROY    — set to 1 to teardown at the end
#   ATHENA_*   — see scripts/athena.sh
#
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
DATABASE="sample_database"
TABLE="evolution_test"
NESTED_TABLE="nested_evolution_test"
REUSED_TABLE="reused_id_test"
PARTITION_TABLE="partition_id_test"
NAME_TABLE="parameter_name_test"
RENUMBER_TABLE="renumber_test"
FORMAT_TABLE="format_version_test"
DECIMAL_TABLE="decimal_test"
CREATE_PARTITION_TABLE="create_partition_id_test"
STACK="IcebergEvolutionStack"

# shellcheck source=scripts/spark/spark-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/spark/spark-env.sh"
# shellcheck source=scripts/athena.sh
source "$(dirname "${BASH_SOURCE[0]}")/athena.sh"
# shellcheck source=scripts/metadata.sh
source "$(dirname "${BASH_SOURCE[0]}")/metadata.sh"
VERIFY_PROGRAM="$(dirname "${BASH_SOURCE[0]}")/spark/verify_evolution.py"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

table_column_names() {
    local meta
    meta=$(fetch_metadata "${1:-$TABLE}")
    echo "$meta" | python3 -c "
import json, sys
m = json.load(sys.stdin)
current_schema = next(s for s in m['schemas'] if s['schema-id'] == m['current-schema-id'])
current_spec = next(s for s in m['partition-specs'] if s['spec-id'] == m['default-spec-id'])
print('schema-id', m['current-schema-id'])
print('max-schema-id', max(s['schema-id'] for s in m['schemas']))
print('last-column-id', m['last-column-id'])
print('schemas-count', len(m['schemas']))
print('spec-count', len(m['partition-specs']))
print('format-version', m['format-version'])
print('properties-format-version', m['properties'].get('format-version', 'unset'))
print('table-uuid', m['table-uuid'])
print('default-spec-id', m['default-spec-id'])
print('default-sort-order-id', m['default-sort-order-id'])
print('sort-orders', ';'.join(str(o['order-id']) + ':' + ','.join(
    f\"{f['transform']}({f['source-id']})/{f['direction']}/{f['null-order']}\" for f in o['fields'])
    for o in m['sort-orders']))
print('commit-retries', m['properties'].get('commit.retry.num-retries', 'unset'))
print('partition-spec-fields', ','.join(f['name'] for f in current_spec['fields']))
print('partition-ids', ','.join(f\"{f['field-id']}:{f['transform']}\" for f in current_spec['fields']))
print('last-partition-id', m['last-partition-id'])
print('columns', ','.join(f\"{f['id']}:{f['name']}\" for f in current_schema['fields']))
print('identifier-field-ids', ','.join(str(i) for i in current_schema.get('identifier-field-ids', [])))
print('pk-marked', ','.join(f['name'] for f in current_schema['fields'] if f.get('doc', '').startswith('(PK) ')))
"
    echo "nested-ids $(echo "$meta" | field_ids)"
}

assert_same() {
    local label="$1" expected="$2" actual="$3" shown=""
    [[ "$actual" == *$'\n'* ]] || shown=" ($actual)"
    if [ "$actual" = "$expected" ]; then
        green "  $label ✓$shown"
    else
        red   "  ${4:-$label} ✗"
        red   "    expected: $expected"
        red   "    actual:   $actual"
        return 1
    fi
}

assert_columns() {
    assert_same columns "$1" "$(table_column_names | grep ^columns | cut -d' ' -f2)"
}

assert_partitions() {
    assert_same partitions "$1" "$(table_column_names | grep ^partition-spec-fields | cut -d' ' -f2)"
}

assert_meta() {
    assert_same "$1" "$2" "$(table_column_names "${3:-$TABLE}" | grep "^$1 " | cut -d' ' -f2)"
}

# The listing of `evolution_test` without the lines whose key matches $1.
listing_without() {
    table_column_names | grep -vE "^($1) "
}

assert_identifiers() {
    local listing
    listing=$(table_column_names)
    assert_same "identifier-field-ids and (PK) docs" "$1 $2" \
        "$(echo "$listing" | grep ^identifier-field-ids | cut -d' ' -f2) $(echo "$listing" | grep ^pk-marked | cut -d' ' -f2)" \
        "identifier-field-ids or (PK) docs"
}

assert_nested_ids() {
    local listing
    listing=$(table_column_names "$NESTED_TABLE")
    assert_same "nested ids" "$1 $2" \
        "$(echo "$listing" | grep ^nested-ids | cut -d' ' -f2) $(echo "$listing" | grep ^last-column-id | cut -d' ' -f2)"
}

ROWS="SELECT * FROM ${TABLE} ORDER BY customer_id"
COMMENTS="SELECT column_name, comment FROM information_schema.columns
  WHERE table_schema = '${DATABASE}' AND table_name = '${TABLE}' ORDER BY ordinal_position"
NESTED_ROWS="SELECT id, element_at(tags, 1) AS tag1, element_at(tags, 2) AS tag2,
  element_at(attrs, 'k1') AS k1, element_at(attrs, 'k2') AS k2, addr.line1 AS line1, addr.city AS city"
ROW_10="10|a@example.com|2026-01-01 09:00:00.000000 UTC"
ROW_11="11|b@example.com|2026-01-02 09:00:00.000000 UTC"
ROW_12="12|c@example.com|2026-01-03 09:00:00.000000 UTC"
ROW_13="13|d@example.com|2026-02-01 09:00:00.000000 UTC"
ROW_14="14|e@example.com|2026-03-05 09:00:00.000000 UTC"
ROW_100="100|t1|t2|v1|v2|L1|C1"
ROW_101="101|u1|u2|w1|w2|M1|D1"

rows_10_to_14() {
    athena_expect "$1" "$ROWS" "customer_id|contact_email|signed_up_at" \
        "$ROW_10" "$ROW_11" "$ROW_12" "$ROW_13" "$ROW_14"
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
# prior run can't confuse the engine's planner.

header "TEARDOWN any existing IcebergEvolutionStack from a prior run"
npx cdk destroy "$STACK" --force --region "$AWS_REGION" 2>&1 | tail -3 || true
yellow "  Also clearing the table's S3 prefix so Iceberg starts fresh."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
for prefix in "$TABLE" "$NESTED_TABLE" "$REUSED_TABLE" "$PARTITION_TABLE" "$NAME_TABLE" \
    "$RENUMBER_TABLE" "$FORMAT_TABLE" "$DECIMAL_TABLE" "$CREATE_PARTITION_TABLE"; do
    aws s3 rm "s3://data-lake-bucket-${ACCOUNT_ID}/${DATABASE}/${prefix}/" \
        --region "$AWS_REGION" --recursive 2>&1 | tail -3 || true
done

################################################
################################################
# Step 1: initial deploy (3 columns, 1 partition).

deploy_step 1

header "VERIFY step 1"
assert_columns "1:customer_id,2:email,3:signed_up_at"
assert_partitions "signed_up_at_day"
assert_identifiers "1" "customer_id"

BASE_IDS="id:1,tags:2,tags.element:5,attrs:3,attrs.key:6,attrs.value:7,addr:4,addr.line1:8"
assert_nested_ids "${BASE_IDS},addr.city:9" "9"

header "VERIFY step 1 (create_partition_id_test, declared 1000 and 1005)"
assert_meta partition-ids "1000:day,1001:bucket[4]" "$CREATE_PARTITION_TABLE"
assert_meta last-partition-id 1001 "$CREATE_PARTITION_TABLE"

header "SPARK step 1 (INSERT seed rows, including the nested row)"
spark_submit "$VERIFY_PROGRAM" --phase 1

header "ATHENA step 1"
athena_expect "seed rows" "$ROWS" "customer_id|email|signed_up_at" "$ROW_10" "$ROW_11" "$ROW_12"
athena_expect "(PK) comment on customer_id" "$COMMENTS" \
    "column_name|comment" "customer_id|(PK) Primary key." "email|NULL" "signed_up_at|NULL"
athena_expect "nested seed row" "${NESTED_ROWS} FROM ${NESTED_TABLE} ORDER BY id" \
    "id|tag1|tag2|k1|k2|line1|city" "$ROW_100"
run_athena "INSERT INTO ${REUSED_TABLE} VALUES (1, 'c1')" >/dev/null
run_athena "INSERT INTO ${NAME_TABLE} VALUES (1, 'v1')" >/dev/null
run_athena "INSERT INTO ${RENUMBER_TABLE} VALUES ('A', 'B')" >/dev/null

################################################
################################################
# Step 2: ADD column `region` (id 4). Partition spec unchanged.

FORMAT_UUID=$(table_column_names "$FORMAT_TABLE" | grep ^table-uuid | cut -d' ' -f2)

deploy_step 2

header "VERIFY step 2 (ADD column)"
assert_columns "1:customer_id,2:email,3:signed_up_at,4:region"
assert_partitions "signed_up_at_day"
assert_meta spec-count 1
assert_meta default-spec-id 0

header "VERIFY step 2 (reused_id_test, partition_id_test)"
assert_meta columns "1:a" "$REUSED_TABLE"
assert_meta partition-ids "1000:day,1001:bucket[4],1005:identity" "$PARTITION_TABLE"
assert_meta last-partition-id 1005 "$PARTITION_TABLE"

header "VERIFY step 2 (renumber_test, format_version_test, decimal_test)"
assert_meta columns "2:a,1:b" "$RENUMBER_TABLE"
assert_meta format-version 2 "$FORMAT_TABLE"
assert_meta properties-format-version 3 "$FORMAT_TABLE"
assert_meta table-uuid "$FORMAT_UUID" "$FORMAT_TABLE"
assert_meta commit-retries 5 "$DECIMAL_TABLE"
assert_meta schemas-count 1 "$DECIMAL_TABLE"
assert_meta schema-id 0 "$DECIMAL_TABLE"

header "SPARK step 2 (old rows read region=NULL, INSERT row carrying region)"
spark_submit "$VERIFY_PROGRAM" --phase 2

header "ATHENA step 2"
athena_expect "old rows read region NULL" "$ROWS" "customer_id|email|signed_up_at|region" \
    "${ROW_10}|NULL" "${ROW_11}|NULL" "${ROW_12}|NULL" "${ROW_13}|us-east-1"
athena_expect "a and b of the row written before the first update read each other's values" \
    "SELECT * FROM ${RENUMBER_TABLE}" "a|b" "B|A"

################################################
################################################
# Step 3: RENAME column `email` -> `contact_email` (id 2 preserved)
# AND ADD partition bucket(8)(customer_id).

deploy_step 3

header "VERIFY step 3 (RENAME column + ADD partition)"
assert_columns "1:customer_id,2:contact_email,3:signed_up_at,4:region"
assert_partitions "signed_up_at_day,customer_id_bucket"

header "VERIFY step 3 (reused_id_test, partition_id_test)"
assert_meta columns "1:a,2:d" "$REUSED_TABLE"
assert_meta last-column-id 2 "$REUSED_TABLE"
assert_meta partition-ids "1000:day,1001:bucket[4],1005:identity,1003:identity" "$PARTITION_TABLE"
assert_meta last-partition-id 1005 "$PARTITION_TABLE"

header "SPARK step 3 (rename preserved data, d of reused_id_test reads c's value)"
spark_submit "$VERIFY_PROGRAM" --phase 3

header "ATHENA step 3"
athena_expect "renamed column keeps its values" "$ROWS" "customer_id|contact_email|signed_up_at|region" \
    "${ROW_10}|NULL" "${ROW_11}|NULL" "${ROW_12}|NULL" "${ROW_13}|us-east-1"
athena_expect "d of the row written before the drop reads c's value" "SELECT * FROM ${REUSED_TABLE}" "a|d" "1|c1"

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
assert_meta spec-count 2
assert_meta default-spec-id 0

LAST_ID=$(table_column_names | grep ^last-column-id | cut -d' ' -f2)
if [ "$LAST_ID" = "4" ]; then
    green "  last-column-id stays at 4 — id reuse protection ✓"
else
    red "  last-column-id changed to $LAST_ID; expected 4"; exit 1
fi

header "SPARK step 4 (rows queryable after drop)"
spark_submit "$VERIFY_PROGRAM" --phase 4

header "ATHENA step 4"
athena_expect "rows without the dropped column" "$ROWS" "customer_id|contact_email|signed_up_at" \
    "$ROW_10" "$ROW_11" "$ROW_12" "$ROW_13"

################################################
################################################
# Step 5: CHANGE the partition transform on signed_up_at from day to
# month — the issue #43 scenario. The new field takes the fresh id
# 1002; the retired day (1000) and bucket (1001) fields stay behind in
# the spec history, and the whole history must remain conflict-free.

deploy_step 5

header "VERIFY step 5 (CHANGE partition transform day -> month)"
assert_columns "1:customer_id,2:contact_email,3:signed_up_at"
assert_partitions "signed_up_at_month"
META=$(fetch_metadata "$TABLE")
assert_partition_history <<< "$META"

header "SPARK step 5 (INSERT under the month spec, rows queryable)"
spark_submit "$VERIFY_PROGRAM" --phase 5

header "ATHENA step 5"
rows_10_to_14 "rows under the month spec"

################################################
################################################
# Step 6: CHANGE identifierFieldNames from customer_id to contact_email only.

deploy_step 6

header "VERIFY step 6 (CHANGE identifier fields only)"
assert_columns "1:customer_id,2:contact_email,3:signed_up_at"
assert_partitions "signed_up_at_month"
assert_identifiers "2" "contact_email"

header "ATHENA step 6"
rows_10_to_14 "rows unchanged"
athena_expect "(PK) comment moved to contact_email" "$COMMENTS" \
    "column_name|comment" "customer_id|Primary key." "contact_email|(PK) " "signed_up_at|NULL"

################################################
################################################
# Step 7: ADD top-level column `note` (id 10) to the nested table.

deploy_step 7

header "VERIFY step 7 (nested ids after ADD top-level column)"
assert_nested_ids "${BASE_IDS},addr.city:9,note:10" "10"

header "SPARK step 7 (old nested row readable by name, INSERT a new row)"
spark_submit "$VERIFY_PROGRAM" --phase 7

header "ATHENA step 7"
athena_expect "nested rows with note" "${NESTED_ROWS}, note FROM ${NESTED_TABLE} ORDER BY id" \
    "id|tag1|tag2|k1|k2|line1|city|note" "${ROW_100}|NULL" "${ROW_101}|n101"

################################################
################################################
# Step 8: ADD struct field `addr.zip` (id 11) between line1 and city.

deploy_step 8

header "VERIFY step 8 (nested ids after ADD struct field in the middle)"
assert_nested_ids "${BASE_IDS},addr.zip:11,addr.city:9,note:10" "11"

header "SPARK step 8 (old nested rows readable by name, INSERT a row with zip)"
spark_submit "$VERIFY_PROGRAM" --phase 8

header "ATHENA step 8"
athena_expect "nested rows with addr.zip" "${NESTED_ROWS}, note, addr.zip AS zip FROM ${NESTED_TABLE} ORDER BY id" \
    "id|tag1|tag2|k1|k2|line1|city|note|zip" \
    "${ROW_100}|NULL|NULL" "${ROW_101}|n101|NULL" "102|x1|x2|y1|y2|N1|E1|n102|Z102"

################################################
################################################
# Step 9: CHANGE one table property of evolution_test, nothing else.

assert_meta commit-retries unset
BEFORE=$(listing_without commit-retries)

deploy_step 9

header "VERIFY step 9 (property-only update)"
assert_meta commit-retries 5
assert_same "rest of metadata.json unchanged" "$BEFORE" "$(listing_without commit-retries)"

header "VERIFY step 9 (parameter_name_test)"
assert_same "${NAME_TABLE} Glue version and metadata file" "1 00001" "$(aws glue get-table \
    --database-name "$DATABASE" --name "$NAME_TABLE" --region "$AWS_REGION" \
    --query '[Table.VersionId,Table.Parameters.metadata_location]' --output text \
    | sed -E 's|[[:space:]].*/([0-9]+)-[^/]*$| \1|')"

header "ATHENA step 9"
rows_10_to_14 "rows unchanged"
athena_expect "${NAME_TABLE} row written at step 1" "SELECT * FROM ${NAME_TABLE}" "id|v" "1|v1"

################################################
################################################
# Step 10: CHANGE the sort order from customer_id to signed_up_at DESC.

assert_meta sort-orders "1:identity(1)/asc/nulls-last"
BEFORE=$(listing_without "default-sort-order-id|sort-orders")

deploy_step 10

header "VERIFY step 10 (sort order change)"
assert_meta default-sort-order-id 2
assert_meta sort-orders "1:identity(1)/asc/nulls-last;2:identity(3)/desc/nulls-first"
assert_same "rest of metadata.json unchanged" "$BEFORE" "$(listing_without "default-sort-order-id|sort-orders")"

header "ATHENA step 10"
rows_10_to_14 "rows unchanged"

################################################
################################################
# Step 11: ADD column country (id 5) in a deploy whose wait condition,
# created after the table update, fails. The stack must roll back.

SCHEMAS_BEFORE=$(table_column_names | grep ^schemas-count | cut -d' ' -f2)
BEFORE=$(listing_without "max-schema-id|last-column-id|schemas-count")

if deploy_step 11; then
    red "  step 11 deploy succeeded; expected a failure and a rollback"
    exit 1
fi

header "VERIFY step 11 (rolled back)"
assert_same "stack status" UPDATE_ROLLBACK_COMPLETE "$(aws cloudformation describe-stacks \
    --stack-name "$STACK" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text)"
assert_same "only RollbackTrigger failed" "$(printf 'RollbackTrigger\t%s' \
    'Cannot wait on specified Handle URL - handle must originate from within the same stack')" \
    "$(aws cloudformation describe-stack-events --stack-name "$STACK" --region "$AWS_REGION" \
        --query "StackEvents[?ResourceStatus=='CREATE_FAILED'].[LogicalResourceId,ResourceStatusReason]" \
        --output text)"
assert_same "current schema, columns and orders as before step 11" "$BEFORE" \
    "$(listing_without "max-schema-id|last-column-id|schemas-count")"
assert_meta last-column-id 5
assert_meta schemas-count $((SCHEMAS_BEFORE + 1))
ROLLED_BACK_SCHEMA_ID=$(table_column_names | grep ^max-schema-id | cut -d' ' -f2)

header "ATHENA step 11"
rows_10_to_14 "rows unchanged after the rollback"

################################################
################################################
# Step 12: the step 11 change again, without the failing resource.

deploy_step 12

header "VERIFY step 12 (redeploy of the rolled-back change)"
assert_columns "1:customer_id,2:contact_email,3:signed_up_at,5:country"
assert_meta schema-id "$ROLLED_BACK_SCHEMA_ID"
assert_meta schemas-count $((SCHEMAS_BEFORE + 1))
assert_meta last-column-id 5

header "ATHENA step 12"
athena_expect "old rows read country NULL" "$ROWS" "customer_id|contact_email|signed_up_at|country" \
    "${ROW_10}|NULL" "${ROW_11}|NULL" "${ROW_12}|NULL" "${ROW_13}|NULL" "${ROW_14}|NULL"

################################################
################################################
# Optional teardown.

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force --region "$AWS_REGION" 2>&1 | tail -3
fi

header "ALL EVOLUTION STEPS PASSED"
