import {
    IcebergPartitionTransform,
    IcebergPartitionTransformKind,
    IcebergType,
} from '../../lib/iceberg';

describe('IcebergPartitionTransform — strings', () => {
    it.each([
        [
            IcebergPartitionTransform.IDENTITY,
            'identity',
        ],
        [
            IcebergPartitionTransform.YEAR,
            'year',
        ],
        [
            IcebergPartitionTransform.MONTH,
            'month',
        ],
        [
            IcebergPartitionTransform.DAY,
            'day',
        ],
        [
            IcebergPartitionTransform.HOUR,
            'hour',
        ],
        [
            IcebergPartitionTransform.VOID,
            'void',
        ],
    ])('%s renders correctly', (transform, expected) => {
        expect(transform.toTransformString()).toBe(expected);
    });

    it('bucket renders as bucket[N]', () => {
        expect(IcebergPartitionTransform.bucket(8).toTransformString()).toBe('bucket[8]');
    });

    it('truncate renders as truncate[W]', () => {
        expect(IcebergPartitionTransform.truncate(64).toTransformString()).toBe('truncate[64]');
    });

    it('exposes the kind discriminator on constants and factory instances', () => {
        expect(IcebergPartitionTransform.IDENTITY.kind).toBe(IcebergPartitionTransformKind.IDENTITY);
        expect(IcebergPartitionTransform.bucket(8).kind).toBe(IcebergPartitionTransformKind.BUCKET);
    });
});

describe('IcebergPartitionTransform — invalid factory args', () => {
    it.each([
        0,
        1.5,
    ])('bucket() rejects %s', (n) => {
        expect(() => IcebergPartitionTransform.bucket(n)).toThrow(/positive integer/);
    });

    it.each([
        0,
        1.5,
    ])('truncate() rejects %s', (n) => {
        expect(() => IcebergPartitionTransform.truncate(n)).toThrow(/positive integer/);
    });
});

