/*---------------------------------------------------------------------------------------------
 *  Tmux wrapper — thin async layer over tmux CLI commands.
 *  Uses execFile (not exec) to avoid shell injection.
 *--------------------------------------------------------------------------------------------*/

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

export const SESSION_PREFIX = 'nobs_';

export function sessionName(id: string): string {
	return `${SESSION_PREFIX}${id}`;
}

export interface ITmux {
	newSession(name: string, command: string, cwd: string): Promise<void>;
	sendKeys(name: string, text: string): Promise<void>;
	capturePane(name: string): Promise<string>;
	hasSession(name: string): Promise<boolean>;
	killSession(name: string): Promise<void>;
	listSessions(): Promise<string[]>;
}

export const realTmux: ITmux = {

	async newSession(name: string, command: string, cwd: string): Promise<void> {
		await execFile('tmux', [
			'new-session',
			'-d',
			'-s', name,
			'-c', cwd,
			'-x', '200',
			'-y', '50',
			command,
		]);
	},

	async sendKeys(name: string, text: string): Promise<void> {
		await execFile('tmux', ['send-keys', '-t', name, text, 'Enter']);
	},

	async capturePane(name: string): Promise<string> {
		const { stdout } = await execFile('tmux', [
			'capture-pane',
			'-t', name,
			'-p',
			'-S', '-',
		]);
		return stdout;
	},

	async hasSession(name: string): Promise<boolean> {
		try {
			await execFile('tmux', ['has-session', '-t', name]);
			return true;
		} catch {
			return false;
		}
	},

	async killSession(name: string): Promise<void> {
		try {
			await execFile('tmux', ['kill-session', '-t', name]);
		} catch {
			// already dead
		}
	},

	async listSessions(): Promise<string[]> {
		try {
			const { stdout } = await execFile('tmux', [
				'list-sessions',
				'-F', '#{session_name}',
			]);
			return stdout
				.trim()
				.split('\n')
				.filter(name => name.startsWith(SESSION_PREFIX));
		} catch {
			return [];
		}
	},
};
