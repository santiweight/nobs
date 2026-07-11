/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IGitWorktreeService } from '../../../../platform/gitWorktree/common/gitWorktreeService.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INobsProject, INobsWorkspace } from '../common/workspace.js';

export const INobsWorkspaceService = createDecorator<INobsWorkspaceService>('nobsWorkspaceService');

export interface INobsWorkspaceService {
	readonly _serviceBrand: undefined;

	readonly projects: readonly INobsProject[];
	readonly activeWorkspace: INobsWorkspace | undefined;
	getWorkspacesForProject(projectId: string): readonly INobsWorkspace[];

	addProject(folderPath?: string): Promise<INobsProject | undefined>;
	removeProject(projectId: string): void;
	toggleProjectExpanded(projectId: string): void;
	selectWorkspace(workspaceId: string): void;
	addWorktree(projectId: string, branchName: string): Promise<INobsWorkspace>;
	removeWorktree(workspaceId: string): Promise<void>;
	renameWorkspace(workspaceId: string, newName: string): void;

	readonly onDidChangeProjects: Event<void>;
	readonly onDidChangeActiveWorkspace: Event<INobsWorkspace | undefined>;
}

const STORAGE_KEY_PROJECTS = 'nobs.projects';
const STORAGE_KEY_ACTIVE_WORKSPACE = 'nobs.activeWorkspace';

interface PersistedProject {
	readonly id: string;
	readonly name: string;
	readonly rootPath: string;
	readonly expanded: boolean;
}

export class NobsWorkspaceService extends Disposable implements INobsWorkspaceService {

	declare readonly _serviceBrand: undefined;

	private _projects: INobsProject[] = [];
	private readonly _workspaces = new Map<string, INobsWorkspace[]>();
	private _activeWorkspace: INobsWorkspace | undefined;

	private readonly _onDidChangeProjects = this._register(new Emitter<void>());
	readonly onDidChangeProjects = this._onDidChangeProjects.event;

	private readonly _onDidChangeActiveWorkspace = this._register(new Emitter<INobsWorkspace | undefined>());
	readonly onDidChangeActiveWorkspace = this._onDidChangeActiveWorkspace.event;

	get projects(): readonly INobsProject[] {
		return this._projects;
	}

	get activeWorkspace(): INobsWorkspace | undefined {
		return this._activeWorkspace;
	}

	constructor(
		@IGitWorktreeService private readonly _gitWorktreeService: IGitWorktreeService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IStorageService private readonly _storageService: IStorageService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
	) {
		super();
		this._initialize().catch(err => {
			console.error('[NobsWorkspaceService] initialization failed:', err);
		});
	}

	private async _initialize(): Promise<void> {
		const workspace = await this._workspaceContextService.getCompleteWorkspace();
		const folders = workspace.folders;
		if (folders.length === 0) {
			return;
		}

		const folderPath = folders[0].uri.fsPath;
		const isGit = await this._gitWorktreeService.isGitRepo(folderPath);
		if (!isGit) {
			const project = this._createProject(folderPath);
			this._projects.push(project);
			const workspace: INobsWorkspace = {
				id: generateUuid(),
				projectId: project.id,
				name: project.name,
				branch: '',
				worktreePath: folderPath,
				isMain: true,
			};
			this._workspaces.set(project.id, [workspace]);
			this._onDidChangeProjects.fire();
			this.selectWorkspace(workspace.id);
			return;
		}

		const project = this._createProject(folderPath);
		project.expanded = true;
		this._projects.push(project);

		await this._discoverWorktrees(project);
		this._onDidChangeProjects.fire();

		const workspaces = this._workspaces.get(project.id) ?? [];
		const matching = workspaces.find(ws => ws.worktreePath === folderPath) ?? workspaces[0];
		if (matching) {
			this.selectWorkspace(matching.id);
		}
	}

	private async _discoverWorktrees(project: INobsProject): Promise<void> {
		const worktrees = await this._gitWorktreeService.listWorktrees(project.rootPath);
		const workspaces: INobsWorkspace[] = worktrees.map(wt => ({
			id: generateUuid(),
			projectId: project.id,
			name: wt.branch || 'detached',
			branch: wt.branch,
			worktreePath: wt.path,
			isMain: wt.isMain,
		}));
		this._workspaces.set(project.id, workspaces);
	}

	private _createProject(folderPath: string): INobsProject {
		const name = folderPath.split('/').pop() ?? folderPath;
		return {
			id: generateUuid(),
			name,
			rootPath: folderPath,
			expanded: false,
		};
	}

	getWorkspacesForProject(projectId: string): readonly INobsWorkspace[] {
		return this._workspaces.get(projectId) ?? [];
	}