describe('IcebergPartitionTransform — source type validation', () => {
    it('identity accepts any type', () => {
        expect(() => IcebergPartitionTransform.IDENTITY._validateSourceType('c', IcebergType.STRING)).not.toThrow();
    });

    it('void accepts any type', () => {
        expect(() => IcebergPartitionTransform.VOID._validateSourceType('c', IcebergType.STRING)).not.toThrow();
    });

    it.each([
        IcebergPartitionTransform.YEAR,
        IcebergPartitionTransform.MONTH,
        IcebergPartitionTransform.DAY,
    ])('year/month/day accept date and timestamp types', (transform) => {
        expect(() => transform._validateSourceType('c', IcebergType.DATE)).not.toThrow();
        expect(() => transform._validateSourceType('c', IcebergType.TIMESTAMP)).not.toThrow();
        expect(() => transform._validateSourceType('c', IcebergType.TIMESTAMPTZ)).not.toThrow();
    });

    it.each([
        IcebergPartitionTransform.YEAR,
        IcebergPartitionTransform.MONTH,
        IcebergPartitionTransform.DAY,
    ])('year/month/day reject non-temporal types', (transform) => {
        expect(() => transform._validateSourceType('c', IcebergType.STRING)).toThrow(/date\/timestamp\/timestamptz/);
        expect(() => transform._validateSourceType('c', IcebergType.INT)).toThrow(/date\/timestamp\/timestamptz/);
    });

    it('hour accepts timestamps but not dates', () => {
        expect(() => IcebergPartitionTransform.HOUR._validateSourceType('c', IcebergType.TIMESTAMP)).not.toThrow();
        expect(() => IcebergPartitionTransform.HOUR._validateSourceType('c', IcebergType.TIMESTAMPTZ)).not.toThrow();
        expect(() => IcebergPartitionTransform.HOUR._validateSourceType('c', IcebergType.DATE)).toThrow(/timestamp\/timestamptz/);
        expect(() => IcebergPartitionTransform.HOUR._validateSourceType('c', IcebergType.STRING)).toThrow(/timestamp\/timestamptz/);
    });

    it('names the legal source types with the article that matches the first one', () => {
        expect(() => IcebergPartitionTransform.bucket(8)._validateSourceType('c', IcebergType.BOOLEAN)).toThrow(
            "partition transform 'bucket[8]' on column 'c' requires an "
            + 'int/long/decimal/date/time/timestamp/timestamptz/timestamp_ns/timestamptz_ns/string/uuid/fixed/binary column',
        );
        expect(() => IcebergPartitionTransform.YEAR._validateSourceType('c', IcebergType.BOOLEAN)).toThrow(
            "partition transform 'year' on column 'c' requires a "
            + 'date/timestamp/timestamptz/timestamp_ns/timestamptz_ns column',
        );
    });

    it.each([
        IcebergType.INT,
        IcebergType.LONG,
        IcebergType.DATE,
        IcebergType.TIME,
        IcebergType.TIMESTAMP,
        IcebergType.TIMESTAMPTZ,
        IcebergType.TIMESTAMP_NS,
        IcebergType.TIMESTAMPTZ_NS,
        IcebergType.STRING,
        IcebergType.UUID,
        IcebergType.BINARY,
        IcebergType.decimal(10, 2),
        IcebergType.fixed(16),
    ])('bucket accepts %s', (type) => {
        expect(() => IcebergPartitionTransform.bucket(8)._validateSourceType('c', type)).not.toThrow();
    });

    it.each([
        IcebergType.BOOLEAN,
        IcebergType.FLOAT,
        IcebergType.DOUBLE,
    ])('bucket rejects %s', (type) => {
        expect(() => IcebergPartitionTransform.bucket(8)._validateSourceType('c', type)).toThrow(/bucket/);
    });

    it.each([
        IcebergType.INT,
        IcebergType.LONG,
        IcebergType.STRING,
        IcebergType.BINARY,
        IcebergType.decimal(10, 2),
    ])('truncate accepts %s', (type) => {
        expect(() => IcebergPartitionTransform.truncate(8)._validateSourceType('c', type)).not.toThrow();
    });

    it.each([
        IcebergType.BOOLEAN,
        IcebergType.FLOAT,
        IcebergType.DOUBLE,
        IcebergType.DATE,
        IcebergType.TIMESTAMP,
        IcebergType.TIMESTAMP_NS,
        IcebergType.TIMESTAMPTZ_NS,
    ])('truncate rejects %s', (type) => {
        expect(() => IcebergPartitionTransform.truncate(8)._validateSourceType('c', type)).toThrow(/truncate/);
    });

    it.each([
        [
            IcebergPartitionTransform.YEAR,
            IcebergType.TIMESTAMP_NS,
        ],
        [
            IcebergPartitionTransform.YEAR,
            IcebergType.TIMESTAMPTZ_NS,
        ],
        [
            IcebergPartitionTransform.HOUR,
            IcebergType.TIMESTAMP_NS,
        ],
        [
            IcebergPartitionTransform.HOUR,
            IcebergType.TIMESTAMPTZ_NS,
        ],
    ])('%s accepts %s', (transform, type) => {
        expect(() => transform._validateSourceType('c', type)).not.toThrow();
    });

    it.each([
        IcebergPartitionTransform.IDENTITY,
        IcebergPartitionTransform.YEAR,
    ])('%s rejects variant', (transform) => {
        expect(() => transform._validateSourceType('c', IcebergType.VARIANT))
            .toThrow(/column 'c' has type variant, which cannot be a partition or sort source/);
    });

    it.each([
        [
            IcebergPartitionTransform.IDENTITY,
            IcebergType.geometry(),
        ],
        [
            IcebergPartitionTransform.IDENTITY,
            IcebergType.geography(),
        ],
        [
            IcebergPartitionTransform.IDENTITY,
            IcebergType.UNKNOWN,
        ],
        [
            IcebergPartitionTransform.YEAR,
            IcebergType.geometry(),
        ],
    ])('%s rejects %s with only void allowed', (transform, type) => {
        expect(() => transform._validateSourceType('c', type))
            .toThrow(`'${transform.toTransformString()}' on column 'c' is not allowed on ${type.kind}; only 'void' is`);
    });

    it.each([
        IcebergType.geometry(),
        IcebergType.geography(),
        IcebergType.UNKNOWN,
    ])('void accepts %s', (type) => {
        expect(() => IcebergPartitionTransform.VOID._validateSourceType('c', type)).not.toThrow();
    });
});
