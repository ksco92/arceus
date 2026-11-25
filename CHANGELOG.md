# Changelog

Releases up to 0.22.1 predate this file; their breaking changes are in [UPGRADING.md](UPGRADING.md).

## Unreleased

- (patch) The README and the `fieldId` doc comment state that Glue numbers a new table's partition fields 1000, 1001 and up in spec order and ignores the declared `fieldId`s; the README also lists the `decimal(P, S)` and partition-spec reuse behaviours among those the suites assert.
- (patch) The README says that dropping a column a partition field has sourced breaks Athena reads also when the field was removed in an earlier deploy, and no longer advises removing the field first; a reused partition `fieldId` is described by what Athena and Spark do, without Trino; the `fieldId` floor of 1000 is stated as the construct's rule, with the Iceberg spec quoted.

## 0.22.2

- (patch) The README now says that GitHub shows `main`, which can be ahead of the latest release, and links this changelog for what is unreleased.
- (patch) The README says what each field id mistake does and how to find the ids a table has used, states the maintenance status and the 1.0 plan, and marks the engine-side v3 upgrade as a path no suite deploys after.
