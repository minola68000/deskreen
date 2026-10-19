import getDesktopSourceStreamBySourceID from './getDesktopSourceStreamBySourceID';
import DesktopCapturerSourceType from '../../../../common/DesktopCapturerSourceType';
import { cropMediaStream } from './cropMediaStream';

export default async function createDesktopCapturerStream(
	peerConnection: PeerConnection,
	sourceID: string,
): Promise<void> {
	try {
		if (process.env.RUN_MODE === 'test') return;

		const stream = sourceID.includes(DesktopCapturerSourceType.SCREEN)
			? await getDesktopSourceStreamBySourceID(
					sourceID,
					peerConnection.sourceDisplaySize?.width,
					peerConnection.sourceDisplaySize?.height,
					0.5,
					1,
				)
			: await getDesktopSourceStreamBySourceID(sourceID);
		peerConnection.localStream = peerConnection.captureCrop
			? await cropMediaStream(stream, peerConnection.captureCrop)
			: stream;
	} catch (e) {
		console.error(e);
	}
}
