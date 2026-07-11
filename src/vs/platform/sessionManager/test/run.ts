/*---------------------------------------------------------------------------------------------
 *  Standalone test runner — no mocha dependency needed.
 *  Implements suite/test/setup with the same TDD interface.
 *
 *  Run with: npx tsx src/vs/platform/sessionManager/test/run.ts
 *--------------------------------------------------------------------------------------------*/

interface TestCase {
	name: string;
	fn: () => Promise<void> | void;
}

interface Suite {
	name: string;
	setup?: () => Promise<void> | void;
	tests: TestCase[];
	suites: Suite[];
}

const rootSuite: Suite = { name: '', setup: undefined, tests: [], suites: [] };
const suiteStack: Suite[] = [rootSuite];

function current(): Suite {
	return suiteStack[suiteStack.length - 1];
}

(globalThis as any).suite = (name: string, fn: () => void) => {
	const s: Suite = { name, setup: undefined, tests: [], suites: [] };
	current().suites.push(s);
	suiteStack.push(s);
	fn();
	suiteStack.pop();
};

(globalThis as any).test = (name: string, fn: () => Promise<void> | void) => {
	current().tests.push({ name, fn });
};

(globalThis as any).setup = (fn: () => Promise<void> | void) => {
	current().setup = fn;
};

async function runSuite(s: Suite, indent: string, parentSetups: Array<() => Promise<void> | void> = []): Promise<{ passed: number; failed: number }> {
	let passed = 0;
	let failed = 0;

	if (s.name) {
		console.log(`${indent}${s.name}`);
	}

	const allSetups = s.setup ? [...parentSetups, s.setup] : parentSetups;

	for (const t of s.tests) {
		for (const setupFn of allSetups) {
			await setupFn();
		}
		try {
			await t.fn();
			console.log(`${indent}  ✓ ${t.name}`);
			passed++;
		} catch (err: any) {
			console.log(`${indent}  ✗ ${t.name}`);
			console.log(`${indent}    ${err.message}`);
			if (err.stack) {
				const lines = err.stack.split('\n').slice(1, 3);
				for (const line of lines) {
					console.log(`${indent}    ${line.trim()}`);
				}
			}
			failed++;
		}
	}

	for (const child of s.suites) {
		const result = await runSuite(child, indent + '  ', allSetups);
		passed += result.passed;
		failed += result.failed;
	}

	return { passed, failed };
}

async function main() {
	// Load test files
	await import('./mockTmux.test.js');
	await import('./tmux.test.js');
	await import('./sessionManager.test.js');

	console.log('\nSession Manager Tests\n');
	const { passed, failed } = await runSuite(rootSuite, '');
	console.log(`\n${passed} passed, ${failed} failed`);

	if (failed > 0) {
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
