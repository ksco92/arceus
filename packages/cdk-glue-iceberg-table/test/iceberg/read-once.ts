export function firstReadThen<T>(first: T, rest: T): () => T {
    let reads = 0;
    return () => {
        reads += 1;
        return reads === 1 ? first : rest;
    };
}

/** A copy of `base` whose `key` returns `first` on the first read and `rest` on every later read. */
export function withGetter<T extends object>(base: T, key: string, first: unknown, rest: unknown): T {
    return Object.defineProperty(
        Object.create(null, Object.getOwnPropertyDescriptors(base)),
        key,
        {
            get: firstReadThen(first, rest),
            enumerable: true,
            configurable: true,
        },
    );
}
