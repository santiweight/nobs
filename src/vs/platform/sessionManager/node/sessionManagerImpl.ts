/*---------------------------------------------------------------------------------------------
 *  Session Manager — tmux-based implementation
 *  Spawns interactive `claude` CLI sessions in tmux with --dangerously-skip-permissions.
 *  Uses the user's subscription auth (whatever `claude` is logged in as).
 *  Follows agent-deck's architecture: tmux for isolation, polling for status detection.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { SessionEvent, SessionEventType, SessionId, SessionInfo, SessionStatus } from '../common/types.js';
import { type ITmux, realTmux, sessionName } from './tmux.js';

export const POLL_INTERVAL_MS = 200;
export const IDLE_TIMEOUT_MS = 2000;
const CLAUDE_COMMAND = 'claude --dangerously-skip-permissions';

interface ManagedSession {
	readonly id: SessionId;
	readonly tmuxName: string;
	readonly cwd: string;
	readonly createdAt: number;
	status: SessionStatus;
	lastActivityAt: number;
	lastCapturedOutput: string;
	listeners: Set<(event: SessionEvent) => void>;
}

export class SessionManager {

	private readonly _sessions = new Map<string, ManagedSession>();
	private readonly _tmux: ITmux;

	constructor(tmux?: ITmux) {
		this._tmux = tmux ?? realTmux;
	}

	async spawn(prompt: string, cwd: string): Promise<{ id: SessionId; stream: AsyncIterable<SessionEvent> }> {
		const id = randomUUID();
		const name = sessionName(id);

		await this._tmux.newSession(name, CLAUDE_COMMAND, cwd);
		await this._tmux.sendKeys(name, prompt);

		const session: ManagedSession = {
			id,
			tmuxName: name,
			cwd,
			createdAt: Date.now(),
			status: SessionStatus.Running,
			lastActivityAt: Date.now(),
			lastCapturedOutput: '',
			listeners: new Set(),
		};
		this._sessions.set(id, session);

		return { id, stream: this._poll(session) };
	}

	async resume(id: SessionId, prompt: string): Promise<AsyncIterable<SessionEvent>> {
		const session = this._get(id);

		const alive = await this._tmux.hasSession(session.tmuxName);
		if (!alive) {
			await this._tmux.newSession(session.tmuxName, CLAUDE_COMMAND, session.cwd);
		}

		await this._tmux.sendKeys(session.tmuxName, prompt);
		this._setStatus(session, SessionStatus.Running);
		session.lastCapturedOutput = await this._tmux.capturePane(session.tmuxName);

		return this._poll(session);
	}

	async status(id: SessionId): Promise<SessionStatus> {
		const session = this._sessions.get(id);
		if (!session) {
			return SessionStatus.Dead;
		}
		const alive = await this._tmux.hasSession(session.tmuxName);
		if (!alive && session.status !== SessionStatus.Dead) {
			this._setStatus(session, SessionStatus.Dead);
		}
		return session.status;
	}

	async kill(id: SessionId): Promise<void> {
		const session = this._sessions.get(id);
		if (!session) {
			return;
		}
		await this._tmux.killSession(session.tmuxName);
		this._setStatus(session, SessionStatus.Dead);
	}

	async list(): Promise<SessionInfo[]> {
		const liveTmuxSessions = new Set(await this._tmux.listSessions());

		return Array.from(this._sessions.values()).map(s => {
			if (!liveTmuxSessions.has(s.tmuxName) && s.status !== SessionStatus.Dead) {
				this._setStatus(s, SessionStatus.Dead);
			}
			return {
				id: s.id,
				status: s.status,
				cwd: s.cwd,
				tmuxSession: s.tmuxName,
				createdAt: s.createdAt,
				lastActivityAt: s.lastActivityAt,
			};
		});
	}

	// --- internals ---

	_poll(session: ManagedSession): AsyncIterable<SessionEvent> {
		const tmux = this._tmux;
		const setStatus = this._setStatus.bind(this);

		return {
			[Symbol.asyncIterator]() {
				const queue: SessionEvent[] = [];
				let resolve: ((value: IteratorResult<SessionEvent>) => void) | undefined;
				let done = false;
				let idleTimerStart = Date.now();

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
					clearInterval(interval);
					session.listeners.delete(listener);
				};

				const listener = (event: SessionEvent) => {
					if (event.type === SessionEventType.StatusChange && event.to === SessionStatus.Dead) {
						finish(event);
					}
				};
				session.listeners.add(listener);

				const interval = setInterval(async () => {
					if (done) {
						clearInterval(interval);
						return;
					}

					const alive = await tmux.hasSession(session.tmuxName);
					if (!alive) {
						setStatus(session, SessionStatus.Dead);
						finish({ type: SessionEventType.Exit, code: null });
						return;
					}

					const output = await tmux.capturePane(session.tmuxName);
					if (output !== session.lastCapturedOutput) {
						const newContent = output.slice(session.lastCapturedOutput.length);
						session.lastCapturedOutput = output;
						session.lastActivityAt = Date.now();
						idleTimerStart = Date.now();

						if (session.status !== SessionStatus.Running) {
							setStatus(session, SessionStatus.Running);
						}
						if (newContent.length > 0) {
							push({ type: SessionEventType.Stdout, data: newContent });
						}
					} else if (session.status === SessionStatus.Running && Date.now() - idleTimerStart >= IDLE_TIMEOUT_MS) {
						setStatus(session, SessionStatus.Idle);
						finish({ type: SessionEventType.StatusChange, from: SessionStatus.Running, to: SessionStatus.Idle });
					}
				}, POLL_INTERVAL_MS);

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
						clearInterval(interval);
						session.listeners.delete(listener);
						return Promise.resolve({ value: undefined as any, done: true });
					},
				};
			}
		};
	}

	_setStatus(session: ManagedSession, status: SessionStatus): void {
		if (session.status === status) {
			return;
		}
		const from = session.status;
		session.status = status;
		const event: SessionEvent = { type: SessionEventType.StatusChange, from, to: status };
		for (const listener of session.listeners) {
			listener(event);
		}
	}

	private _get(id: SessionId): ManagedSession {
		const session = this._sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}
		return session;
	}
}
