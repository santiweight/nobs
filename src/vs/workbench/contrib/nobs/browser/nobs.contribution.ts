/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { INobsCenterService, NobsAgentType } from '../../../services/nobs/browser/nobsCenterService.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { getZoomFactor } from '../../../../base/browser/browser.js';

class NobsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.nobs';

	private _browserCount = 0;

	constructor(
		@INobsCenterService private readonly _nobsCenterService: INobsCenterService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IBrowserViewWorkbenchService private readonly _browserViewWorkbenchService: IBrowserViewWorkbenchService,
	) {
		super();
		this._wire();
	}

	private _wire(): void {
		this._register(this._nobsCenterService.onDidAddAgentTab(({ id, body, type }) => {
			this._createAgentTerminal(id, body, type);
		}));

		this._register(this._nobsCenterService.onDidAddOutputTab(({ id, body, type }) => {
			if (type === 'browser') {
				this._createBrowser(id, body);
			} else {
				this._createOutputTerminal(id, body);
			}
		}));

		this._register(this._nobsCenterService.onReady(() => {
			this._nobsCenterService.addAgentTab('claude');
			this._nobsCenterService.addOutputTab('terminal');
		}));
	}

	private async _createAgentTerminal(tabId: string, container: HTMLElement, type: NobsAgentType): Promise<void> {
		container.style.padding = '0';

		const config = type === 'claude'
			? { executable: 'claude', name: 'Claude', hideFromUser: true }
			: { executable: 'codex', name: 'Codex', hideFromUser: true };

		const instance = await this._terminalService.createTerminal({
			config,
			location: TerminalLocation.Panel,
		});
		instance.attachToElement(container);
		instance.setVisible(true);
		instance.layout({ width: container.clientWidth, height: container.clientHeight });

		const resizeObserver = new ResizeObserver(() => {
			if (container.clientWidth > 0 && container.clientHeight > 0) {
				instance.layout({ width: container.clientWidth, height: container.clientHeight });
			}
		});
		resizeObserver.observe(container);

		const disposables = new DisposableStore();
		disposables.add(instance);
		disposables.add({ dispose: () => resizeObserver.disconnect() });

		this._register(this._nobsCenterService.onDidChangeActiveAgentTab(activeId => {
			instance.setVisible(activeId === tabId);
			if (activeId === tabId) {
				instance.layout({ width: container.clientWidth, height: container.clientHeight });
			}
		}));

		this._register(disposables);
	}

	private async _createOutputTerminal(tabId: string, container: HTMLElement): Promise<void> {
		container.style.padding = '0';

		const instance = await this._terminalService.createTerminal({
			config: {
				name: 'Terminal',
				hideFromUser: true,
			},
			location: TerminalLocation.Panel,
		});
		instance.attachToElement(container);
		instance.setVisible(true);
		instance.layout({ width: container.clientWidth, height: container.clientHeight });

		const resizeObserver = new ResizeObserver(() => {
			if (container.clientWidth > 0 && container.clientHeight > 0) {
				instance.layout({ width: container.clientWidth, height: container.clientHeight });
			}
		});
		resizeObserver.observe(container);

		const disposables = new DisposableStore();
		disposables.add(instance);
		disposables.add({ dispose: () => resizeObserver.disconnect() });

		this._register(this._nobsCenterService.onDidChangeActiveOutputTab(activeId => {
			instance.setVisible(activeId === tabId);
			if (activeId === tabId) {
				instance.layout({ width: container.clientWidth, height: container.clientHeight });
			}
		}));

		this._register(disposables);
	}

	private async _createBrowser(tabId: string, container: HTMLElement): Promise<void> {
		const browserId = `nobs-browser-${this._browserCount++}`;
		const disposables = new DisposableStore();

		const chrome = document.createElement('div');
		chrome.className = 'nobs-browser-chrome';
		chrome.style.cssText = 'display:flex;align-items:center;height:32px;background:#1e2028;border-bottom:1px solid #2e3038;padding:0 8px;gap:4px;flex-shrink:0;';

		// allow-any-unicode-next-line
		const backBtn = this._createNavButton('←');
		// allow-any-unicode-next-line
		const fwdBtn = this._createNavButton('→');
		// allow-any-unicode-next-line
		const reloadBtn = this._createNavButton('↻');

		const urlBar = document.createElement('input');
		urlBar.type = 'text';
		urlBar.className = 'nobs-url-bar';
		urlBar.placeholder = 'Enter URL...';
		urlBar.value = 'https://google.com';
		urlBar.style.cssText = 'flex:1;height:24px;background:#14161c;border:1px solid #2e3038;border-radius:4px;color:#d8dae0;padding:0 8px;font-size:12px;outline:none;font-family:inherit;';

		chrome.appendChild(backBtn);
		chrome.appendChild(fwdBtn);
		chrome.appendChild(reloadBtn);
		chrome.appendChild(urlBar);
		container.appendChild(chrome);

		const browserHost = document.createElement('div');
		browserHost.className = 'nobs-browser-host';
		browserHost.style.cssText = 'flex:1;overflow:hidden;position:relative;';
		container.appendChild(browserHost);

		const input = this._browserViewWorkbenchService.getOrCreateLazy(browserId, {
			url: 'https://google.com',
			title: 'Browser',
		});
		disposables.add(input);

		const model = await input.resolve();

		const layoutBrowser = () => {
			const rect = browserHost.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				return;
			}
			void model.layout({
				windowId: mainWindow.vscodeWindowId,
				x: rect.left,
				y: rect.top,
				width: rect.width,
				height: rect.height,
				zoomFactor: getZoomFactor(mainWindow),
				cornerRadius: 0,
			});
		};

		void model.setVisible(true);
		mainWindow.requestAnimationFrame(() => layoutBrowser());

		const resizeObserver = new ResizeObserver(() => layoutBrowser());
		resizeObserver.observe(browserHost);
		disposables.add({ dispose: () => resizeObserver.disconnect() });

		disposables.add(model.onDidNavigate(e => {
			urlBar.value = e.url;
		}));

		this._register(this._nobsCenterService.onDidChangeActiveOutputTab(activeId => {
			const isVisible = activeId === tabId;
			void model.setVisible(isVisible);
			if (isVisible) {
				mainWindow.requestAnimationFrame(() => layoutBrowser());
			}
		}));

		urlBar.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				let url = urlBar.value;
				if (!/^https?:\/\//i.test(url)) {
					url = 'https://' + url;
				}
				urlBar.value = url;
				void model.loadURL(url);
			}
		});

		backBtn.addEventListener('click', () => void model.goBack());
		fwdBtn.addEventListener('click', () => void model.goForward());
		reloadBtn.addEventListener('click', () => void model.reload());

		this._register(disposables);
	}

	private _createNavButton(label: string): HTMLElement {
		const btn = document.createElement('button');
		btn.textContent = label;
		btn.style.cssText = 'width:24px;height:24px;background:none;border:none;color:#6e7280;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;border-radius:4px;padding:0;';
		btn.addEventListener('mouseenter', () => { btn.style.background = '#262830'; btn.style.color = '#d8dae0'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; btn.style.color = '#6e7280'; });
		return btn;
	}
}

registerWorkbenchContribution2(NobsContribution.ID, NobsContribution, WorkbenchPhase.AfterRestored);
