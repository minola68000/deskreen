import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ElectronStoreKeys } from '../../common/ElectronStoreKeys.enum';
import { store } from '../../common/deskreen-electron-store';
import SharingSessionStatusEnum from '../../features/SharingSessionService/SharingSessionStatusEnum';
import { getDeskreenGlobal } from '../helpers/getDeskreenGlobal';
import { clampDelayMs, windowHandleToken } from './pcmDelay';

export type WindowAudioDelayState = {
	ms: number;
	error: string;
};

let child: ChildProcessWithoutNullStreams | null = null;
let currentToken: string | null = null;
let lastError = '';
let chain: Promise<void> = Promise.resolve();
let lifecycleInstalled = false;

const bundledDir = (): string => {
	const devDir = path.join(
		app.getAppPath(),
		'src/main/windowAudioDelay/bin',
	);
	if (fs.existsSync(path.join(devDir, 'AudioDelayInject.exe'))) {
		return devDir;
	}
	return path.join(process.resourcesPath, 'window-audio-delay');
};

const prepareHelperDir = (): string => {
	const sourceDir = bundledDir();
	const runtimeDir = path.join(app.getPath('userData'), 'window-audio-delay');
	fs.mkdirSync(runtimeDir, { recursive: true });
	const copy = (from: string, to: string): void => {
		try {
			fs.copyFileSync(from, to);
		} catch (error) {
			if (!fs.existsSync(to)) {
				throw error;
			}
		}
	};
	copy(
		path.join(sourceDir, 'AudioDelayInject.exe'),
		path.join(runtimeDir, 'AudioDelayInject.exe'),
	);
	return runtimeDir;
};

const enqueue = (task: () => Promise<void>): void => {
	chain = chain
		.then(task)
		.catch((error: unknown) => {
			console.error('window audio delay failed', error);
		});
};

const stopCurrent = async (): Promise<void> => {
	const current = child;
	child = null;
	currentToken = null;
	if (!current) {
		return;
	}
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			try {
				current.kill();
			} catch {
				// already exited
			}
		}, 1000);
		current.once('exit', () => {
			clearTimeout(timer);
			resolve();
		});
		try {
			current.stdin.write('delay 0\nquit\n');
		} catch {
			clearTimeout(timer);
			try {
				current.kill();
			} catch {
				// already exited
			}
			resolve();
		}
	});
};

const startCurrent = (token: string, ms: number): Promise<void> => {
	return new Promise((resolve) => {
		let runtimeDir = '';
		try {
			runtimeDir = prepareHelperDir();
		} catch (error) {
			lastError = 'helper-failed';
			console.error(error);
			resolve();
			return;
		}
		const proc = spawn(
			path.join(runtimeDir, 'AudioDelayInject.exe'),
			['run', '--hwnd', token, String(ms), '--parent', String(process.pid)],
			{ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
		);
		child = proc;
		currentToken = token;
		let settled = false;
		let pendingError = 'helper-failed';
		const finish = (error: string): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			lastError = error;
			if (error) {
				try {
					proc.kill();
				} catch {
					// already exited
				}
			}
			resolve();
		};
		const timer = setTimeout(() => finish(pendingError), 8000);
		proc.stdout.on('data', (buf: Buffer) => {
			if (buf.toString().includes('READY')) {
				finish('');
			}
		});
		proc.stderr.on('data', (buf: Buffer) => {
			const text = buf.toString();
			console.error(text.trim());
			if (text.includes('own-process')) {
				pendingError = 'own-process';
			} else if (text.includes('32-bit')) {
				pendingError = '32-bit';
			}
		});
		proc.once('error', () => {
			finish(pendingError);
		});
		proc.once('exit', () => {
			if (child === proc) {
				child = null;
				currentToken = null;
			}
			if (!settled) {
				finish(pendingError);
			}
		});
	});
};

export const readWindowAudioDelayMs = (): number => {
	const raw = store.get(ElectronStoreKeys.WindowAudioDelayMs);
	if (raw === undefined) {
		return 0;
	}
	return clampDelayMs(Number(raw));
};

export const getWindowAudioDelayState = (): WindowAudioDelayState => {
	return { ms: readWindowAudioDelayMs(), error: lastError };
};

export const activeSharedWindowSourceId = (): string | null => {
	try {
		const sessions = getDeskreenGlobal().sharingSessionService.sharingSessions;
		for (const session of sessions.values()) {
			if (session.status !== SharingSessionStatusEnum.SHARING) {
				continue;
			}
			if (windowHandleToken(session.desktopCapturerSourceID)) {
				return session.desktopCapturerSourceID;
			}
		}
	} catch {
		return null;
	}
	return null;
};

export const syncWindowAudioDelay = (sourceId: string | null): void => {
	const ms = readWindowAudioDelayMs();
	const token = sourceId ? windowHandleToken(sourceId) : null;
	enqueue(async () => {
		if (!token || ms <= 0) {
			await stopCurrent();
			lastError = '';
			return;
		}
		if (process.platform !== 'win32') {
			lastError = 'unsupported-platform';
			await stopCurrent();
			return;
		}
		if (child && currentToken === token) {
			try {
				child.stdin.write(`delay ${ms}\n`);
				lastError = '';
				return;
			} catch {
				// restart below
			}
		}
		await stopCurrent();
		await startCurrent(token, ms);
	});
};

export const stopWindowAudioDelay = (): void => {
	enqueue(async () => {
		await stopCurrent();
	});
};

export const setWindowAudioDelayMs = (
	value: number,
): Promise<WindowAudioDelayState> => {
	const ms = clampDelayMs(value);
	store.set(ElectronStoreKeys.WindowAudioDelayMs, String(ms));
	syncWindowAudioDelay(activeSharedWindowSourceId());
	return chain.then(() => getWindowAudioDelayState());
};

export const installWindowAudioDelayLifecycle = (): void => {
	if (lifecycleInstalled) {
		return;
	}
	lifecycleInstalled = true;
	app.on('before-quit', () => {
		stopWindowAudioDelay();
	});
};
