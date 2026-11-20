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

export const READ_TABLE_ACTIONS = [
    'glue:BatchGetPartition',
    'glue:GetDatabase',
    'glue:GetPartition',
    'glue:GetPartitions',
    'glue:GetTable',
    'glue:GetTables',
    'glue:GetTableVersion',
    'glue:GetTableVersions',
];

export const WRITE_TABLE_ACTIONS = [
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
export const READ_S3_LIST_ACTIONS = [
    's3:ListBucket',
];

/// S3 actions that operate at the bucket level but DO NOT support
/// `s3:prefix`. Granted on the bucket ARN with no condition — adding
/// one would silently deny these actions at runtime even though they
/// appear in the policy document.
export const READ_S3_BUCKET_ACTIONS = [
    's3:GetBucketLocation',
];

export const WRITE_S3_BUCKET_ACTIONS = [
    's3:ListBucketMultipartUploads',
];

/// S3 actions that operate at the object level. Must be granted on
/// the `bucket/prefix*` ARN.
export const READ_S3_OBJECT_ACTIONS = [
    's3:GetObject',
];

export const WRITE_S3_OBJECT_ACTIONS = [
    's3:PutObject',
    's3:DeleteObject',
    's3:AbortMultipartUpload',
    's3:ListMultipartUploadParts',
];

/// KMS actions on the table's `encryptionKey`: S3 decrypts with the
/// caller's `kms:Decrypt` on GetObject and multipart uploads, and
/// encrypts a new object with `kms:GenerateDataKey`, never `kms:Encrypt`.
export const READ_KEY_ACTIONS = [
    'kms:Decrypt',
];

export const WRITE_KEY_ACTIONS = [
    'kms:Decrypt',
    'kms:GenerateDataKey',
];

/// KMS actions on the Data Catalog key, as the Glue encryption guide lists them for a caller.
export const READ_CATALOG_KEY_ACTIONS = [
    'kms:Decrypt',
];

export const WRITE_CATALOG_KEY_ACTIONS = [
    'kms:Decrypt',
    'kms:Encrypt',
    'kms:GenerateDataKey',
];

/** Options for `grantRead`, `grantWrite` and `grantReadWrite` on an Iceberg table. */
export interface IcebergTableGrantOptions {
    /**
     * Add `lakeformation:GetDataAccess` on `*`, which Athena needs to read a
     * table whose location is registered with Lake Formation. The action
     * takes no resource narrower than `*`. The Lake Formation permissions
     * themselves are not created. Defaults to `false`.
     */
    readonly lakeFormationDataAccess?: boolean;

    /**
     * KMS key the account's Data Catalog is encrypted with (`SSE-KMS`).
     * Read grants add `kms:Decrypt` on it; write grants add `kms:Decrypt`,
     * `kms:Encrypt` and `kms:GenerateDataKey`. Leave unset when the catalog
     * is not encrypted or delegates KMS to a service role.
     */
    readonly catalogEncryptionKey?: IKey;
}

/**
 * Issue the policy statements that scope an Iceberg-table grant
 * correctly: Glue actions on the catalog, database and table ARNs,
 * S3 list-bucket actions on the bucket ARN with an `s3:prefix` condition so only the
 * table's own prefix can be listed, S3 bucket-level actions that DO
 * NOT support the `s3:prefix` condition (e.g. `GetBucketLocation`,
 * `ListBucketMultipartUploads`) on the bucket ARN with no condition
 * — including them in the conditioned statement would silently deny
 * them at runtime — and S3 object-level actions on the
 * `bucket/prefix*` ARN; then KMS actions on the table's key and the
 * catalog key when given, and `lakeformation:GetDataAccess` when asked.
 * Returns the Glue grant (any one is sufficient for the `Grant` API
 * contract; the rest attach as side effects). Reads each option once.
 *
 * @internal
 */
export function grantSplit(
    grantee: IGrantable,
    args: {
        catalogArn: string;
        databaseArn: string;
        tableArn: string;
        bucketArn: string;
        objectArn: string;
        prefixGlob: string;
        tableActions: string[];
        listActions: string[];
        bucketActions: string[];
        objectActions: string[];
        encryptionKey?: IKey;
        keyActions: string[];
        catalogKeyActions: string[];
    },
    options: IcebergTableGrantOptions | undefined,
): Grant {
    const {
        lakeFormationDataAccess, catalogEncryptionKey,
    } = options ?? {};
    const tableGrant = Grant.addToPrincipal({
        grantee,
        actions: args.tableActions,
        resourceArns: [
            args.catalogArn,
            args.databaseArn,
            args.tableArn,
        ],
    });
    if (args.listActions.length > 0) {
        Grant.addToPrincipal({
            grantee,
            actions: args.listActions,
            resourceArns: [
                args.bucketArn,
            ],
            conditions: {
                StringLike: {
                    's3:prefix': [
                        args.prefixGlob,
                        args.prefixGlob.replace(/\*$/, ''),
                    ],
                },
            },
        });
    }
    Grant.addToPrincipal({
        grantee,
        actions: args.bucketActions,
        resourceArns: [
            args.bucketArn,
        ],
    });
    Grant.addToPrincipal({
        grantee,
        actions: args.objectActions,
        resourceArns: [
            args.objectArn,
        ],
    });
    args.encryptionKey?.grant(grantee, ...args.keyActions);
    catalogEncryptionKey?.grant(grantee, ...args.catalogKeyActions);
    if (primitive('lakeFormationDataAccess', lakeFormationDataAccess, 'boolean', {
        optional: true,
    })) {
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
