#!/usr/bin/env bash
#
# End-to-end integration test for IcebergTable's v2 DML surface.
# Deploys `IcebergDmlStack` once, then runs scripts/spark/verify_dml.py,
# which exercises INSERT, UPDATE, DELETE, MERGE INTO, time travel,
# compaction, and snapshot expiration against the same Iceberg table
# through Spark.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var set to the ARN of the IAM principal
#     the workflow is running as (same value passed to ArceusStack).
#   - ArceusStack already deployed with the same `PRINCIPAL_ARN`.
#   - The Spark toolchain installed (scripts/spark/install-spark.sh).
#
# Usage:
#   scripts/integration-test-dml.sh
#
# Optional env vars:
#   AWS_REGION - default us-east-1
#   DESTROY    - set to 1 to teardown at the end
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

################################################
################################################
# Initial deploy.

header "DEPLOY IcebergDmlStack"
npx cdk deploy "$STACK" --require-approval=never 2>&1 | tail -5

header "SPARK DML steps 1-9"
spark_submit "$(dirname "${BASH_SOURCE[0]}")/spark/verify_dml.py"

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
