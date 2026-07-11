/*---------------------------------------------------------------------------------------------
 *  Session Manager — Types
 *  Provider-agnostic interface for managing headless coding agent sessions.
 *--------------------------------------------------------------------------------------------*/

export type SessionId = string;

export const enum SessionStatus {
	Running = 'running',
	Idle = 'idle',
	Dead = 'dead',
}

export const enum SessionEventType {
	Stdout = 'stdout',
	StatusChange = 'status_change',
	Exit = 'exit',
}

export interface SessionStdoutEvent {
	readonly type: SessionEventType.Stdout;
	readonly data: string;
}

export interface SessionStatusChangeEvent {
	readonly type: SessionEventType.StatusChange;
	readonly from: SessionStatus;
	readonly to: SessionStatus;
}

export interface SessionExitEvent {
	readonly type: SessionEventType.Exit;
	readonly code: number | null;
}

export type SessionEvent =
	| SessionStdoutEvent
	| SessionStatusChangeEvent
	| SessionExitEvent;

export interface SessionInfo {
	readonly id: SessionId;
	readonly status: SessionStatus;
	readonly cwd: string;
	readonly createdAt: number;
	readonly lastActivityAt: number;
}

export interface ISessionManager {
	spawn(prompt: string, cwd: string): Promise<{ id: SessionId; stream: AsyncIterable<SessionEvent> }>;
	resume(id: SessionId, prompt: string): Promise<AsyncIterable<SessionEvent>>;
	status(id: SessionId): Promise<SessionStatus>;
	kill(id: SessionId): Promise<void>;
	list(): Promise<SessionInfo[]>;
	getOutput(id: SessionId): Promise<string>;
}
