/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { NobsWorkspaceService } from '../browser/nobsWorkspaceService.js';
import type { IGitWorktreeService, IGitWorktreeInfo } from '../../../../platform/gitWorktree/common/gitWorktreeService.js';
import { type IWorkspaceContextService, type IWorkspace, type IWorkspaceFolder, type IWorkspaceFoldersChangeEvent, type IWorkspaceFoldersWillChangeEvent, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

class MockGitWorktreeService implements IGitWorktreeService {
	readonly _serviceBrand: undefined;

	private _isGitRepo = true;
	private _worktrees: IGitWorktreeInfo[] = [
		{ path: '/projects/nobs', branch: 'main', isMain: true, detached: false },
	];
	private _branch = 'main';

	setIsGitRepo(v: boolean): void { this._isGitRepo = v; }
	setWorktrees(wt: IGitWorktreeInfo[]): void { this._worktrees = wt; }
	setBranch(b: string): void { this._branch = b; }

	async isGitRepo(): Promise<boolean> { return this._isGitRepo; }
	async initRepo(): Promise<void> { this._isGitRepo = true; }
	async listWorktrees(): Promise<IGitWorktreeInfo[]> { return this._worktrees; }
	async addWorktree(_repoPath: string, path: string, branch: string): Promise<IGitWorktreeInfo> {
		const info: IGitWorktreeInfo = { path, branch, isMain: false, detached: false };
		this._worktrees.push(info);
		return info;
	}
	async removeWorktree(_repoPath: string, worktreePath: string): Promise<void> {
		this._worktrees = this._worktrees.filter(w => w.path !== worktreePath);
	}
	async getCurrentBranch(): Promise<string | undefined> { return this._branch; }
}

class MockStorageService {
	private readonly _store = new Map<string, string>();
	get(key: string, _scope: StorageScope, fallback?: string): string | undefined { return this._store.get(key) ?? fallback; }
	store(key: string, value: string, _scope: StorageScope, _target: StorageTarget): void { this._store.set(key, value); }
	getObject<T>(key: string, _scope: StorageScope, fallback?: T): T | undefined { const v = this._store.get(key); return v ? JSON.parse(v) : fallback; }
}

function createMockWorkspaceContextService(folderPath: string): IWorkspaceContextService {
	const folder: IWorkspaceFolder = {
		uri: URI.file(folderPath),
		name: folderPath.split('/').pop()!,
		index: 0,
		toResource: (rel: string) => URI.file(`${folderPath}/${rel}`),
	} as IWorkspaceFolder;

	const workspace: IWorkspace = {
		id: 'test',
		folders: [folder],
		name: folder.name,
	};

	return {
		_serviceBrand: undefined,
		getWorkspace: () => workspace,
		getWorkbenchState: () => WorkbenchState.FOLDER,
		getWorkspaceFolder: () => folder,
		isInsideWorkspace: () => true,
		isCurrentWorkspace: () => true,
		getCompleteWorkspace: () => Promise.resolve(workspace),
		hasWorkspaceData: () => true,
		onDidChangeWorkbenchState: Event.None,
		onDidChangeWorkspaceName: Event.None,
		onWillChangeWorkspaceFolders: Event.None as Event<IWorkspaceFoldersWillChangeEvent>,
		onDidChangeWorkspaceFolders: Event.None as Event<IWorkspaceFoldersChangeEvent>,
	} as IWorkspaceContextService;
}

class MockFileDialogService {
	private _pickResult: URI[] | undefined;
	setPick(uris: URI[]): void { this._pickResult = uris; }
	async showOpenDialog(): Promise<URI[] | undefined> { return this._pickResult; }
}

function createService(opts?: {
	folderPath?: string;
	isGitRepo?: boolean;
	worktrees?: IGitWorktreeInfo[];
}): {
	service: NobsWorkspaceService;
	gitWorktree: MockGitWorktreeService;
	fileDialog: MockFileDialogService;
} {
	const folderPath = opts?.folderPath ?? '/projects/nobs';
	const gitWorktree = new MockGitWorktreeService();
	if (opts?.isGitRepo !== undefined) {
		gitWorktree.setIsGitRepo(opts.isGitRepo);
	}
	if (opts?.worktrees) {
		gitWorktree.setWorktrees(opts.worktrees);
	}
	const storage = new MockStorageService();
	const workspace = createMockWorkspaceContextService(folderPath);
	const fileDialog = new MockFileDialogService();

	const service = new NobsWorkspaceService(
		gitWorktree as any,
		workspace,
		storage as any,
		fileDialog as any,
	);

	return { service, gitWorktree, fileDialog };
}

function waitForEvent<T>(event: Event<T>, timeoutMs = 2000): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Event timeout')), timeoutMs);
		const disposable = event(value => {
			clearTimeout(timer);
			disposable.dispose();
			resolve(value);
		});
	});
}

