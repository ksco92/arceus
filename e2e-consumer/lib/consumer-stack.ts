import {
    RemovalPolicy,
    Stack,
    StackProps,
} from 'aws-cdk-lib';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    Construct,
} from 'constructs';
import {
    IcebergDataFormat,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

/**
 * Minimal consumer stack that exercises the public surface of
 * `cdk-glue-iceberg-table` as imported from npm. Synthesizes only;
 * never deployed by CI. The point is to fail synth if a refactor
 * of the construct changes the public shape in a breaking way.
 */
export class ConsumerStack extends Stack {
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);

        const bucket = new Bucket(this, 'WarehouseBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        const database = new Database(this, 'AnalyticsDatabase', {
            databaseName: 'analytics',
        });

        new IcebergTable(this, 'OrdersTable', {
            database,
            tableName: 'orders',
            location: `s3://${bucket.bucketName}/analytics/orders/`,
            comment: 'E2E-consumer orders table.',
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 2,
                },
                {
                    name: 'order_amount',
                    type: IcebergType.decimal(12, 2),
                    required: true,
                    id: 3,
                },
                {
                    name: 'placed_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 4,
                },
                {
                    name: 'tags',
                    type: IcebergType.list(IcebergType.STRING),
                    id: 5,
                },
                {
                    name: 'shipping_address',
                    type: IcebergType.struct([
                        {
                            name: 'city',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            name: 'country',
                            type: IcebergType.STRING,
                            required: true,
                        },
                    ]),
                    id: 6,
                },
                {
                    name: 'metadata',
                    type: IcebergType.map(IcebergType.STRING, IcebergType.STRING, false),
                    id: 7,
                },
            ],
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                },
                {
                    sourceColumn: 'customer_id',
                    transform: IcebergPartitionTransform.bucket(16),
                },
            ],
            sortOrder: [
                {
                    sourceColumn: 'placed_at',
                    direction: IcebergSortDirection.ASC,
                    nullOrder: IcebergNullOrder.NULLS_LAST,
                },
            ],
            identifierFieldNames: [
                'order_id',
            ],
            dataFormat: IcebergDataFormat.PARQUET,
            formatVersion: IcebergFormatVersion.V2,
            tableProperties: {
                'write.parquet.compression-codec': 'zstd',
            },
        });
    }
}
