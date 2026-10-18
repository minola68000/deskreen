export function shouldUseNativeVideoPlayer(
	userAgent: string,
	maxTouchPoints: number,
): boolean {
	if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
	return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}
