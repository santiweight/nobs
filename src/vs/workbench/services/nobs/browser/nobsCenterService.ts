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

export interface INobsCenterService {
	readonly _serviceBrand: undefined;
	readonly onReady: Event<void>;

	addAgentTab(type: NobsAgentType): INobsTabHandle;
	addOutputTab(type: NobsOutputType): INobsTabHandle;
	removeAgentTab(id: string): void;
	removeOutputTab(id: string): void;

	readonly onDidAddAgentTab: Event<INobsTabHandle & { type: NobsAgentType }>;
	readonly onDidAddOutputTab: Event<INobsTabHandle & { type: NobsOutputType }>;
	readonly onDidRemoveAgentTab: Event<string>;
	readonly onDidRemoveOutputTab: Event<string>;
	readonly onDidChangeActiveAgentTab: Event<string>;
	readonly onDidChangeActiveOutputTab: Event<string>;
}

export interface INobsCenterServiceInternal extends INobsCenterService {
	setAgentTabBar(tabBar: INobsTabBarAdapter): void;
	setOutputTabBar(tabBar: INobsTabBarAdapter): void;
}

export interface INobsTabBarAdapter {
	addTab(label: string, id?: string): { id: string; body: HTMLElement };
	removeTab(id: string): void;
	readonly onDidRemoveTab: Event<string>;
	readonly onDidChangeActiveTab: Event<string>;
	registerTabDisposable(id: string, disposable: IDisposable): void;
}

export class NobsCenterService extends Disposable implements INobsCenterServiceInternal {
	declare readonly _serviceBrand: undefined;

	private _agentTabBar: INobsTabBarAdapter | null = null;
	private _outputTabBar: INobsTabBarAdapter | null = null;
	private _isReady = false;

	private readonly _onReady = this._register(new Emitter<void>());
	get onReady(): Event<void> {
		return (listener, thisArgs?, disposables?) => {
			if (this._isReady) {
				listener.call(thisArgs);
			}
			return this._onReady.event(listener, thisArgs, disposables);
		};
	}

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

	setAgentTabBar(tabBar: INobsTabBarAdapter): void {
		this._agentTabBar = tabBar;
		this._register(tabBar.onDidRemoveTab(id => this._onDidRemoveAgentTab.fire(id)));
		this._register(tabBar.onDidChangeActiveTab(id => this._onDidChangeActiveAgentTab.fire(id)));
		this._checkReady();
	}

	setOutputTabBar(tabBar: INobsTabBarAdapter): void {
		this._outputTabBar = tabBar;
		this._register(tabBar.onDidRemoveTab(id => this._onDidRemoveOutputTab.fire(id)));
		this._register(tabBar.onDidChangeActiveTab(id => this._onDidChangeActiveOutputTab.fire(id)));
		this._checkReady();
	}

	private _checkReady(): void {
		if (this._agentTabBar && this._outputTabBar && !this._isReady) {
			this._isReady = true;
			this._onReady.fire();
		}
	}

	addAgentTab(type: NobsAgentType): INobsTabHandle {
		if (!this._agentTabBar) {
			throw new Error('Agent tab bar not initialized');
		}
		const label = type === 'claude' ? 'Claude' : 'Codex';
		const { id, body } = this._agentTabBar.addTab(label);
		this._onDidAddAgentTab.fire({ id, body, type });
		return { id, body };
	}

	addOutputTab(type: NobsOutputType): INobsTabHandle {
		if (!this._outputTabBar) {
			throw new Error('Output tab bar not initialized');
		}
		const label = type === 'browser' ? 'Browser' : 'Terminal';
		const { id, body } = this._outputTabBar.addTab(label);
		this._onDidAddOutputTab.fire({ id, body, type });
		return { id, body };
	}

	removeAgentTab(id: string): void {
		this._agentTabBar?.removeTab(id);
	}

	removeOutputTab(id: string): void {
		this._outputTabBar?.removeTab(id);
	}
}

registerSingleton(INobsCenterService, NobsCenterService, InstantiationType.Eager);
