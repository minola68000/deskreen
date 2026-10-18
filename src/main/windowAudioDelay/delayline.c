#include <stddef.h>
#include <stdlib.h>
#include <string.h>

typedef struct DelayLine {
	int frame_bytes;
	unsigned char* data;
	int capacity;
	int read_at;
	int count;
} DelayLine;

static void delay_line_init(DelayLine* line, int delay_frames, int frame_bytes, int slack_frames) {
	int capacity = delay_frames + slack_frames;
	if (capacity < 1) {
		capacity = 1;
	}
	line->frame_bytes = frame_bytes;
	line->capacity = capacity;
	line->data = (unsigned char*)calloc((size_t)capacity * (size_t)frame_bytes, 1);
	line->read_at = 0;
	line->count = line->data ? (delay_frames < capacity ? delay_frames : capacity) : 0;
}

static void delay_line_free(DelayLine* line) {
	free(line->data);
	line->data = NULL;
	line->count = 0;
}

static void delay_line_write(DelayLine* line, const unsigned char* src, int frames) {
	int overflow;
	int write_at;
	int i;
	if (!line->data || frames <= 0) {
		return;
	}
	overflow = line->count + frames - line->capacity;
	if (overflow > 0) {
		line->read_at = (line->read_at + overflow) % line->capacity;
		line->count -= overflow;
	}
	write_at = (line->read_at + line->count) % line->capacity;
	for (i = 0; i < frames; i++) {
		memcpy(
			line->data + (size_t)write_at * (size_t)line->frame_bytes,
			src + (size_t)i * (size_t)line->frame_bytes,
			(size_t)line->frame_bytes
		);
		write_at++;
		if (write_at == line->capacity) {
			write_at = 0;
		}
	}
	line->count += frames;
}

static int delay_line_read(DelayLine* line, unsigned char* dst, int frames) {
	int n;
	int i;
	if (!line->data || frames <= 0) {
		return 0;
	}
	n = frames < line->count ? frames : line->count;
	for (i = 0; i < n; i++) {
		memcpy(
			dst + (size_t)i * (size_t)line->frame_bytes,
			line->data + (size_t)line->read_at * (size_t)line->frame_bytes,
			(size_t)line->frame_bytes
		);
		line->read_at++;
		if (line->read_at == line->capacity) {
			line->read_at = 0;
		}
	}
	line->count -= n;
	return n;
}
