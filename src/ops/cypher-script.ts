/**
 * Cypher script runner (NTS-134) — split a .cypher file into statements
 * (comment- and string-aware) and execute them sequentially.
 */

import { Runner, QueryOutput } from '../driver/types';

/**
 * Split a script's contents into statements.
 *
 * Semicolons split statements except when they appear inside:
 *  - single- or double-quoted string literals (backslash escapes honoured),
 *  - backtick-quoted identifiers (`` `a``b` `` doubling honoured),
 *  - `--` and `//` line comments, and `/*` block comments (to the closer).
 *
 * Chunks that hold nothing but whitespace and comments are dropped, and each
 * remaining statement is trimmed. Comments that belong to a statement are
 * kept — they are legal Cypher.
 */
export function splitCypherStatements(content: string): string[] {
    const statements: string[] = [];

    // Offset where the current statement starts, and whether anything but
    // whitespace/comments has been seen since — comments-only chunks are
    // not statements
    let start = 0;
    let hasCode = false;

    const endStatement = (semicolonIndex: number): void => {
        if (hasCode) {
            statements.push(content.slice(start, semicolonIndex).trim());
        }

        start = semicolonIndex + 1;
        hasCode = false;
    };

    let i = 0;

    while (i < content.length) {
        const char = content[i];

        switch (char) {
            case ';':
                endStatement(i);
                i += 1;
                break;

            case '\'':
            case '"':
                hasCode = true;
                i = skipString(content, i, char);
                break;

            case '`':
                hasCode = true;
                i = skipQuotedIdentifier(content, i);
                break;

            case '-':
                if (content[i + 1] === '-') {
                    i = skipLineComment(content, i);
                    break;
                }

                hasCode = true;
                i += 1;
                break;

            case '/':
                if (content[i + 1] === '/') {
                    i = skipLineComment(content, i);
                    break;
                }

                if (content[i + 1] === '*') {
                    i = skipBlockComment(content, i);
                    break;
                }

                hasCode = true;
                i += 1;
                break;

            default:
                if (!/\s/.test(char)) {
                    hasCode = true;
                }

                i += 1;
        }
    }

    endStatement(content.length);

    return statements;
}

export interface RunCypherScriptOptions {
    /** Progress callback — fires with each statement before it executes. */
    onStatement?: (statement: string, index: number) => void;
}

/**
 * Run every statement of a script sequentially against a runner.
 * Stops at (rejects on) the first failing statement.
 */
export async function runCypherScript(
    runner: Runner,
    content: string,
    options: RunCypherScriptOptions = {}
): Promise<QueryOutput[]> {
    const statements = splitCypherStatements(content);
    const results: QueryOutput[] = [];

    for (const [index, statement] of statements.entries()) {
        options.onStatement?.(statement, index);

        results.push(await runner.run(statement));
    }

    return results;
}

/** Consume a quoted string literal; returns the index after its closing quote. */
function skipString(content: string, openIndex: number, quote: string): number {
    for (let i = openIndex + 1; i < content.length; i += 1) {
        if (content[i] === '\\') {
            i += 1; // escaped character (\' \" \\ ...) — never a closing quote
            continue;
        }

        if (content[i] === quote) {
            return i + 1;
        }
    }

    return content.length;
}

/** Consume a backtick-quoted identifier; doubled backticks are the escape. */
function skipQuotedIdentifier(content: string, openIndex: number): number {
    for (let i = openIndex + 1; i < content.length; i += 1) {
        if (content[i] !== '`') {
            continue;
        }

        if (content[i + 1] === '`') {
            i += 1;
            continue;
        }

        return i + 1;
    }

    return content.length;
}

/** Skip to (not past) the newline ending a line comment. */
function skipLineComment(content: string, start: number): number {
    let i = start;

    while (i < content.length && content[i] !== '\n') {
        i += 1;
    }

    return i;
}

/** Skip past the closer of a block comment (unterminated comments run to EOF). */
function skipBlockComment(content: string, start: number): number {
    const end = content.indexOf('*/', start + 2);

    return end === -1 ? content.length : end + 2;
}
