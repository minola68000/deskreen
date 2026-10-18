export default (sdp: string, mediaType: string, bitrate: number) => {
	const sdpLines = sdp.split('\n');
	let mediaLineIndex = -1;
	const mediaLine = `m=${mediaType}`;
	let bitrateLineIndex = -1;
	const bitrateLine = `b=AS:${bitrate}`;
	mediaLineIndex = sdpLines.findIndex((line) => line.startsWith(mediaLine));

	if (mediaLineIndex >= 0 && mediaLineIndex < sdpLines.length) {
		bitrateLineIndex = mediaLineIndex + 1;

		while (
			bitrateLineIndex < sdpLines.length &&
			(sdpLines[bitrateLineIndex].startsWith('i=') ||
				sdpLines[bitrateLineIndex].startsWith('c='))
		) {
			bitrateLineIndex += 1;
		}

		if (bitrateLineIndex >= sdpLines.length) {
			sdpLines.push(bitrateLine);
		} else if (sdpLines[bitrateLineIndex].startsWith('b=')) {
			// If the next line is a b=* line, replace it with our new bandwidth
			sdpLines[bitrateLineIndex] = bitrateLine;
		} else {
			// Otherwise insert a new bitrate line.
			sdpLines.splice(bitrateLineIndex, 0, bitrateLine);
		}
	}

	// Then return the updated sdp content as a string
	return sdpLines.join('\n');
};
