/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { IGitWorktreeService, IGitWorktreeInfo } from '../common/gitWorktreeService.js';

const execFile = promisify(execFileCb);

export class GitWorktreeMainService implements IGitWorktreeService {

	declare readonly _serviceBrand: undefined;

	async isGitRepo(path: string): Promise<boolean> {
		try {
			await execFile('git', ['-C', path, 'rev-parse', '--git-dir']);
			return true;
		} catch {
			return false;
		}
	}

	async initRepo(path: string): Promise<void> {
		await execFile('git', ['-C', path, 'init']);
	}

	async listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]> {
		const { stdout } = await execFile('git', ['-C', repoPath, 'worktree', 'list', '--porcelain']);
		return this._parsePorcelain(stdout);
	}

	async addWorktree(repoPath: string, path: string, branch: string): Promise<IGitWorktreeInfo> {
		await execFile('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, path]);
		const worktrees = await this.listWorktrees(repoPath);
		const created = worktrees.find(w => w.path === path);
		if (!created) {
			throw new Error(`Worktree at ${path} was not found after creation`);
		}
		return created;
	}

	async removeWorktree(repoPath: string, worktreePath: string, force?: boolean): Promise<void> {
		const args = ['-C', repoPath, 'worktree', 'remove', worktreePath];
		if (force) {
			args.push('--force');
		}
		await execFile('git', args);
	}

	async getCurrentBranch(repoPath: string): Promise<string | undefined> {
		try {
			const { stdout } = await execFile('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD']);
			return stdout.trim() || undefined;
		} catch {
			return undefined;
		}
	}

	private _parsePorcelain(output: string): IGitWorktreeInfo[] {
		const results: IGitWorktreeInfo[] = [];
		const blocks = output.trim().split('\n\n');

		for (const block of blocks) {
			if (!block.trim()) {
				continue;
			}
			const lines = block.split('\n');
			let path = '';
			let branch = '';
			let isMain = false;
			let detached = false;

			for (const line of lines) {
				if (line.startsWith('worktree ')) {
					path = line.substring('worktree '.length);
				} else if (line.startsWith('branch ')) {
					const ref = line.substring('branch '.length);
					branch = ref.startsWith('refs/heads/') ? ref.substring('refs/heads/'.length) : ref;
				} else if (line === 'detached') {
					detached = true;
				} else if (line === 'bare') {
					isMain = true;
				}
			}

			if (path) {
				if (!isMain) {
					isMain = results.length === 0;
				}
				results.push({ path, branch, isMain, detached });
			}
		}

		return results;
	}
}
