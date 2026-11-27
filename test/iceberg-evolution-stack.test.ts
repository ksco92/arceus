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

function icebergInputAt(step: number | string, tableName = 'evolution_test') {
    const tables = Object.values(synthAt(step).findResources('AWS::Glue::Table'));
    const table = tables.find((resource) => resource.Properties.Name === tableName);
    return table!.Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput;
}

function fieldsAt(step: number | string, tableName = 'evolution_test'): Array<{ Id: number; Name: string }> {
    const fields = icebergInputAt(step, tableName).Schema.Fields;
    return fields.map((field: { Id: number; Name: string }) => ({
        Id: field.Id,
        Name: field.Name,
    }));
}

function partitionsAt(step: number | string, tableName = 'evolution_test'): Array<{ Name: string; FieldId: number }> {
    const fields = icebergInputAt(step, tableName).PartitionSpec.Fields;
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

function nestedFieldsAt(step: number): Array<{ Id: number; Name: string; Type: unknown }> {
    return icebergInputAt(step, 'nested_evolution_test').Schema.Fields.map((field: { Id: number; Name: string; Type: string }) => ({
        Id: field.Id,
        Name: field.Name,
        Type: field.Type.startsWith('{') ? JSON.parse(field.Type) : field.Type,
    }));
}

describe('IcebergEvolutionStack — nested evolution', () => {
    const structField = (id: number, name: string) => ({
        id,
        name,
        required: false,
        type: 'string',
    });
    const baseline = [
        {
            Id: 1,
            Name: 'id',
            Type: 'long',
        },
        {
            Id: 2,
            Name: 'tags',
            Type: {
                type: 'list',
                'element-id': 5,
                'element-required': false,
                element: 'string',
            },
        },
        {
            Id: 3,
            Name: 'attrs',
            Type: {
                type: 'map',
                'key-id': 6,
                key: 'string',
                'value-id': 7,
                'value-required': false,
                value: 'string',
            },
        },
        {
            Id: 4,
            Name: 'addr',
            Type: {
                type: 'struct',
                fields: [
                    structField(8, 'line1'),
                    structField(9, 'city'),
                ],
            },
        },
    ];
    const withNote = [
        ...baseline,
        {
            Id: 10,
            Name: 'note',
            Type: 'string',
        },
    ];
    const withZip = withNote.map((field) => (field.Name === 'addr' ? {
        ...field,
        Type: {
            type: 'struct',
            fields: [
                structField(8, 'line1'),
                structField(11, 'zip'),
                structField(9, 'city'),
            ],
        },
    } : field));

    it.each([
        1,
        2,
        3,
        4,
        5,
        6,
    ])('step %i renders the baseline nested table', (step) => {
        expect(nestedFieldsAt(step)).toEqual(baseline);
    });

    it.each([
        [
            7,
            withNote,
        ],
        [
            8,
            withZip,
        ],
    ])('step %i renders the nested table with its added field', (step, expected) => {
        expect(nestedFieldsAt(step)).toEqual(expected);
    });

    it('steps 7 and 8 leave the evolution_test table at its step 6 shape', () => {
        expect(icebergInputAt(7)).toEqual(icebergInputAt(6));
        expect(icebergInputAt(8)).toEqual(icebergInputAt(6));
    });
});

describe('IcebergEvolutionStack — property, sort order and rollback steps', () => {
    function without(input: Record<string, unknown>, key: string): Record<string, unknown> {
        const rest = {
            ...input,
        };
        delete rest[key];
        return rest;
    }

    it('step 9 adds commit.retry.num-retries and changes nothing else', () => {
        expect(icebergInputAt(8).Properties['commit.retry.num-retries']).toBeUndefined();
        expect(icebergInputAt(9).Properties['commit.retry.num-retries']).toBe('5');
        expect(without(icebergInputAt(9), 'Properties')).toEqual(without(icebergInputAt(8), 'Properties'));
        expect(without(icebergInputAt(9).Properties, 'commit.retry.num-retries')).toEqual(icebergInputAt(8).Properties);
    });

    it.each([
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
    ])('step %i keeps the step 1 write order', (step) => {
        expect(icebergInputAt(step).WriteOrder).toEqual(icebergInputAt(1).WriteOrder);
    });

    it('step 10 replaces the customer_id write order and changes nothing else', () => {
        expect(icebergInputAt(1).WriteOrder).toEqual({
            OrderId: 1,
            Fields: [
                {
                    SourceId: 1,
                    Transform: 'identity',
                    Direction: 'asc',
                    NullOrder: 'nulls-last',
                },
            ],
        });
        expect(icebergInputAt(10).WriteOrder).toEqual({
            OrderId: 1,
            Fields: [
                {
                    SourceId: 3,
                    Transform: 'identity',
                    Direction: 'desc',
                    NullOrder: 'nulls-first',
                },
            ],
        });
        expect(without(icebergInputAt(10), 'WriteOrder')).toEqual(without(icebergInputAt(9), 'WriteOrder'));
    });

    it('steps 11 and 12 add country under the never-used id 5', () => {
        const expected = [
            ...fieldsAt(10),
            {
                Id: 5,
                Name: 'country',
            },
        ];
        expect(fieldsAt(11)).toEqual(expected);
        expect(icebergInputAt(12)).toEqual(icebergInputAt(11));
    });

    it('only step 11 adds table_input_test, with tableInput beside icebergTableInput, after the table', () => {
        const tables = synthAt(11).findResources('AWS::Glue::Table');
        const tableId = Object.entries(tables).find(([
            , table,
        ]) => table.Properties.Name === 'evolution_test')![0];
        expect(tables.TableInputTable.Properties.TableInput).toEqual({
            Name: 'table_input_test',
        });
        expect(tables.TableInputTable.Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput).toBeDefined();
        expect(tables.TableInputTable.DependsOn).toEqual([
            tableId,
        ]);
        expect(synthAt(10).findResources('AWS::Glue::Table').TableInputTable).toBeUndefined();
        expect(synthAt(12).findResources('AWS::Glue::Table').TableInputTable).toBeUndefined();
    });
});

describe('IcebergEvolutionStack — Glue observation tables', () => {
    function parameterNameTableAt(step: number): Record<string, unknown> {
        return Object.entries(synthAt(step).findResources('AWS::Glue::Table')).find(([
            logicalId,
        ]) => logicalId.startsWith('ParameterNameTable'))![1].Properties;
    }

    it('reused_id_test drops c at step 2 and gives its id 2 to d from step 3', () => {
        const kept = {
            Id: 1,
            Name: 'a',
        };
        expect(fieldsAt(1, 'reused_id_test')).toEqual([
            kept,
            {
                Id: 2,
                Name: 'c',
            },
        ]);
        expect(fieldsAt(2, 'reused_id_test')).toEqual([
            kept,
        ]);
        expect(fieldsAt(3, 'reused_id_test')).toEqual([
            kept,
            {
                Id: 2,
                Name: 'd',
            },
        ]);
        expect(icebergInputAt(12, 'reused_id_test')).toEqual(icebergInputAt(3, 'reused_id_test'));
    });

    it('partition_id_test adds field 1005 at step 2 and field 1003 at step 3', () => {
        const base = [
            {
                Name: 'ts_day',
                FieldId: 1000,
            },
            {
                Name: 'id_bucket',
                FieldId: 1001,
            },
        ];
        const cat = {
            Name: 'cat',
            FieldId: 1005,
        };
        expect(partitionsAt(1, 'partition_id_test')).toEqual(base);
        expect(partitionsAt(2, 'partition_id_test')).toEqual([
            ...base,
            cat,
        ]);
        expect(partitionsAt(3, 'partition_id_test')).toEqual([
            ...base,
            cat,
            {
                Name: 'region',
                FieldId: 1003,
            },
        ]);
        expect(icebergInputAt(12, 'partition_id_test')).toEqual(icebergInputAt(3, 'partition_id_test'));
    });

    it('parameter_name_test takes its name from a parameter defaulting to it from step 9, nothing else changing', () => {
        const before = parameterNameTableAt(8);
        const after = parameterNameTableAt(9);
        expect(before.Name).toBe('parameter_name_test');
        expect(after.Name).toEqual({
            Ref: 'ParameterNameTableName',
        });
        expect(synthAt(9).toJSON().Parameters.ParameterNameTableName.Default).toBe('parameter_name_test');
        expect({
            ...after,
            Name: before.Name,
        }).toEqual(before);
    });

    it('decimal_test declares amount as decimal(10, 2)', () => {
        expect(icebergInputAt(1, 'decimal_test').Schema.Fields).toEqual([
            expect.objectContaining({
                Name: 'amount',
                Type: 'decimal(10, 2)',
            }),
        ]);
    });

    it('create_partition_id_test pins non-default partition field ids [1005, 1000]', () => {
        expect(partitionsAt(1, 'create_partition_id_test').map((field) => field.FieldId)).toEqual([
            1005,
            1000,
        ]);
    });

    it('v2_promotion_test widens int, float, decimal and relaxes req at step 2 with ids preserved', () => {
        expect(icebergInputAt(1, 'v2_promotion_test').Schema.Fields).toEqual([
            {
                Id: 1,
                Name: 'id',
                Type: 'long',
                Required: true,
            },
            {
                Id: 2,
                Name: 'n',
                Type: 'int',
                Required: false,
            },
            {
                Id: 3,
                Name: 'f',
                Type: 'float',
                Required: false,
            },
            {
                Id: 4,
                Name: 'd',
                Type: 'decimal(10, 2)',
                Required: false,
            },
            {
                Id: 5,
                Name: 'req',
                Type: 'string',
                Required: true,
            },
        ]);
        expect(icebergInputAt(2, 'v2_promotion_test').Schema.Fields).toEqual([
            {
                Id: 1,
                Name: 'id',
                Type: 'long',
                Required: true,
            },
            {
                Id: 2,
                Name: 'n',
                Type: 'long',
                Required: false,
            },
            {
                Id: 3,
                Name: 'f',
                Type: 'double',
                Required: false,
            },
            {
                Id: 4,
                Name: 'd',
                Type: 'decimal(12, 2)',
                Required: false,
            },
            {
                Id: 5,
                Name: 'req',
                Type: 'string',
                Required: false,
            },
        ]);
        expect(icebergInputAt(12, 'v2_promotion_test')).toEqual(icebergInputAt(2, 'v2_promotion_test'));
    });

    it('location_change_test moves location from v1 to v2 at step 2 and changes nothing else', () => {
        const before = icebergInputAt(1, 'location_change_test');
        const after = icebergInputAt(2, 'location_change_test');
        expect(before.Location).toBe('s3://data-lake-bucket-123456789012/sample_database/location_change_test/v1/');
        expect(after.Location).toBe('s3://data-lake-bucket-123456789012/sample_database/location_change_test/v2/');
        expect({
            ...after,
            Location: before.Location,
        }).toEqual(before);
        expect(icebergInputAt(12, 'location_change_test')).toEqual(after);
    });

    it('v1_test uses format version 1 and adds note (id 3) at step 2', () => {
        const step1Table = Object.values(synthAt(1).findResources('AWS::Glue::Table'))
            .find((resource) => resource.Properties.Name === 'v1_test')!;
        expect(step1Table.Properties.OpenTableFormatInput.IcebergInput.Version).toBe('1');
        expect(icebergInputAt(1, 'v1_test').Properties['format-version']).toBe('1');
        expect(fieldsAt(1, 'v1_test')).toEqual([
            {
                Id: 1,
                Name: 'id',
            },
            {
                Id: 2,
                Name: 'v',
            },
        ]);
        expect(fieldsAt(2, 'v1_test')).toEqual([
            {
                Id: 1,
                Name: 'id',
            },
            {
                Id: 2,
                Name: 'v',
            },
            {
                Id: 3,
                Name: 'note',
            },
        ]);
        expect(icebergInputAt(12, 'v1_test')).toEqual(icebergInputAt(2, 'v1_test'));
    });

    it('optimizer_test evolves schema + commit.retry.num-retries and attaches compaction + retention optimizers', () => {
        const step1 = synthAt(1);
        const step1Tables = step1.findResources('AWS::Glue::Table');
        const [
            optimizerTableId,
            optimizerTable,
        ] = Object.entries(step1Tables).find(([
            , resource,
        ]) => resource.Properties.Name === 'optimizer_test')!;
        expect(optimizerTable.Properties.OpenTableFormatInput.IcebergInput.Version).toBe('2');
        expect(icebergInputAt(1, 'optimizer_test').WriteOrder).toEqual({
            OrderId: 1,
            Fields: [
                {
                    SourceId: 1,
                    Transform: 'identity',
                    Direction: 'asc',
                    NullOrder: 'nulls-last',
                },
            ],
        });
        expect(fieldsAt(1, 'optimizer_test')).toEqual([
            {
                Id: 1,
                Name: 'id',
            },
            {
                Id: 2,
                Name: 'v',
            },
        ]);
        expect(icebergInputAt(1, 'optimizer_test').Properties['commit.retry.num-retries']).toBeUndefined();
        expect(fieldsAt(2, 'optimizer_test')).toEqual([
            {
                Id: 1,
                Name: 'id',
            },
            {
                Id: 2,
                Name: 'v',
            },
            {
                Id: 3,
                Name: 'note',
            },
        ]);
        expect(icebergInputAt(2, 'optimizer_test').Properties['commit.retry.num-retries']).toBe('5');
        expect(icebergInputAt(12, 'optimizer_test')).toEqual(icebergInputAt(2, 'optimizer_test'));

        const roles = step1.findResources('AWS::IAM::Role');
        const [
            roleId,
            role,
        ] = Object.entries(roles).find(([
            logicalId,
        ]) => logicalId.startsWith('OptimizerRole'))!;
        expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([
            expect.objectContaining({
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: {
                    Service: 'glue.amazonaws.com',
                },
            }),
        ]);

        const policies = step1.findResources('AWS::IAM::Policy');
        const [
            policyId,
            policy,
        ] = Object.entries(policies).find(([
            logicalId,
        ]) => logicalId.startsWith('OptimizerRoleDefaultPolicy'))!;
        expect(policy.Properties.Roles).toEqual([
            {
                Ref: roleId,
            },
        ]);
        const policyJson = JSON.stringify(policy.Properties.PolicyDocument);
        expect(policyJson).toContain('glue:UpdateTable');
        expect(policyJson).toContain('s3:PutObject');
        expect(policyJson).toContain('sample_database/optimizer_test/*');

        const lfPermissions = step1.findResources('AWS::LakeFormation::Permissions');
        const rolePermission = lfPermissions.OptimizerRolePermission;
        expect(rolePermission.Properties.Resource.TableResource.Name).toBe('optimizer_test');
        expect(rolePermission.Properties.DataLakePrincipal.DataLakePrincipalIdentifier).toEqual({
            'Fn::GetAtt': [
                roleId,
                'Arn',
            ],
        });
        expect([
            ...rolePermission.Properties.Permissions,
        ].sort()).toEqual([
            'ALTER',
            'DELETE',
            'DESCRIBE',
            'INSERT',
            'SELECT',
        ]);
        expect(rolePermission.DependsOn).toEqual([
            optimizerTableId,
        ]);

        const optimizers = step1.findResources('AWS::Glue::TableOptimizer');
        expect(Object.keys(optimizers).sort()).toEqual([
            'CompactionOptimizer',
            'RetentionOptimizer',
        ]);
        const expectedDeps = [
            optimizerTableId,
            policyId,
            roleId,
            'OptimizerRolePermission',
        ].sort();
        expect(optimizers.CompactionOptimizer.Properties).toEqual({
            CatalogId: '123456789012',
            DatabaseName: 'sample_database',
            TableName: 'optimizer_test',
            Type: 'compaction',
            TableOptimizerConfiguration: {
                Enabled: true,
                RoleArn: {
                    'Fn::GetAtt': [
                        roleId,
                        'Arn',
                    ],
                },
                CompactionConfiguration: {
                    IcebergConfiguration: {
                        Strategy: 'binpack',
                    },
                },
            },
        });
        expect([
            ...optimizers.CompactionOptimizer.DependsOn,
        ].sort()).toEqual(expectedDeps);
        expect(optimizers.RetentionOptimizer.Properties).toEqual({
            CatalogId: '123456789012',
            DatabaseName: 'sample_database',
            TableName: 'optimizer_test',
            Type: 'retention',
            TableOptimizerConfiguration: {
                Enabled: true,
                RoleArn: {
                    'Fn::GetAtt': [
                        roleId,
                        'Arn',
                    ],
                },
                RetentionConfiguration: {
                    IcebergConfiguration: {
                        SnapshotRetentionPeriodInDays: 5,
                        NumberOfSnapshotsToRetain: 1,
                        CleanExpiredFiles: true,
                    },
                },
            },
        });
        expect([
            ...optimizers.RetentionOptimizer.DependsOn,
        ].sort()).toEqual(expectedDeps);
    });
});

describe('IcebergEvolutionStack — unmarked identifier tables', () => {
    it.each([
        'unmarked_identifier_test',
        'unmarked_identifier_doc_test',
    ])('%s has no (PK) marker at step 1 and has it at step 2', (tableName) => {
        expect(icebergInputAt(1, tableName).Schema.Fields[0].Doc).toBeUndefined();
        expect(icebergInputAt(2, tableName).Schema.Fields[0].Doc).toBe('(PK) ');
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
        expect(() => synthAt(99)).toThrow(/evolutionStep must be an integer from 1 to 12, got '99'/);
    });

    it('rejects a fractional step', () => {
        expect(() => synthAt('9.5')).toThrow(/evolutionStep must be an integer from 1 to 12/);
    });

    it('grants the developer IAM user SELECT/INSERT/DELETE/ALTER/DESCRIBE on every table', () => {
        const template = synthAt(1);
        const permissions = Object.entries(template.findResources('AWS::LakeFormation::Permissions'))
            .filter(([
                logicalId,
            ]) => logicalId !== 'OptimizerRolePermission')
            .map(([
                , permission,
            ]) => permission);
        const tableIds = Object.fromEntries(Object.entries(template.findResources('AWS::Glue::Table')).map(([
            logicalId,
            table,
        ]) => [
            table.Properties.Name ?? table.Properties.TableInput.Name,
            logicalId,
        ]));
        expect(permissions.map((permission) => permission.Properties.Resource.TableResource.Name)).toEqual([
            'evolution_test',
            'nested_evolution_test',
            'reused_id_test',
            'partition_id_test',
            'parameter_name_test',
            'renumber_test',
            'format_version_test',
            'decimal_test',
            'create_partition_id_test',
            'drop_source_test',
            'drop_source_later_test',
            'reused_partition_id_test',
            'unmarked_identifier_test',
            'unmarked_identifier_doc_test',
            'engine_column_test',
            'engine_column_declared_test',
            'engine_column_other_id_test',
            'engine_upgrade_test',
            'engine_upgrade_v2_test',
            'v2_promotion_test',
            'location_change_test',
            'v1_test',
            'optimizer_test',
            'storage_columns_test',
        ]);
        permissions.forEach((permission) => {
            expect([
                ...permission.Properties.Permissions,
            ].sort()).toEqual([
                'ALTER',
                'DELETE',
                'DESCRIBE',
                'INSERT',
                'SELECT',
            ]);
            expect(permission.Properties.PermissionsWithGrantOption).toEqual([]);
            expect(permission.DependsOn).toEqual([
                tableIds[permission.Properties.Resource.TableResource.Name],
            ]);
            /// Partition is a CFN intrinsic; resolve to JSON and assert
            /// the user-name + account literals end up in the identifier.
            const identifier = JSON.stringify(permission.Properties.DataLakePrincipal.DataLakePrincipalIdentifier);
            expect(identifier).toContain('iam::123456789012:user/me');
        });
    });
});
