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

function icebergInputAt(step: number | string) {
    const tables = synthAt(step).findResources('AWS::Glue::Table');
    return Object.values(tables)[0].Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput;
}

function fieldsAt(step: number | string): Array<{ Id: number; Name: string }> {
    const fields = icebergInputAt(step).Schema.Fields;
    return fields.map((field: { Id: number; Name: string }) => ({
        Id: field.Id,
        Name: field.Name,
    }));
}

function partitionsAt(step: number | string): Array<{ Name: string; FieldId: number }> {
    const fields = icebergInputAt(step).PartitionSpec.Fields;
    return fields.map((field: { Name: string; FieldId: number }) => ({
        Name: field.Name,
        FieldId: field.FieldId,
    }));
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
    it('step 1 has a single day(signed_up_at) partition pinned at 1000', () => {
        expect(partitionsAt(1)).toEqual([
            {
                Name: 'signed_up_at_day',
                FieldId: 1000,
            },
        ]);
    });

    it('step 2 keeps the single partition while ADDing the region column', () => {
        expect(partitionsAt(2)).toEqual([
            {
                Name: 'signed_up_at_day',
                FieldId: 1000,
            },
        ]);
    });

    it('step 3 ADDs a bucket(8)(customer_id) partition at fresh id 1001', () => {
        expect(partitionsAt(3)).toEqual([
            {
                Name: 'signed_up_at_day',
                FieldId: 1000,
            },
            {
                Name: 'customer_id_bucket',
                FieldId: 1001,
            },
        ]);
    });

    it('step 4 DROPs the customer_id partition (column stays in the schema)', () => {
        expect(partitionsAt(4)).toEqual([
            {
                Name: 'signed_up_at_day',
                FieldId: 1000,
            },
        ]);
    });

    it('step 5 CHANGEs the transform day -> month under a fresh id, never reusing 1000', () => {
        expect(partitionsAt(5)).toEqual([
            {
                Name: 'signed_up_at_month',
                FieldId: 1002,
            },
        ]);
    });
});

describe('IcebergEvolutionStack — identifier evolution', () => {
    function schemaAt(step: number): { IdentifierFieldIds: number[]; Fields: Array<Record<string, unknown>> } {
        return icebergInputAt(step).Schema;
    }

    it('step 5 identifies rows by customer_id, marked in its doc', () => {
        const schema = schemaAt(5);
        expect(schema.IdentifierFieldIds).toEqual([
            1,
        ]);
        expect(schema.Fields.map((field) => field.Doc)).toEqual([
            '(PK) Primary key.',
            undefined,
            undefined,
        ]);
    });

    it('step 6 moves the identifier to contact_email and changes nothing else', () => {
        const before = schemaAt(5);
        const after = schemaAt(6);
        expect(after.IdentifierFieldIds).toEqual([
            2,
        ]);
        expect(after.Fields.map((field) => field.Doc)).toEqual([
            'Primary key.',
            '(PK) ',
            undefined,
        ]);
        const shapeOf = (fields: Array<Record<string, unknown>>): unknown[] => fields.map((field) => [
            field.Id,
            field.Name,
            field.Type,
            field.Required,
        ]);
        expect(shapeOf(after.Fields)).toEqual(shapeOf(before.Fields));
        expect(partitionsAt(6)).toEqual(partitionsAt(5));
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
        expect(() => synthAt(99)).toThrow(/evolutionStep must be 1, 2, 3, 4, 5, or 6/);
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
