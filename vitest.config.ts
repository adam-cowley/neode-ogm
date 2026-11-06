import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * SWC transform with legacy decorator support and design:type metadata
 * emission. tsc's `emitDecoratorMetadata` equivalent — required by
 * decorators that reflect entity types (e.g. @OneToOne).
 */
const swcPlugin = swc.vite({
    jsc: {
        parser: {
            syntax: 'typescript',
            decorators: true,
        },
        transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
        },
        target: 'es2022',
    },
});

export default defineConfig({
    plugins: [swcPlugin],
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
        },
        projects: [
            // Fast tests with no database dependency
            {
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.test.ts'],
                    globals: true,
                },
            },

            // Tests against a real graph database:
            // Relate (embedded, default) or Neo4j / Memgraph via Bolt (env vars)
            {
                test: {
                    name: 'integration',
                    include: ['test/integration/**/*.test.ts'],
                    setupFiles: ['./test/integration/setup.ts'],
                    testTimeout: 30000,
                    globals: true,
                },
            },
        ],
    },
});
