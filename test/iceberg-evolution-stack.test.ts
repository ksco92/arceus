import {
    App,
} from 'aws-cdk-lib';
import {
    Template,
} from 'aws-cdk-lib/assertions';
import {
    IcebergEvolutionStack,
} from '../lib/iceberg-evolution-stack';

function synthAt(step: number | string): Template {
    const app = new App({
        context: {
            evolutionStep: step,
        },
    });
    const stack = new IcebergEvolutionStack(app, 'Evo', {
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

function fieldsAt(step: number | string): Array<{ Id: number; Name: string }> {
    const template = synthAt(step);
    const tables = template.findResources('AWS::Glue::Table');
    const props = Object.values(tables)[0].Properties;
    const fields = props.OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields;
    return fields.map((field: { Id: number; Name: string }) => ({
        Id: field.Id,
        Name: field.Name,
    }));
}

function partitionsAt(step: number | string): string[] {
    const template = synthAt(step);
    const tables = template.findResources('AWS::Glue::Table');
    const props = Object.values(tables)[0].Properties;
    const fields = props.OpenTableFormatInput.IcebergInput.IcebergTableInput.PartitionSpec.Fields;
    return fields.map((field: { Name: string }) => field.Name);
}

describe('IcebergEvolutionStack — schema evolution', () => {
    it('step 1 emits the baseline three columns', () => {
        expect(fieldsAt(1)).toEqual([
            {
                Id: 1,
                Name: 'customer_id',
            },
            {
                Id: 2,
                Name: 'email',
            },
            {
                Id: 3,
                Name: 'signed_up_at',
            },
        ]);
    });

    it('step 2 ADDs region with a fresh id (4) without disturbing existing ids', () => {
        expect(fieldsAt(2)).toEqual([
            {
                Id: 1,
                Name: 'customer_id',
            },
            {
                Id: 2,
                Name: 'email',
            },
            {
                Id: 3,
                Name: 'signed_up_at',
            },
            {
                Id: 4,
                Name: 'region',
            },
        ]);
    });

    it('step 3 RENAMEs email -> contact_email while pinning id 2', () => {
        expect(fieldsAt(3)).toEqual([
            {
                Id: 1,
                Name: 'customer_id',
            },
            {
                Id: 2,
                Name: 'contact_email',
            },
            {
                Id: 3,
                Name: 'signed_up_at',
            },
            {
                Id: 4,
                Name: 'region',
            },
        ]);
    });

    it('step 4 DROPs region; id 4 disappears from the field list (retires)', () => {
        const fields = fieldsAt(4);
        expect(fields.map((field) => field.Id)).toEqual([
            1,
            2,
            3,
        ]);
        expect(fields.map((field) => field.Name)).not.toContain('region');
    });
});

describe('IcebergEvolutionStack — partition evolution', () => {
    it('step 1 has a single day(signed_up_at) partition', () => {
        expect(partitionsAt(1)).toEqual([
            'signed_up_at_day',
        ]);
    });

    it('step 2 keeps the single partition while ADDing the region column', () => {
        expect(partitionsAt(2)).toEqual([
            'signed_up_at_day',
        ]);
    });

    it('step 3 ADDs a bucket(8)(customer_id) partition during the rename', () => {
        expect(partitionsAt(3)).toEqual([
            'signed_up_at_day',
            'customer_id_bucket',
        ]);
    });

    it('step 4 DROPs the customer_id partition (column stays in the schema)', () => {
        expect(partitionsAt(4)).toEqual([
            'signed_up_at_day',
        ]);
    });
});

describe('IcebergEvolutionStack — wiring', () => {
    it('defaults to step 1 when no context is provided', () => {
        const app = new App();
        const stack = new IcebergEvolutionStack(app, 'Evo', {
            env: {
                account: '123456789012',
                region: 'us-east-1',
            },
            importedDataLakeBucketName: 'data-lake-bucket-123456789012',
            importedDatabaseName: 'sample_database',
            principalArn: 'arn:aws:iam::123456789012:user/me',
        });
        const template = Template.fromStack(stack);
        template.hasOutput('EvolutionStepOutput', {
            Value: '1',
        });
    });

    it('rejects an out-of-range step', () => {
        expect(() => synthAt(99)).toThrow(/evolutionStep must be 1, 2, 3, or 4/);
    });

    it('grants the developer IAM user SELECT/INSERT/DELETE/ALTER/DESCRIBE on the table', () => {
        const template = synthAt(1);
        const permissions = template.findResources('AWS::LakeFormation::Permissions');
        const permission = Object.values(permissions)[0];
        expect(permission.Properties.Permissions).toEqual(expect.arrayContaining([
            'SELECT',
            'INSERT',
            'DELETE',
            'ALTER',
            'DESCRIBE',
        ]));
        /// Partition is a CFN intrinsic; resolve to JSON and assert
        /// the user-name + account literals end up in the identifier.
        const identifier = JSON.stringify(permission.Properties.DataLakePrincipal.DataLakePrincipalIdentifier);
        expect(identifier).toContain('iam::123456789012:user/me');
    });
});
