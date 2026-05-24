import {
    IcebergRenderContext,
    IcebergType,
} from '../../lib/iceberg/iceberg-type';

function makeContext(start = 1): IcebergRenderContext {
    let next = start;
    return {
        nextId: () => {
            const id = next;
            next += 1;
            return id;
        },
    };
}

describe('IcebergType — primitive', () => {
    it.each([
        [
            'BOOLEAN',
            IcebergType.BOOLEAN,
            'boolean',
        ],
        [
            'INT',
            IcebergType.INT,
            'int',
        ],
        [
            'LONG',
            IcebergType.LONG,
            'long',
        ],
        [
            'FLOAT',
            IcebergType.FLOAT,
            'float',
        ],
        [
            'DOUBLE',
            IcebergType.DOUBLE,
            'double',
        ],
        [
            'DATE',
            IcebergType.DATE,
            'date',
        ],
        [
            'TIME',
            IcebergType.TIME,
            'time',
        ],
        [
            'TIMESTAMP',
            IcebergType.TIMESTAMP,
            'timestamp',
        ],
        [
            'TIMESTAMPTZ',
            IcebergType.TIMESTAMPTZ,
            'timestamptz',
        ],
        [
            'STRING',
            IcebergType.STRING,
            'string',
        ],
        [
            'UUID',
            IcebergType.UUID,
            'uuid',
        ],
        [
            'BINARY',
            IcebergType.BINARY,
            'binary',
        ],
    ])('%s renders to %s', (_label, type, expected) => {
        expect(type._render(makeContext())).toBe(expected);
        expect(type.isPrimitive(expected)).toBe(true);
    });

    it('exposes a stable kind', () => {
        expect(IcebergType.INT.kind).toBe('int');
        expect(IcebergType.STRING.kind).toBe('string');
    });
});

describe('IcebergType — decimal', () => {
    it('renders decimal(P,S)', () => {
        const type = IcebergType.decimal(10, 2);
        expect(type._render(makeContext())).toBe('decimal(10,2)');
        expect(type.isDecimal()).toBe(true);
    });

    it.each([
        0,
        39,
        -1,
        1.5,
    ])('rejects invalid precision %s', (precision) => {
        expect(() => IcebergType.decimal(precision, 0)).toThrow(/decimal precision/);
    });

    it.each([
        -1,
        11,
        1.5,
    ])('rejects invalid scale %s', (scale) => {
        expect(() => IcebergType.decimal(10, scale)).toThrow(/decimal scale/);
    });
});

describe('IcebergType — fixed', () => {
    it('renders fixed[L]', () => {
        const type = IcebergType.fixed(16);
        expect(type._render(makeContext())).toBe('fixed[16]');
        expect(type.isFixed()).toBe(true);
    });

    it.each([
        0,
        -1,
        1.5,
    ])('rejects invalid length %s', (length) => {
        expect(() => IcebergType.fixed(length)).toThrow(/fixed length/);
    });
});

describe('IcebergType — list', () => {
    it('renders a primitive list with auto-assigned element id', () => {
        const type = IcebergType.list(IcebergType.STRING);
        const ctx = makeContext(100);
        const repr = JSON.parse(type._render(ctx));
        expect(repr).toEqual({
            type: 'list',
            'element-id': 100,
            'element-required': true,
            element: 'string',
        });
    });

    it('honors elementRequired=false', () => {
        const type = IcebergType.list(IcebergType.INT, false);
        const repr = JSON.parse(type._render(makeContext()));
        expect(repr['element-required']).toBe(false);
    });

    it('nests complex types as JSON objects (no double encoding)', () => {
        const inner = IcebergType.struct([
            {
                name: 'k',
                type: IcebergType.STRING,
                required: true,
            },
        ]);
        const type = IcebergType.list(inner);
        const repr = JSON.parse(type._render(makeContext()));
        expect(typeof repr.element).toBe('object');
        expect(repr.element.type).toBe('struct');
    });
});

describe('IcebergType — map', () => {
    it('renders with auto-assigned key and value ids', () => {
        const type = IcebergType.map(IcebergType.STRING, IcebergType.INT);
        const ctx = makeContext(50);
        const repr = JSON.parse(type._render(ctx));
        expect(repr).toEqual({
            type: 'map',
            'key-id': 50,
            key: 'string',
            'value-id': 51,
            'value-required': true,
            value: 'int',
        });
    });

    it('honors valueRequired=false', () => {
        const type = IcebergType.map(IcebergType.STRING, IcebergType.STRING, false);
        const repr = JSON.parse(type._render(makeContext()));
        expect(repr['value-required']).toBe(false);
    });
});

describe('IcebergType — struct', () => {
    it('renders fields with monotonic ids', () => {
        const type = IcebergType.struct([
            {
                name: 'a',
                type: IcebergType.INT,
                required: true,
            },
            {
                name: 'b',
                type: IcebergType.STRING,
                doc: 'optional b',
            },
        ]);
        const ctx = makeContext(10);
        const repr = JSON.parse(type._render(ctx));
        expect(repr).toEqual({
            type: 'struct',
            fields: [
                {
                    id: 10,
                    name: 'a',
                    required: true,
                    type: 'int',
                },
                {
                    id: 11,
                    name: 'b',
                    required: false,
                    type: 'string',
                    doc: 'optional b',
                },
            ],
        });
    });

    it('rejects empty struct', () => {
        expect(() => IcebergType.struct([])).toThrow(/at least one field/);
    });

    it('rejects duplicate field names', () => {
        expect(() => IcebergType.struct([
            {
                name: 'a',
                type: IcebergType.INT,
            },
            {
                name: 'a',
                type: IcebergType.STRING,
            },
        ])).toThrow(/duplicate field name/);
    });

    it('threads ids across nested structs', () => {
        const inner = IcebergType.struct([
            {
                name: 'inner_field',
                type: IcebergType.INT,
            },
        ]);
        const outer = IcebergType.struct([
            {
                name: 'outer_a',
                type: inner,
            },
            {
                name: 'outer_b',
                type: IcebergType.STRING,
            },
        ]);
        const ctx = makeContext(100);
        const repr = JSON.parse(outer._render(ctx));
        const outerAField = repr.fields[0];
        const outerBField = repr.fields[1];
        expect(outerAField.id).toBe(100);
        expect(outerAField.type.fields[0].id).toBe(101);
        expect(outerBField.id).toBe(102);
    });
});
