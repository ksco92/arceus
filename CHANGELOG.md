# Changelog

Releases up to 0.22.1 predate this file; their breaking changes are in [UPGRADING.md](UPGRADING.md).

## Unreleased

- (patch) The README states that Glue numbers a new table's partition fields 1000, 1001 and up in spec order and ignores the declared `fieldId`s, and lists that, the `decimal(P, S)` spacing and the reuse of a partition spec the table holds among the Glue behaviours the integration suites assert.

## 0.22.2

- (patch) The README now says that GitHub shows `main`, which can be ahead of the latest release, and links this changelog for what is unreleased.
- (patch) The README says what each field id mistake does and how to find the ids a table has used, states the maintenance status and the 1.0 plan, and marks the engine-side v3 upgrade as a path no suite deploys after.
