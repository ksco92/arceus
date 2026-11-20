import {
    IcebergEdgeAlgorithm,
    IcebergType,
    IcebergTypeKind,
} from '../../lib/iceberg/iceberg-type';

function render(type: IcebergType): string {
    return type._render('c', (_path, id) => id as number);
}

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

    it('rejects decimal with invalid precision or scale', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.DECIMAL,
            decimalPrecision: 0,
            decimalScale: 0,
        })).toThrow(/decimal precision/);
        expect(() => new IcebergType({
            kind: IcebergTypeKind.DECIMAL,
            decimalPrecision: 10,
            decimalScale: 11,
        })).toThrow(/decimal scale/);
    });

    it('rejects fixed without length', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.FIXED,
        })).toThrow(/fixedLength/);
    });

    it('rejects fixed with non-positive length', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.FIXED,
            fixedLength: 0,
        })).toThrow(/positive integer/);
        expect(() => new IcebergType({
            kind: IcebergTypeKind.FIXED,
            fixedLength: 1.5,
        })).toThrow(/positive integer/);
    });

    it('rejects list without listElement', () => {
        expect(() => new IcebergType({
            kind: IcebergTypeKind.LIST,
        })).toThrow(/listElement/);
    });

    it('defaults listElementRequired to false when omitted', () => {
        const type = new IcebergType({
            kind: IcebergTypeKind.LIST,
            listElement: IcebergType.STRING,
            listElementId: 2,
        });
        expect(type.listElementRequired).toBe(false);
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

    it('defaults mapValueRequired to false when omitted', () => {
        const type = new IcebergType({
            kind: IcebergTypeKind.MAP,
            mapKey: IcebergType.STRING,
            mapKeyId: 2,
            mapValue: IcebergType.INT,
            mapValueId: 3,
        });
        expect(type.mapValueRequired).toBe(false);
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
        expect(render(type)).toBe(expected);
        expect(type.isPrimitive(expected)).toBe(true);
    });

    it('exposes a stable kind', () => {
        expect(IcebergType.INT.kind).toBe('int');
        expect(IcebergType.STRING.kind).toBe('string');
    });
});

describe('IcebergType — decimal', () => {
    it('renders decimal(P, S) in Iceberg canonical form (space after the comma)', () => {
        /// The space is required: Glue stores decimals as `decimal(P, S)`,
        /// so a spaceless render makes schema-identical updates fail with
        /// `Cannot set last added schema`. Regression guard for issue #40.
        const type = IcebergType.decimal(10, 2);
        expect(render(type)).toBe('decimal(10, 2)');
        expect(type.isDecimal()).toBe(true);
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
        const repr = JSON.parse(render(type));
        expect(repr.fields[0].type).toBe('decimal(12, 4)');
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
        expect(render(type)).toBe('fixed[16]');
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
    it('renders the pinned element id with nullable elements by default', () => {
        const type = IcebergType.list({
            element: IcebergType.STRING,
            elementId: 100,
        });
        expect(JSON.parse(render(type))).toEqual({
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
        expect(JSON.parse(render(type))['element-required']).toBe(true);
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
        const repr = JSON.parse(render(type));
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
        expect(JSON.parse(render(type))).toEqual({
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
        expect(JSON.parse(render(type))['value-required']).toBe(true);
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
        expect(JSON.parse(render(type))).toEqual({
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

    it('rejects empty struct', () => {
        expect(() => IcebergType.struct([])).toThrow(/at least one structField/);
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
        expect(render(type)).toBe(expected);
    });

    it.each([
        '',
        'EPSG: 4326',
        'EPSG:4326\t',
        'srid(4326)',
        'EPSG:4326,karney',
        'EPSG:4326)',
        'srid(4326',
        '{x',
        'x}',
        '{"type":"GeographicCRS"}',
    ])('rejects CRS %j on geometry and geography', (crs) => {
        expect(() => IcebergType.geometry(crs)).toThrow(/geometry CRS must be a non-empty identifier/);
        expect(() => IcebergType.geography(crs)).toThrow(/geography CRS must be a non-empty identifier/);
    });

    it.each([
        'srid:3857',
        'EPSG:4326',
        'projjson:my_crs_property',
    ])('accepts CRS %s', (crs) => {
        expect(IcebergType.geometry(crs).geoCrs).toBe(crs);
    });
});

describe('IcebergType — inputs are copied at construction', () => {
    it('rejects a kind that is not an IcebergTypeKind', () => {
        expect(() => new IcebergType({
            kind: 'bogus' as IcebergTypeKind,
        })).toThrow('unknown IcebergTypeKind: bogus');
    });

    it('reads each construction option once', () => {
        let reads = 0;
        const options = {
            get kind() {
                reads += 1;
                return IcebergTypeKind.STRING;
            },
        };
        expect(new IcebergType(options).kind).toBe(IcebergTypeKind.STRING);
        expect(reads).toBe(1);
    });

    it('keeps neither the caller array nor its field objects', () => {
        const field = {
            id: 2,
            name: 'a',
            type: IcebergType.STRING,
        };
        const fields = [
            field,
        ];
        const struct = IcebergType.struct(fields);
        fields.push({
            ...field,
            id: 3,
        });
        field.name = 'b';
        expect(struct.structFields).toEqual([
            {
                id: 2,
                name: 'a',
                type: IcebergType.STRING,
                required: false,
            },
        ]);
    });

    it('keeps no reference to the element, key and value types it was given', () => {
        const inner = IcebergType.struct([
            {
                id: 3,
                name: 'a',
                type: IcebergType.STRING,
            },
        ]);
        const list = IcebergType.list({
            element: inner,
            elementId: 2,
        });
        const map = IcebergType.map({
            key: inner,
            keyId: 4,
            value: inner,
            valueId: 5,
        });
        expect(list.listElement).not.toBe(inner);
        expect(map.mapKey).not.toBe(inner);
        expect(map.mapValue).not.toBe(inner);
    });
});
