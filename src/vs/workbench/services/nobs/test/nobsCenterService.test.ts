/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { NobsCenterService, INobsAddAction, INobsTabBarAdapter, INobsWorkspaceActivation } from '../browser/nobsCenterService.js';
import { Emitter } from '../../../../base/common/event.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';

class MockTabBar implements INobsTabBarAdapter {
	private readonly _tabs = new Map<string, { id: string; body: HTMLElement }>();
	private _nextId = 0;
	private _activeId: string | undefined;
	readonly element: HTMLElement;

	private readonly _onDidRemoveTab = new Emitter<string>();
	readonly onDidRemoveTab = this._onDidRemoveTab.event;

	private readonly _onDidChangeActiveTab = new Emitter<string>();
	readonly onDidChangeActiveTab = this._onDidChangeActiveTab.event;

	constructor(parent: HTMLElement, _actions: INobsAddAction[]) {
		this.element = document.createElement('div');
		this.element.className = 'mock-tab-bar';
		parent.appendChild(this.element);
	}

	addTab(label: string, id?: string): { id: string; body: HTMLElement } {
		const tabId = id ?? `tab-${this._nextId++}`;
		const body = document.createElement('div');
		this._tabs.set(tabId, { id: tabId, body });
		if (!this._activeId) {
			this._activeId = tabId;
			this._onDidChangeActiveTab.fire(tabId);
		}
		return { id: tabId, body };
	}

	removeTab(id: string): void {
		this._tabs.delete(id);
		this._onDidRemoveTab.fire(id);
	}

	registerTabDisposable(_id: string, _disposable: IDisposable): void {}

	get tabCount(): number { return this._tabs.size; }
}

function createService(): {
	service: NobsCenterService;
	agentPanel: HTMLElement;
	outputPanel: HTMLElement;
} {
	const service = new NobsCenterService();

	service.setTabBarFactory((parent, actions) => new MockTabBar(parent, actions));

	const agentPanel = document.createElement('div');
	const outputPanel = document.createElement('div');

	return { service, agentPanel, outputPanel };
}

function activateWorkspace(service: NobsCenterService, wsId: string, agentPanel: HTMLElement, outputPanel: HTMLElement): void {
	service.activateWorkspace(wsId, `/projects/${wsId}`, agentPanel, outputPanel,
		[{ label: 'Claude', handler: () => service.addAgentTab('claude') }],
		[{ label: 'Terminal', handler: () => service.addOutputTab('terminal') }],
	);
}

function collectActivations(service: NobsCenterService): INobsWorkspaceActivation[] {
	const activations: INobsWorkspaceActivation[] = [];
	service.onDidActivateWorkspace(a => activations.push(a));
	return activations;
}

