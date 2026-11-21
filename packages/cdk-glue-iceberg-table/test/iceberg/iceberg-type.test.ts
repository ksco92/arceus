import {
    IcebergEdgeAlgorithm,
    IcebergType,
    IcebergTypeKind,
} from '../../lib/iceberg/iceberg-type';

describe('IcebergType — direct constructor', () => {
    it('rejects decimal without precision + scale', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.DECIMAL,
        })).toThrow(/decimalPrecision and decimalScale/);
        expect(() => new IcebergType({
            kind: IcebergTypeKind.DECIMAL,
            decimalPrecision: 5,
        })).toThrow(/decimalPrecision and decimalScale/);
    });

    it('rejects fixed without length', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.FIXED,
        })).toThrow(/fixedLength/);
    });

    it('rejects list without listElement', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.LIST,
        })).toThrow(/listElement/);
    });

    it('rejects map without mapKey or mapValue', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.MAP,
        })).toThrow(/mapKey and mapValue/);
        expect(() => new IcebergType({
            kind: IcebergTypeKind.MAP,
            mapKey: IcebergType.STRING,
        })).toThrow(/mapKey and mapValue/);
    });

    it('rejects struct without fields', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.STRUCT,
        })).toThrow(/at least one structField/);
    });
});

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
        [
            'UNKNOWN',
            IcebergType.UNKNOWN,
            'unknown',
        ],
        [
            'TIMESTAMP_NS',
            IcebergType.TIMESTAMP_NS,
            'timestamp_ns',
        ],
        [
            'TIMESTAMPTZ_NS',
            IcebergType.TIMESTAMPTZ_NS,
            'timestamptz_ns',
        ],
        [
            'VARIANT',
            IcebergType.VARIANT,
            'variant',
        ],
    ])('%s renders to %s', (_label, type, expected) => {
        expect(type._render()).toBe(expected);
    });
});

describe('IcebergType — decimal', () => {
    it('renders decimal(P, S) in Iceberg canonical form (space after the comma)', () => {
        expect(IcebergType.decimal(10, 2)._render()).toBe('decimal(10, 2)');
    });

    it('renders a decimal nested inside a struct in canonical form', () => {
        const type = IcebergType.struct([
            {
                id: 2,
                name: 'amount',
                type: IcebergType.decimal(12, 4),
                required: true,
            },
        ]);
        const repr = JSON.parse(type._render());
        expect(repr.fields[0].type).toBe('decimal(12, 4)');
    });

    it.each([
        0,
        39,
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
        expect(type._render()).toBe('fixed[16]');
    });

    it.each([
        0,
        1.5,
    ])('rejects invalid length %s', (length) => {
        expect(() => IcebergType.fixed(length)).toThrow(/fixed length/);
    });
});

describe('IcebergType — list', () => {
    it('renders the pinned element id with nullable elements by default', () => {
        const type = IcebergType.list({
            element: IcebergType.STRING,
            elementId: 100,
        });
        expect(JSON.parse(type._render())).toEqual({
            type: 'list',
            'element-id': 100,
            'element-required': false,
            element: 'string',
        });
    });

    it('honors elementRequired=true', () => {
        const type = IcebergType.list({
            element: IcebergType.INT,
            elementId: 2,
            elementRequired: true,
        });
        expect(JSON.parse(type._render())['element-required']).toBe(true);
    });

    it('nests complex types as JSON objects (no double encoding)', () => {
        const inner = IcebergType.struct([
            {
                id: 3,
                name: 'k',
                type: IcebergType.STRING,
                required: true,
            },
        ]);
        const type = IcebergType.list({
            element: inner,
            elementId: 2,
        });
        const repr = JSON.parse(type._render());
        expect(typeof repr.element).toBe('object');
        expect(repr.element.type).toBe('struct');
    });
});

describe('IcebergType — map', () => {
    it('renders the pinned key and value ids with nullable values by default', () => {
        const type = IcebergType.map({
            key: IcebergType.STRING,
            keyId: 50,
            value: IcebergType.INT,
            valueId: 77,
        });
        expect(JSON.parse(type._render())).toEqual({
            type: 'map',
            'key-id': 50,
            key: 'string',
            'value-id': 77,
            'value-required': false,
            value: 'int',
        });
    });

    it('honors valueRequired=true', () => {
        const type = IcebergType.map({
            key: IcebergType.STRING,
            keyId: 2,
            value: IcebergType.STRING,
            valueId: 3,
            valueRequired: true,
        });
        expect(JSON.parse(type._render())['value-required']).toBe(true);
    });
});

describe('IcebergType — struct', () => {
    it('renders the pinned field ids', () => {
        const type = IcebergType.struct([
            {
                id: 11,
                name: 'a',
                type: IcebergType.INT,
                required: true,
            },
            {
                id: 10,
                name: 'b',
                type: IcebergType.STRING,
                doc: 'optional b',
            },
        ]);
        expect(JSON.parse(type._render())).toEqual({
            type: 'struct',
            fields: [
                {
                    id: 11,
                    name: 'a',
                    required: true,
                    type: 'int',
                },
                {
                    id: 10,
                    name: 'b',
                    required: false,
                    type: 'string',
                    doc: 'optional b',
                },
            ],
        });
    });

    it('rejects duplicate field names', () => {
        expect(() => IcebergType.struct([
            {
                id: 1,
                name: 'a',
                type: IcebergType.INT,
            },
            {
                id: 2,
                name: 'a',
                type: IcebergType.STRING,
            },
        ])).toThrow(/duplicate field name/);
    });
});

describe('IcebergType — geospatial', () => {
    it.each([
        [
            IcebergType.geometry(),
            'geometry',
        ],
        [
            IcebergType.geometry('EPSG:3857'),
            'geometry(EPSG:3857)',
        ],
        [
            IcebergType.geography(),
            'geography',
        ],
        [
            IcebergType.geography('EPSG:4326'),
            'geography(EPSG:4326)',
        ],
        [
            IcebergType.geography('EPSG:4326', IcebergEdgeAlgorithm.SPHERICAL),
            'geography(EPSG:4326, spherical)',
        ],
        [
            IcebergType.geography('OGC:CRS84', IcebergEdgeAlgorithm.VINCENTY),
            'geography(OGC:CRS84, vincenty)',
        ],
        [
            IcebergType.geography(undefined, IcebergEdgeAlgorithm.KARNEY),
            'geography(OGC:CRS84, karney)',
        ],
        [
            IcebergType.geography('EPSG:4326', IcebergEdgeAlgorithm.THOMAS),
            'geography(EPSG:4326, thomas)',
        ],
        [
            IcebergType.geography('EPSG:4326', IcebergEdgeAlgorithm.ANDOYER),
            'geography(EPSG:4326, andoyer)',
        ],
    ])('renders %#: %s', (type, expected) => {
        expect(type._render()).toBe(expected);
    });

    it.each([
        '',
        'EPSG: 4326',
        'EPSG:4326,karney',
        'EPSG:4326)',
        'srid(4326',
        '{x',
        'x}',
    ])('rejects CRS %j on geometry and geography', (crs) => {
        expect(() => IcebergType.geometry(crs)).toThrow(/geometry CRS must be a non-empty identifier/);
        expect(() => IcebergType.geography(crs)).toThrow(/geography CRS must be a non-empty identifier/);
    });
});
