export default class WhereNull {
    private negative = false;

    constructor(private readonly property: string) {}

    setNegative(): void {
        this.negative = true;
    }

    toString(): string {
        const suffix = this.negative ? 'IS NOT NULL' : 'IS NULL';

        return `${this.property} ${suffix}`;
    }
}
