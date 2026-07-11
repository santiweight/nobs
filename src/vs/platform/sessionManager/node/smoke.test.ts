/*---------------------------------------------------------------------------------------------
 *  Session Manager — Smoke Test (real claude + tmux)
 *  Run with: npx tsx src/vs/platform/sessionManager/node/smoke.test.ts
 *--------------------------------------------------------------------------------------------*/

import { SessionManager } from './sessionManagerImpl.js';
import { SessionEventType } from '../common/types.js';

async function main() {
	const manager = new SessionManager();

	console.log('=== spawn ===');
	const { id, stream } = await manager.spawn('say hello and nothing else', process.cwd());
	console.log(`session id: ${id}`);

	for await (const event of stream) {
		switch (event.type) {
			case SessionEventType.Stdout:
				process.stdout.write(event.data);
				break;
			case SessionEventType.StatusChange:
				console.log(`\n[status] ${event.from} → ${event.to}`);
				break;
			case SessionEventType.Exit:
				console.log(`\n[exit] code=${event.code}`);
				break;
		}
	}

	console.log('\n=== status ===');
	console.log(`status: ${await manager.status(id)}`);

	console.log('\n=== list ===');
	for (const info of await manager.list()) {
		console.log(`  ${info.id} | ${info.status} | ${info.tmuxSession}`);
	}

	console.log('\n=== resume ===');
	const stream2 = await manager.resume(id, 'now say goodbye and nothing else');
	for await (const event of stream2) {
		switch (event.type) {
			case SessionEventType.Stdout:
				process.stdout.write(event.data);
				break;
			case SessionEventType.StatusChange:
				console.log(`\n[status] ${event.from} → ${event.to}`);
				break;
		}
	}

	console.log('\n=== kill ===');
	await manager.kill(id);
	console.log(`status after kill: ${await manager.status(id)}`);
	console.log('\ndone');
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
