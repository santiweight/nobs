/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { GitWorktreeMainService } from '../electron-main/gitWorktreeMainService.js';

suite('GitWorktreeMainService', () => {

	let service: GitWorktreeMainService;

	setup(() => {
		service = new GitWorktreeMainService();
	});

	suite('_parsePorcelain', () => {

		test('parses single main worktree', () => {
			const output = [
				'worktree /Users/dev/my-project',
				'HEAD abc1234',
				'branch refs/heads/main',
				'',
			].join('\n');

			const result = (service as any)._parsePorcelain(output);
			assert.deepStrictEqual(result, [{
				path: '/Users/dev/my-project',
				branch: 'main',
				isMain: true,
				detached: false,
			}]);
		});

		test('parses multiple worktrees with main flagged correctly', () => {
			const output = [
				'worktree /Users/dev/my-project',
				'HEAD abc1234',
				'branch refs/heads/main',
				'',
				'worktree /Users/dev/my-project-feature',
				'HEAD def5678',
				'branch refs/heads/feature/auth',
				'',
			].join('\n');

			const result = (service as any)._parsePorcelain(output);
			assert.deepStrictEqual(result, [
				{
					path: '/Users/dev/my-project',
					branch: 'main',
					isMain: true,
					detached: false,
				},
				{
					path: '/Users/dev/my-project-feature',
					branch: 'feature/auth',
					isMain: false,
					detached: false,
				},
			]);
		});

		test('parses detached HEAD worktree', () => {
			const output = [
				'worktree /Users/dev/my-project',
				'HEAD abc1234',
				'branch refs/heads/main',
				'',
				'worktree /Users/dev/detached-wt',
				'HEAD 9876543',
				'detached',
				'',
			].join('\n');

			const result = (service as any)._parsePorcelain(output);
			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result[1], {
				path: '/Users/dev/detached-wt',
				branch: '',
				isMain: false,
				detached: true,
			});
		});

		test('handles empty output', () => {
			const result = (service as any)._parsePorcelain('');
			assert.deepStrictEqual(result, []);
		});

		test('strips refs/heads/ prefix from branch names', () => {
			const output = [
				'worktree /a',
				'HEAD abc',
				'branch refs/heads/fix/smtp-auth',
				'',
			].join('\n');

			const result = (service as any)._parsePorcelain(output);
			assert.strictEqual(result[0].branch, 'fix/smtp-auth');
		});

		test('handles bare repo worktree', () => {
			const output = [
				'worktree /Users/dev/bare.git',
				'HEAD abc1234',
				'bare',
				'',
				'worktree /Users/dev/work',
				'HEAD def5678',
				'branch refs/heads/main',
				'',
			].join('\n');

			const result = (service as any)._parsePorcelain(output);
			assert.strictEqual(result[0].isMain, true);
			assert.strictEqual(result[1].isMain, false);
		});
	});
});
