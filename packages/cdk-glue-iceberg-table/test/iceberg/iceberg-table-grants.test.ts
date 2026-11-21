import {
    App,
    Stack,
} from 'aws-cdk-lib';
import {
    Template,
} from 'aws-cdk-lib/assertions';
import {
    CfnDatabase,
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    Grant,
    IGrantable,
    Role,
    ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
    CfnKey,
    IKey,
    Key,
} from 'aws-cdk-lib/aws-kms';
import {
    IcebergFormatVersion,
    IcebergTable,
    IcebergTableAttributes,
    IcebergTableGrantOptions,
    IcebergTableProps,
    IcebergType,
    IIcebergTable,
} from '../../lib/iceberg';
import {
    withGetter,
} from './read-once';

type Statement = Record<string, unknown>;
type GrantMethod = 'grantRead' | 'grantWrite' | 'grantReadWrite';
type Source = 'constructed' | 'imported';

const PARTITION = {
    Ref: 'AWS::Partition',
};
const CATALOG_KEY_ARN = 'arn:aws:kms:us-east-1:123456789012:key/catalog';
const OTHER_KEY_ARN = 'arn:aws:kms:us-east-1:123456789012:key/other';

function join(...parts: unknown[]): unknown {
    return {
        'Fn::Join': [
            '',
            parts,
        ],
    };
}

interface Fixture {
    readonly stack: Stack;
    readonly database: Database;
    readonly key: Key;
    readonly role: Role;
}

function fixture(): Fixture {
    const stack = new Stack(new App(), 'TestStack', {
        env: {
            account: '123456789012',
            region: 'us-east-1',
        },
    });
    return {
        stack,
        database: new Database(stack, 'TestDatabase', {
            databaseName: 'test_db',
        }),
        key: new Key(stack, 'TableKey'),
        role: new Role(stack, 'Grantee', {
            assumedBy: new ServicePrincipal('glue.amazonaws.com'),
        }),
    };
}

function table(f: Fixture, source: Source, encryptionKey?: IKey, location = 's3://my-bucket/path/simple/'): IIcebergTable {
    if (source === 'imported') {
        return IcebergTable.fromIcebergTableAttributes(f.stack, 'Imported', {
            database: f.database,
            tableName: 'simple',
            location,
            encryptionKey,
        });
    }
    return new IcebergTable(f.stack, 'Tbl', {
        database: f.database,
        tableName: 'simple',
        formatVersion: IcebergFormatVersion.V2,
        columns: [
            {
                name: 'id',
                type: IcebergType.LONG,
                id: 1,
            },
        ],
        location,
        encryptionKey,
    });
}

function statements(f: Fixture): Statement[] {
    const policies = Template.fromStack(f.stack).findResources('AWS::IAM::Policy');
    return Object.values(policies).flatMap((policy) => policy.Properties.PolicyDocument.Statement);
}

function databaseRef(f: Fixture): unknown {
    return {
        Ref: f.stack.getLogicalId(f.database.node.defaultChild as CfnDatabase),
    };
}

function keyArn(f: Fixture): unknown {
    return {
        'Fn::GetAtt': [
            f.stack.getLogicalId(f.key.node.defaultChild as CfnKey),
            'Arn',
        ],
    };
}

function glueStatement(f: Fixture, actions: string[]): Statement {
    return {
        Action: actions,
        Effect: 'Allow',
        Resource: [
            join('arn:', PARTITION, ':glue:us-east-1:123456789012:catalog'),
            join('arn:', PARTITION, ':glue:us-east-1:123456789012:database/', databaseRef(f)),
            join('arn:', PARTITION, ':glue:us-east-1:123456789012:table/', databaseRef(f), '/simple'),
        ],
    };
}

const BUCKET = join('arn:', PARTITION, ':s3:::my-bucket');
const LIST_STATEMENT = {
    Action: 's3:ListBucket',
    Condition: {
        StringLike: {
            's3:prefix': [
                'path/simple/*',
                'path/simple/',
            ],
        },
    },
    Effect: 'Allow',
    Resource: BUCKET,
};

function allow(action: string | string[], resource: unknown): Statement {
    return {
        Action: action,
        Effect: 'Allow',
        Resource: resource,
    };
}

const OBJECTS = join('arn:', PARTITION, ':s3:::my-bucket/path/simple/*');

