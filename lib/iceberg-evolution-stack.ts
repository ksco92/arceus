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
} from '@aws-cdk/aws-glue-alpha';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergColumn,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
} from './iceberg';

/**
 * Props for `IcebergEvolutionStack`. The stack itself is parameterized
 * on a single integer `step` so that integration tests can run
 * sequential `cdk deploy --context evolutionStep=N` invocations and
 * observe how the underlying Iceberg table evolves.
 *
 * The bucket and database are imported by name rather than passed as
 * cross-stack references so that the test stack can be deployed and
 * destroyed independently of `ArceusStack`.
 */
export interface IcebergEvolutionStackProps extends StackProps {
    /** Name of the data-lake bucket that owns the table's S3 prefix. */
    readonly importedDataLakeBucketName: string;

    /** Name of the existing Glue database to publish the table to. */
    readonly importedDatabaseName: string;

    /**
     * IAM user name (in this account) that should be granted
     * SELECT/INSERT/DELETE/ALTER/DESCRIBE on the test table —
     * typically the developer running `cdk deploy`.
     */
    readonly developerIamUserName: string;
}

/**
 * Stack that owns a single Iceberg table whose columns and
 * partition spec change based on a `--context evolutionStep=N`
 * value. Used as the target of `scripts/integration-test-evolution.sh`.
 */
export class IcebergEvolutionStack extends Stack {
    constructor(scope: Construct, id: string, props: IcebergEvolutionStackProps) {
        super(scope, id, props);

        const stepRaw = this.node.tryGetContext('evolutionStep') ?? '1';
        const step = Number(stepRaw);
        if (![
            1,
            2,
            3,
            4,
        ].includes(step)) {
            throw new Error(`evolutionStep must be 1, 2, 3, or 4, got '${stepRaw}'`);
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
        const developerArn = `arn:${this.partition}:iam::${this.account}:user/${props.developerIamUserName}`;

        const columns: IcebergColumn[] = buildColumns(step);
        const partitionSpec: IcebergPartitionField[] = buildPartitionSpec(step);

        const table = new IcebergTable(this, 'EvolutionTable', {
            database: importedDatabase,
            tableName: 'evolution_test',
            comment: `Integration-test target — evolution step ${step}.`,
            columns,
            location: `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/evolution_test/`,
            partitionSpec,
            identifierFieldNames: [
                'customer_id',
            ],
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const permission = new CfnPermissions(this, 'EvolutionTablePermission', {
            permissions: [
                'SELECT',
                'INSERT',
                'DELETE',
                'ALTER',
                'DESCRIBE',
            ],
            permissionsWithGrantOption: [

            ],
            resource: {
                tableResource: {
                    catalogId: this.account,
                    name: table.tableName,
                    databaseName: importedDatabase.databaseName,
                },
            },
            dataLakePrincipal: {
                dataLakePrincipalIdentifier: developerArn,
            },
        });
        permission.addDependency(table.resource);

        new CfnOutput(this, 'EvolutionStepOutput', {
            value: String(step),
            description: 'Evolution step this stack was last deployed with.',
        });

        new CfnOutput(this, 'EvolutionTableNameOutput', {
            value: table.tableName,
        });
    }
}

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Evolution definitions
//
// Each step is a snapshot of what the table looks like after a
// particular `cdk deploy`. The id pinning is the load-bearing piece —
// every column keeps the same id across the lifetime of the table so
// that data files (which reference fields by id) stay queryable.

function buildColumns(step: number): IcebergColumn[] {
    /// `region` is dropped in step 4 — note it is intentionally NOT
    /// a partition source so that the column-drop deploy can succeed
    /// without first inserting a `void` transform in the partition
    /// spec (Iceberg requires the latter, and the CFN
    /// OpenTableFormatInput surface cannot express it).
    const baseline: IcebergColumn[] = [
        {
            name: 'customer_id',
            type: IcebergType.LONG,
            required: true,
            id: 1,
            doc: 'Primary key.',
        },
        {
            name: 'email',
            type: IcebergType.STRING,
            required: true,
            id: 2,
        },
        {
            name: 'signed_up_at',
            type: IcebergType.TIMESTAMPTZ,
            required: true,
            id: 3,
        },
    ];
    if (step === 1) {
        return baseline;
    }
    /// Step 2: ADD `region` (new id 4).
    const withRegion: IcebergColumn[] = [
        ...baseline,
        {
            name: 'region',
            type: IcebergType.STRING,
            required: false,
            id: 4,
        },
    ];
    if (step === 2) {
        return withRegion;
    }
    /// Step 3: RENAME `email` -> `contact_email` (id 2 preserved).
    const renamed: IcebergColumn[] = [
        withRegion[0],
        {
            name: 'contact_email',
            type: IcebergType.STRING,
            required: true,
            id: 2,
        },
        withRegion[2],
        withRegion[3],
    ];
    if (step === 3) {
        return renamed;
    }
    /// Step 4: DROP `region`. Id 4 stays retired — filter it out
    /// rather than index-slicing so the intent is explicit.
    return renamed.filter((column) => column.name !== 'region');
}

function buildPartitionSpec(step: number): IcebergPartitionField[] {
    const dayPartition: IcebergPartitionField = {
        sourceColumn: 'signed_up_at',
        transform: IcebergPartitionTransform.DAY,
    };
    /// `customer_id` is partitioned via `bucket(8)` from step 3 onward,
    /// and removed in step 4. The transform deliberately targets a
    /// column that is NEVER dropped, so partition evolution proves out
    /// independently of column-drop semantics.
    const customerBucketPartition: IcebergPartitionField = {
        sourceColumn: 'customer_id',
        transform: IcebergPartitionTransform.bucket(8),
    };
    if (step === 1 || step === 2) {
        return [
            dayPartition,
        ];
    }
    if (step === 3) {
        return [
            dayPartition,
            customerBucketPartition,
        ];
    }
    /// Step 4: DROP the bucket partition on customer_id while keeping
    /// the column itself in the schema.
    return [
        dayPartition,
    ];
}
