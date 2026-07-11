/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface INobsProject {
	readonly id: string;
	readonly name: string;
	readonly rootPath: string;
	expanded: boolean;
}

export interface INobsWorkspace {
	readonly id: string;
	readonly projectId: string;
	name: string;
	readonly branch: string;
	readonly worktreePath: string;
	readonly isMain: boolean;
}
