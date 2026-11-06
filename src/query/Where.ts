export const OPERATOR_EQUALS = '=';

export default class Where {
    private negative = false;

    constructor(
        private readonly left: string,
        private readonly operator: string,
        private readonly right: string
    ) {}

    setNegative(): void {
        this.negative = true;
    }

    toString(): string {
        const prefix = this.negative ? 'NOT ' : '';

        return `${prefix}${this.left} ${this.operator} ${this.right}`;
    }
}
