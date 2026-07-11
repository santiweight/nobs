/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IGitWorktreeService = createDecorator<IGitWorktreeService>('gitWorktreeService');

export interface IGitWorktreeInfo {
	readonly path: string;
	readonly branch: string;
	readonly isMain: boolean;
	readonly detached: boolean;
}

export interface IGitWorktreeService {
	readonly _serviceBrand: undefined;

	isGitRepo(path: string): Promise<boolean>;
	initRepo(path: string): Promise<void>;
	listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]>;
	addWorktree(repoPath: string, path: string, branch: string): Promise<IGitWorktreeInfo>;
	removeWorktree(repoPath: string, worktreePath: string, force?: boolean): Promise<void>;
	getCurrentBranch(repoPath: string): Promise<string | undefined>;
}
