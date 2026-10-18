import { BrowserWindow } from 'electron';
import uuid from 'uuid';
import SharingSessionStatusEnum from './SharingSessionStatusEnum';
import SharingTypeEnum from './SharingTypeEnum';
import PeerConnectionHelperRendererService from '../PeerConnectionHelperRendererService';
import { Device } from '../../common/Device';
import { LocalPeerUser } from '../../common/LocalPeerUser';

export type SharingSessionStatusChangeListener = (
	sharingSessionID: string,
) => void;

export default class SharingSession {
	id: string;
	deviceID: string;
	sharingType: SharingTypeEnum;
	sharingStream: MediaStream | null;
	roomID: string;
	connectedDeviceAt: Date | null;
	sharingStartedAt: Date | null;
	status: SharingSessionStatusEnum;
	statusChangeListeners: SharingSessionStatusChangeListener[];
	peerConnectionHelperRenderer: BrowserWindow | undefined;
	onDeviceConnectedCallback: undefined | ((device: Device) => void);
	desktopCapturerSourceID: string;
	localUser: LocalPeerUser;
	helperRendererService: PeerConnectionHelperRendererService;
	reannounceTimer: ReturnType<typeof setTimeout> | null = null;

	private helperClosedByUs = false;

	constructor(
		_roomID: string,
		user: LocalPeerUser,
		peerConnectionHelperRendererService: PeerConnectionHelperRendererService,
	) {
		this.id = uuid.v4();
		this.deviceID = '';
		this.sharingType = SharingTypeEnum.NOT_SET;
		this.sharingStream = null;
		this.roomID = _roomID;
		this.connectedDeviceAt = null;
		this.sharingStartedAt = null;
		this.status = SharingSessionStatusEnum.NOT_CONNECTED;
		this.statusChangeListeners = [] as SharingSessionStatusChangeListener[];
		this.desktopCapturerSourceID = '';
		this.onDeviceConnectedCallback = undefined;
		this.localUser = user;
		this.helperRendererService = peerConnectionHelperRendererService;

		if (process.env.RUN_MODE === 'test') return;

		this.peerConnectionHelperRenderer = this.createHelperWindow();

		this.statusChangeListeners.push(() => {
			if (this.status === SharingSessionStatusEnum.CONNECTED) {
				this.peerConnectionHelperRenderer?.webContents.send(
					'send-user-allowed-to-connect',
				);
			}
		});
	}

	private helperPayload(): {
		roomID: string;
		sharingSessionID: string;
		user: LocalPeerUser;
	} {
		return {
			roomID: this.roomID,
			sharingSessionID: this.id,
			user: this.localUser,
		};
	}

	private bindHelper(win: BrowserWindow): void {
		win.webContents.on('did-finish-load', () => {
			win.webContents.send(
				'create-peer-connection-with-data',
				this.helperPayload(),
			);
		});

		win.webContents.on('ipc-message', (_, channel, data) => {
			if (channel === 'peer-connected' && this.onDeviceConnectedCallback) {
				this.onDeviceConnectedCallback(data);
			}
		});
	}

	private createHelperWindow(): BrowserWindow {
		const win = this.helperRendererService.createPeerConnectionHelperRenderer();
		this.bindHelper(win);
		win.on('closed', () => {
			if (this.helperClosedByUs) return;
			if (this.peerConnectionHelperRenderer !== win) return;
			this.peerConnectionHelperRenderer = undefined;
			if (this.reannounceTimer) {
				clearTimeout(this.reannounceTimer);
				this.reannounceTimer = null;
			}
			this.reannounceHost();
		});
		return win;
	}

	private reannounceAttempts = 0;

	reannounceHost(): void {
		if (process.env.RUN_MODE === 'test') return;

		const win = this.peerConnectionHelperRenderer;
		if (!win || win.isDestroyed()) {
			if (this.reannounceTimer) {
				clearTimeout(this.reannounceTimer);
				this.reannounceTimer = null;
			}
			this.peerConnectionHelperRenderer = this.createHelperWindow();
			this.reannounceAttempts = 0;
			this.reannounceTimer = setTimeout(() => {
				this.reannounceTimer = null;
			}, 2000);
			return;
		}
		if (this.reannounceTimer) return;
		if (win.webContents.isLoading()) {
			this.reannounceAttempts += 1;
			if (this.reannounceAttempts > 8) {
				this.reannounceAttempts = 0;
				return;
			}
			this.reannounceTimer = setTimeout(() => {
				this.reannounceTimer = null;
				this.reannounceHost();
			}, 400);
			return;
		}
		this.reannounceAttempts = 0;
		this.reannounceTimer = setTimeout(() => {
			this.reannounceTimer = null;
		}, 2000);
		win.webContents.send('start-peer-connection');
		win.webContents.send(
			'create-peer-connection-with-data',
			this.helperPayload(),
		);
	}

	destroy(): void {
		this.helperClosedByUs = true;
		if (this.reannounceTimer) {
			clearTimeout(this.reannounceTimer);
			this.reannounceTimer = null;
		}
		this.peerConnectionHelperRenderer?.close();
	}

	setOnDeviceConnectedCallback(callback: (device: Device) => void): void {
		this.onDeviceConnectedCallback = callback;
	}

	setDesktopCapturerSourceID(id: string): void {
		this.desktopCapturerSourceID = id;
		if (process.env.RUN_MODE === 'test') return;
		this.peerConnectionHelperRenderer?.webContents.send(
			'set-desktop-capturer-source-id',
			id,
		);
	}

	callPeer(): void {
		if (process.env.RUN_MODE === 'test') return;
		this.peerConnectionHelperRenderer?.webContents.send('call-peer');
	}

	disconnectByHostMachineUser(): void {
		this.peerConnectionHelperRenderer?.webContents.send(
			'disconnect-by-host-machine-user',
			this.deviceID,
		);
	}

	denyConnectionForPartner(): void {
		this.peerConnectionHelperRenderer?.webContents.send(
			'deny-connection-for-partner',
		);
	}

	appLanguageChanged(): void {
		this.peerConnectionHelperRenderer?.webContents.send('app-language-changed');
	}

	addStatusChangeListener(callback: SharingSessionStatusChangeListener): void {
		this.statusChangeListeners.push(callback);
	}

	notifyStatusChangeListeners(): Promise<undefined> {
		return new Promise((resolve) => {
			for (let i = 0; i < this.statusChangeListeners.length; i += 1) {
				this.statusChangeListeners[i](this.id);
			}
			resolve(undefined);
		});
	}

	setStatus(newStatus: SharingSessionStatusEnum): void {
		this.status = newStatus;
		this.notifyStatusChangeListeners();
	}

	setDeviceID(deviceID: string): void {
		this.deviceID = deviceID;
	}
}