suite('NobsWorkspaceService', () => {

	suite('Workflow 1: Open project → discover worktrees → auto-select', () => {

		test('discovers git repo and lists worktrees on startup', async () => {
			const { service } = createService({
				worktrees: [
					{ path: '/projects/nobs', branch: 'main', isMain: true, detached: false },
					{ path: '/projects/nobs-fix', branch: 'fix-smtp', isMain: false, detached: false },
				],
			});

			await waitForEvent(service.onDidChangeActiveWorkspace);

			assert.strictEqual(service.projects.length, 1);
			assert.strictEqual(service.projects[0].name, 'nobs');
			assert.strictEqual(service.projects[0].expanded, true);

			const workspaces = service.getWorkspacesForProject(service.projects[0].id);
			assert.strictEqual(workspaces.length, 2);
			assert.strictEqual(workspaces[0].branch, 'main');
			assert.strictEqual(workspaces[1].branch, 'fix-smtp');

			assert.strictEqual(service.activeWorkspace?.branch, 'main');
		});

		test('auto-selects workspace matching current folder', async () => {
			const { service } = createService({
				folderPath: '/projects/nobs-fix',
				worktrees: [
					{ path: '/projects/nobs', branch: 'main', isMain: true, detached: false },
					{ path: '/projects/nobs-fix', branch: 'fix-smtp', isMain: false, detached: false },
				],
			});

			await waitForEvent(service.onDidChangeActiveWorkspace);
			assert.strictEqual(service.activeWorkspace?.branch, 'fix-smtp');
			assert.strictEqual(service.activeWorkspace?.worktreePath, '/projects/nobs-fix');
		});

		test('handles non-git folder gracefully', async () => {
			const { service } = createService({ isGitRepo: false });

			await waitForEvent(service.onDidChangeActiveWorkspace);

			assert.strictEqual(service.projects.length, 1);
			const workspaces = service.getWorkspacesForProject(service.projects[0].id);
			assert.strictEqual(workspaces.length, 1);
			assert.strictEqual(workspaces[0].branch, '');
			assert.strictEqual(workspaces[0].isMain, true);
		});
	});

	suite('Workflow 2: Add worktree → switch → verify isolation → switch back', () => {

		test('addWorktree creates workspace and auto-selects it', async () => {
			const { service } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			const projectId = service.projects[0].id;
			const originalWs = service.activeWorkspace!;
			assert.strictEqual(originalWs.branch, 'main');

			const newWs = await service.addWorktree(projectId, 'feature-auth');

			assert.strictEqual(newWs.branch, 'feature-auth');
			assert.strictEqual(newWs.isMain, false);
			assert.strictEqual(service.activeWorkspace?.id, newWs.id);

			const workspaces = service.getWorkspacesForProject(projectId);
			assert.strictEqual(workspaces.length, 2);
		});

		test('switching workspace fires event and updates active', async () => {
			const { service } = createService({
				worktrees: [
					{ path: '/projects/nobs', branch: 'main', isMain: true, detached: false },
					{ path: '/projects/nobs-fix', branch: 'fix-auth', isMain: false, detached: false },
				],
			});
			await waitForEvent(service.onDidChangeActiveWorkspace);

			const workspaces = service.getWorkspacesForProject(service.projects[0].id);
			const fixWs = workspaces.find(w => w.branch === 'fix-auth')!;

			const eventPromise = waitForEvent(service.onDidChangeActiveWorkspace);
			service.selectWorkspace(fixWs.id);
			const fired = await eventPromise;

			assert.strictEqual(fired?.branch, 'fix-auth');
			assert.strictEqual(service.activeWorkspace?.id, fixWs.id);
		});

		test('switching back to original workspace preserves state', async () => {
			const { service } = createService({
				worktrees: [
					{ path: '/projects/nobs', branch: 'main', isMain: true, detached: false },
					{ path: '/projects/fix', branch: 'fix', isMain: false, detached: false },
				],
			});
			await waitForEvent(service.onDidChangeActiveWorkspace);

			const workspaces = service.getWorkspacesForProject(service.projects[0].id);
			const mainWs = workspaces.find(w => w.branch === 'main')!;
			const fixWs = workspaces.find(w => w.branch === 'fix')!;

			service.selectWorkspace(fixWs.id);
			assert.strictEqual(service.activeWorkspace?.branch, 'fix');

			service.selectWorkspace(mainWs.id);
			assert.strictEqual(service.activeWorkspace?.branch, 'main');
			assert.strictEqual(service.activeWorkspace?.worktreePath, '/projects/nobs');
		});

		test('selecting same workspace is a no-op', async () => {
			const { service } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			let eventCount = 0;
			service.onDidChangeActiveWorkspace(() => eventCount++);

			service.selectWorkspace(service.activeWorkspace!.id);
			assert.strictEqual(eventCount, 0);
		});
	});

	suite('Workflow 3: Add project → init git → create worktree → verify isolation', () => {

		test('addProject with non-git folder initializes git', async () => {
			const { service, gitWorktree, fileDialog } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			gitWorktree.setIsGitRepo(false);
			fileDialog.setPick([URI.file('/projects/new-project')]);
			gitWorktree.setWorktrees([
				{ path: '/projects/new-project', branch: 'main', isMain: true, detached: false },
			]);

			const project = await service.addProject();

			assert.ok(project);
			assert.strictEqual(project!.name, 'new-project');
			assert.strictEqual(service.projects.length, 2);

			const workspaces = service.getWorkspacesForProject(project!.id);
			assert.strictEqual(workspaces.length, 1);
			assert.strictEqual(workspaces[0].branch, 'main');
		});

		test('addProject with existing git repo discovers worktrees', async () => {
			const { service, gitWorktree, fileDialog } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			gitWorktree.setIsGitRepo(true);
			fileDialog.setPick([URI.file('/projects/other-repo')]);
			gitWorktree.setWorktrees([
				{ path: '/projects/other-repo', branch: 'main', isMain: true, detached: false },
				{ path: '/projects/other-dev', branch: 'dev', isMain: false, detached: false },
			]);

			const project = await service.addProject();

			assert.ok(project);
			const workspaces = service.getWorkspacesForProject(project!.id);
			assert.strictEqual(workspaces.length, 2);
		});

		test('addProject returns undefined when dialog cancelled', async () => {
			const { service, fileDialog } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			fileDialog.setPick(undefined as any);
			const result = await service.addProject();
			assert.strictEqual(result, undefined);
		});

		test('addProject deduplicates by path', async () => {
			const { service, fileDialog } = createService({ folderPath: '/projects/nobs' });
			await waitForEvent(service.onDidChangeActiveWorkspace);

			fileDialog.setPick([URI.file('/projects/nobs')]);
			await service.addProject();

			assert.strictEqual(service.projects.length, 1);
		});

		test('removeWorktree removes workspace and falls back', async () => {
			const { service } = createService({
				worktrees: [
					{ path: '/projects/nobs', branch: 'main', isMain: true, detached: false },
					{ path: '/projects/fix', branch: 'fix', isMain: false, detached: false },
				],
			});
			await waitForEvent(service.onDidChangeActiveWorkspace);

			const workspaces = service.getWorkspacesForProject(service.projects[0].id);
			const fixWs = workspaces.find(w => w.branch === 'fix')!;

			service.selectWorkspace(fixWs.id);
			assert.strictEqual(service.activeWorkspace?.branch, 'fix');

			await service.removeWorktree(fixWs.id);

			assert.strictEqual(service.activeWorkspace?.branch, 'main');
			assert.strictEqual(service.getWorkspacesForProject(service.projects[0].id).length, 1);
		});

		test('cannot remove main worktree', async () => {
			const { service } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			const mainWs = service.activeWorkspace!;
			assert.strictEqual(mainWs.isMain, true);

			await assert.rejects(
				() => service.removeWorktree(mainWs.id),
				/Cannot remove the main worktree/,
			);
		});
	});

	suite('Sidebar state', () => {

		test('toggleProjectExpanded toggles and fires event', async () => {
			const { service } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			assert.strictEqual(service.projects[0].expanded, true);

			const eventPromise = waitForEvent(service.onDidChangeProjects);
			service.toggleProjectExpanded(service.projects[0].id);
			await eventPromise;

			assert.strictEqual(service.projects[0].expanded, false);
		});

		test('removeProject removes project and clears workspace', async () => {
			const { service } = createService();
			await waitForEvent(service.onDidChangeActiveWorkspace);

			const projectId = service.projects[0].id;
			service.removeProject(projectId);

			assert.strictEqual(service.projects.length, 0);
			assert.strictEqual(service.activeWorkspace, undefined);
		});
	});
});
