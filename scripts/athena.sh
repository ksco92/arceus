# shellcheck shell=bash
# Sourced by the v2 integration scripts. `run_athena SQL` runs one statement
# in database sample_database and prints its result rows, the header row
# first, one row per line with fields joined by `|` and NULL for a null.
# A query that fails to start, fails, is cancelled, or is still running
# after ATHENA_TIMEOUT_SECONDS returns 1 after printing Athena's reason.
# `athena_expect LABEL SQL ROW...` fails unless the printed rows equal ROW...
#
# Optional env vars:
#   ATHENA_WORKGROUP       - default primary
#   ATHENA_OUTPUT_LOCATION - default s3://data-lake-bucket-<account>/athena-results/
#   ATHENA_TIMEOUT_SECONDS - default 600
#   AWS_REGION             - default us-east-1

ATHENA_WORKGROUP="${ATHENA_WORKGROUP:-primary}"
# ponytail: query results accumulate under the location; add an S3 lifecycle rule if it grows
ATHENA_OUTPUT_LOCATION="${ATHENA_OUTPUT_LOCATION:-s3://data-lake-bucket-$(aws sts get-caller-identity --query Account --output text)/athena-results/}"
ATHENA_TIMEOUT_SECONDS="${ATHENA_TIMEOUT_SECONDS:-600}"
AWS_REGION="${AWS_REGION:-us-east-1}"

run_athena() {
    local sql="$1" qid state deadline=$((SECONDS + ATHENA_TIMEOUT_SECONDS))
    if ! qid=$(aws athena start-query-execution \
        --region "$AWS_REGION" \
        --work-group "$ATHENA_WORKGROUP" \
        --query-execution-context Database=sample_database \
        --result-configuration "OutputLocation=${ATHENA_OUTPUT_LOCATION}" \
        --query-string "$sql" \
        --query QueryExecutionId \
        --output text 2>&1); then
        printf 'Athena did not start the query:\n%s\nSQL: %s\n' "$qid" "$sql" >&2
        return 1
    fi
    while :; do
        state=$(aws athena get-query-execution \
            --region "$AWS_REGION" \
            --query-execution-id "$qid" \
            --query 'QueryExecution.Status.[State,StateChangeReason]' \
            --output text) || return 1
        case "$state" in
            SUCCEEDED*) break ;;
            FAILED* | CANCELLED*)
                printf 'Athena query %s ended %s\nSQL: %s\n' "$qid" "$state" "$sql" >&2
                return 1 ;;
        esac
        if [ "$SECONDS" -ge "$deadline" ]; then
            aws athena stop-query-execution --region "$AWS_REGION" --query-execution-id "$qid" || true
            printf 'Athena query %s still %s after %ss; stopped\nSQL: %s\n' \
                "$qid" "$state" "$ATHENA_TIMEOUT_SECONDS" "$sql" >&2
            return 1
        fi
        sleep 1
    done
    aws athena get-query-results \
        --region "$AWS_REGION" \
        --query-execution-id "$qid" \
        --output json \
        | python3 -c '
import json, sys
for row in json.load(sys.stdin)["ResultSet"]["Rows"]:
    print("|".join(cell.get("VarCharValue", "NULL") for cell in row["Data"]))
'
}

athena_expect() {
    local label="$1" sql="$2" expected actual
    shift 2
    expected=$(printf '%s\n' "$@")
    actual=$(run_athena "$sql") || return 1
    if [ "$actual" = "$expected" ]; then
        printf '\033[32m  Athena: %s ✓\033[0m\n' "$label"
    else
        printf '\033[31m  Athena: %s ✗\033[0m\nexpected:\n%s\nactual:\n%s\n' "$label" "$expected" "$actual" >&2
        return 1
    fi
}
