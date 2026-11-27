"""Print the current schema's field ids of the Iceberg metadata.json on stdin as path:id, comma-separated."""
import json
import sys


def walk(path, field_type, out):
    if not isinstance(field_type, dict):
        return
    if field_type['type'] == 'struct':
        for field in field_type['fields']:
            out.append('%s.%s:%d' % (path, field['name'], field['id']))
            walk(path + '.' + field['name'], field['type'], out)
    elif field_type['type'] == 'list':
        out.append('%s.element:%d' % (path, field_type['element-id']))
        walk(path + '.element', field_type['element'], out)
    elif field_type['type'] == 'map':
        out.append('%s.key:%d' % (path, field_type['key-id']))
        out.append('%s.value:%d' % (path, field_type['value-id']))
        walk(path + '.key', field_type['key'], out)
        walk(path + '.value', field_type['value'], out)


metadata = json.load(sys.stdin)
schemas = metadata.get('schemas')
if schemas and 'current-schema-id' in metadata:
    schema = next(s for s in schemas if s['schema-id'] == metadata['current-schema-id'])
else:
    schema = metadata['schema']
out = []
for field in schema['fields']:
    out.append('%s:%d' % (field['name'], field['id']))
    walk(field['name'], field['type'], out)
print(','.join(out))
