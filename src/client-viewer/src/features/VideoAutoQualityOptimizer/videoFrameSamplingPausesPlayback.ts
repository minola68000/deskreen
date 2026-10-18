export function videoFrameSamplingPausesPlayback(
	userAgent: string,
	maxTouchPoints: number,
): boolean {
	if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
	if (/Macintosh/i.test(userAgent) && !/Chrome|Chromium|Edg\//i.test(userAgent)) {
		return true;
	}
	return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}
