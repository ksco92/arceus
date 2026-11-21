# shellcheck shell=bash
# Sourced by the integration scripts that read a table's Iceberg metadata.json.
# Reads DATABASE and AWS_REGION; assert_partition_history also needs the
# caller's green and red helpers.
#
# `fetch_metadata TABLE` prints the metadata.json that Glue's
# metadata_location points at for TABLE.
# `assert_partition_history` reads a metadata.json on stdin and fails if a
# partition field-id is bound to two (source-id, transform) pairs across the
# spec history, or if last-partition-id is below the highest field-id.
# `field_ids` reads a metadata.json on stdin and prints its field ids as path:id.

field_ids() { python3 "$(dirname "${BASH_SOURCE[0]}")/field_ids.py"; }

fetch_metadata() {
    local meta_loc
    meta_loc=$(aws glue get-table \
        --database-name "$DATABASE" \
        --name "$1" \
        --region "$AWS_REGION" \
        --query 'Table.Parameters.metadata_location' \
        --output text) || return
    aws s3 cp "$meta_loc" - --region "$AWS_REGION"
}

assert_partition_history() {
    if python3 -c "
import json, sys
m = json.load(sys.stdin)
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
"; then
        green "  partition-spec history consistent ✓"
    else
        red   "  partition-spec history violates Iceberg invariants ✗"
        return 1
    fi
}
