export function preferVideoCodec(sdp: string, codec: string): string {
	const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
	const lines = sdp.split(/\r?\n/);
	const mediaIndex = lines.findIndex((line) => line.startsWith('m=video '));
	if (mediaIndex < 0) return sdp;

	const parts = lines[mediaIndex].split(' ');
	if (parts.length < 4) return sdp;
	const payloads = parts.slice(3);
	const wanted = new Set<string>();
	const rtpmap = new RegExp(`^a=rtpmap:(\\d+)\\s+${codec}/90000`, 'i');
	for (const line of lines) {
		const match = line.match(rtpmap);
		if (match) wanted.add(match[1]);
	}
	if (wanted.size === 0) return sdp;

	lines[mediaIndex] = [
		...parts.slice(0, 3),
		...payloads.filter((payload) => wanted.has(payload)),
		...payloads.filter((payload) => !wanted.has(payload)),
	].join(' ');
	return lines.join(newline);
}

export function preferIpadH264(sdp: string): string {
	const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
	const lines = sdp.split(/\r?\n/);
	const mediaIndex = lines.findIndex((line) => line.startsWith('m=video '));
	if (mediaIndex < 0) return sdp;
	const parts = lines[mediaIndex].split(' ');
	if (parts.length < 4) return preferVideoCodec(sdp, 'H264');
	const payloads = parts.slice(3);
	const preferred = new Set<string>();
	for (const line of lines) {
		const match = line.match(/^a=fmtp:(\d+)\s+(.*)/i);
		if (!match) continue;
		const params = match[2].toLowerCase();
		if (
			params.includes('profile-level-id=42e01f') &&
			params.includes('packetization-mode=1')
		) {
			preferred.add(match[1]);
		}
	}
	if (preferred.size === 0) return preferVideoCodec(sdp, 'H264');
	for (const line of lines) {
		const rtx = line.match(/^a=fmtp:(\d+)\s+.*\bapt=(\d+)/i);
		if (rtx && preferred.has(rtx[2])) preferred.add(rtx[1]);
	}
	const kept = payloads.filter((payload) => preferred.has(payload));
	if (kept.length === 0) return preferVideoCodec(sdp, 'H264');
	const keptPayloads = new Set(kept);
	const filtered = lines.filter((line, index) => {
		if (index === mediaIndex) return true;
		const payload = line.match(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/i)?.[1];
		if (!payload) return true;
		return keptPayloads.has(payload);
	});
	const mediaParts = filtered[mediaIndex].split(' ');
	filtered[mediaIndex] = [...mediaParts.slice(0, 3), ...kept].join(' ');
	return filtered.join(newline);
}
