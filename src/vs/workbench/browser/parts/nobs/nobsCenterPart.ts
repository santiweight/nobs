/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Part } from '../../part.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { $, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { INobsCenterService, NobsCenterService } from '../../../services/nobs/browser/nobsCenterService.js';
import { NobsTabBar } from './nobsTabBar.js';

export class NobsCenterPart extends Part {

	static readonly ID = Parts.NOBS_CENTER_PART;

	readonly minimumWidth: number = 200;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 200;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	constructor(
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@INobsCenterService private readonly _nobsCenterService: NobsCenterService,
	) {
		super(Parts.NOBS_CENTER_PART, { hasTitle: false }, themeService, storageService, layoutService);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;
		parent.style.height = '100%';
		parent.style.width = '100%';
		parent.style.overflow = 'hidden';

		const style = document.createElement('style');
		style.textContent = NOBS_STYLES;
		append(parent, style);

		const wrapper = $('.nobs-wrapper');

		const container = $('.nobs-main');
		append(container, this.createSidebar());

		const agentPanel = this.createAgentPanel();
		append(container, agentPanel);

		const handle = $('.nobs-resize-handle');
		this.setupResize(handle, agentPanel, container);
		append(container, handle);

		append(container, this.createOutputPanel());
		append(wrapper, container);

		append(wrapper, this.createStatusBar());
		append(parent, wrapper);

		return parent;
	}

	private createSidebar(): HTMLElement {
		const sidebar = $('.nobs-sidebar');

		const header = append(sidebar, $('.nobs-sidebar-header'));
		const label = append(header, $('.nobs-sidebar-label'));
		label.textContent = 'Workspaces';

		const list = append(sidebar, $('.nobs-projects-list'));
		const group = append(list, $('.nobs-project-group'));

		const projectHeader = append(group, $('.nobs-project-header'));
		const chevron = append(projectHeader, $('.nobs-chevron'));
		// allow-any-unicode-next-line
		chevron.textContent = '▾';
		const projectName = append(projectHeader, $('.nobs-project-name'));
		projectName.textContent = 'nobs';

		const wsItem = append(group, $('.nobs-workspace-item.active'));
		const dot = append(wsItem, $('.nobs-ws-dot'));
		dot.style.display = 'inline-block';
		const wsLabel = document.createTextNode('main');
		wsItem.appendChild(wsLabel);

		const footer = append(sidebar, $('.nobs-sidebar-footer'));
		const newBtn = append(footer, $('.nobs-new-project-btn'));
		newBtn.textContent = '+ New project';

		return sidebar;
	}

	private createAgentPanel(): HTMLElement {
		const panel = $('.nobs-agent-panel');

		const service = this._nobsCenterService;
		const tabBar = this._register(new NobsTabBar(panel, [
			{
				label: 'Claude',
				handler: () => service.addAgentTab('claude'),
			},
			{
				label: 'Codex',
				handler: () => service.addAgentTab('codex'),
			},
		]));

		service.setAgentTabBar(tabBar);

		return panel;
	}

	private createOutputPanel(): HTMLElement {
		const panel = $('.nobs-output-panel');

		const service = this._nobsCenterService;
		const tabBar = this._register(new NobsTabBar(panel, [
			{
				label: 'Browser',
				handler: () => service.addOutputTab('browser'),
			},
			{
				label: 'Terminal',
				handler: () => service.addOutputTab('terminal'),
			},
		]));

		service.setOutputTabBar(tabBar);

		return panel;
	}

	private createStatusBar(): HTMLElement {
		const bar = $('.nobs-statusbar');

		const left = append(bar, $('.nobs-statusbar-left'));
		const connected = append(left, $('.nobs-statusbar-item'));
		append(connected, $('.nobs-status-dot'));
		const connLabel = document.createTextNode('Connected');
		connected.appendChild(connLabel);

		const branch = append(left, $('.nobs-statusbar-item'));
		const branchIcon = append(branch, $('span'));
		branchIcon.textContent = '\u{e725}';
		branchIcon.style.fontFamily = '"codicon"';
		branchIcon.style.fontSize = '12px';
		const branchLabel = document.createTextNode('main');
		branch.appendChild(branchLabel);

		const right = append(bar, $('.nobs-statusbar-right'));
		const model = append(right, $('.nobs-statusbar-item'));
		model.textContent = 'Opus 4.6';
		const enc = append(right, $('.nobs-statusbar-item'));
		enc.textContent = 'UTF-8';
		enc.style.color = 'var(--vscode-disabledForeground)';

		return bar;
	}

	private setupResize(handle: HTMLElement, agentPanel: HTMLElement, container: HTMLElement): void {
		let dragging = false;

		handle.addEventListener('mousedown', (e: MouseEvent) => {
			dragging = true;
			handle.classList.add('active');
			e.preventDefault();
		});

		mainWindow.document.addEventListener('mousemove', (e: MouseEvent) => {
			if (!dragging) {
				return;
			}
			const rect = container.getBoundingClientRect();
			const sidebarWidth = 220;
			const availableWidth = rect.width - sidebarWidth;
			const relativeX = e.clientX - rect.left - sidebarWidth;
			const pct = (relativeX / availableWidth) * 100;
			const clamped = Math.max(25, Math.min(75, pct));
			agentPanel.style.flex = `0 0 ${clamped}%`;
		});

		mainWindow.document.addEventListener('mouseup', () => {
			dragging = false;
			handle.classList.remove('active');
		});
	}

	override layout(width: number, height: number, top: number, left: number): void {
		super.layout(width, height, top, left);
		super.layoutContents(width, height);
	}

