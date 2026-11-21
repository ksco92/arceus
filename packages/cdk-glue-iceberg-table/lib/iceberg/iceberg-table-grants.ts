import {
    Stack,
} from 'aws-cdk-lib';
import {
    IDatabase,
} from 'aws-cdk-lib/aws-glue';
import {
    Grant,
    IGrantable,
} from 'aws-cdk-lib/aws-iam';
import {
    IKey,
} from 'aws-cdk-lib/aws-kms';

/**
 * The action lists one grant method issues.
 *
 * `listActions` support the `s3:prefix` condition key and are granted on the bucket ARN
 * limited to the table's prefix; `bucketActions` do not support it and get no condition;
 * `objectActions` are granted on `bucket/prefix*`.
 *
 * @internal
 */
export interface GrantProfile {
    readonly tableActions: string[];
    readonly listActions: string[];
    readonly bucketActions: string[];
    readonly objectActions: string[];
    readonly keyActions: string[];
    readonly catalogKeyActions: string[];
}

export const READ_PROFILE: GrantProfile = {
    tableActions: [
        'glue:BatchGetPartition',
        'glue:GetDatabase',
        'glue:GetPartition',
        'glue:GetPartitions',
        'glue:GetTable',
        'glue:GetTables',
        'glue:GetTableVersion',
        'glue:GetTableVersions',
    ],
    listActions: [
        's3:ListBucket',
    ],
    bucketActions: [
        's3:GetBucketLocation',
    ],
    objectActions: [
        's3:GetObject',
    ],
    keyActions: [
        'kms:Decrypt',
    ],
    catalogKeyActions: [
        'kms:Decrypt',
    ],
};

export const WRITE_PROFILE: GrantProfile = {
    tableActions: [
        'glue:BatchCreatePartition',
        'glue:BatchDeletePartition',
        'glue:CreatePartition',
        'glue:DeletePartition',
        'glue:UpdatePartition',
        'glue:UpdateTable',
    ],
    listActions: [],
    bucketActions: [
        's3:ListBucketMultipartUploads',
    ],
    objectActions: [
        's3:PutObject',
        's3:DeleteObject',
        's3:AbortMultipartUpload',
        's3:ListMultipartUploadParts',
    ],
    keyActions: [
        'kms:Decrypt',
        'kms:GenerateDataKey',
    ],
    catalogKeyActions: [
        'kms:Decrypt',
        'kms:Encrypt',
        'kms:GenerateDataKey',
    ],
};

export const READ_WRITE_PROFILE: GrantProfile = {
    tableActions: [
        ...READ_PROFILE.tableActions,
        ...WRITE_PROFILE.tableActions,
    ],
    listActions: [
        ...READ_PROFILE.listActions,
        ...WRITE_PROFILE.listActions,
    ],
    bucketActions: [
        ...READ_PROFILE.bucketActions,
        ...WRITE_PROFILE.bucketActions,
    ],
    objectActions: [
        ...READ_PROFILE.objectActions,
        ...WRITE_PROFILE.objectActions,
    ],
    keyActions: [
        ...READ_PROFILE.keyActions,
        ...WRITE_PROFILE.keyActions,
    ],
    catalogKeyActions: [
        ...READ_PROFILE.catalogKeyActions,
        ...WRITE_PROFILE.catalogKeyActions,
    ],
};

/**
 * The resources one table's grants name.
 *
 * @internal
 */
export interface GrantContext {
    readonly catalogArn: string;
    readonly databaseArn: string;
    readonly tableArn: string;
    readonly bucketArn: string;
    readonly prefix: string;
    readonly encryptionKey?: IKey;
}

/**
 * The grant resources of the table `tableName` in `database`, stored under `bucket`/`key`.
 * With `catalogId` set, the catalog, database and table ARNs all carry that account and the
 * database ARN is built from `database.databaseName`; otherwise they use the stack's account
 * and the database's own ARN.
 *
 * @internal
 */
export function grantContext(
    stack: Stack,
    database: IDatabase,
    tableName: string,
    catalogId: string | undefined,
    location: { bucket: string; key: string },
    encryptionKey: IKey | undefined,
): GrantContext {
    const bucketArn = `arn:${stack.partition}:s3:::${location.bucket}`;
    return {
        catalogArn: stack.formatArn({
            service: 'glue',
            resource: 'catalog',
            account: catalogId,
        }),
        databaseArn: catalogId === undefined
            ? database.databaseArn
            : stack.formatArn({
                service: 'glue',
                resource: 'database',
                resourceName: database.databaseName,
                account: catalogId,
            }),
        tableArn: stack.formatArn({
            service: 'glue',
            resource: 'table',
            account: catalogId,
            resourceName: `${database.databaseName}/${tableName}`,
        }),
        bucketArn,
        prefix: location.key,
        encryptionKey,
    };
}

/** Options for `grantRead`, `grantWrite` and `grantReadWrite` on an Iceberg table. */
export interface IcebergTableGrantOptions {
    /**
     * Add `lakeformation:GetDataAccess` on `*`, which Athena needs to read a
     * table whose location is registered with Lake Formation. The Lake
     * Formation permissions themselves are not created. Defaults to `false`.
     */
    readonly lakeFormationDataAccess?: boolean;

    /**
     * KMS key the account's Data Catalog is encrypted with (`SSE-KMS`).
     * Read grants add `kms:Decrypt`; write grants add `kms:Decrypt`,
     * `kms:Encrypt` and `kms:GenerateDataKey`, on the whole key.
     */
    readonly catalogEncryptionKey?: IKey;
}

/**
 * Attach `profile`'s statements for the table in `context` to `grantee`, in order:
 * Glue, S3 list, S3 bucket, S3 object, table key, catalog key, Lake Formation.
 * Returns the Glue grant.
 *
 * @internal
 */
export function grantProfile(
    grantee: IGrantable,
    profile: GrantProfile,
    context: GrantContext,
    options: IcebergTableGrantOptions | undefined,
): Grant {
    const {
        lakeFormationDataAccess, catalogEncryptionKey,
    } = options ?? {};
    const tableGrant = Grant.addToPrincipal({
        grantee,
        actions: profile.tableActions,
        resourceArns: [
            context.catalogArn,
            context.databaseArn,
            context.tableArn,
        ],
    });
    if (profile.listActions.length > 0) {
        Grant.addToPrincipal({
            grantee,
            actions: profile.listActions,
            resourceArns: [
                context.bucketArn,
            ],
            conditions: {
                StringLike: {
                    's3:prefix': [
                        `${context.prefix}*`,
                        context.prefix,
                    ],
                },
            },
        });
    }
    Grant.addToPrincipal({
        grantee,
        actions: profile.bucketActions,
        resourceArns: [
            context.bucketArn,
        ],
    });
    Grant.addToPrincipal({
        grantee,
        actions: profile.objectActions,
        resourceArns: [
            `${context.bucketArn}/${context.prefix}*`,
        ],
    });
    context.encryptionKey?.grant(grantee, ...profile.keyActions);
    catalogEncryptionKey?.grant(grantee, ...profile.catalogKeyActions);
    if (lakeFormationDataAccess) {
        Grant.addToPrincipal({
            grantee,
            actions: [
                'lakeformation:GetDataAccess',
            ],
            resourceArns: [
                '*',
            ],
        });
    }
    return tableGrant;
}
