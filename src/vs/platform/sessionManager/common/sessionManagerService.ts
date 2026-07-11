/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { SessionId, SessionInfo, SessionStatus } from './types.js';

export const ISessionManagerService = createDecorator<ISessionManagerService>('sessionManagerService');

export interface ISessionStdoutEvent {
	readonly id: SessionId;
	readonly data: string;
}

export interface ISessionStatusChangeEvent {
	readonly id: SessionId;
	readonly from: SessionStatus;
	readonly to: SessionStatus;
}

export interface ISessionExitEvent {
	readonly id: SessionId;
	readonly code: number | null;
}

export interface ISessionManagerService {

	readonly _serviceBrand: undefined;

	spawn(prompt: string, cwd: string): Promise<{ id: SessionId }>;
	resume(id: SessionId, prompt: string): Promise<void>;
	kill(id: SessionId): Promise<void>;
	list(): Promise<SessionInfo[]>;
	status(id: SessionId): Promise<SessionStatus>;

	readonly onDidReceiveOutput: Event<ISessionStdoutEvent>;
	readonly onDidChangeStatus: Event<ISessionStatusChangeEvent>;
	readonly onDidExit: Event<ISessionExitEvent>;
}
