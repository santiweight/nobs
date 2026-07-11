/*---------------------------------------------------------------------------------------------
 *  Mock tmux — in-memory fake for unit testing.
 *  Simulates tmux sessions with controllable output.
 *--------------------------------------------------------------------------------------------*/

import type { ITmux } from '../node/tmux.js';

export interface MockSession {
	name: string;
	command: string;
	cwd: string;
	alive: boolean;
	output: string;
	keysReceived: string[];
}

export class MockTmux implements ITmux {

	readonly sessions = new Map<string, MockSession>();
	readonly calls: { method: string; args: any[] }[] = [];

	async newSession(name: string, command: string, cwd: string): Promise<void> {
		this.calls.push({ method: 'newSession', args: [name, command, cwd] });
		const existing = this.sessions.get(name);
		if (existing && existing.alive) {
			throw new Error(`duplicate session: ${name}`);
		}
		this.sessions.set(name, {
			name,
			command,
			cwd,
			alive: true,
			output: '',
			keysReceived: [],
		});
	}

	async sendKeys(name: string, text: string): Promise<void> {
		this.calls.push({ method: 'sendKeys', args: [name, text] });
		const s = this.sessions.get(name);
		if (!s || !s.alive) {
			throw new Error(`session not found: ${name}`);
		}
		s.keysReceived.push(text);
	}

	async capturePane(name: string): Promise<string> {
		this.calls.push({ method: 'capturePane', args: [name] });
		const s = this.sessions.get(name);
		if (!s || !s.alive) {
			throw new Error(`session not found: ${name}`);
		}
		return s.output;
	}

	async hasSession(name: string): Promise<boolean> {
		this.calls.push({ method: 'hasSession', args: [name] });
		const s = this.sessions.get(name);
		return !!s && s.alive;
	}

	async killSession(name: string): Promise<void> {
		this.calls.push({ method: 'killSession', args: [name] });
		const s = this.sessions.get(name);
		if (s) {
			s.alive = false;
		}
	}

	async listSessions(): Promise<string[]> {
		this.calls.push({ method: 'listSessions', args: [] });
		return Array.from(this.sessions.values())
			.filter(s => s.alive)
			.map(s => s.name);
	}

	// --- test helpers ---

	appendOutput(name: string, text: string): void {
		const s = this.sessions.get(name);
		if (!s) {
			throw new Error(`no such mock session: ${name}`);
		}
		s.output += text;
	}

	setOutput(name: string, text: string): void {
		const s = this.sessions.get(name);
		if (!s) {
			throw new Error(`no such mock session: ${name}`);
		}
		s.output = text;
	}

	destroySession(name: string): void {
		const s = this.sessions.get(name);
		if (s) {
			s.alive = false;
		}
	}

	reset(): void {
		this.sessions.clear();
		this.calls.length = 0;
	}
}