suite('NobsCenterService — workspace-scoped tabs', () => {

	suite('Workflow 1: First activation creates tab bars and fires event', () => {

		test('activateWorkspace creates tab bars on first call', () => {
			const { service, agentPanel, outputPanel } = createService();
			const activations = collectActivations(service);

			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);

			assert.strictEqual(activations.length, 1);
			assert.strictEqual(activations[0].workspaceId, 'ws-main');
			assert.strictEqual(activations[0].isFirstActivation, true);
			assert.strictEqual(activations[0].worktreePath, '/projects/ws-main');
		});

		test('second activation of same workspace is no-op', () => {
			const { service, agentPanel, outputPanel } = createService();
			const activations = collectActivations(service);

			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);
			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);

			assert.strictEqual(activations.length, 1);
		});

		test('tab bars are appended to panels', () => {
			const { service, agentPanel, outputPanel } = createService();

			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);

			assert.strictEqual(agentPanel.children.length, 1);
			assert.strictEqual(outputPanel.children.length, 1);
			assert.strictEqual(agentPanel.children[0].className, 'mock-tab-bar');
		});
	});

	suite('Workflow 2: Switch workspace → swap tabs → switch back', () => {

		test('switching workspace detaches old tab bars and attaches new', () => {
			const { service, agentPanel, outputPanel } = createService();

			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);
			assert.strictEqual(agentPanel.children.length, 1);

			activateWorkspace(service, 'ws-feature', agentPanel, outputPanel);
			assert.strictEqual(agentPanel.children.length, 1);

			const featureTabBar = agentPanel.children[0];

			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);
			assert.strictEqual(agentPanel.children.length, 1);
			assert.notStrictEqual(agentPanel.children[0], featureTabBar);
		});

		test('second workspace gets isFirstActivation=true, then false on re-select', () => {
			const { service, agentPanel, outputPanel } = createService();
			const activations = collectActivations(service);

			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);
			activateWorkspace(service, 'ws-feature', agentPanel, outputPanel);

			assert.strictEqual(activations.length, 2);
			assert.strictEqual(activations[1].isFirstActivation, true);

			activateWorkspace(service, 'ws-main', agentPanel, outputPanel);

			assert.strictEqual(activations.length, 3);
			assert.strictEqual(activations[2].isFirstActivation, false);
		});

		test('tabs added to workspace A are not visible when workspace B is active', () => {
			const { service, agentPanel, outputPanel } = createService();

			activateWorkspace(service, 'ws-a', agentPanel, outputPanel);
			service.addAgentTab('claude');
			service.addAgentTab('claude');

			activateWorkspace(service, 'ws-b', agentPanel, outputPanel);
			service.addAgentTab('claude');

			const wsATabBar = agentPanel.children[0];
			activateWorkspace(service, 'ws-a', agentPanel, outputPanel);
			assert.notStrictEqual(agentPanel.children[0], wsATabBar);
		});
	});

	suite('Workflow 3: Tab operations scoped to active workspace', () => {

		test('addAgentTab adds to active workspace only', () => {
			const { service, agentPanel, outputPanel } = createService();
			const addedTabs: Array<{ id: string; type: string }> = [];
			service.onDidAddAgentTab(({ id, type }) => addedTabs.push({ id, type }));

			activateWorkspace(service, 'ws-a', agentPanel, outputPanel);
			service.addAgentTab('claude');

			activateWorkspace(service, 'ws-b', agentPanel, outputPanel);
			service.addAgentTab('claude');

			assert.strictEqual(addedTabs.length, 2);
			assert.strictEqual(addedTabs[0].type, 'claude');
			assert.strictEqual(addedTabs[1].type, 'claude');
		});

		test('addOutputTab works for browser and terminal types', () => {
			const { service, agentPanel, outputPanel } = createService();
			const addedTypes: string[] = [];
			service.onDidAddOutputTab(({ type }) => addedTypes.push(type));

			activateWorkspace(service, 'ws-a', agentPanel, outputPanel);
			service.addOutputTab('terminal');
			service.addOutputTab('browser');

			assert.deepStrictEqual(addedTypes, ['terminal', 'browser']);
		});

		test('throws when no active workspace', () => {
			const { service } = createService();

			assert.throws(() => service.addAgentTab('claude'), /No active workspace/);
			assert.throws(() => service.addOutputTab('terminal'), /No active workspace/);
		});

		test('removeAgentTab removes from active workspace', () => {
			const { service, agentPanel, outputPanel } = createService();
			const removedIds: string[] = [];
			service.onDidRemoveAgentTab(id => removedIds.push(id));

			activateWorkspace(service, 'ws-a', agentPanel, outputPanel);
			const tab = service.addAgentTab('claude');
			service.removeAgentTab(tab.id);

			assert.strictEqual(removedIds.length, 1);
			assert.strictEqual(removedIds[0], tab.id);
		});

		test('tab body elements are HTMLElements for terminal attachment', () => {
			const { service, agentPanel, outputPanel } = createService();

			activateWorkspace(service, 'ws-a', agentPanel, outputPanel);
			const tab = service.addAgentTab('claude');

			assert.ok(tab.body instanceof HTMLElement);
			assert.ok(tab.id.length > 0);
		});
	});
});
