/*---------------------------------------------------------------------------------------------
 *  Session Manager — Types
 *  Manages headless Claude CLI sessions via tmux, using subscription auth.
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
	readonly tmuxSession: string;
	readonly createdAt: number;
	readonly lastActivityAt: number;
}
