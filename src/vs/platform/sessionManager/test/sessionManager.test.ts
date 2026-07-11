/*---------------------------------------------------------------------------------------------
 *  Tests for ISessionManager — shared suite runs 1:1 for every provider.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { SessionEventType, SessionStatus, type ISessionManager, type SessionEvent } from '../common/types.js';
import { IDLE_TIMEOUT_MS, ClaudeSessionManager, CodexSessionManager } from '../node/sessionManagerImpl.js';
import { MockPtyFactory } from './mockPty.js';

function wait(ms: number): Promise<void> {
	return new Promise(r => setTimeout(r, ms));
}

async function collectEvents(stream: AsyncIterable<SessionEvent>, maxMs: number = 10000): Promise<SessionEvent[]> {
	const events: SessionEvent[] = [];
	const timeout = setTimeout(() => { /* safety net */ }, maxMs);
	try {
		for await (const event of stream) {
			events.push(event);
		}
	} finally {
		clearTimeout(timeout);
	}
	return events;
}

async function drainWithTimeout(stream: AsyncIterable<SessionEvent>, maxMs: number): Promise<SessionEvent[]> {
	return new Promise<SessionEvent[]>(async (resolve) => {
		const events: SessionEvent[] = [];
		const timer = setTimeout(() => resolve(events), maxMs);
		try {
			for await (const event of stream) {
				events.push(event);
			}
		} finally {
			clearTimeout(timer);
		}
		resolve(events);
	});
}

interface ProviderSpec {
	name: string;
	command: string;
	args: string[];
	create: (factory: MockPtyFactory) => ISessionManager;
}

const providers: ProviderSpec[] = [
	{
		name: 'ClaudeSessionManager',
		command: 'claude',
		args: ['--dangerously-skip-permissions'],
		create: (factory) => new ClaudeSessionManager(factory.spawnPty),
	},
	{
		name: 'CodexSessionManager',
		command: 'codex',
		args: ['--approval-mode', 'full-auto'],
		create: (factory) => new CodexSessionManager(factory.spawnPty),
	},
];