	toJSON(): object {
		return { type: Parts.NOBS_CENTER_PART };
	}
}

const NOBS_STYLES = `
	.nobs-wrapper {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
	}
	.nobs-main {
		display: flex;
		flex: 1;
		width: 100%;
		min-height: 0;
		background: var(--vscode-editor-background);
		color: var(--vscode-foreground);
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
		font-size: 13px;
		-webkit-font-smoothing: antialiased;
	}

	/* Sidebar */
	.nobs-sidebar {
		width: 220px;
		min-width: 220px;
		background: var(--vscode-sideBar-background);
		border-right: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.nobs-sidebar-header {
		padding: 10px 12px 8px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));
	}
	.nobs-sidebar-label {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.nobs-projects-list {
		flex: 1;
		overflow-y: auto;
		padding: 0 0 8px;
	}
	.nobs-project-header {
		display: flex;
		align-items: center;
		padding: 5px 12px;
		cursor: pointer;
		gap: 4px;
		user-select: none;
	}
	.nobs-project-header:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.nobs-chevron {
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--vscode-disabledForeground);
		font-size: 10px;
	}
	.nobs-project-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--vscode-foreground);
	}
	.nobs-workspace-item {
		padding: 4px 12px 4px 32px;
		font-size: 12.5px;
		color: var(--vscode-descriptionForeground);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		user-select: none;
	}
	.nobs-workspace-item:hover {
		background: var(--vscode-list-hoverBackground);
		color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
	}
	.nobs-workspace-item.active {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.nobs-ws-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--vscode-disabledForeground);
		flex-shrink: 0;
	}
	.nobs-workspace-item.active .nobs-ws-dot {
		background: var(--vscode-list-activeSelectionForeground);
	}
	.nobs-sidebar-footer {
		padding: 8px 12px;
		border-top: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
	}
	.nobs-new-project-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: 6px;
		color: var(--vscode-descriptionForeground);
		cursor: pointer;
		font-size: 12px;
		border: 1px dashed var(--vscode-sideBar-border, var(--vscode-panel-border));
		justify-content: center;
	}
	.nobs-new-project-btn:hover {
		background: var(--vscode-list-hoverBackground);
		color: var(--vscode-foreground);
		border-color: var(--vscode-disabledForeground);
	}

	/* Panel containers */
	.nobs-agent-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-right: 1px solid var(--vscode-panel-border);
	}
	.nobs-output-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* NobsTabBar styles */
	.nobs-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.nobs-tab-bar {
		display: flex;
		align-items: stretch;
		height: 36px;
		background: var(--vscode-editorGroupHeader-tabsBackground);
		border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder, var(--vscode-panel-border));
		flex-shrink: 0;
	}
	.nobs-tab-list {
		display: flex;
		align-items: stretch;
		gap: 1px;
		padding: 0 4px;
		overflow-x: auto;
		flex: 1;
		min-width: 0;
	}
	.nobs-tab-list::-webkit-scrollbar {
		height: 0;
	}
	.nobs-tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px 0 12px;
		font-size: 12px;
		color: var(--vscode-tab-inactiveForeground);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.nobs-tab:hover {
		color: var(--vscode-tab-hoverForeground, var(--vscode-tab-activeForeground));
	}
	.nobs-tab.active {
		color: var(--vscode-tab-activeForeground);
		border-bottom-color: var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder));
	}
	.nobs-tab-label {
		pointer-events: none;
	}
	.nobs-tab-close {
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		font-size: 14px;
		color: var(--vscode-disabledForeground);
		opacity: 0;
		transition: opacity 0.1s;
	}
	.nobs-tab:hover .nobs-tab-close,
	.nobs-tab.active .nobs-tab-close {
		opacity: 1;
	}
	.nobs-tab-close:hover {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--vscode-foreground);
	}

	/* Add buttons */
	.nobs-tab-bar-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 6px;
		flex-shrink: 0;
	}
	.nobs-tab-add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px 8px;
		color: var(--vscode-disabledForeground);
		cursor: pointer;
		font-size: 11px;
		border-radius: 4px;
		white-space: nowrap;
	}
	.nobs-tab-add-btn:hover {
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-toolbar-hoverBackground);
	}

	/* Tab body */
	.nobs-tab-body-container {
		flex: 1;
		overflow: hidden;
		background: var(--vscode-editor-background);
		position: relative;
		display: flex;
	}
	.nobs-tab-body {
		flex: 1;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}

	/* Terminal hosting */
	.nobs-tab-body .terminal-wrapper {
		height: 100% !important;
	}

	/* Resize handle */
	.nobs-resize-handle {
		width: 4px;
		cursor: col-resize;
		background: transparent;
		flex-shrink: 0;
	}
	.nobs-resize-handle:hover,
	.nobs-resize-handle.active {
		background: var(--vscode-focusBorder);
	}

	/* Statusbar */
	.nobs-statusbar {
		height: 28px;
		background: var(--vscode-statusBar-background);
		border-top: 1px solid var(--vscode-statusBar-border, var(--vscode-panel-border));
		display: flex;
		align-items: center;
		padding: 0 12px;
		font-size: 11px;
		color: var(--vscode-statusBar-foreground);
		gap: 16px;
		justify-content: space-between;
		flex-shrink: 0;
	}
	.nobs-statusbar-left,
	.nobs-statusbar-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.nobs-statusbar-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.nobs-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--vscode-testing-iconPassed, #4ade80);
	}

	/* Scrollbar */
	.nobs-main ::-webkit-scrollbar { width: 6px; }
	.nobs-main ::-webkit-scrollbar-track { background: transparent; }
	.nobs-main ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
	.nobs-main ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
`;
