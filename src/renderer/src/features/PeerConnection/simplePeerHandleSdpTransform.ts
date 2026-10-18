import { sdpKeepingLanCandidates } from './lanIceCandidate';
import setSdpMediaBitrate from './setSdpMediaBitrate';
import { preferIpadH264 } from './preferVideoCodec';

export default (sdp: string, lanIp = ''): string => {
	return sdpKeepingLanCandidates(
		setSdpMediaBitrate(preferIpadH264(sdp), 'video', 500000),
		lanIp,
	);
};
