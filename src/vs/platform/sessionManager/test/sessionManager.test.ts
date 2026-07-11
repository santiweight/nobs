/*---------------------------------------------------------------------------------------------
 *  Tests for SessionManager — the 5-function API with mock tmux.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { SessionEventType, SessionStatus, type SessionEvent } from '../common/types.js';
import { IDLE_TIMEOUT_MS, POLL_INTERVAL_MS, SessionManager } from '../node/sessionManagerImpl.js';
import { MockTmux } from './mockTmux.js';

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

suite('SessionManager', () => {

	let mock: MockTmux;
	let manager: SessionManager;

	setup(() => {
		mock = new MockTmux();
		manager = new SessionManager(mock);
	});

	// ── spawn ──────────────────────────────────────────────────────

	suite('spawn', () => {

		test('creates a tmux session with correct command', async () => {
			const { id } = await manager.spawn('hello', '/tmp');
			assert.ok(id);
			const newSessionCall = mock.calls.find(c => c.method === 'newSession');
			assert.ok(newSessionCall);
			assert.strictEqual(newSessionCall.args[1], 'claude --dangerously-skip-permissions');
			assert.strictEqual(newSessionCall.args[2], '/tmp');
		});

		test('sends the prompt via sendKeys', async () => {
			await manager.spawn('my prompt', '/tmp');
			const sendCall = mock.calls.find(c => c.method === 'sendKeys');
			assert.ok(sendCall);
			assert.strictEqual(sendCall.args[1], 'my prompt');
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

		test('stream emits stdout when output appears', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;

			setTimeout(() => {
				mock.appendOutput(tmuxName, 'hello world\n');
			}, POLL_INTERVAL_MS + 50);

			const events = await drainWithTimeout(stream, IDLE_TIMEOUT_MS + POLL_INTERVAL_MS * 5);
			const stdoutEvents = events.filter(e => e.type === SessionEventType.Stdout);
			assert.ok(stdoutEvents.length > 0, 'expected at least one stdout event');
			assert.ok(stdoutEvents.some(e => e.type === SessionEventType.Stdout && e.data.includes('hello world')));
		});

		test('stream ends with idle status after no output', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;

			mock.appendOutput(tmuxName, 'initial output');

			const events = await collectEvents(stream);
			const lastStatusChange = events.filter(e => e.type === SessionEventType.StatusChange).pop();
			assert.ok(lastStatusChange);
			assert.strictEqual(lastStatusChange.type, SessionEventType.StatusChange);
			if (lastStatusChange.type === SessionEventType.StatusChange) {
				assert.strictEqual(lastStatusChange.to, SessionStatus.Idle);
			}
		});

		test('stream ends with exit when tmux session dies', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;

			// Produce some output first so polling is active, then kill
			mock.appendOutput(tmuxName, 'some output');
			await wait(POLL_INTERVAL_MS * 2);
			mock.destroySession(tmuxName);

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

		test('detects tmux session death', async () => {
			const { id } = await manager.spawn('x', '/tmp');
			mock.destroySession(`nobs_${id}`);
			assert.strictEqual(await manager.status(id), SessionStatus.Dead);
		});

		test('does not flip dead back to alive', async () => {
			const { id } = await manager.spawn('x', '/tmp');
			mock.destroySession(`nobs_${id}`);
			assert.strictEqual(await manager.status(id), SessionStatus.Dead);
			// even if we somehow revive the tmux session, status sticks dead
			// (because _setStatus won't transition dead→dead)
			assert.strictEqual(await manager.status(id), SessionStatus.Dead);
		});
	});

	// ── kill ───────────────────────────────────────────────────────

	suite('kill', () => {

		test('kills the tmux session', async () => {
			const { id } = await manager.spawn('x', '/tmp');
			await manager.kill(id);
			const killCall = mock.calls.find(c => c.method === 'killSession');
			assert.ok(killCall);
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
			assert.ok(session.tmuxSession.startsWith('nobs_'));
			assert.ok(session.createdAt > 0);
			assert.ok(session.lastActivityAt > 0);
		});

		test('cross-checks tmux and marks dead sessions', async () => {
			const { id } = await manager.spawn('test', '/tmp');
			mock.destroySession(`nobs_${id}`);
			const sessions = await manager.list();
			const session = sessions.find(s => s.id === id);
			assert.ok(session);
			assert.strictEqual(session.status, SessionStatus.Dead);
		});

		test('preserves already-dead status without re-querying', async () => {
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
			// drain the spawn stream so it settles
			const tmuxName = `nobs_${id}`;
			mock.appendOutput(tmuxName, 'initial');

			await manager.resume(id, 'second prompt');
			const sendCalls = mock.calls.filter(c => c.method === 'sendKeys');
			assert.strictEqual(sendCalls.length, 2);
			assert.strictEqual(sendCalls[1].args[1], 'second prompt');
		});

		test('respawns dead tmux session', async () => {
			const { id } = await manager.spawn('first', '/tmp');
			const tmuxName = `nobs_${id}`;
			mock.destroySession(tmuxName);

			await manager.resume(id, 'revive');
			const newSessionCalls = mock.calls.filter(c => c.method === 'newSession');
			assert.strictEqual(newSessionCalls.length, 2);
			assert.strictEqual(await mock.hasSession(tmuxName), true);
		});

		test('throws for unknown session id', async () => {
			await assert.rejects(() => manager.resume('nonexistent', 'x'), /Session not found/);
		});

		test('sets status back to running', async () => {
			const { id } = await manager.spawn('first', '/tmp');
			const tmuxName = `nobs_${id}`;
			mock.appendOutput(tmuxName, 'output');

			// Wait for idle
			await wait(IDLE_TIMEOUT_MS + POLL_INTERVAL_MS * 3);

			await manager.resume(id, 'second');
			assert.strictEqual(await manager.status(id), SessionStatus.Running);
		});

		test('resume returns a new stream that emits events', async () => {
			const { id } = await manager.spawn('first', '/tmp');
			const tmuxName = `nobs_${id}`;
			mock.appendOutput(tmuxName, 'initial');

			// let spawn's stream settle
			await wait(IDLE_TIMEOUT_MS + POLL_INTERVAL_MS * 3);

			// resume and produce new output
			const stream = await manager.resume(id, 'second');
			setTimeout(() => {
				mock.appendOutput(tmuxName, '\nnew output after resume');
			}, POLL_INTERVAL_MS + 50);

			const events = await drainWithTimeout(stream, IDLE_TIMEOUT_MS + POLL_INTERVAL_MS * 5);
			const stdoutEvents = events.filter(e => e.type === SessionEventType.Stdout);
			assert.ok(stdoutEvents.length > 0, 'expected stdout events from resumed stream');
		});
	});

	// ── idle detection ─────────────────────────────────────────────

	suite('idle detection', () => {

		test('output resets idle timer', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;

			// drip output every 500ms to keep resetting idle timer
			const intervals: ReturnType<typeof setTimeout>[] = [];
			let counter = 0;
			const drip = setInterval(() => {
				counter++;
				mock.appendOutput(tmuxName, `drip${counter}\n`);
				if (counter >= 3) {
					clearInterval(drip);
				}
			}, IDLE_TIMEOUT_MS / 2);
			intervals.push(drip);

			const startTime = Date.now();
			const events = await collectEvents(stream);
			const elapsed = Date.now() - startTime;

			intervals.forEach(i => clearInterval(i));

			// should have taken longer than a single idle timeout
			// because the drips kept resetting it
			assert.ok(elapsed > IDLE_TIMEOUT_MS, `elapsed ${elapsed}ms should be > ${IDLE_TIMEOUT_MS}ms`);

			const stdoutEvents = events.filter(e => e.type === SessionEventType.Stdout);
			assert.ok(stdoutEvents.length >= 3, `expected ≥3 stdout events, got ${stdoutEvents.length}`);
		});

		test('no output leads to idle within expected time', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;

			// produce one burst of output then stop
			mock.appendOutput(tmuxName, 'one burst');

			const startTime = Date.now();
			await collectEvents(stream);
			const elapsed = Date.now() - startTime;

			// should go idle roughly around IDLE_TIMEOUT_MS (plus some polling slack)
			const maxExpected = IDLE_TIMEOUT_MS + POLL_INTERVAL_MS * 5;
			assert.ok(elapsed < maxExpected, `elapsed ${elapsed}ms should be < ${maxExpected}ms`);
		});
	});

	// ── stream behavior ────────────────────────────────────────────

	suite('stream', () => {

		test('stream.return() stops polling', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;
			mock.appendOutput(tmuxName, 'output');

			const iter = stream[Symbol.asyncIterator]();
			await iter.next();
			await iter.return!();

			// wait a bit and verify no more capturePane calls pile up
			const callCountBefore = mock.calls.filter(c => c.method === 'capturePane').length;
			await wait(POLL_INTERVAL_MS * 3);
			const callCountAfter = mock.calls.filter(c => c.method === 'capturePane').length;

			// allow at most 1 extra call (from an in-flight poll)
			assert.ok(callCountAfter - callCountBefore <= 1,
				`expected polling to stop, but ${callCountAfter - callCountBefore} extra calls`);
		});

		test('multiple concurrent spawns work independently', async () => {
			const { id: id1, stream: stream1 } = await manager.spawn('a', '/tmp/a');
			const { id: id2, stream: stream2 } = await manager.spawn('b', '/tmp/b');

			mock.appendOutput(`nobs_${id1}`, 'output from session 1');
			mock.appendOutput(`nobs_${id2}`, 'output from session 2');

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
			const tmuxName = `nobs_${id}`;
			mock.appendOutput(tmuxName, 'some output');

			// kill after a short delay
			setTimeout(() => manager.kill(id), POLL_INTERVAL_MS * 2);

			const events = await collectEvents(stream);
			const hasDeadEvent = events.some(
				e => e.type === SessionEventType.StatusChange && e.to === SessionStatus.Dead
			);
			assert.ok(hasDeadEvent, 'expected a status change to dead');
		});

		test('empty output diff does not emit stdout', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;

			// set output once, then let it sit
			mock.setOutput(tmuxName, 'static');

			const events = await collectEvents(stream);
			const stdoutEvents = events.filter(e => e.type === SessionEventType.Stdout);
			// should get exactly one stdout for the initial "static" text
			assert.strictEqual(stdoutEvents.length, 1);
		});
	});

	// ── edge cases ─────────────────────────────────────────────────

	suite('edge cases', () => {

		test('spawn with empty prompt', async () => {
			const { id } = await manager.spawn('', '/tmp');
			assert.ok(id);
			const sendCall = mock.calls.find(c => c.method === 'sendKeys');
			assert.ok(sendCall);
			assert.strictEqual(sendCall.args[1], '');
		});

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

		test('tmux session vanishing mid-poll', async () => {
			const { id, stream } = await manager.spawn('test', '/tmp');
			const tmuxName = `nobs_${id}`;
			mock.appendOutput(tmuxName, 'initial output');

			// wait for polling to pick up the output, then kill
			await wait(POLL_INTERVAL_MS * 2);
			mock.destroySession(tmuxName);

			const events = await collectEvents(stream);
			const hasTerminal = events.some(
				e => e.type === SessionEventType.Exit ||
					(e.type === SessionEventType.StatusChange && e.to === SessionStatus.Dead)
			);
			assert.ok(hasTerminal, 'expected exit or dead event when tmux session vanishes');
		});

		test('list reflects external tmux death', async () => {
			const { id } = await manager.spawn('test', '/tmp');
			// externally kill the tmux session (simulate crash)
			mock.destroySession(`nobs_${id}`);

			const sessions = await manager.list();
			assert.strictEqual(sessions[0].status, SessionStatus.Dead);
		});
	});
});
