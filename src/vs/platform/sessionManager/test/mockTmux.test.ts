/*---------------------------------------------------------------------------------------------
 *  Tests for MockTmux — verify the mock itself behaves correctly.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { MockTmux } from './mockTmux.js';

suite('MockTmux', () => {

	let mock: MockTmux;

	setup(() => {
		mock = new MockTmux();
	});

	test('newSession creates a session', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		assert.ok(mock.sessions.has('s1'));
		assert.strictEqual(mock.sessions.get('s1')!.alive, true);
	});

	test('newSession rejects duplicate names', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		await assert.rejects(() => mock.newSession('s1', 'cmd', '/tmp'), /duplicate session/);
	});

	test('hasSession returns true for alive, false for dead', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		assert.strictEqual(await mock.hasSession('s1'), true);
		mock.destroySession('s1');
		assert.strictEqual(await mock.hasSession('s1'), false);
	});

	test('hasSession returns false for nonexistent', async () => {
		assert.strictEqual(await mock.hasSession('nope'), false);
	});

	test('sendKeys records input', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		await mock.sendKeys('s1', 'hello');
		await mock.sendKeys('s1', 'world');
		assert.deepStrictEqual(mock.sessions.get('s1')!.keysReceived, ['hello', 'world']);
	});

	test('sendKeys throws on dead session', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		mock.destroySession('s1');
		await assert.rejects(() => mock.sendKeys('s1', 'hello'), /session not found/);
	});

	test('capturePane returns output', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		mock.appendOutput('s1', 'line1\n');
		assert.strictEqual(await mock.capturePane('s1'), 'line1\n');
		mock.appendOutput('s1', 'line2\n');
		assert.strictEqual(await mock.capturePane('s1'), 'line1\nline2\n');
	});

	test('killSession marks session dead', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		await mock.killSession('s1');
		assert.strictEqual(mock.sessions.get('s1')!.alive, false);
	});

	test('killSession on nonexistent is no-op', async () => {
		await mock.killSession('nope');
	});

	test('listSessions returns only alive sessions', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		await mock.newSession('s2', 'cmd', '/tmp');
		mock.destroySession('s1');
		const list = await mock.listSessions();
		assert.deepStrictEqual(list, ['s2']);
	});

	test('reset clears everything', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		mock.reset();
		assert.strictEqual(mock.sessions.size, 0);
		assert.strictEqual(mock.calls.length, 0);
	});

	test('calls are tracked in order', async () => {
		await mock.newSession('s1', 'cmd', '/tmp');
		await mock.sendKeys('s1', 'hi');
		await mock.capturePane('s1');
		assert.strictEqual(mock.calls.length, 3);
		assert.strictEqual(mock.calls[0].method, 'newSession');
		assert.strictEqual(mock.calls[1].method, 'sendKeys');
		assert.strictEqual(mock.calls[2].method, 'capturePane');
	});
});
