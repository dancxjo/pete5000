// Queue class definition

export class Queue<Q> {
    protected storage: Q[] = [];

    toString(): string {
        return JSON.stringify(this.storage);
    }

    pull(): Q | undefined {
        return this.storage.shift();
    }
    push(item: Q): void {
        this.storage.push(item);
    }
    peek(i = 0): Q | undefined {
        return this.storage[i];
    }
    size(): number {
        return this.storage.length;
    }
    isEmpty(): boolean {
        return this.storage.length === 0;
    }
    clear(): void {
        this.storage = [];
    }
}
