/*---------------------------------------------------------------------------------------------
 *  Session Manager — node-pty implementation
 *  Spawns headless coding agent CLI sessions using native PTY processes.
 *  Real-time output streaming via pty.onData(), event-driven idle detection.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { type ISessionManager, SessionEvent, SessionEventType, SessionId, SessionInfo, SessionStatus } from '../common/types.js';

export const IDLE_TIMEOUT_MS = 2000;

type IPty = import('node-pty').IPty;
type IPtyForkOptions = import('node-pty').IPtyForkOptions;

export type SpawnPtyFn = (file: string, args: string[], options: IPtyForkOptions) => IPty;

let nodePtyModule: typeof import('node-pty') | undefined;
async function getNodePty(): Promise<typeof import('node-pty')> {
	if (!nodePtyModule) {
		nodePtyModule = await import('node-pty');
	}
	return nodePtyModule;
}

interface ManagedSession {
	readonly id: SessionId;
	readonly cwd: string;
	readonly createdAt: number;
	pty: IPty;
	status: SessionStatus;
	lastActivityAt: number;
	outputBuffer: string;
	listeners: Set<(event: SessionEvent) => void>;
	idleTimer: ReturnType<typeof setTimeout> | undefined;
	exitCode: number | null;
}

export class PtySessionManager implements ISessionManager {

	private readonly _sessions = new Map<string, ManagedSession>();
	private readonly _command: string;
	private readonly _args: string[];
	private readonly _spawnPty: SpawnPtyFn | undefined;

	constructor(command: string, args: string[], spawnPty?: SpawnPtyFn) {
		this._command = command;
		this._args = args;
		this._spawnPty = spawnPty;
	}

	private async _spawn(cwd: string): Promise<IPty> {
		const options: IPtyForkOptions = {
			name: 'xterm-256color',
			cwd,
			env: process.env as Record<string, string>,
			cols: 200,
			rows: 50,
		};
		if (this._spawnPty) {
			return this._spawnPty(this._command, this._args, options);
		}
		const nodePty = await getNodePty();
		return nodePty.spawn(this._command, this._args, options);
	}

	async spawn(prompt: string, cwd: string): Promise<{ id: SessionId; stream: AsyncIterable<SessionEvent> }> {
		const id = randomUUID();
		const pty = await this._spawn(cwd);

		const session: ManagedSession = {
			id,
			cwd,
			createdAt: Date.now(),
			pty,
			status: SessionStatus.Running,
			lastActivityAt: Date.now(),
			outputBuffer: '',
			listeners: new Set(),
			idleTimer: undefined,
			exitCode: null,
		};
		this._sessions.set(id, session);

		this._wirePtyEvents(session);

		if (prompt) {
			pty.write(prompt + '\r');
		}

		return { id, stream: this._createStream(session) };
	}

	async resume(id: SessionId, prompt: string): Promise<AsyncIterable<SessionEvent>> {
		const session = this._get(id);

		if (session.status === SessionStatus.Dead) {
			const pty = await this._spawn(session.cwd);
			session.pty = pty;
			session.outputBuffer = '';
			session.exitCode = null;
			this._wirePtyEvents(session);
		}

		this._setStatus(session, SessionStatus.Running);

		if (prompt) {
			session.pty.write(prompt + '\r');
		}

		return this._createStream(session);
	}

	async status(id: SessionId): Promise<SessionStatus> {
		const session = this._sessions.get(id);
		if (!session) {
			return SessionStatus.Dead;
		}
		return session.status;
	}

	async kill(id: SessionId): Promise<void> {
		const session = this._sessions.get(id);
		if (!session) {
			return;
		}
		if (session.idleTimer) {
			clearTimeout(session.idleTimer);
			session.idleTimer = undefined;
		}
		try {
			session.pty.kill();
		} catch {
			// already dead
		}
		this._setStatus(session, SessionStatus.Dead);
	}

	async list(): Promise<SessionInfo[]> {
		return Array.from(this._sessions.values()).map(s => ({
			id: s.id,
			status: s.status,
			cwd: s.cwd,
			createdAt: s.createdAt,
			lastActivityAt: s.lastActivityAt,
		}));
	}

	async getOutput(id: SessionId): Promise<string> {
		const session = this._get(id);
		return session.outputBuffer;
	}

	async dispose(): Promise<void> {
		for (const id of this._sessions.keys()) {
			await this.kill(id);
		}
	}

	// --- internals ---

	private _wirePtyEvents(session: ManagedSession): void {
		session.pty.onData((data: string) => {
			session.outputBuffer += data;
			session.lastActivityAt = Date.now();

			if (session.status !== SessionStatus.Running) {
				this._setStatus(session, SessionStatus.Running);
			}

			this._emit(session, { type: SessionEventType.Stdout, data });
			this._resetIdleTimer(session);
		});

		session.pty.onExit((e: { exitCode: number; signal?: number }) => {
			if (session.idleTimer) {
				clearTimeout(session.idleTimer);
				session.idleTimer = undefined;
			}
			session.exitCode = e.exitCode;
			this._emit(session, { type: SessionEventType.Exit, code: e.exitCode });
			this._setStatus(session, SessionStatus.Dead);
		});
	}

	private _resetIdleTimer(session: ManagedSession): void {
		if (session.idleTimer) {
			clearTimeout(session.idleTimer);
		}
		session.idleTimer = setTimeout(() => {
			if (session.status === SessionStatus.Running) {
				this._setStatus(session, SessionStatus.Idle);
			}
		}, IDLE_TIMEOUT_MS);
	}

	private _createStream(session: ManagedSession): AsyncIterable<SessionEvent> {
		return {
			[Symbol.asyncIterator]() {
				const queue: SessionEvent[] = [];
				let resolve: ((value: IteratorResult<SessionEvent>) => void) | undefined;
				let done = false;

				const push = (event: SessionEvent) => {
					if (done) {
						return;
					}
					if (resolve) {
						resolve({ value: event, done: false });
						resolve = undefined;
					} else {
						queue.push(event);
					}
				};

				const finish = (event: SessionEvent) => {
					push(event);
					done = true;
					session.listeners.delete(listener);
				};

				const listener = (event: SessionEvent) => {
					if (event.type === SessionEventType.Exit) {
						finish(event);
					} else if (event.type === SessionEventType.StatusChange && event.to === SessionStatus.Dead) {
						finish(event);
					} else if (event.type === SessionEventType.StatusChange && event.to === SessionStatus.Idle) {
						finish(event);
					} else {
						push(event);
					}
				};
				session.listeners.add(listener);

				return {
					next(): Promise<IteratorResult<SessionEvent>> {
						if (queue.length > 0) {
							const event = queue.shift()!;
							return Promise.resolve({ value: event, done: false });
						}
						if (done) {
							return Promise.resolve({ value: undefined as any, done: true });
						}
						return new Promise(r => { resolve = r; });
					},
					return(): Promise<IteratorResult<SessionEvent>> {
						done = true;
						session.listeners.delete(listener);
						return Promise.resolve({ value: undefined as any, done: true });
					},
				};
			}
		};
	}

	_emit(session: ManagedSession, event: SessionEvent): void {
		for (const listener of session.listeners) {
			listener(event);
		}
	}

	_setStatus(session: ManagedSession, status: SessionStatus): void {
		if (session.status === status) {
			return;
		}
		const from = session.status;
		session.status = status;
		const event: SessionEvent = { type: SessionEventType.StatusChange, from, to: status };
		this._emit(session, event);
	}

	private _get(id: SessionId): ManagedSession {
		const session = this._sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}
		return session;
	}
}

const CLAUDE_COMMAND = 'claude';
const CLAUDE_ARGS = ['--dangerously-skip-permissions'];

export class ClaudeSessionManager extends PtySessionManager {
	constructor(spawnPty?: SpawnPtyFn) {
		super(CLAUDE_COMMAND, CLAUDE_ARGS, spawnPty);
	}
}

const CODEX_COMMAND = 'codex';
const CODEX_ARGS = ['--approval-mode', 'full-auto'];

export class CodexSessionManager extends PtySessionManager {
	constructor(spawnPty?: SpawnPtyFn) {
		super(CODEX_COMMAND, CODEX_ARGS, spawnPty);
	}
}

export { ClaudeSessionManager as SessionManager };
