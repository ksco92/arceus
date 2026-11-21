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
import {
    primitive,
} from './iceberg-type';

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Grant action sets

const READ_TABLE_ACTIONS = [
    'glue:BatchGetPartition',
    'glue:GetDatabase',
    'glue:GetPartition',
    'glue:GetPartitions',
    'glue:GetTable',
    'glue:GetTables',
    'glue:GetTableVersion',
    'glue:GetTableVersions',
];

const WRITE_TABLE_ACTIONS = [
    'glue:BatchCreatePartition',
    'glue:BatchDeletePartition',
    'glue:CreatePartition',
    'glue:DeletePartition',
    'glue:UpdatePartition',
    'glue:UpdateTable',
];

/// S3 actions that operate at the bucket level AND support the
/// `s3:prefix` request condition key (per the S3 docs). Granted on
/// the bucket ARN with a `StringLike s3:prefix = [<prefix>*, <prefix>]`
/// condition so the grantee can only list the table's own prefix.
const READ_S3_LIST_ACTIONS = [
    's3:ListBucket',
];

/// S3 actions that operate at the bucket level but DO NOT support
/// `s3:prefix`. Granted on the bucket ARN with no condition — adding
/// one would silently deny these actions at runtime even though they
/// appear in the policy document.
const READ_S3_BUCKET_ACTIONS = [
    's3:GetBucketLocation',
];

const WRITE_S3_BUCKET_ACTIONS = [
    's3:ListBucketMultipartUploads',
];

/// S3 actions that operate at the object level. Must be granted on
/// the `bucket/prefix*` ARN.
const READ_S3_OBJECT_ACTIONS = [
    's3:GetObject',
];

const WRITE_S3_OBJECT_ACTIONS = [
    's3:PutObject',
    's3:DeleteObject',
    's3:AbortMultipartUpload',
    's3:ListMultipartUploadParts',
];

/// KMS actions S3 needs on the table key: decrypt to read, a data key to write.
const READ_KEY_ACTIONS = [
    'kms:Decrypt',
];

const WRITE_KEY_ACTIONS = [
    'kms:Decrypt',
    'kms:GenerateDataKey',
];

/// KMS actions on the Data Catalog key, as the Glue encryption guide lists them for a caller.
const READ_CATALOG_KEY_ACTIONS = [
    'kms:Decrypt',
];

const WRITE_CATALOG_KEY_ACTIONS = [
    'kms:Decrypt',
    'kms:Encrypt',
    'kms:GenerateDataKey',
];

/**
 * The action lists one grant method issues.
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
    tableActions: READ_TABLE_ACTIONS,
    listActions: READ_S3_LIST_ACTIONS,
    bucketActions: READ_S3_BUCKET_ACTIONS,
    objectActions: READ_S3_OBJECT_ACTIONS,
    keyActions: READ_KEY_ACTIONS,
    catalogKeyActions: READ_CATALOG_KEY_ACTIONS,
};

export const WRITE_PROFILE: GrantProfile = {
    tableActions: WRITE_TABLE_ACTIONS,
    listActions: [],
    bucketActions: WRITE_S3_BUCKET_ACTIONS,
    objectActions: WRITE_S3_OBJECT_ACTIONS,
    keyActions: WRITE_KEY_ACTIONS,
    catalogKeyActions: WRITE_CATALOG_KEY_ACTIONS,
};

export const READ_WRITE_PROFILE: GrantProfile = {
    tableActions: [
        ...READ_TABLE_ACTIONS,
        ...WRITE_TABLE_ACTIONS,
    ],
    listActions: READ_S3_LIST_ACTIONS,
    bucketActions: [
        ...READ_S3_BUCKET_ACTIONS,
        ...WRITE_S3_BUCKET_ACTIONS,
    ],
    objectActions: [
        ...READ_S3_OBJECT_ACTIONS,
        ...WRITE_S3_OBJECT_ACTIONS,
    ],
    keyActions: WRITE_KEY_ACTIONS,
    catalogKeyActions: WRITE_CATALOG_KEY_ACTIONS,
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
    readonly objectArn: string;
    readonly prefixGlob: string;
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
        objectArn: `${bucketArn}/${location.key}*`,
        prefixGlob: `${location.key}*`,
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
 * Reads and checks every option before attaching anything. Returns the Glue grant.
 *
 * @internal
 */
export function grantSplit(
    grantee: IGrantable,
    profile: GrantProfile,
    context: GrantContext,
    options: IcebergTableGrantOptions | undefined,
): Grant {
    const {
        lakeFormationDataAccess, catalogEncryptionKey,
    } = options ?? {};
    const dataAccess = primitive('lakeFormationDataAccess', lakeFormationDataAccess, 'boolean', {
        optional: true,
    });
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
                        context.prefixGlob,
                        context.prefixGlob.replace(/\*$/, ''),
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
            context.objectArn,
        ],
    });
    context.encryptionKey?.grant(grantee, ...profile.keyActions);
    catalogEncryptionKey?.grant(grantee, ...profile.catalogKeyActions);
    if (dataAccess) {
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
