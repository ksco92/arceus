import {
    CfnOutput,
    RemovalPolicy,
    Stack,
    StackProps,
} from 'aws-cdk-lib';
import {
    Construct,
} from 'constructs';
import {
    CfnPermissions,
} from 'aws-cdk-lib/aws-lakeformation';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergColumn,
    IcebergFormatVersion,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
} from '../packages/cdk-glue-iceberg-table/lib/iceberg';

/** Props for `IcebergV3EvolutionStack`; the bucket and database are imported by name. */
export interface IcebergV3EvolutionStackProps extends StackProps {
    /** Name of the data-lake bucket that owns the table's S3 prefix. */
    readonly importedDataLakeBucketName: string;

    /** Name of the existing Glue database to publish the table to. */
    readonly importedDatabaseName: string;

    /** ARN of the IAM principal granted table permissions, typically the one running `cdk deploy`. */
    readonly principalArn: string;
}

/**
 * Owns a format-version 3 table whose schema and partition spec follow
 * `--context v3EvolutionStep=N`. Target of
 * `scripts/integration-test-v3-evolution.sh`.
 */
export class IcebergV3EvolutionStack extends Stack {
    constructor(scope: Construct, id: string, props: IcebergV3EvolutionStackProps) {
        super(scope, id, props);

        const stepRaw = this.node.tryGetContext('v3EvolutionStep') ?? '1';
        const step = Number(stepRaw);
        if (![
            1,
            2,
            3,
            4,
        ].includes(step)) {
            throw new Error(`v3EvolutionStep must be 1, 2, 3, or 4, got '${stepRaw}'`);
        }

        const importedBucket = Bucket.fromBucketName(
            this,
            'ImportedDataLakeBucket',
            props.importedDataLakeBucketName,
        );
        const importedDatabase = Database.fromDatabaseArn(
            this,
            'ImportedDatabase',
            `arn:${this.partition}:glue:${this.region}:${this.account}:database/${props.importedDatabaseName}`,
        );

        const table = new IcebergTable(this, 'V3EvolutionTable', {
            database: importedDatabase,
            tableName: 'v3_evolution_test',
            formatVersion: IcebergFormatVersion.V3,
            comment: `Integration-test target — v3 evolution step ${step}.`,
            columns: buildColumns(step),
            location: `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/v3_evolution_test/`,
            partitionSpec: buildPartitionSpec(step),
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const permission = new CfnPermissions(this, 'V3EvolutionTablePermission', {
            permissions: [
                'SELECT',
                'INSERT',
                'DELETE',
                'ALTER',
                'DESCRIBE',
            ],
            permissionsWithGrantOption: [],
            resource: {
                tableResource: {
                    catalogId: this.account,
                    name: table.tableName,
                    databaseName: importedDatabase.databaseName,
                },
            },
            dataLakePrincipal: {
                dataLakePrincipalIdentifier: props.principalArn,
            },
        });
        permission.addResourceDependency(table.resource);

        new CfnOutput(this, 'V3EvolutionStepOutput', {
            value: String(step),
            description: 'Evolution step this stack was last deployed with.',
        });

        new CfnOutput(this, 'V3EvolutionTableNameOutput', {
            value: table.tableName,
        });
    }
}

function buildColumns(step: number): IcebergColumn[] {
    const promoted = step >= 3;
    const columns: IcebergColumn[] = [
        {
            name: 'event_id',
            type: IcebergType.LONG,
            required: true,
            id: 1,
        },
        {
            name: 'occurred_at',
            type: IcebergType.TIMESTAMP_NS,
            required: false,
            id: 2,
        },
        {
            name: 'received_at',
            type: IcebergType.TIMESTAMPTZ_NS,
            required: false,
            id: 3,
        },
        {
            name: 'raw',
            type: promoted ? IcebergType.STRING : IcebergType.UNKNOWN,
            required: false,
            id: 4,
        },
        {
            name: 'event_date',
            type: promoted ? IcebergType.TIMESTAMP : IcebergType.DATE,
            required: false,
            id: 5,
        },
    ];
    if (step >= 2) {
        columns.push({
            name: 'source',
            type: IcebergType.STRING,
            required: false,
            id: 6,
        });
    }
    return columns;
}

function buildPartitionSpec(step: number): IcebergPartitionField[] {
    const occurredAt: IcebergPartitionField = step === 4
        ? {
            sourceColumn: 'occurred_at',
            transform: IcebergPartitionTransform.MONTH,
            fieldId: 1002,
        }
        : {
            sourceColumn: 'occurred_at',
            transform: IcebergPartitionTransform.DAY,
            fieldId: 1000,
        };
    if (step === 1) {
        return [
            occurredAt,
        ];
    }
    return [
        occurredAt,
        {
            sourceColumn: 'received_at',
            transform: IcebergPartitionTransform.HOUR,
            fieldId: 1001,
        },
    ];
}
