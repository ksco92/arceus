import {
    Grant,
    IGrantable,
} from 'aws-cdk-lib/aws-iam';

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Grant action sets

export const READ_TABLE_ACTIONS = [
    'glue:BatchGetPartition',
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

/**
 * Issue the four policy statements that scope an Iceberg-table grant
 * correctly: Glue actions on the table ARN, S3 list-bucket actions
 * on the bucket ARN with an `s3:prefix` condition so only the
 * table's own prefix can be listed, S3 bucket-level actions that DO
 * NOT support the `s3:prefix` condition (e.g. `GetBucketLocation`,
 * `ListBucketMultipartUploads`) on the bucket ARN with no condition
 * — including them in the conditioned statement would silently deny
 * them at runtime — and S3 object-level actions on the
 * `bucket/prefix*` ARN. Returns the table-actions grant (any of the
 * four is sufficient for the `Grant` API contract; the rest attach
 * as side effects).
 *
 * @internal
 */
export function grantSplit(
    grantee: IGrantable,
    args: {
        tableArn: string;
        bucketArn: string;
        objectArn: string;
        prefixGlob: string;
        tableActions: string[];
        listActions: string[];
        bucketActions: string[];
        objectActions: string[];
    },
): Grant {
    const tableGrant = Grant.addToPrincipal({
        grantee,
        actions: args.tableActions,
        resourceArns: [
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
    if (args.bucketActions.length > 0) {
        Grant.addToPrincipal({
            grantee,
            actions: args.bucketActions,
            resourceArns: [
                args.bucketArn,
            ],
        });
    }
    Grant.addToPrincipal({
        grantee,
        actions: args.objectActions,
        resourceArns: [
            args.objectArn,
        ],
    });
    return tableGrant;
}
