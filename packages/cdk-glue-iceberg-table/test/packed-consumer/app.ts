import {
    App,
    Stack,
} from 'aws-cdk-lib';
import {
    Template,
} from 'aws-cdk-lib/assertions';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergFormatVersion,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

const app = new App();
const stack = new Stack(app, 'PackedConsumer');
new IcebergTable(stack, 'Orders', {
    database: new Database(stack, 'Db', {
        databaseName: 'analytics',
    }),
    tableName: 'orders',
    location: 's3://warehouse/analytics/orders/',
    columns: [
        {
            name: 'order_id',
            type: IcebergType.LONG,
            required: true,
            id: 1,
        },
        {
            name: 'placed_at',
            type: IcebergType.TIMESTAMPTZ,
            required: true,
            id: 2,
        },
    ],
    formatVersion: IcebergFormatVersion.V2,
    partitionSpec: [
        {
            sourceColumn: 'placed_at',
            transform: IcebergPartitionTransform.DAY,
            fieldId: 1000,
        },
    ],
});

Template.fromStack(stack).resourceCountIs('AWS::Glue::Table', 1);
