#!/usr/bin/env bash
#
# Smoke test for the Spark toolchain. Deploys `IcebergSparkSmokeStack`,
# then runs scripts/spark/smoke.py against its table through the Glue
# catalog and the data lake bucket.
#
# Prereqs:
#   - AWS credentials in the default profile (us-east-1).
#   - `PRINCIPAL_ARN` env var set to the ARN of the IAM principal
#     the workflow is running as (same value passed to ArceusStack).
#   - ArceusStack already deployed with the same `PRINCIPAL_ARN`.
#   - The Spark toolchain installed (scripts/spark/install-spark.sh).
#
# Usage:
#   scripts/integration-test-spark-smoke.sh
#
# Optional env vars:
#   AWS_REGION - default us-east-1
#   DESTROY    - set to 1 to teardown at the end
#
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
DATABASE="sample_database"
TABLE="spark_smoke"
STACK="IcebergSparkSmokeStack"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

cleanup_table_prefix() {
    local bucket="data-lake-bucket-$(aws sts get-caller-identity --query Account --output text)"
    yellow "  Clearing s3://${bucket}/${DATABASE}/${TABLE}/ so the next deploy starts fresh."
    aws s3 rm "s3://${bucket}/${DATABASE}/${TABLE}/" --recursive --region "$AWS_REGION" 2>/dev/null || true
}

# shellcheck source=scripts/spark/spark-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/spark/spark-env.sh"

header "TEARDOWN any existing ${STACK} from a prior run"
npx cdk destroy "$STACK" --force 2>&1 | tail -5 || true
cleanup_table_prefix

header "DEPLOY ${STACK}"
npx cdk deploy "$STACK" --require-approval=never 2>&1 | tail -5

header "SPARK smoke"
spark_submit "$(dirname "${BASH_SOURCE[0]}")/spark/smoke.py"

if [ "${DESTROY:-0}" = "1" ]; then
    header "TEARDOWN"
    npx cdk destroy "$STACK" --force 2>&1 | tail -5
    cleanup_table_prefix
fi

green ""
green "=== SPARK SMOKE PASSED ==="
