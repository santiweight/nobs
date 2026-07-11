/*---------------------------------------------------------------------------------------------
 *  Agent Session — visual agent deck
 *  Opens coding agent CLIs (Claude, Codex) in native VS Code terminal tabs.
 *  Provides full clipboard, selection, scrollback, and resize support.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IShellLaunchConfig } from '../../../../platform/terminal/common/terminal.js';

registerAction2(class OpenClaudeSessionAction extends Action2 {
	constructor() {
		super({
			id: 'nobs.openClaudeSession',
			title: localize2('openClaudeSession', 'Open Claude Agent Session'),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const terminalService = accessor.get(ITerminalService);
		const config: IShellLaunchConfig = {
			name: 'Claude Agent',
			executable: 'claude',
			args: ['--dangerously-skip-permissions'],
		};
		await terminalService.createTerminal({ config });
	}
});

registerAction2(class OpenCodexSessionAction extends Action2 {
	constructor() {
		super({
			id: 'nobs.openCodexSession',
			title: localize2('openCodexSession', 'Open Codex Agent Session'),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const terminalService = accessor.get(ITerminalService);
		const config: IShellLaunchConfig = {
			name: 'Codex Agent',
			executable: 'codex',
			args: ['--approval-mode', 'full-auto'],
		};
		await terminalService.createTerminal({ config });
	}
});
