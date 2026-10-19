const SCREEN_CAPTURE_FEATURE = 'AllowWgcScreenCapturer';
const WINDOW_CAPTURE_FEATURE = 'AllowWgcWindowCapturer';
const LAN_CANDIDATE_FEATURE = 'WebRtcHideLocalIpsWithMdns';

export function chromiumFeaturesDisablingBrokenWgc(
	platform: NodeJS.Platform,
): string | null {
	const features = [LAN_CANDIDATE_FEATURE];
	if (platform === 'win32') {
		features.unshift(SCREEN_CAPTURE_FEATURE);
	}
	return features.join(',');
}

export function argvWithBrokenWgcDisabled(
	argv: readonly string[],
	platform: NodeJS.Platform,
): string[] | null {
	const features = chromiumFeaturesDisablingBrokenWgc(platform);
	if (!features) return null;
	const required = features.split(',');
	const disableArg = argv.find((arg) => arg.startsWith('--disable-features='));
	const present = new Set(
		(disableArg ? disableArg.slice('--disable-features='.length) : '')
			.split(',')
			.filter(Boolean),
	);
	const windowCapturerDisabled = present.has(WINDOW_CAPTURE_FEATURE);
	present.delete(WINDOW_CAPTURE_FEATURE);
	if (
		!windowCapturerDisabled &&
		required.every((feature) => present.has(feature))
	) {
		return null;
	}
	for (const feature of required) present.add(feature);
	const kept = argv
		.slice(1)
		.filter((arg) => !arg.startsWith('--disable-features='));
	return [...kept, `--disable-features=${[...present].join(',')}`];
}
