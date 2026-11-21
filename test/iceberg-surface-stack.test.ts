import {
    App,
} from 'aws-cdk-lib';
import {
    Match,
    Template,
} from 'aws-cdk-lib/assertions';
import {
    IcebergSurfaceStack,
} from '../lib/iceberg-surface-stack';

function synth(): Template {
    const app = new App();
    const stack = new IcebergSurfaceStack(app, 'Surface', {
        env: {
            account: '123456789012',
            region: 'us-east-1',
        },
        importedDataLakeBucketName: 'data-lake-bucket-123456789012',
        importedDatabaseName: 'sample_database',
        principalArn: 'arn:aws:iam::123456789012:user/me',
    });
    return Template.fromStack(stack);
}

function tableNamed(template: Template, name: string): Record<string, unknown> {
    const tables = template.findResources('AWS::Glue::Table');
    for (const entry of Object.values(tables)) {
        const props = entry.Properties;
        if (props.Name === name) {
            return props.OpenTableFormatInput.IcebergInput.IcebergTableInput;
        }
    }
    throw new Error(`no table named ${name} in template`);
}

describe('IcebergSurfaceStack', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('creates exactly five Glue tables', () => {
        template.resourceCountIs('AWS::Glue::Table', 5);
    });

    it('creation_order_test has no partition spec, sort order or identifier fields', () => {
        const input = tableNamed(template, 'creation_order_test');
        expect([
            input.PartitionSpec,
            input.WriteOrder,
            (input.Schema as Record<string, unknown>).IdentifierFieldIds,
        ]).toEqual([
            undefined,
            undefined,
            undefined,
        ]);
    });

    it('transforms_test partitions by year, month, day, hour, bucket[8], truncate[4], identity', () => {
        const input = tableNamed(template, 'transforms_test');
        const fields = (input.PartitionSpec as { Fields: Array<{ Transform: string }> }).Fields;
        const transforms = fields.map((f) => f.Transform);
        expect(transforms).toEqual([
            'year',
            'month',
            'day',
            'hour',
            'bucket[8]',
            'truncate[4]',
            'identity',
        ]);
    });

    it('sorted_test renders the mixed-direction sort order in writeOrder', () => {
        const input = tableNamed(template, 'sorted_test');
        const fields = (input.WriteOrder as { Fields: Array<{ Direction: string; NullOrder: string }> }).Fields;
        expect(fields.map((f) => ({
            d: f.Direction,
            n: f.NullOrder,
        }))).toEqual([
            {
                d: 'asc',
                n: 'nulls-first',
            },
            {
                d: 'desc',
                n: 'nulls-last',
            },
            {
                d: 'desc',
                n: 'nulls-last',
            },
        ]);
    });

    it('nested_test declares list, struct, and map columns with stable ids', () => {
        const input = tableNamed(template, 'nested_test');
        const fields = (input.Schema as { Fields: Array<{ Name: string; Type: string }> }).Fields;
        const byName = new Map(fields.map((f) => [
            f.Name,
            f.Type,
        ]));
        const tagsType = byName.get('tags') ?? '';
        const profileType = byName.get('profile') ?? '';
        const attrsType = byName.get('attrs') ?? '';
        expect(tagsType).toContain('"type":"list"');
        expect(tagsType).toContain('"element":"string"');
        expect(profileType).toContain('"type":"struct"');
        expect(profileType).toContain('first_name');
        expect(profileType).toContain('last_name');
        expect(attrsType).toContain('"type":"map"');
        expect(attrsType).toContain('"key":"string"');
    });

    it('emits Lake-Formation table grants for the principal on every table', () => {
        const permissions = Object.values(template.findResources('AWS::LakeFormation::Permissions'))
            .map((r) => r.Properties)
            .filter((p) => p.DataLakePrincipal.DataLakePrincipalIdentifier === 'arn:aws:iam::123456789012:user/me');
        expect(permissions.map((p) => p.Resource.TableResource.Name)).toEqual([
            'transforms_test',
            'sorted_test',
            'nested_test',
            'creation_order_test',
            'grants_test',
        ]);
        expect(permissions.map((p) => p.Permissions)).toEqual(Array(5).fill([
            'SELECT',
            'INSERT',
            'DELETE',
            'ALTER',
            'DESCRIBE',
        ]));
    });

    it('creates two grantee roles, each trust-policied to the deployer principal', () => {
        template.resourceCountIs('AWS::IAM::Role', 2);
        template.allResourcesProperties('AWS::IAM::Role', {
            AssumeRolePolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Principal: {
                            AWS: 'arn:aws:iam::123456789012:user/me',
                        },
                    }),
                ]),
            }),
        });
    });

    it('outputs the two grantee role ARNs', () => {
        template.hasOutput('ReaderRoleArnOutput', {});
        template.hasOutput('ReadWriterRoleArnOutput', {});
    });

    it.each([
        [
            'ReaderRole',
            [
                'SELECT',
                'DESCRIBE',
            ],
        ],
        [
            'ReadWriterRole',
            [
                'SELECT',
                'INSERT',
                'DELETE',
                'ALTER',
                'DESCRIBE',
            ],
        ],
    ])('grants %s Lake Formation %s on grants_test', (role, permissions) => {
        template.hasResourceProperties('AWS::LakeFormation::Permissions', {
            DataLakePrincipal: {
                DataLakePrincipalIdentifier: {
                    'Fn::GetAtt': [
                        Match.stringLikeRegexp(`^${role}`),
                        'Arn',
                    ],
                },
            },
            Permissions: permissions,
            Resource: {
                TableResource: Match.objectLike({
                    Name: 'grants_test',
                }),
            },
        });
    });

    function grantPolicyStatements(role: string): Array<Record<string, unknown>> {
        const policy = Object.values(template.findResources('AWS::IAM::Policy')).find((p) => {
            const roles = p.Properties.Roles as Array<{ Ref: string }>;
            return roles.length === 1 && roles[0].Ref.startsWith(role);
        });
        return policy?.Properties.PolicyDocument.Statement;
    }

    it.each([
        [
            'ReaderRole',
            'kms:Decrypt',
            'kms:Decrypt',
        ],
        [
            'ReadWriterRole',
            [
                'kms:Decrypt',
                'kms:GenerateDataKey',
            ],
            [
                'kms:Decrypt',
                'kms:Encrypt',
                'kms:GenerateDataKey',
            ],
        ],
    ])('%s holds the table key, catalog key and GetDataAccess statements from its grant', (role, tableKeyActions, catalogKeyActions) => {
        expect(grantPolicyStatements(role).slice(-3)).toEqual([
            {
                Action: tableKeyActions,
                Effect: 'Allow',
                Resource: {
                    Ref: 'DataLakeKeyArn',
                },
            },
            {
                Action: catalogKeyActions,
                Effect: 'Allow',
                Resource: {
                    Ref: 'CatalogKeyArn',
                },
            },
            {
                Action: 'lakeformation:GetDataAccess',
                Effect: 'Allow',
                Resource: '*',
            },
        ]);
    });

    it('attaches the Athena query policy to both grantee roles', () => {
        const policy = Object.entries(template.findResources('AWS::IAM::Policy'))
            .find(([
                id,
            ]) => id.startsWith('AthenaQueryPolicy'))?.[1];
        expect((policy?.Properties.Roles as Array<{ Ref: string }>).map((r) => r.Ref.replace(/[0-9A-F]{8}$/, ''))).toEqual([
            'ReaderRole',
            'ReadWriterRole',
        ]);
    });
});
