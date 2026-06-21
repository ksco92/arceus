import {
    IcebergPartitionTransform,
    IcebergPartitionTransformKind,
} from '../../lib/iceberg/iceberg-partition-transform';
import {
    IcebergType,
} from '../../lib/iceberg/iceberg-type';

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
});

describe('IcebergPartitionTransform — direct constructor', () => {
    it('rejects bucket kind without bucketCount', () => {
        expect(() => new IcebergPartitionTransform({
            kind: IcebergPartitionTransformKind.BUCKET,
        })).toThrow(/bucketCount/);
    });

    it.each([
        0,
        -1,
        1.5,
    ])('rejects bucket kind with invalid bucketCount=%s', (bucketCount) => {
        expect(() => new IcebergPartitionTransform({
            kind: IcebergPartitionTransformKind.BUCKET,
            bucketCount,
        })).toThrow(/positive integer/);
    });

    it('rejects truncate kind without truncateWidth', () => {
        expect(() => new IcebergPartitionTransform({
            kind: IcebergPartitionTransformKind.TRUNCATE,
        })).toThrow(/truncateWidth/);
    });

    it.each([
        0,
        -1,
        1.5,
    ])('rejects truncate kind with invalid truncateWidth=%s', (truncateWidth) => {
        expect(() => new IcebergPartitionTransform({
            kind: IcebergPartitionTransformKind.TRUNCATE,
            truncateWidth,
        })).toThrow(/positive integer/);
    });
});

describe('IcebergPartitionTransform — invalid factory args', () => {
    it.each([
        0,
        -1,
        1.5,
    ])('bucket() rejects %s', (n) => {
        expect(() => IcebergPartitionTransform.bucket(n)).toThrow(/positive integer/);
    });

    it.each([
        0,
        -1,
        1.5,
    ])('truncate() rejects %s', (n) => {
        expect(() => IcebergPartitionTransform.truncate(n)).toThrow(/positive integer/);
    });
});

describe('IcebergPartitionTransform — source type validation', () => {
    it('identity accepts any type', () => {
        expect(() => IcebergPartitionTransform.IDENTITY._validateSourceType('c', IcebergType.STRING)).not.toThrow();
        expect(() => IcebergPartitionTransform.IDENTITY._validateSourceType('c', IcebergType.BOOLEAN)).not.toThrow();
        expect(() => IcebergPartitionTransform.IDENTITY._validateSourceType('c', IcebergType.decimal(5, 2))).not.toThrow();
    });

    it('void accepts any type', () => {
        expect(() => IcebergPartitionTransform.VOID._validateSourceType('c', IcebergType.STRING)).not.toThrow();
        expect(() => IcebergPartitionTransform.VOID._validateSourceType('c', IcebergType.BOOLEAN)).not.toThrow();
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

    it.each([
        IcebergType.INT,
        IcebergType.LONG,
        IcebergType.DATE,
        IcebergType.TIME,
        IcebergType.TIMESTAMP,
        IcebergType.TIMESTAMPTZ,
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
    ])('truncate rejects %s', (type) => {
        expect(() => IcebergPartitionTransform.truncate(8)._validateSourceType('c', type)).toThrow(/truncate/);
    });
});
