/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

export const INobsCenterService = createDecorator<INobsCenterService>('nobsCenterService');

export type NobsAgentType = 'claude' | 'codex';
export type NobsOutputType = 'browser' | 'terminal';

export interface INobsTabHandle {
	readonly id: string;
	readonly body: HTMLElement;
}

export interface INobsWorkspaceActivation {
	readonly workspaceId: string;
	readonly worktreePath: string;
	readonly isFirstActivation: boolean;
}

export interface INobsCenterService {
	readonly _serviceBrand: undefined;

	addAgentTab(type: NobsAgentType): INobsTabHandle;
	addOutputTab(type: NobsOutputType): INobsTabHandle;
	removeAgentTab(id: string): void;
	removeOutputTab(id: string): void;

	activateWorkspace(workspaceId: string, worktreePath: string, agentPanel: HTMLElement, outputPanel: HTMLElement, agentActions: INobsAddAction[], outputActions: INobsAddAction[]): void;

	readonly onDidAddAgentTab: Event<INobsTabHandle & { type: NobsAgentType }>;
	readonly onDidAddOutputTab: Event<INobsTabHandle & { type: NobsOutputType }>;
	readonly onDidRemoveAgentTab: Event<string>;
	readonly onDidRemoveOutputTab: Event<string>;
	readonly onDidChangeActiveAgentTab: Event<string>;
	readonly onDidChangeActiveOutputTab: Event<string>;
	readonly onDidActivateWorkspace: Event<INobsWorkspaceActivation>;
}

export interface INobsAddAction {
	readonly label: string;
	readonly handler: () => void;
}

export interface INobsTabBarAdapter {
	addTab(label: string, id?: string): { id: string; body: HTMLElement };
	removeTab(id: string): void;
	readonly element: HTMLElement;
	readonly onDidRemoveTab: Event<string>;
	readonly onDidChangeActiveTab: Event<string>;
	registerTabDisposable(id: string, disposable: IDisposable): void;
}

interface WorkspaceTabState {
	agentTabBar: INobsTabBarAdapter;
	outputTabBar: INobsTabBarAdapter;
	agentDisposables: IDisposable;
	outputDisposables: IDisposable;
}

export class NobsCenterService extends Disposable implements INobsCenterService {
	declare readonly _serviceBrand: undefined;

	private readonly _workspaceTabBars = new Map<string, WorkspaceTabState>();
	private _activeWorkspaceId: string | undefined;
	private _tabBarFactory: ((parent: HTMLElement, actions: INobsAddAction[]) => INobsTabBarAdapter) | undefined;

	private readonly _onDidAddAgentTab = this._register(new Emitter<INobsTabHandle & { type: NobsAgentType }>());
	readonly onDidAddAgentTab = this._onDidAddAgentTab.event;

	private readonly _onDidAddOutputTab = this._register(new Emitter<INobsTabHandle & { type: NobsOutputType }>());
	readonly onDidAddOutputTab = this._onDidAddOutputTab.event;

	private readonly _onDidRemoveAgentTab = this._register(new Emitter<string>());
	readonly onDidRemoveAgentTab = this._onDidRemoveAgentTab.event;

	private readonly _onDidRemoveOutputTab = this._register(new Emitter<string>());
	readonly onDidRemoveOutputTab = this._onDidRemoveOutputTab.event;

	private readonly _onDidChangeActiveAgentTab = this._register(new Emitter<string>());
	readonly onDidChangeActiveAgentTab = this._onDidChangeActiveAgentTab.event;

	private readonly _onDidChangeActiveOutputTab = this._register(new Emitter<string>());
	readonly onDidChangeActiveOutputTab = this._onDidChangeActiveOutputTab.event;

	private readonly _onDidActivateWorkspace = this._register(new Emitter<INobsWorkspaceActivation>());
	private _lastActivation: INobsWorkspaceActivation | undefined;
	get onDidActivateWorkspace(): Event<INobsWorkspaceActivation> {
		return (listener, thisArgs?, disposables?) => {
			if (this._lastActivation) {
				listener.call(thisArgs, this._lastActivation);
			}
			return this._onDidActivateWorkspace.event(listener, thisArgs, disposables);
		};
	}

