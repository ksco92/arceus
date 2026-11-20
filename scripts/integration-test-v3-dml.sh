#!/usr/bin/env bash
#
# End-to-end test for Iceberg v3 tables created by CloudFormation,
# driven through Spark against `IcebergV3DmlStack`. `v3_geo_test` (geometry and
# geography columns) is asserted from metadata.json only; no Spark job opens it.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var set to the ARN of the IAM principal
#     the workflow is running as (same value passed to ArceusStack).
#   - ArceusStack already deployed with the same `PRINCIPAL_ARN`.
#   - The Spark toolchain installed (scripts/spark/install-spark.sh).
#
# Usage:
#   scripts/integration-test-v3-dml.sh
#
# Optional env vars:
#   AWS_REGION - default us-east-1
#   DESTROY    - set to 1 to teardown at the end
#
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
DATABASE="sample_database"
TABLES="v3_dml_test v3_upgrade_test v3_geo_test"
STACK="IcebergV3DmlStack"

green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

cleanup_table_prefixes() {
    local bucket
    bucket="data-lake-bucket-$(aws sts get-caller-identity --query Account --output text)"
    for table in $TABLES; do
        yellow "  Clearing s3://${bucket}/${DATABASE}/${table}/ so the next deploy starts fresh."
        aws s3 rm "s3://${bucket}/${DATABASE}/${table}/" --recursive --region "$AWS_REGION" 2>/dev/null || true
    done
}

assert_metadata() {
    local table="$1" format_version="$2" min_next_row_id="${3:-0}"
    local meta_loc
    meta_loc=$(aws glue get-table \
        --database-name "$DATABASE" \
        --name "$table" \
        --region "$AWS_REGION" \
        --query 'Table.Parameters.metadata_location' \
        --output text)
    aws s3 cp "$meta_loc" - --region "$AWS_REGION" | python3 -c '
import json, sys
m = json.load(sys.stdin)
table, format_version, min_next_row_id = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
found, next_row_id = m["format-version"], m.get("next-row-id", 0)
assert found == format_version, f"{table}: format-version {found}, expected {format_version}"
assert next_row_id >= min_next_row_id, f"{table}: next-row-id {next_row_id}, expected >= {min_next_row_id}"
print(f"  {table}: format-version {found}, next-row-id {next_row_id} \u2713")
' "$table" "$format_version" "$min_next_row_id"
}

assert_geo_columns() {
    local meta_loc
    meta_loc=$(aws glue get-table \
        --database-name "$DATABASE" \
        --name v3_geo_test \
        --region "$AWS_REGION" \
        --query 'Table.Parameters.metadata_location' \
        --output text)
    aws s3 cp "$meta_loc" - --region "$AWS_REGION" | python3 -c '
import json, sys
m = json.load(sys.stdin)
schema = next(s for s in m["schemas"] if s["schema-id"] == m["current-schema-id"])
found = [(f["id"], f["name"], f["required"], f["type"]) for f in schema["fields"]]
expected = [
    (1, "home", False, "geography(OGC:CRS84, spherical)"),
    (2, "shape", False, "geometry"),
]
version = m["format-version"]
assert version == 3, f"v3_geo_test: format-version {version}, expected 3"
assert found == expected, f"v3_geo_test: columns {found}, expected {expected}"
print(f"  v3_geo_test: format-version 3, columns {found} \u2713")
'
}

# shellcheck source=scripts/spark/spark-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/spark/spark-env.sh"

header "TEARDOWN any existing ${STACK} from a prior run"
npx cdk destroy "$STACK" --force 2>&1 | tail -5 || true
cleanup_table_prefixes

header "DEPLOY ${STACK}"
npx cdk deploy "$STACK" --require-approval=never 2>&1 | tail -5

header "VERIFY metadata.json as CloudFormation wrote it"
assert_metadata v3_dml_test 3
assert_metadata v3_upgrade_test 2
assert_geo_columns

header "SPARK verify_v3_dml.py"
spark_submit "$(dirname "${BASH_SOURCE[0]}")/spark/verify_v3_dml.py"

header "VERIFY metadata.json after the Spark writes"
assert_metadata v3_dml_test 3 1
assert_metadata v3_upgrade_test 3

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force 2>&1 | tail -5
    cleanup_table_prefixes
fi

green ""
green "=== ALL V3 DML STEPS PASSED ==="
