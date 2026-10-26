#!/usr/bin/env bash
#
# Integration test for the catalog-level format-version 3 features that
# no engine in the runner can exercise: nanosecond timestamp columns and
# the unknown -> string / date -> timestamp promotions. Drives
# `IcebergV3EvolutionStack` through four real `cdk deploy`s and asserts
# the resulting `metadata.json` after each.
#
# Prereqs: same as scripts/integration-test-evolution.sh (AWS credentials,
# PRINCIPAL_ARN, ArceusStack deployed with the same principal).
#
# Usage:
#   scripts/integration-test-v3-evolution.sh
#
# Optional env vars:
#   AWS_REGION — default us-east-1
#   DESTROY    — set to 1 to teardown at the end
#
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
DATABASE="sample_database"
TABLE="v3_evolution_test"
STACK="IcebergV3EvolutionStack"
META_FILE=$(mktemp)
trap 'rm -f "$META_FILE"' EXIT

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

fetch_metadata() {
    local meta_loc
    meta_loc=$(aws glue get-table \
        --database-name "$DATABASE" \
        --name "$TABLE" \
        --region "$AWS_REGION" \
        --query 'Table.Parameters.metadata_location' \
        --output text)
    aws s3 cp "$meta_loc" "$META_FILE" --region "$AWS_REGION" > /dev/null
}

# Prints "<key> <value>" lines describing the current metadata.
table_summary() {
    python3 -c "
import json, sys
m = json.load(open(sys.argv[1]))
schema = next(s for s in m['schemas'] if s['schema-id'] == m['current-schema-id'])
spec = next(s for s in m['partition-specs'] if s['spec-id'] == m['default-spec-id'])
print('format-version', m['format-version'])
print('next-row-id', m['next-row-id'])
print('schema-id', m['current-schema-id'])
print('schemas-count', len(m['schemas']))
print('last-partition-id', m['last-partition-id'])
print('last-column-id', m['last-column-id'])
print('columns', ','.join(f\"{f['id']}:{f['name']}:{f['type']}\" for f in schema['fields']))
print('partitions', ','.join(f\"{f['field-id']}:{f['transform']}\" for f in spec['fields']))
" "$META_FILE"
}

summary_value() {
    table_summary | grep "^$1 " | cut -d' ' -f2
}

assert_equals() {
    local label="$1" expected="$2" actual="$3"
    if [ "$actual" = "$expected" ]; then
        green "  $label ✓ ($actual)"
    else
        red   "  $label ✗"
        red   "    expected: $expected"
        red   "    actual:   $actual"
        return 1
    fi
}

assert_format() {
    assert_equals "format-version" "3" "$(summary_value format-version)"
    local next_row_id
    next_row_id=$(summary_value next-row-id)
    [[ "$next_row_id" =~ ^[0-9]+$ ]] || { red "  next-row-id missing"; return 1; }
    green "  next-row-id present ($next_row_id)"
}

assert_columns()    { assert_equals "columns" "$1" "$(summary_value columns)"; }
assert_partitions() { assert_equals "partitions" "$1" "$(summary_value partitions)"; }

# Issue #43 regression check, applied to the v3 spec history: no
# partition field-id may be bound to two different (source-id,
# transform) pairs, and last-partition-id must cover the highest
# field-id in any spec.
assert_partition_history() {
    if python3 -c "
import json, sys
m = json.load(open(sys.argv[1]))
specs = m['partition-specs']
bindings = {}
conflicts = []
max_field_id = 0
for spec in specs:
    for f in spec['fields']:
        binding = (f['source-id'], f['transform'])
        max_field_id = max(max_field_id, f['field-id'])
        previous = bindings.setdefault(f['field-id'], binding)
        if previous != binding:
            conflicts.append((f['field-id'], previous, binding))
print('spec-count', len(specs))
print('partition-field-ids', ','.join(str(i) for i in sorted(bindings)))
print('last-partition-id', m['last-partition-id'])
if conflicts:
    for field_id, a, b in conflicts:
        print(f'CONFLICT: field-id {field_id} bound to both {a} and {b}')
    sys.exit(1)
if m['last-partition-id'] < max_field_id:
    print(f'STALE COUNTER: last-partition-id {m[\"last-partition-id\"]} < max field-id {max_field_id}')
    sys.exit(1)
" "$META_FILE"; then
        green "  partition-spec history consistent ✓"
    else
        red   "  partition-spec history violates Iceberg invariants ✗"
        return 1
    fi
}

verify_step() {
    local columns="$1" partitions="$2"
    fetch_metadata
    assert_format
    assert_columns "$columns"
    assert_partitions "$partitions"
    assert_partition_history
    yellow "  $(table_summary | grep -E '^(schema-id|schemas-count|last-column-id) ' | tr '\n' ' ')"
}

deploy_step() {
    local step="$1"
    header "STEP $step — cdk deploy"
    npx cdk deploy "$STACK" \
        --require-approval=never \
        --region "$AWS_REGION" \
        --context "v3EvolutionStep=$step" 2>&1 | tail -3
}

header "TEARDOWN any existing ${STACK} from a prior run"
npx cdk destroy "$STACK" --force --region "$AWS_REGION" 2>&1 | tail -3 || true
yellow "  Also clearing the table's S3 prefix so Iceberg starts fresh."
aws s3 rm "s3://data-lake-bucket-$(aws sts get-caller-identity --query Account --output text)/${DATABASE}/${TABLE}/" \
    --region "$AWS_REGION" --recursive 2>&1 | tail -3 || true

STEP1_COLUMNS="1:event_id:long,2:occurred_at:timestamp_ns,3:received_at:timestamptz_ns,4:raw:unknown,5:event_date:date"
STEP2_COLUMNS="${STEP1_COLUMNS},6:source:string"
STEP3_COLUMNS="1:event_id:long,2:occurred_at:timestamp_ns,3:received_at:timestamptz_ns,4:raw:string,5:event_date:timestamp,6:source:string"

deploy_step 1
header "VERIFY step 1 (nanosecond, unknown and date columns)"
verify_step "$STEP1_COLUMNS" "1000:day"

deploy_step 2
header "VERIFY step 2 (ADD column + ADD hour partition on timestamptz_ns)"
verify_step "$STEP2_COLUMNS" "1000:day,1001:hour"

SCHEMA_ID_BEFORE_PROMOTION=$(summary_value schema-id)
deploy_step 3
header "VERIFY step 3 (promote unknown -> string and date -> timestamp)"
verify_step "$STEP3_COLUMNS" "1000:day,1001:hour"
SCHEMA_ID_AFTER_PROMOTION=$(summary_value schema-id)
if [ "$SCHEMA_ID_AFTER_PROMOTION" -gt "$SCHEMA_ID_BEFORE_PROMOTION" ]; then
    green "  schema-id advanced ($SCHEMA_ID_BEFORE_PROMOTION -> $SCHEMA_ID_AFTER_PROMOTION) ✓"
else
    red "  schema-id did not advance ($SCHEMA_ID_BEFORE_PROMOTION -> $SCHEMA_ID_AFTER_PROMOTION)"; exit 1
fi
assert_equals "last-column-id" "6" "$(summary_value last-column-id)"

deploy_step 4
header "VERIFY step 4 (CHANGE day -> month under fresh id 1002)"
verify_step "$STEP3_COLUMNS" "1002:month,1001:hour"
assert_equals "last-partition-id" "1002" "$(summary_value last-partition-id)"

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force --region "$AWS_REGION" 2>&1 | tail -3
fi

header "ALL V3 EVOLUTION STEPS PASSED"