	setTabBarFactory(factory: (parent: HTMLElement, actions: INobsAddAction[]) => INobsTabBarAdapter): void {
		this._tabBarFactory = factory;
	}

	activateWorkspace(workspaceId: string, worktreePath: string, agentPanel: HTMLElement, outputPanel: HTMLElement, agentActions: INobsAddAction[], outputActions: INobsAddAction[]): void {
		if (this._activeWorkspaceId === workspaceId) {
			return;
		}

		const oldState = this._activeWorkspaceId ? this._workspaceTabBars.get(this._activeWorkspaceId) : undefined;
		if (oldState) {
			oldState.agentTabBar.element.remove();
			oldState.outputTabBar.element.remove();
		}

		this._activeWorkspaceId = workspaceId;
		let isFirstActivation = false;

		let state = this._workspaceTabBars.get(workspaceId);
		if (!state) {
			if (!this._tabBarFactory) {
				throw new Error('Tab bar factory not set');
			}
			isFirstActivation = true;

			const agentTabBar = this._tabBarFactory(agentPanel, agentActions);
			const outputTabBar = this._tabBarFactory(outputPanel, outputActions);

			const agentDisposables = this._wireTabBarEvents(agentTabBar, 'agent');
			const outputDisposables = this._wireTabBarEvents(outputTabBar, 'output');

			state = { agentTabBar, outputTabBar, agentDisposables, outputDisposables };
			this._workspaceTabBars.set(workspaceId, state);
		} else {
			agentPanel.appendChild(state.agentTabBar.element);
			outputPanel.appendChild(state.outputTabBar.element);
		}

		const activation = { workspaceId, worktreePath, isFirstActivation };
		this._lastActivation = activation;
		this._onDidActivateWorkspace.fire(activation);
	}

	private _wireTabBarEvents(tabBar: INobsTabBarAdapter, panel: 'agent' | 'output'): IDisposable {
		const removeEmitter = panel === 'agent' ? this._onDidRemoveAgentTab : this._onDidRemoveOutputTab;
		const activeEmitter = panel === 'agent' ? this._onDidChangeActiveAgentTab : this._onDidChangeActiveOutputTab;

		const d1 = tabBar.onDidRemoveTab(id => removeEmitter.fire(id));
		const d2 = tabBar.onDidChangeActiveTab(id => activeEmitter.fire(id));

		return { dispose: () => { d1.dispose(); d2.dispose(); } };
	}

	addAgentTab(type: NobsAgentType): INobsTabHandle {
		const state = this._activeWorkspaceId ? this._workspaceTabBars.get(this._activeWorkspaceId) : undefined;
		if (!state) {
			throw new Error('No active workspace');
		}
		const label = type === 'claude' ? 'Claude' : 'Codex';
		const { id, body } = state.agentTabBar.addTab(label);
		this._onDidAddAgentTab.fire({ id, body, type });
		return { id, body };
	}

	addOutputTab(type: NobsOutputType): INobsTabHandle {
		const state = this._activeWorkspaceId ? this._workspaceTabBars.get(this._activeWorkspaceId) : undefined;
		if (!state) {
			throw new Error('No active workspace');
		}
		const label = type === 'browser' ? 'Browser' : 'Terminal';
		const { id, body } = state.outputTabBar.addTab(label);
		this._onDidAddOutputTab.fire({ id, body, type });
		return { id, body };
	}

	removeAgentTab(id: string): void {
		const state = this._activeWorkspaceId ? this._workspaceTabBars.get(this._activeWorkspaceId) : undefined;
		state?.agentTabBar.removeTab(id);
	}

	removeOutputTab(id: string): void {
		const state = this._activeWorkspaceId ? this._workspaceTabBars.get(this._activeWorkspaceId) : undefined;
		state?.outputTabBar.removeTab(id);
	}
}

registerSingleton(INobsCenterService, NobsCenterService, InstantiationType.Eager);