	async addProject(folderPath?: string): Promise<INobsProject | undefined> {
		if (!folderPath) {
			const result = await this._fileDialogService.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				title: 'Open Project Folder',
			});
			if (!result || result.length === 0) {
				return undefined;
			}
			folderPath = result[0].fsPath;
		}

		const existing = this._projects.find(p => p.rootPath === folderPath);
		if (existing) {
			return existing;
		}

		const isGit = await this._gitWorktreeService.isGitRepo(folderPath);
		if (!isGit) {
			await this._gitWorktreeService.initRepo(folderPath);
		}

		const project = this._createProject(folderPath);
		project.expanded = true;
		this._projects.push(project);
		await this._discoverWorktrees(project);

		this._persistProjects();
		this._onDidChangeProjects.fire();

		const workspaces = this._workspaces.get(project.id) ?? [];
		if (workspaces.length > 0) {
			this.selectWorkspace(workspaces[0].id);
		}

		return project;
	}

	removeProject(projectId: string): void {
		const index = this._projects.findIndex(p => p.id === projectId);
		if (index < 0) {
			return;
		}

		this._projects.splice(index, 1);
		this._workspaces.delete(projectId);

		if (this._activeWorkspace?.projectId === projectId) {
			this._activeWorkspace = undefined;
			this._onDidChangeActiveWorkspace.fire(undefined);
		}

		this._persistProjects();
		this._onDidChangeProjects.fire();
	}

	toggleProjectExpanded(projectId: string): void {
		const project = this._projects.find(p => p.id === projectId);
		if (project) {
			project.expanded = !project.expanded;
			this._onDidChangeProjects.fire();
		}
	}

	selectWorkspace(workspaceId: string): void {
		if (this._activeWorkspace?.id === workspaceId) {
			return;
		}

		for (const workspaces of this._workspaces.values()) {
			const ws = workspaces.find(w => w.id === workspaceId);
			if (ws) {
				this._activeWorkspace = ws;
				this._storageService.store(STORAGE_KEY_ACTIVE_WORKSPACE, workspaceId, StorageScope.APPLICATION, StorageTarget.USER);
				this._onDidChangeActiveWorkspace.fire(ws);
				return;
			}
		}
	}

	async addWorktree(projectId: string, branchName: string): Promise<INobsWorkspace> {
		const project = this._projects.find(p => p.id === projectId);
		if (!project) {
			throw new Error(`Project ${projectId} not found`);
		}

		const parentDir = project.rootPath.substring(0, project.rootPath.lastIndexOf('/'));
		const safeBranch = branchName.replace(/\//g, '-');
		const worktreePath = `${parentDir}/${project.name}-${safeBranch}`;

		const info = await this._gitWorktreeService.addWorktree(project.rootPath, worktreePath, branchName);

		const workspace: INobsWorkspace = {
			id: generateUuid(),
			projectId,
			name: info.branch || branchName,
			branch: info.branch || branchName,
			worktreePath: info.path,
			isMain: false,
		};

		const workspaces = this._workspaces.get(projectId) ?? [];
		workspaces.push(workspace);
		this._workspaces.set(projectId, workspaces);

		this._onDidChangeProjects.fire();
		this.selectWorkspace(workspace.id);

		return workspace;
	}

	async removeWorktree(workspaceId: string): Promise<void> {
		for (const [projectId, workspaces] of this._workspaces) {
			const index = workspaces.findIndex(w => w.id === workspaceId);
			if (index >= 0) {
				const ws = workspaces[index];
				if (ws.isMain) {
					throw new Error('Cannot remove the main worktree');
				}

				const project = this._projects.find(p => p.id === projectId);
				if (project) {
					await this._gitWorktreeService.removeWorktree(project.rootPath, ws.worktreePath);
				}

				workspaces.splice(index, 1);

				if (this._activeWorkspace?.id === workspaceId) {
					const fallback = workspaces[0];
					if (fallback) {
						this.selectWorkspace(fallback.id);
					} else {
						this._activeWorkspace = undefined;
						this._onDidChangeActiveWorkspace.fire(undefined);
					}
				}

				this._onDidChangeProjects.fire();
				return;
			}
		}
	}

	renameWorkspace(workspaceId: string, newName: string): void {
		for (const workspaces of this._workspaces.values()) {
			const ws = workspaces.find(w => w.id === workspaceId);
			if (ws) {
				ws.name = newName;
				this._onDidChangeProjects.fire();
				return;
			}
		}
	}

	private _persistProjects(): void {
		const data: PersistedProject[] = this._projects.map(p => ({
			id: p.id,
			name: p.name,
			rootPath: p.rootPath,
			expanded: p.expanded,
		}));
		this._storageService.store(STORAGE_KEY_PROJECTS, JSON.stringify(data), StorageScope.APPLICATION, StorageTarget.USER);
	}
}

registerSingleton(INobsWorkspaceService, NobsWorkspaceService, InstantiationType.Eager);