const READ_GLUE = [
    'glue:BatchGetPartition',
    'glue:GetDatabase',
    'glue:GetPartition',
    'glue:GetPartitions',
    'glue:GetTable',
    'glue:GetTables',
    'glue:GetTableVersion',
    'glue:GetTableVersions',
];
const WRITE_GLUE = [
    'glue:BatchCreatePartition',
    'glue:BatchDeletePartition',
    'glue:CreatePartition',
    'glue:DeletePartition',
    'glue:UpdatePartition',
    'glue:UpdateTable',
];
const WRITE_OBJECT = [
    's3:PutObject',
    's3:DeleteObject',
    's3:AbortMultipartUpload',
    's3:ListMultipartUploadParts',
];

/** The S3 and Glue statements each method issues, in order. */
function baseStatements(f: Fixture, method: GrantMethod): Statement[] {
    switch (method) {
        case 'grantRead':
            return [
                glueStatement(f, READ_GLUE),
                LIST_STATEMENT,
                allow('s3:GetBucketLocation', BUCKET),
                allow('s3:GetObject', OBJECTS),
            ];
        case 'grantWrite':
            return [
                glueStatement(f, WRITE_GLUE),
                allow('s3:ListBucketMultipartUploads', BUCKET),
                allow(WRITE_OBJECT, OBJECTS),
            ];
        default:
            return [
                glueStatement(f, [
                    ...READ_GLUE,
                    ...WRITE_GLUE,
                ]),
                LIST_STATEMENT,
                allow([
                    's3:GetBucketLocation',
                    's3:ListBucketMultipartUploads',
                ], BUCKET),
                allow([
                    's3:GetObject',
                    ...WRITE_OBJECT,
                ], OBJECTS),
            ];
    }
}

const TABLE_KEY_ACTIONS: Record<GrantMethod, string | string[]> = {
    grantRead: 'kms:Decrypt',
    grantWrite: [
        'kms:Decrypt',
        'kms:GenerateDataKey',
    ],
    grantReadWrite: [
        'kms:Decrypt',
        'kms:GenerateDataKey',
    ],
};

const CATALOG_KEY_ACTIONS: Record<GrantMethod, string | string[]> = {
    grantRead: 'kms:Decrypt',
    grantWrite: [
        'kms:Decrypt',
        'kms:Encrypt',
        'kms:GenerateDataKey',
    ],
    grantReadWrite: [
        'kms:Decrypt',
        'kms:Encrypt',
        'kms:GenerateDataKey',
    ],
};

const GET_DATA_ACCESS = allow('lakeformation:GetDataAccess', '*');

function grant(t: IIcebergTable, method: GrantMethod, grantee: IGrantable, options?: IcebergTableGrantOptions): Grant {
    return t[method](grantee, options);
}

const METHODS: GrantMethod[] = [
    'grantRead',
    'grantWrite',
    'grantReadWrite',
];
const CASES = METHODS.flatMap((method) => ([
    'constructed',
    'imported',
] as Source[]).map((source): [GrantMethod, Source] => [
    method,
    source,
]));

