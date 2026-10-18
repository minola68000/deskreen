const CANDIDATE_ADDRESS =
	/(?:^a=)?candidate:\S+ \d+ \S+ \d+ (\S+)/;

export function iceCandidateAddress(line: string): string | undefined {
	return line.match(CANDIDATE_ADDRESS)?.[1];
}

export function sdpKeepingLanCandidates(sdp: string, lanIp: string): string {
	if (!lanIp) return sdp;
	const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
	return sdp
		.split(/\r?\n/)
		.filter((line) => {
			if (!line.startsWith('a=candidate:')) return true;
			return iceCandidateAddress(line) === lanIp;
		})
		.join(newline);
}

export function signalUsesLanAddress(data: unknown, lanIp: string): boolean {
	if (!lanIp) return true;
	const record = typeof data === 'string' ? parseSignal(data) : data;
	if (!record || typeof record !== 'object') return true;
	const nested = (record as { candidate?: { candidate?: string } | string })
		.candidate;
	const line = typeof nested === 'string' ? nested : nested?.candidate;
	if (!line) return true;
	return iceCandidateAddress(line) === lanIp;
}

function parseSignal(data: string): unknown {
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
}
