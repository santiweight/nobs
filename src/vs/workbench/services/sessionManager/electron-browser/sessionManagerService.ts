/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { ISessionManagerService } from '../../../../platform/sessionManager/common/sessionManagerService.js';

registerMainProcessRemoteService(ISessionManagerService, 'sessionManager');
