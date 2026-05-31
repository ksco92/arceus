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

    it('creates exactly three Glue tables', () => {
        template.resourceCountIs('AWS::Glue::Table', 3);
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
        template.resourceCountIs('AWS::LakeFormation::Permissions', 3);
        template.allResourcesProperties('AWS::LakeFormation::Permissions', {
            DataLakePrincipal: {
                DataLakePrincipalIdentifier: 'arn:aws:iam::123456789012:user/me',
            },
            Permissions: [
                'SELECT',
                'INSERT',
                'DELETE',
                'ALTER',
                'DESCRIBE',
            ],
        });
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
        template.hasOutput('GranteeRoleArnOutput', {});
        template.hasOutput('ImportedGranteeRoleArnOutput', {});
    });

    it('grantRead on the native table issues Glue + S3 list + S3 bucket + S3 object statements', () => {
        const policies = template.findResources('AWS::IAM::Policy');
        const policyEntries = Object.values(policies);
        const allActions = policyEntries
            .flatMap((policy) => (policy.Properties.PolicyDocument as {
                Statement: Array<{
                    Action: string | string[];
                }>;
            }).Statement)
            .flatMap((s) => (Array.isArray(s.Action) ? s.Action : [
                s.Action,
            ]));
        expect(allActions).toContain('glue:GetTable');
        expect(allActions).toContain('s3:ListBucket');
        expect(allActions).toContain('s3:GetBucketLocation');
        expect(allActions).toContain('s3:GetObject');
    });

    it('grantRead via the imported factory produces a separate IAM::Policy attached to ImportedGranteeRole', () => {
        const policies = template.findResources('AWS::IAM::Policy');
        const importedPolicyAttached = Object.values(policies).some((policy) => {
            const roles = (policy.Properties.Roles ?? []) as Array<unknown>;
            return roles.some((ref) => JSON.stringify(ref).includes('ImportedGranteeRole'));
        });
        expect(importedPolicyAttached).toBe(true);
    });
});
