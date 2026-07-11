/*---------------------------------------------------------------------------------------------
 *  Tests for tmux.ts — sessionName helper and ITmux interface contract.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { sessionName, SESSION_PREFIX } from '../node/tmux.js';

suite('tmux', () => {

	test('sessionName prefixes with nobs_', () => {
		assert.strictEqual(sessionName('abc-123'), 'nobs_abc-123');
	});

	test('sessionName with empty string', () => {
		assert.strictEqual(sessionName(''), 'nobs_');
	});

	test('SESSION_PREFIX is nobs_', () => {
		assert.strictEqual(SESSION_PREFIX, 'nobs_');
	});

	test('sessionName with uuid-like id', () => {
		const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
		const name = sessionName(id);
		assert.ok(name.startsWith('nobs_'));
		assert.ok(name.endsWith(id));
	});
});
