/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ISessionManagerService, ISessionStdoutEvent, ISessionStatusChangeEvent, ISessionExitEvent } from '../common/sessionManagerService.js';
import { SessionEventType, SessionId, SessionInfo, SessionStatus } from '../common/types.js';
import { PtySessionManager } from '../node/sessionManagerImpl.js';

const CLAUDE_COMMAND = 'claude';
const CLAUDE_ARGS = ['--dangerously-skip-permissions'];

export class SessionManagerMainService extends Disposable implements ISessionManagerService {

	declare readonly _serviceBrand: undefined;

	private readonly _sessionManager = new PtySessionManager(CLAUDE_COMMAND, CLAUDE_ARGS);

	private readonly _onDidReceiveOutput = this._register(new Emitter<ISessionStdoutEvent>());
	readonly onDidReceiveOutput = this._onDidReceiveOutput.event;

	private readonly _onDidChangeStatus = this._register(new Emitter<ISessionStatusChangeEvent>());
	readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private readonly _onDidExit = this._register(new Emitter<ISessionExitEvent>());
	readonly onDidExit = this._onDidExit.event;

	async spawn(prompt: string, cwd: string): Promise<{ id: SessionId }> {
		const { id, stream } = await this._sessionManager.spawn(prompt, cwd);
		this._consumeStream(id, stream);
		return { id };
	}

	async resume(id: SessionId, prompt: string): Promise<void> {
		const stream = await this._sessionManager.resume(id, prompt);
		this._consumeStream(id, stream);
	}

	async kill(id: SessionId): Promise<void> {
		return this._sessionManager.kill(id);
	}

	async list(): Promise<SessionInfo[]> {
		return this._sessionManager.list();
	}

	async status(id: SessionId): Promise<SessionStatus> {
		return this._sessionManager.status(id);
	}

	private async _consumeStream(id: SessionId, stream: AsyncIterable<import('../common/types.js').SessionEvent>): Promise<void> {
		for await (const event of stream) {
			switch (event.type) {
				case SessionEventType.Stdout:
					this._onDidReceiveOutput.fire({ id, data: event.data });
					break;
				case SessionEventType.StatusChange:
					this._onDidChangeStatus.fire({ id, from: event.from, to: event.to });
					break;
				case SessionEventType.Exit:
					this._onDidExit.fire({ id, code: event.code });
					break;
			}
		}
	}
}
