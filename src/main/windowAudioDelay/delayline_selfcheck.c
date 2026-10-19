#include <stdio.h>
#include <string.h>

#include "delayline.c"

static int expect_bytes(const unsigned char* got, const unsigned char* expect, int length) {
	int i;
	for (i = 0; i < length; i++) {
		if (got[i] != expect[i]) {
			printf("FAIL byte %d\n", i);
			return 1;
		}
	}
	return 0;
}

int main(void) {
	DelayLine delay;
	unsigned char input[8] = {1, 0, 2, 0, 3, 0, 4, 0};
	unsigned char output[8];
	unsigned char expect[8] = {0, 0, 0, 0, 1, 0, 2, 0};
	DelayLine passthrough;
	unsigned char again[4];

	memset(&delay, 0, sizeof(delay));
	delay_line_init(&delay, 2, 2, 8);
	delay_line_write(&delay, input, 4);
	memset(output, 0xFF, sizeof(output));
	if (delay_line_read(&delay, output, 4) != 4) {
		printf("FAIL count\n");
		return 1;
	}
	if (expect_bytes(output, expect, 8) != 0) {
		return 1;
	}
	delay_line_free(&delay);

	memset(&passthrough, 0, sizeof(passthrough));
	delay_line_init(&passthrough, 0, 2, 4);
	delay_line_write(&passthrough, input, 2);
	memset(again, 0, sizeof(again));
	delay_line_read(&passthrough, again, 2);
	if (again[0] != 1 || again[2] != 2) {
		printf("FAIL passthrough\n");
		return 1;
	}
	delay_line_free(&passthrough);
	printf("OK\n");
	return 0;
}
