# Upgrading

Upgrade notes by version, from 0.12.0 on, newest first.

## 0.22.0

Upgrading from a version before 0.22.0: `IcebergType.isPrimitive`,
`isDecimal` and `isFixed` are removed; compare the type's `kind` with
`IcebergTypeKind` instead, for example
`type.kind === IcebergTypeKind.DECIMAL`.

## 0.21.0

Upgrading from a version before 0.21.0: `schemaHistoryFile` and
`IcebergSchemaHistory` are removed. Remove the prop, stop running the update
command after synth, and delete the committed history file.

## 0.20.0

Upgrading from a version before 0.20.0: `IcebergPropertyKeys` is removed, and
synth no longer checks the compression codec, write mode, distribution mode,
`gc.enabled` and numeric table properties.

## 0.17.0

Upgrading from a version before 0.17.0: existing `grantRead`,
`grantWrite` and `grantReadWrite` policies change with no code edit.
The Glue statement names the catalog and database ARNs as well as the
table, and read grants add `glue:GetDatabase`. Nothing for KMS or Lake
Formation is issued unless the new prop or options are passed.

## 0.12.0

Upgrading from a version before 0.12.0, which numbered nested fields
itself: declare the ids the table's current `metadata.json` holds,
top-level and nested (each field `id`, `element-id`, `key-id` and
`value-id`), or the next deploy renumbers the fields that differ and
existing data files read under the wrong field. A nested type object
shared by two columns now fails synth with a duplicate id; give each
column its own nested type with its own ids. The list element and map
value nullability default also changed: `elementRequired` and
`valueRequired` now default to `false`. Earlier versions made list
elements required by default and map values required unless the third
argument of `map` was `false`; set `elementRequired: true` or
`valueRequired: true` wherever the deployed schema has
`"element-required": true` or `"value-required": true`.
