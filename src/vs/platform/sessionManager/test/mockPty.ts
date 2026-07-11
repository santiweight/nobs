/*---------------------------------------------------------------------------------------------
 *  Mock PTY — in-memory fake for unit testing.
 *  Follows the TestPty pattern from agentHostTerminalManager.test.ts.
 *--------------------------------------------------------------------------------------------*/

type IPty = import('node-pty').IPty;

type DataListener = (data: string) => void;
type ExitListener = (e: { exitCode: number; signal?: number }) => void;

export class MockPty implements IPty {
	readonly pid = 1;
	cols = 200;
	rows = 50;
	process = 'mock-agent';
	handleFlowControl = false;
	readonly writes: string[] = [];

	private _dataListeners: DataListener[] = [];
	private _exitListeners: ExitListener[] = [];
	private _killed = false;

	onData(listener: DataListener): { dispose(): void } {
		this._dataListeners.push(listener);
		return { dispose: () => { this._dataListeners = this._dataListeners.filter(l => l !== listener); } };
	}

	onExit(listener: ExitListener): { dispose(): void } {
		this._exitListeners.push(listener);
		return { dispose: () => { this._exitListeners = this._exitListeners.filter(l => l !== listener); } };
	}

	write(data: string): void {
		this.writes.push(data);
	}

	resize(_cols: number, _rows: number): void {}
	pause(): void {}
	resume(): void {}
	clear(): void {}

	kill(_signal?: string): void {
		if (!this._killed) {
			this._killed = true;
			this.fireExit(0);
		}
	}

	// --- test helpers ---

	fireData(data: string): void {
		for (const listener of this._dataListeners) {
			listener(data);
		}
	}

	fireExit(code: number): void {
		for (const listener of this._exitListeners) {
			listener({ exitCode: code });
		}
	}

	get killed(): boolean {
		return this._killed;
	}
}

export class MockPtyFactory {
	readonly ptys: MockPty[] = [];
	readonly spawnCalls: { file: string; args: string[]; options: any }[] = [];

	get spawnPty() {
		return (file: string, args: string[], options: any): MockPty => {
			this.spawnCalls.push({ file, args, options });
			const pty = new MockPty();
			this.ptys.push(pty);
			return pty;
		};
	}

	get lastPty(): MockPty {
		if (this.ptys.length === 0) {
			throw new Error('No PTYs spawned');
		}
		return this.ptys[this.ptys.length - 1];
	}

	reset(): void {
		this.ptys.length = 0;
		this.spawnCalls.length = 0;
	}
}