describe('IcebergTable grants', () => {
    it.each(CASES)('%s on a %s table without a key or options issues the Glue and S3 statements', (method, source) => {
        const f = fixture();
        grant(table(f, source), method, f.role);
        expect(statements(f)).toEqual(baseStatements(f, method));
    });

    it.each(CASES)('%s on a %s table with encryptionKey adds the table key statement', (method, source) => {
        const f = fixture();
        grant(table(f, source, f.key), method, f.role);
        expect(statements(f)).toEqual([
            ...baseStatements(f, method),
            allow(TABLE_KEY_ACTIONS[method], keyArn(f)),
        ]);
    });

    it.each(CASES)('%s on a %s table with catalogEncryptionKey adds the catalog key statement', (method, source) => {
        const f = fixture();
        grant(table(f, source), method, f.role, {
            catalogEncryptionKey: Key.fromKeyArn(f.stack, 'CatalogKey', CATALOG_KEY_ARN),
        });
        expect(statements(f)).toEqual([
            ...baseStatements(f, method),
            allow(CATALOG_KEY_ACTIONS[method], CATALOG_KEY_ARN),
        ]);
    });

    it.each(CASES)('%s on a %s table with lakeFormationDataAccess adds GetDataAccess on *', (method, source) => {
        const f = fixture();
        grant(table(f, source), method, f.role, {
            lakeFormationDataAccess: true,
        });
        expect(statements(f)).toEqual([
            ...baseStatements(f, method),
            GET_DATA_ACCESS,
        ]);
    });

    it.each(CASES)('%s on a %s table with every key and option issues every statement', (method, source) => {
        const f = fixture();
        grant(table(f, source, f.key), method, f.role, {
            lakeFormationDataAccess: true,
            catalogEncryptionKey: Key.fromKeyArn(f.stack, 'CatalogKey', CATALOG_KEY_ARN),
        });
        expect(statements(f)).toEqual([
            ...baseStatements(f, method),
            allow(TABLE_KEY_ACTIONS[method], keyArn(f)),
            allow(CATALOG_KEY_ACTIONS[method], CATALOG_KEY_ARN),
            GET_DATA_ACCESS,
        ]);
    });

    it.each(METHODS)('%s with lakeFormationDataAccess false adds no statement', (method) => {
        const f = fixture();
        grant(table(f, 'constructed'), method, f.role, {
            lakeFormationDataAccess: false,
        });
        expect(statements(f)).toEqual(baseStatements(f, method));
    });

    it('rejects a lakeFormationDataAccess that is not a boolean', () => {
        const f = fixture();
        expect(() => table(f, 'constructed').grantRead(f.role, {
            lakeFormationDataAccess: 'yes' as unknown as boolean,
        })).toThrow('lakeFormationDataAccess must be a boolean, got string');
    });

    it('attaches no statement when an option is rejected', () => {
        const f = fixture();
        const t = table(f, 'constructed', f.key);
        expect(() => t.grantReadWrite(f.role, {
            catalogEncryptionKey: Key.fromKeyArn(f.stack, 'CatalogKey', CATALOG_KEY_ARN),
            lakeFormationDataAccess: 'yes' as unknown as boolean,
        })).toThrow('lakeFormationDataAccess must be a boolean, got string');
        expect(statements(f)).toEqual([]);
    });

    it('leaves the key policy of an in-stack encryptionKey unchanged', () => {
        const f = fixture();
        table(f, 'constructed', f.key).grantReadWrite(f.role);
        const keys = Template.fromStack(f.stack).findResources('AWS::KMS::Key');
        expect(Object.values(keys)[0].Properties.KeyPolicy.Statement).toHaveLength(1);
    });

    it('sets the s3:prefix glob to "*" for a bucket-root location', () => {
        const f = fixture();
        table(f, 'constructed', undefined, 's3://my-bucket').grantRead(f.role);
        const list = statements(f).find((s) => s.Action === 's3:ListBucket');
        expect(list?.Condition).toEqual({
            StringLike: {
                's3:prefix': [
                    '*',
                    '',
                ],
            },
        });
    });
});

describe('IcebergTable grants read each caller value once', () => {
    const otherKey = (f: Fixture): IKey => Key.fromKeyArn(f.stack, 'Other', OTHER_KEY_ARN);

    it('exposes and grants on the props.encryptionKey that was read once', () => {
        const f = fixture();
        const t = new IcebergTable(f.stack, 'Tbl', withGetter({
            database: f.database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    id: 1,
                },
            ],
            location: 's3://my-bucket/path/simple/',
        }, 'encryptionKey', f.key, otherKey(f)) as IcebergTableProps);
        t.grantRead(f.role);
        expect(t.encryptionKey).toBe(f.key);
        expect(statements(f).at(-1)).toEqual(allow('kms:Decrypt', keyArn(f)));
    });

    it('exposes and grants on the attrs.encryptionKey that was read once', () => {
        const f = fixture();
        const t = IcebergTable.fromIcebergTableAttributes(f.stack, 'Imported', withGetter({
            database: f.database,
            tableName: 'simple',
            location: 's3://my-bucket/path/simple/',
        }, 'encryptionKey', f.key, otherKey(f)) as IcebergTableAttributes);
        t.grantRead(f.role);
        expect(t.encryptionKey).toBe(f.key);
        expect(statements(f).at(-1)).toEqual(allow('kms:Decrypt', keyArn(f)));
    });

    it.each([
        'constructed',
        'imported',
    ] as Source[])('a %s table without encryptionKey exposes none', (source) => {
        expect(table(fixture(), source).encryptionKey).toBeUndefined();
    });

    it('grants on the catalogEncryptionKey that was read once', () => {
        const f = fixture();
        table(f, 'constructed').grantRead(f.role, withGetter({}, 'catalogEncryptionKey', Key.fromKeyArn(f.stack, 'CatalogKey', CATALOG_KEY_ARN), otherKey(f)));
        expect(statements(f).at(-1)).toEqual(allow('kms:Decrypt', CATALOG_KEY_ARN));
    });

    it.each([
        [
            true,
            false,
            [
                GET_DATA_ACCESS,
            ],
        ],
        [
            false,
            true,
            [],
        ],
    ])('acts on the lakeFormationDataAccess %s that was read once', (first, rest, added) => {
        const f = fixture();
        table(f, 'constructed').grantRead(f.role, withGetter({}, 'lakeFormationDataAccess', first, rest));
        expect(statements(f)).toEqual([
            ...baseStatements(f, 'grantRead'),
            ...added,
        ]);
    });
});
