# Changelog

Releases up to 0.22.1 predate this file; their breaking changes are in [UPGRADING.md](UPGRADING.md).

## Unreleased

- (patch) Document live AWS integration coverage for `IcebergFormatVersion.V1` and `AWS::Glue::TableOptimizer` coexistence (with `optimizer.node.addDependency(table)` and `table.grantReadWrite(optimizerRole, { lakeFormationDataAccess: true })` wiring notes) in the README.
- (minor) Bundle the zero-dependency field-id checker CLI (`cdk-glue-iceberg-check-field-ids`, `bin/check-field-ids.js`) in the npm package, add `permissions.node.addDependency(table)` to the `CfnPermissions` README example, document the Integration test workflow schedule and V1 / `AWS::Glue::TableOptimizer` test status, and move the CI check and tool comparison earlier in the README.
- (patch) Document the zero-dependency CI field-id checker (`docs/check-field-ids.js`) and copy-pasteable `aws glue get-table` / `aws s3 cp` invocation in the README and `docs/field-ids.md`.
- (patch) Tighten the README for first-time adopters (add an `IcebergTableProps` summary table, document `Database.fromDatabaseArn` and tokenized `location` grant rules, clarify `fromIcebergTableAttributes` vs `cdk import`, surface the plain-`CfnTable` eject hatch and `UpdateTable` mechanism earlier, and move the Format version 3 deep dive to `docs/format-version-3.md`).

## 0.23.0

- (patch) Restructure the README for first-time adopters (move the full-surface example to `docs/full-example.md`, add a Table of Contents, surface comparison and access docs earlier, remove the FAQ), document all public exports (`IcebergTypeKind`, `IcebergPartitionTransformKind`, `IcebergTableProps`, `IcebergTableAttributes`, `IIcebergTable`, `IcebergSortField`), add `location` change behavior, document `.resource` migration and CI field-id checks, and narrow unasserted claims.
- (breaking) `IcebergType` and `IcebergPartitionTransform` constructors are now private (`IcebergTypeOptions` and `IcebergPartitionTransformOptions` are no longer exported), and `IcebergTable` no longer checks `formatVersion` and `dataFormat` enum membership at runtime.
- (patch) The README's "Evolving a table" section lists the v2 type promotions (`int` to `long`, `float` to `double`, `decimal(10, 2)` to `decimal(12, 2)`) and nullability relaxation (`required: true` to `false`) that the evolution suite deploys alongside the v3 promotions.
- (patch) Complete `@param` and `@returns` JSDoc tags on public `IcebergTable`, `IcebergType`, and `IcebergPartitionTransform` methods and enforce them via `eslint-plugin-jsdoc`.
- (patch) The README and the `fieldId` doc comment state that Glue numbers a new table's partition fields 1000, 1001 and up in spec order and ignores the declared `fieldId`s; the README also lists the `decimal(P, S)` and partition-spec reuse behaviours among those the suites assert.
- (patch) The README no longer advises removing a partition field before dropping its source column (`SELECT *` and `SELECT count(*)` fail in Athena either way), describes a reused `fieldId` without Trino and quotes the Iceberg spec on field id 1000; the `fieldId` doc comment drops Trino too.
- (patch) The README's "Why a raw CfnTable goes wrong" section drops the example's `table_type` parameter, names failing Athena reads and quotes the `tableInput` rejection message under a renamed heading; the lead and the `IcebergTable` doc comment point at it, and "Identifier fields" says schema reuse compares `doc` too.
- (patch) The README's "Changes that need care" states what a deploy does after Athena adds a column or Spark upgrades a v2 table to v3, and "Changes that replace or remove the table" states what a rename keeping the `location` leaves there; both name what is not observed.

## 0.22.2

- (patch) The README now says that GitHub shows `main`, which can be ahead of the latest release, and links this changelog for what is unreleased.
- (patch) The README says what each field id mistake does and how to find the ids a table has used, states the maintenance status and the 1.0 plan, and marks the engine-side v3 upgrade as a path no suite deploys after.
