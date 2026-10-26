import {
    App,
} from 'aws-cdk-lib';
import {
    Template,
} from 'aws-cdk-lib/assertions';
import {
    IcebergV3EvolutionStack,
} from '../lib/iceberg-v3-evolution-stack';

function newStack(context?: Record<string, unknown>): IcebergV3EvolutionStack {
    return new IcebergV3EvolutionStack(new App({
        context,
    }), 'V3Evo', {
        env: {
            account: '123456789012',
            region: 'us-east-1',
        },
        importedDataLakeBucketName: 'data-lake-bucket-123456789012',
        importedDatabaseName: 'sample_database',
        principalArn: 'arn:aws:iam::123456789012:user/me',
    });
}

function icebergInputAt(step: number | string) {
    const template = Template.fromStack(newStack({
        v3EvolutionStep: step,
    }));
    const table = Object.values(template.findResources('AWS::Glue::Table'))[0];
    return table.Properties.OpenTableFormatInput.IcebergInput;
}

function columnsAt(step: number): string[] {
    return icebergInputAt(step).IcebergTableInput.Schema.Fields.map(
        (field: { Id: number; Name: string; Type: string }) => `${field.Id}:${field.Name}:${field.Type}`,
    );
}

function partitionsAt(step: number): string[] {
    return icebergInputAt(step).IcebergTableInput.PartitionSpec.Fields.map(
        (field: { FieldId: number; Name: string; Transform: string }) => `${field.FieldId}:${field.Name}:${field.Transform}`,
    );
}

const step1Columns = [
    '1:event_id:long',
    '2:occurred_at:timestamp_ns',
    '3:received_at:timestamptz_ns',
    '4:raw:unknown',
    '5:event_date:date',
];

describe('IcebergV3EvolutionStack — schema', () => {
    it('step 1 renders the v3 type strings', () => {
        expect(columnsAt(1)).toEqual(step1Columns);
    });

    it('step 1 declares format version 3', () => {
        const input = icebergInputAt(1);
        expect(input.Version).toBe('3');
        expect(input.IcebergTableInput.Properties['format-version']).toBe('3');
    });

    it('step 2 adds source under a fresh id', () => {
        expect(columnsAt(2)).toEqual([
            ...step1Columns,
            '6:source:string',
        ]);
    });

    it('step 3 promotes raw and event_date keeping their ids', () => {
        expect(columnsAt(3)).toEqual([
            '1:event_id:long',
            '2:occurred_at:timestamp_ns',
            '3:received_at:timestamptz_ns',
            '4:raw:string',
            '5:event_date:timestamp',
            '6:source:string',
        ]);
    });

    it('step 4 keeps the step 3 schema', () => {
        expect(columnsAt(4)).toEqual(columnsAt(3));
    });
});

describe('IcebergV3EvolutionStack — partition spec', () => {
    it('step 1 has day(occurred_at) at 1000', () => {
        expect(partitionsAt(1)).toEqual([
            '1000:occurred_at_day:day',
        ]);
    });

    it('step 2 adds hour(received_at) at 1001', () => {
        expect(partitionsAt(2)).toEqual([
            '1000:occurred_at_day:day',
            '1001:received_at_hour:hour',
        ]);
    });

    it('step 3 keeps the step 2 spec', () => {
        expect(partitionsAt(3)).toEqual(partitionsAt(2));
    });

    it('step 4 replaces day with month under fresh id 1002', () => {
        expect(partitionsAt(4)).toEqual([
            '1002:occurred_at_month:month',
            '1001:received_at_hour:hour',
        ]);
    });
});

describe('IcebergV3EvolutionStack — wiring', () => {
    it('defaults to step 1 without context', () => {
        Template.fromStack(newStack()).hasOutput('V3EvolutionStepOutput', {
            Value: '1',
        });
    });

    it('rejects an out-of-range step', () => {
        expect(() => newStack({
            v3EvolutionStep: 5,
        })).toThrow(/v3EvolutionStep must be 1, 2, 3, or 4/);
    });

    it('grants the principal table permissions', () => {
        const template = Template.fromStack(newStack());
        const permission = Object.values(template.findResources('AWS::LakeFormation::Permissions'))[0];
        expect(permission.Properties.Permissions).toEqual([
            'SELECT',
            'INSERT',
            'DELETE',
            'ALTER',
            'DESCRIBE',
        ]);
        expect(JSON.stringify(permission.Properties.DataLakePrincipal)).toContain('user/me');
    });
});
