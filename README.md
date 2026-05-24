# arceus

CDK app that provisions a small Lake Formation data lake (KMS-encrypted S3
buckets, a Glue database, an Athena workgroup) plus an `IcebergTable` L2
construct for managing Apache Iceberg tables through CloudFormation.

The Iceberg construct lives in `lib/iceberg-table.ts` and uses Glue
`AWS::Glue::Table` with the Iceberg `table_type` parameter so that
`cdk deploy` creates, updates, and deletes Iceberg tables the same way
CloudFormation handles any other resource.

## Quickstart

```bash
npm install
npm run build
npm test
npx cdk synth
npx cdk deploy ArceusStack --require-approval=never
```

The stack outputs the data lake bucket name, the Athena results bucket name,
and the Glue database name once deployment finishes.

## Project layout

```
arceus/
├── bin/arceus.ts           # CDK app entry point
├── lib/
│   └── arceus-stack.ts     # Stack scaffolding (buckets, DB, workgroup)
├── test/
│   └── arceus-stack.test.ts
├── cdk.json
├── package.json
└── tsconfig.json
```
