/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { $, append } from '../../../../base/browser/dom.js';

export interface INobsTabInfo {
	readonly id: string;
	readonly label: string;
}

export interface INobsAddAction {
	readonly label: string;
	readonly handler: () => void;
}

export class NobsTabBar extends Disposable {

	private readonly _element: HTMLElement;
	private readonly _tabsContainer: HTMLElement;
	private readonly _actionsContainer: HTMLElement;
	private readonly _bodyContainer: HTMLElement;

	private readonly _tabs = new Map<string, { header: HTMLElement; labelEl: HTMLElement; body: HTMLElement; disposables: DisposableStore }>();
	private _activeTabId: string | undefined;
	private _nextId = 0;

	private readonly _onDidAddTab = this._register(new Emitter<INobsTabInfo>());
	readonly onDidAddTab: Event<INobsTabInfo> = this._onDidAddTab.event;

	private readonly _onDidRemoveTab = this._register(new Emitter<string>());
	readonly onDidRemoveTab: Event<string> = this._onDidRemoveTab.event;

	private readonly _onDidChangeActiveTab = this._register(new Emitter<string>());
	readonly onDidChangeActiveTab: Event<string> = this._onDidChangeActiveTab.event;

	constructor(
		parent: HTMLElement,
		private readonly _addActions: INobsAddAction[],
	) {
		super();

		this._element = append(parent, $('.nobs-panel'));

		const tabBar = append(this._element, $('.nobs-tab-bar'));
		this._tabsContainer = append(tabBar, $('.nobs-tab-list'));
		this._actionsContainer = append(tabBar, $('.nobs-tab-bar-actions'));

		for (const action of this._addActions) {
			const btn = append(this._actionsContainer, $('.nobs-tab-add-btn'));
			btn.textContent = `${action.label} +`;
			btn.addEventListener('click', () => action.handler());
		}

		this._bodyContainer = append(this._element, $('.nobs-tab-body-container'));
	}

	get element(): HTMLElement {
		return this._element;
	}

	addTab(label: string, id?: string): { id: string; body: HTMLElement } {
		const tabId = id ?? `tab-${this._nextId++}`;
		const disposables = new DisposableStore();

		const header = $('.nobs-tab');
		const tabLabel = append(header, $('.nobs-tab-label'));
		tabLabel.textContent = label;

		const closeBtn = append(header, $('.nobs-tab-close'));
		closeBtn.textContent = '×';
		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.removeTab(tabId);
		});

		header.addEventListener('click', () => this.setActiveTab(tabId));
		this._tabsContainer.appendChild(header);

		const body = append(this._bodyContainer, $('.nobs-tab-body'));
		body.style.display = 'none';

		this._tabs.set(tabId, { header, labelEl: tabLabel, body, disposables });
		this._onDidAddTab.fire({ id: tabId, label });

		if (this._tabs.size === 1) {
			this.setActiveTab(tabId);
		}

		return { id: tabId, body };
	}

	removeTab(tabId: string): void {
		const tab = this._tabs.get(tabId);
		if (!tab) {
			return;
		}

		tab.header.remove();
		tab.body.remove();
		tab.disposables.dispose();
		this._tabs.delete(tabId);

		this._onDidRemoveTab.fire(tabId);

		if (this._activeTabId === tabId) {
			const remaining = [...this._tabs.keys()];
			if (remaining.length > 0) {
				this.setActiveTab(remaining[remaining.length - 1]);
			} else {
				this._activeTabId = undefined;
			}
		}
	}

	setActiveTab(tabId: string): void {
		if (this._activeTabId === tabId) {
			return;
		}

		for (const [id, tab] of this._tabs) {
			const isActive = id === tabId;
			tab.header.classList.toggle('active', isActive);
			tab.body.style.display = isActive ? 'flex' : 'none';
		}

		this._activeTabId = tabId;
		this._onDidChangeActiveTab.fire(tabId);
	}

	getActiveTabId(): string | undefined {
		return this._activeTabId;
	}

	getTabBody(tabId: string): HTMLElement | undefined {
		return this._tabs.get(tabId)?.body;
	}

	getTabCount(): number {
		return this._tabs.size;
	}

	registerTabDisposable(tabId: string, disposable: IDisposable): void {
		this._tabs.get(tabId)?.disposables.add(disposable);
	}

	setTabLabel(tabId: string, label: string): void {
		const tab = this._tabs.get(tabId);
		if (tab) {
			tab.labelEl.textContent = label;
		}
	}
}
