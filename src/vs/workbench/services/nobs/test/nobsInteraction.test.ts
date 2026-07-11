/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event, Emitter } from '../../../../base/common/event.js';
import { NobsCenterService, INobsAddAction, INobsTabBarAdapter } from '../browser/nobsCenterService.js';
import { NobsWorkspaceService } from '../browser/nobsWorkspaceService.js';
import { URI } from '../../../../base/common/uri.js';
import type { IGitWorktreeService, IGitWorktreeInfo } from '../../../../platform/gitWorktree/common/gitWorktreeService.js';
import { type IWorkspaceContextService, type IWorkspace, type IWorkspaceFolder, type IWorkspaceFoldersChangeEvent, type IWorkspaceFoldersWillChangeEvent, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { StorageScope } from '../../../../platform/storage/common/storage.js';

class MockGitWorktreeService implements IGitWorktreeService {
	readonly _serviceBrand: undefined;
	private _worktrees: IGitWorktreeInfo[] = [
		{ path: '/projects/nobs', branch: 'main', isMain: true, detached: false },
		{ path: '/projects/nobs-fix', branch: 'fix-auth', isMain: false, detached: false },
	];
	async isGitRepo(): Promise<boolean> { return true; }
	async initRepo(): Promise<void> {}
	async listWorktrees(): Promise<IGitWorktreeInfo[]> { return this._worktrees; }
	async addWorktree(_repoPath: string, path: string, branch: string): Promise<IGitWorktreeInfo> {
		const info: IGitWorktreeInfo = { path, branch, isMain: false, detached: false };
		this._worktrees.push(info);
		return info;
	}
	async removeWorktree(): Promise<void> {}
	async getCurrentBranch(): Promise<string | undefined> { return 'main'; }
}

class MockStorageService {
	private readonly _store = new Map<string, string>();
	get(key: string, _scope: StorageScope, fallback?: string): string | undefined { return this._store.get(key) ?? fallback; }
	store(key: string, value: string): void { this._store.set(key, value); }
}

function createMockWorkspaceCtx(): IWorkspaceContextService {
	const folder: IWorkspaceFolder = {
		uri: URI.file('/projects/nobs'),
		name: 'nobs',
		index: 0,
		toResource: (rel: string) => URI.file(`/projects/nobs/${rel}`),
	} as IWorkspaceFolder;
	const workspace: IWorkspace = { id: 'test', folders: [folder], name: 'nobs' };
	return {
		_serviceBrand: undefined,
		getWorkspace: () => workspace,
		getCompleteWorkspace: () => Promise.resolve(workspace),
		getWorkbenchState: () => WorkbenchState.FOLDER,
		getWorkspaceFolder: () => folder,
		isInsideWorkspace: () => true,
		isCurrentWorkspace: () => true,
		hasWorkspaceData: () => true,
		onDidChangeWorkbenchState: Event.None,
		onDidChangeWorkspaceName: Event.None,
		onWillChangeWorkspaceFolders: Event.None as Event<IWorkspaceFoldersWillChangeEvent>,
		onDidChangeWorkspaceFolders: Event.None as Event<IWorkspaceFoldersChangeEvent>,
	} as IWorkspaceContextService;
}

class MockFileDialogService {
	pickResult: URI[] | undefined;
	async showOpenDialog(): Promise<URI[] | undefined> { return this.pickResult; }
}

class MockTabBar implements INobsTabBarAdapter {
	private _nextId = 0;
	readonly element: HTMLElement;
	private readonly _onDidRemoveTab = new Emitter<string>();
	readonly onDidRemoveTab = this._onDidRemoveTab.event;
	private readonly _onDidChangeActiveTab = new Emitter<string>();
	readonly onDidChangeActiveTab = this._onDidChangeActiveTab.event;

	constructor(parent: HTMLElement) {
		this.element = document.createElement('div');
		parent.appendChild(this.element);
	}

	addTab(label: string, id?: string): { id: string; body: HTMLElement } {
		const tabId = id ?? `tab-${this._nextId++}`;
		return { id: tabId, body: document.createElement('div') };
	}
	removeTab(id: string): void { this._onDidRemoveTab.fire(id); }
	registerTabDisposable(): void {}
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

suite('Nobs Interaction Smoke Tests', () => {

	let workspaceService: NobsWorkspaceService;
	let centerService: NobsCenterService;
	let agentPanel: HTMLElement;
	let outputPanel: HTMLElement;

	setup(async () => {
		const gitWorktree = new MockGitWorktreeService();
		const storage = new MockStorageService();
		const workspaceCtx = createMockWorkspaceCtx();
		const fileDialog = new MockFileDialogService();

		workspaceService = new NobsWorkspaceService(
			gitWorktree as any,
			workspaceCtx,
			storage as any,
			fileDialog as any,
		);

		await waitForEvent(workspaceService.onDidChangeActiveWorkspace);

		centerService = new NobsCenterService();
		centerService.setTabBarFactory((parent, _actions) => new MockTabBar(parent));

		agentPanel = document.createElement('div');
		outputPanel = document.createElement('div');
	});

	test('clicking project header toggles expand/collapse without error', () => {
		const projectId = workspaceService.projects[0].id;

		assert.strictEqual(workspaceService.projects[0].expanded, true);
		workspaceService.toggleProjectExpanded(projectId);
		assert.strictEqual(workspaceService.projects[0].expanded, false);
		workspaceService.toggleProjectExpanded(projectId);
		assert.strictEqual(workspaceService.projects[0].expanded, true);
	});

	test('clicking workspace item switches active workspace without error', () => {
		const workspaces = workspaceService.getWorkspacesForProject(workspaceService.projects[0].id);
		assert.strictEqual(workspaces.length, 2);

		const fixWs = workspaces.find(w => w.branch === 'fix-auth')!;
		workspaceService.selectWorkspace(fixWs.id);

		assert.strictEqual(workspaceService.activeWorkspace?.branch, 'fix-auth');
	});

	test('workspace switch activates center service tab bars without error', () => {
		const ws = workspaceService.activeWorkspace!;
		const activations: Array<{ isFirstActivation: boolean }> = [];
		centerService.onDidActivateWorkspace(a => activations.push(a));

		centerService.activateWorkspace(ws.id, ws.worktreePath, agentPanel, outputPanel,
			[{ label: 'Claude', handler: () => {} }],
			[{ label: 'Terminal', handler: () => {} }],
		);

		assert.strictEqual(activations.length, 1);
		assert.strictEqual(activations[0].isFirstActivation, true);
	});

	test('switching to second workspace creates new tab bars without error', () => {
		const workspaces = workspaceService.getWorkspacesForProject(workspaceService.projects[0].id);
		const mainWs = workspaces.find(w => w.branch === 'main')!;
		const fixWs = workspaces.find(w => w.branch === 'fix-auth')!;
		const actions: INobsAddAction[] = [{ label: 'Claude', handler: () => {} }];
		const outActions: INobsAddAction[] = [{ label: 'Terminal', handler: () => {} }];

		centerService.activateWorkspace(mainWs.id, mainWs.worktreePath, agentPanel, outputPanel, actions, outActions);
		centerService.activateWorkspace(fixWs.id, fixWs.worktreePath, agentPanel, outputPanel, actions, outActions);
		centerService.activateWorkspace(mainWs.id, mainWs.worktreePath, agentPanel, outputPanel, actions, outActions);

		assert.strictEqual(agentPanel.children.length, 1);
		assert.strictEqual(outputPanel.children.length, 1);
	});

	test('add agent tab after workspace activation works without error', () => {
		const ws = workspaceService.activeWorkspace!;
		centerService.activateWorkspace(ws.id, ws.worktreePath, agentPanel, outputPanel,
			[{ label: 'Claude', handler: () => centerService.addAgentTab('claude') }],
			[{ label: 'Terminal', handler: () => centerService.addOutputTab('terminal') }],
		);

		const tab = centerService.addAgentTab('claude');
		assert.ok(tab.id);
		assert.ok(tab.body instanceof HTMLElement);
	});

	test('add output tab (terminal and browser) works without error', () => {
		const ws = workspaceService.activeWorkspace!;
		centerService.activateWorkspace(ws.id, ws.worktreePath, agentPanel, outputPanel,
			[{ label: 'Claude', handler: () => {} }],
			[{ label: 'Terminal', handler: () => centerService.addOutputTab('terminal') }],
		);

		const termTab = centerService.addOutputTab('terminal');
		assert.ok(termTab.id);

		const browserTab = centerService.addOutputTab('browser');
		assert.ok(browserTab.id);
	});

	test('add worktree creates workspace without error', async () => {
		const projectId = workspaceService.projects[0].id;
		const before = workspaceService.getWorkspacesForProject(projectId).length;

		const newWs = await workspaceService.addWorktree(projectId, 'feature-new');

		assert.strictEqual(newWs.branch, 'feature-new');
		assert.strictEqual(workspaceService.getWorkspacesForProject(projectId).length, before + 1);
		assert.strictEqual(workspaceService.activeWorkspace?.id, newWs.id);
	});

	test('new project via folder path works without error', async () => {
		const before = workspaceService.projects.length;
		const project = await workspaceService.addProject('/projects/other-repo');

		assert.ok(project);
		assert.strictEqual(project!.name, 'other-repo');
		assert.strictEqual(workspaceService.projects.length, before + 1);
	});

	test('new project with cancelled dialog returns undefined without error', async () => {
		const fileDialog = new MockFileDialogService();
		fileDialog.pickResult = undefined;
		const gitWorktree = new MockGitWorktreeService();
		const storage = new MockStorageService();
		const workspaceCtx = createMockWorkspaceCtx();

		const svc = new NobsWorkspaceService(
			gitWorktree as any,
			workspaceCtx,
			storage as any,
			fileDialog as any,
		);
		await waitForEvent(svc.onDidChangeActiveWorkspace);

		const result = await svc.addProject();
		assert.strictEqual(result, undefined);
	});

	test('remove worktree with active workspace falls back without error', async () => {
		const projectId = workspaceService.projects[0].id;
		const workspaces = workspaceService.getWorkspacesForProject(projectId);
		const fixWs = workspaces.find(w => w.branch === 'fix-auth')!;

		workspaceService.selectWorkspace(fixWs.id);
		assert.strictEqual(workspaceService.activeWorkspace?.branch, 'fix-auth');

		await workspaceService.removeWorktree(fixWs.id);

		assert.strictEqual(workspaceService.activeWorkspace?.branch, 'main');
	});

	test('rapid workspace switching does not throw', () => {
		const workspaces = workspaceService.getWorkspacesForProject(workspaceService.projects[0].id);
		const actions: INobsAddAction[] = [{ label: 'Claude', handler: () => {} }];
		const outActions: INobsAddAction[] = [{ label: 'Terminal', handler: () => {} }];

		for (let i = 0; i < 10; i++) {
			for (const ws of workspaces) {
				workspaceService.selectWorkspace(ws.id);
				centerService.activateWorkspace(ws.id, ws.worktreePath, agentPanel, outputPanel, actions, outActions);
			}
		}

		assert.ok(workspaceService.activeWorkspace);
		assert.strictEqual(agentPanel.children.length, 1);
	});
});