for (const provider of providers) {

	suite(provider.name, () => {

		let factory: MockPtyFactory;
		let manager: any; // PtySessionManager with dispose()

		setup(() => {
			factory = new MockPtyFactory();
			manager = provider.create(factory);
		});

		teardown(async () => {
			await manager.dispose();
		});

		// ── spawn ──────────────────────────────────────────────────────

		suite('spawn', () => {

			test('spawns PTY with correct command and args', async () => {
				await manager.spawn('hello', '/tmp');
				assert.strictEqual(factory.spawnCalls.length, 1);
				assert.strictEqual(factory.spawnCalls[0].file, provider.command);
				assert.deepStrictEqual(factory.spawnCalls[0].args, provider.args);
				assert.strictEqual(factory.spawnCalls[0].options.cwd, '/tmp');
			});

			test('sends the prompt via pty.write', async () => {
				await manager.spawn('my prompt', '/tmp');
				const pty = factory.lastPty;
				assert.ok(pty.writes.some(w => w.includes('my prompt')));
			});

			test('prompt is sent with carriage return', async () => {
				await manager.spawn('do something', '/tmp');
				const pty = factory.lastPty;
				assert.ok(pty.writes.some(w => w === 'do something\r'));
			});

			test('empty prompt does not write', async () => {
				await manager.spawn('', '/tmp');
				const pty = factory.lastPty;
				assert.strictEqual(pty.writes.length, 0);
			});

			test('returns a unique session id', async () => {
				const { id: id1 } = await manager.spawn('a', '/tmp');
				const { id: id2 } = await manager.spawn('b', '/tmp');
				assert.notStrictEqual(id1, id2);
			});

			test('initial status is running', async () => {
				const { id } = await manager.spawn('x', '/tmp');
				assert.strictEqual(await manager.status(id), SessionStatus.Running);
			});

			test('stream emits stdout when pty outputs data', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;

				setTimeout(() => {
					pty.fireData('hello world\n');
				}, 10);

				const events = await drainWithTimeout(stream, IDLE_TIMEOUT_MS + 500);
				const stdoutEvents = events.filter(e => e.type === SessionEventType.Stdout);
				assert.ok(stdoutEvents.length > 0, 'expected at least one stdout event');
				assert.ok(stdoutEvents.some(e => e.type === SessionEventType.Stdout && e.data.includes('hello world')));
			});

			test('stream ends with idle status after no output', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;

				pty.fireData('initial output');

				const events = await collectEvents(stream);
				const lastStatusChange = events.filter(e => e.type === SessionEventType.StatusChange).pop();
				assert.ok(lastStatusChange);
				if (lastStatusChange.type === SessionEventType.StatusChange) {
					assert.strictEqual(lastStatusChange.to, SessionStatus.Idle);
				}
			});

			test('stream ends with exit when pty exits', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;

				pty.fireData('some output');
				setTimeout(() => pty.fireExit(0), 50);

				const events = await collectEvents(stream);
				const hasTerminal = events.some(
					e => e.type === SessionEventType.Exit ||
						(e.type === SessionEventType.StatusChange && e.to === SessionStatus.Dead)
				);
				assert.ok(hasTerminal, 'expected an exit or dead event');
			});
		});

		// ── status ─────────────────────────────────────────────────────

		suite('status', () => {

			test('returns dead for unknown id', async () => {
				assert.strictEqual(await manager.status('nonexistent'), SessionStatus.Dead);
			});

			test('returns running for newly spawned session', async () => {
				const { id } = await manager.spawn('x', '/tmp');
				assert.strictEqual(await manager.status(id), SessionStatus.Running);
			});

			test('returns dead after pty exits', async () => {
				const { id } = await manager.spawn('x', '/tmp');
				factory.lastPty.fireExit(0);
				assert.strictEqual(await manager.status(id), SessionStatus.Dead);
			});

			test('returns dead after kill', async () => {
				const { id } = await manager.spawn('x', '/tmp');
				await manager.kill(id);
				assert.strictEqual(await manager.status(id), SessionStatus.Dead);
			});
		});

		// ── kill ───────────────────────────────────────────────────────

		suite('kill', () => {

			test('kills the pty process', async () => {
				await manager.spawn('x', '/tmp');
				const pty = factory.lastPty;
				const { id } = (await manager.list())[0];
				await manager.kill(id);
				assert.ok(pty.killed);
			});

			test('sets status to dead', async () => {
				const { id } = await manager.spawn('x', '/tmp');
				await manager.kill(id);
				assert.strictEqual(await manager.status(id), SessionStatus.Dead);
			});

			test('kill nonexistent session is no-op', async () => {
				await manager.kill('nonexistent');
			});

			test('kill already-dead session is no-op', async () => {
				const { id } = await manager.spawn('x', '/tmp');
				await manager.kill(id);
				await manager.kill(id);
				assert.strictEqual(await manager.status(id), SessionStatus.Dead);
			});
		});

		// ── list ───────────────────────────────────────────────────────

		suite('list', () => {

			test('returns empty for fresh manager', async () => {
				const sessions = await manager.list();
				assert.strictEqual(sessions.length, 0);
			});

			test('returns all spawned sessions', async () => {
				await manager.spawn('a', '/tmp/a');
				await manager.spawn('b', '/tmp/b');
				const sessions = await manager.list();
				assert.strictEqual(sessions.length, 2);
			});

			test('includes correct session info', async () => {
				const { id } = await manager.spawn('test', '/workspace');
				const sessions = await manager.list();
				const session = sessions.find(s => s.id === id);
				assert.ok(session);
				assert.strictEqual(session.cwd, '/workspace');
				assert.strictEqual(session.status, SessionStatus.Running);
				assert.ok(session.createdAt > 0);
				assert.ok(session.lastActivityAt > 0);
			});

			test('reflects dead status after kill', async () => {
				const { id } = await manager.spawn('test', '/tmp');
				await manager.kill(id);
				const sessions = await manager.list();
				assert.strictEqual(sessions.find(s => s.id === id)!.status, SessionStatus.Dead);
			});
		});

		// ── resume ─────────────────────────────────────────────────────

		suite('resume', () => {

			test('sends prompt to existing session', async () => {
				const { id } = await manager.spawn('first', '/tmp');
				const pty = factory.lastPty;
				pty.fireData('initial');

				await manager.resume(id, 'second prompt');
				assert.ok(pty.writes.some(w => w === 'second prompt\r'));
			});

			test('respawns dead session with correct command', async () => {
				const { id } = await manager.spawn('first', '/tmp');
				factory.lastPty.fireExit(0);

				await manager.resume(id, 'revive');
				assert.strictEqual(factory.spawnCalls.length, 2);
				assert.strictEqual(factory.spawnCalls[1].file, provider.command);
				assert.deepStrictEqual(factory.spawnCalls[1].args, provider.args);
			});

			test('throws for unknown session id', async () => {
				await assert.rejects(() => manager.resume('nonexistent', 'x'), /Session not found/);
			});

			test('sets status back to running', async () => {
				const { id } = await manager.spawn('first', '/tmp');
				const pty = factory.lastPty;
				pty.fireData('output');

				// Wait for idle
				await wait(IDLE_TIMEOUT_MS + 100);

				await manager.resume(id, 'second');
				assert.strictEqual(await manager.status(id), SessionStatus.Running);
			});

			test('resume returns a new stream that emits events', async () => {
				const { id } = await manager.spawn('first', '/tmp');
				const pty1 = factory.lastPty;
				pty1.fireData('initial');
				await wait(IDLE_TIMEOUT_MS + 100);

				const stream = await manager.resume(id, 'second');
				// For a dead-then-resumed session, pty2 is the new one
				// For an idle-then-resumed session, it's still pty1
				const pty = factory.lastPty;
				setTimeout(() => {
					pty.fireData('new output after resume');
				}, 10);

				const events = await drainWithTimeout(stream, IDLE_TIMEOUT_MS + 500);
				const stdoutEvents = events.filter(e => e.type === SessionEventType.Stdout);
				assert.ok(stdoutEvents.length > 0, 'expected stdout events from resumed stream');
			});
		});

		// ── idle detection ─────────────────────────────────────────────

		suite('idle detection', () => {

			test('output resets idle timer', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;

				let counter = 0;
				const drip = setInterval(() => {
					counter++;
					pty.fireData(`drip${counter}\n`);
					if (counter >= 3) {
						clearInterval(drip);
					}
				}, IDLE_TIMEOUT_MS / 2);

				const startTime = Date.now();
				const events = await collectEvents(stream);
				const elapsed = Date.now() - startTime;

				clearInterval(drip);

				assert.ok(elapsed > IDLE_TIMEOUT_MS, `elapsed ${elapsed}ms should be > ${IDLE_TIMEOUT_MS}ms`);

				const stdoutEvents = events.filter(e => e.type === SessionEventType.Stdout);
				assert.ok(stdoutEvents.length >= 3, `expected ≥3 stdout events, got ${stdoutEvents.length}`);
			});

			test('no output leads to idle within expected time', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;

				pty.fireData('one burst');

				const startTime = Date.now();
				await collectEvents(stream);
				const elapsed = Date.now() - startTime;

				const maxExpected = IDLE_TIMEOUT_MS + 500;
				assert.ok(elapsed < maxExpected, `elapsed ${elapsed}ms should be < ${maxExpected}ms`);
			});
		});

		// ── stream behavior ────────────────────────────────────────────

		suite('stream', () => {

			test('stream.return() stops delivering events', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;
				pty.fireData('output');

				const iter = stream[Symbol.asyncIterator]();
				await iter.next();
				await iter.return!();

				// further data should not cause errors
				pty.fireData('more output');
				await wait(50);
			});

			test('multiple concurrent spawns work independently', async () => {
				const { stream: stream1 } = await manager.spawn('a', '/tmp/a');
				const pty1 = factory.ptys[0];
				const { stream: stream2 } = await manager.spawn('b', '/tmp/b');
				const pty2 = factory.ptys[1];

				// Fire data after collectEvents starts iterating (which registers the stream listener)
				setTimeout(() => {
					pty1.fireData('output from session 1');
					pty2.fireData('output from session 2');
				}, 10);

				const [events1, events2] = await Promise.all([
					collectEvents(stream1),
					collectEvents(stream2),
				]);

				const stdout1 = events1.filter(e => e.type === SessionEventType.Stdout).map(e => (e as any).data).join('');
				const stdout2 = events2.filter(e => e.type === SessionEventType.Stdout).map(e => (e as any).data).join('');

				assert.ok(stdout1.includes('session 1'));
				assert.ok(stdout2.includes('session 2'));
				assert.ok(!stdout1.includes('session 2'));
				assert.ok(!stdout2.includes('session 1'));
			});

			test('killing a session terminates its active stream', async () => {
				const { id, stream } = await manager.spawn('test', '/tmp');
				factory.lastPty.fireData('some output');

				setTimeout(() => manager.kill(id), 50);

				const events = await collectEvents(stream);
				const hasTerminal = events.some(
					e => e.type === SessionEventType.Exit ||
						(e.type === SessionEventType.StatusChange && e.to === SessionStatus.Dead)
				);
				assert.ok(hasTerminal, 'expected an exit or dead event');
			});
		});

		// ── getOutput ──────────────────────────────────────────────────

		suite('getOutput', () => {

			test('returns accumulated output', async () => {
				const { id } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;
				pty.fireData('hello ');
				pty.fireData('world');

				const output = await manager.getOutput(id);
				assert.strictEqual(output, 'hello world');
			});

			test('throws for unknown session id', async () => {
				await assert.rejects(() => manager.getOutput('nonexistent'), /Session not found/);
			});

			test('preserves ANSI escape codes', async () => {
				const { id } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;
				pty.fireData('\x1b[32mgreen text\x1b[0m');

				const output = await manager.getOutput(id);
				assert.ok(output.includes('\x1b[32m'), 'expected ANSI codes preserved');
			});
		});

		// ── edge cases ─────────────────────────────────────────────────

		suite('edge cases', () => {

			test('rapid sequential spawns', async () => {
				const ids: string[] = [];
				for (let i = 0; i < 10; i++) {
					const { id } = await manager.spawn(`prompt ${i}`, '/tmp');
					ids.push(id);
				}
				assert.strictEqual(new Set(ids).size, 10);
				const sessions = await manager.list();
				assert.strictEqual(sessions.length, 10);
			});

			test('status after kill then respawn via resume', async () => {
				const { id } = await manager.spawn('initial', '/tmp');
				await manager.kill(id);
				assert.strictEqual(await manager.status(id), SessionStatus.Dead);

				await manager.resume(id, 'revived');
				assert.strictEqual(await manager.status(id), SessionStatus.Running);
			});

			test('pty exit mid-stream', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;
				pty.fireData('initial output');

				setTimeout(() => pty.fireExit(1), 50);

				const events = await collectEvents(stream);
				const hasTerminal = events.some(
					e => e.type === SessionEventType.Exit ||
						(e.type === SessionEventType.StatusChange && e.to === SessionStatus.Dead)
				);
				assert.ok(hasTerminal, 'expected exit or dead event when pty exits');
			});

			test('exit code is preserved', async () => {
				const { stream } = await manager.spawn('test', '/tmp');
				const pty = factory.lastPty;

				setTimeout(() => pty.fireExit(42), 10);

				const events = await collectEvents(stream);
				const exitEvent = events.find(e => e.type === SessionEventType.Exit);
				assert.ok(exitEvent);
				if (exitEvent.type === SessionEventType.Exit) {
					assert.strictEqual(exitEvent.code, 42);
				}
			});
		});
	});
}
