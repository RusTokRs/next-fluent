export declare class LRUCache<V> {
    private readonly map;
    private readonly maxSize;
    constructor(maxSize: number);
    get(key: string): V | undefined;
    set(key: string, value: V): void;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    get size(): number;
}
