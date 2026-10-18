#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <objbase.h>
#include <stdio.h>
#include <windows.h>

#include "delayline.c"

static const int kMaxSlots = 8;
static const DWORD kSilentFlag = 2;

struct DelayControl {
	volatile LONG delayMs;
	volatile LONG rewrittenFrames;
	volatile LONG status;
	DWORD parentPid;
	DWORD injectorPid;
};

struct Slot {
	void* render;
	BYTE* data;
	UINT32 frames;
	DelayLine line;
	int delayFrames;
	int frameBytes;
	int ready;
};

static DWORD g_tls = TLS_OUT_OF_INDEXES;
static int g_formatOffset = -1;
static DelayControl* g_control = NULL;
static CRITICAL_SECTION g_slotsLock;
static Slot g_slots[kMaxSlots];
static IAudioClient* g_lastClient = NULL;
static volatile LONG g_installing = 1;

typedef HRESULT(STDMETHODCALLTYPE* GetBufferFn)(IAudioRenderClient*, UINT32, BYTE**);
typedef HRESULT(STDMETHODCALLTYPE* ReleaseBufferFn)(IAudioRenderClient*, UINT32, DWORD);
typedef HRESULT(STDMETHODCALLTYPE* GetPaddingFn)(IAudioClient*, UINT32*);

static GetBufferFn g_getBuffer = NULL;
static ReleaseBufferFn g_releaseBuffer = NULL;
static GetPaddingFn g_getPadding = NULL;

static int Readable(const void* address, int bytes) {
	MEMORY_BASIC_INFORMATION info;
	const char* start;
	const char* regionStart;
	const char* regionEnd;
	if (!address || bytes <= 0) {
		return 0;
	}
	if (VirtualQuery(address, &info, sizeof(info)) == 0) {
		return 0;
	}
	if (info.State != MEM_COMMIT) {
		return 0;
	}
	if (info.Protect & (PAGE_NOACCESS | PAGE_GUARD)) {
		return 0;
	}
	start = (const char*)address;
	regionStart = (const char*)info.BaseAddress;
	regionEnd = regionStart + info.RegionSize;
	return start >= regionStart && start + bytes <= regionEnd;
}

static WAVEFORMATEX* FormatOf(IAudioClient* client) {
	WAVEFORMATEX* format;
	if (!client || g_formatOffset < 0) {
		return NULL;
	}
	if (!Readable((char*)client + g_formatOffset, (int)sizeof(void*))) {
		return NULL;
	}
	format = *(WAVEFORMATEX**)((char*)client + g_formatOffset);
	if (!Readable(format, (int)sizeof(WAVEFORMATEX))) {
		return NULL;
	}
	if (format->nChannels < 1 || format->nChannels > 8) {
		return NULL;
	}
	if (format->wBitsPerSample != 16 && format->wBitsPerSample != 32) {
		return NULL;
	}
	if (format->nBlockAlign != format->nChannels * (format->wBitsPerSample / 8)) {
		return NULL;
	}
	if (format->nSamplesPerSec < 8000 || format->nSamplesPerSec > 384000) {
		return NULL;
	}
	if (format->wFormatTag != WAVE_FORMAT_PCM && format->wFormatTag != WAVE_FORMAT_IEEE_FLOAT &&
		format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) {
		return NULL;
	}
	return format;
}

static int FindFormatOffset(IAudioClient* client) {
	WAVEFORMATEX* mix = NULL;
	int offset;
	if (FAILED(client->GetMixFormat(&mix)) || !mix) {
		return -1;
	}
	for (offset = 0; offset <= 1200; offset += (int)sizeof(void*)) {
		WAVEFORMATEX* candidate;
		if (!Readable((char*)client + offset, (int)sizeof(void*))) {
			continue;
		}
		candidate = *(WAVEFORMATEX**)((char*)client + offset);
		if (!Readable(candidate, (int)sizeof(WAVEFORMATEX))) {
			continue;
		}
		if (candidate->nSamplesPerSec == mix->nSamplesPerSec && candidate->nChannels == mix->nChannels &&
			candidate->nBlockAlign == mix->nBlockAlign && candidate->wBitsPerSample == mix->wBitsPerSample &&
			(candidate->wFormatTag == WAVE_FORMAT_PCM || candidate->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
			 candidate->wFormatTag == WAVE_FORMAT_EXTENSIBLE)) {
			CoTaskMemFree(mix);
			return offset;
		}
	}
	CoTaskMemFree(mix);
	return -1;
}

static Slot* FindSlot(void* render, int create) {
	int i;
	int freeIndex = -1;
	for (i = 0; i < kMaxSlots; i++) {
		if (g_slots[i].render == render) {
			return &g_slots[i];
		}
		if (freeIndex < 0 && g_slots[i].render == NULL) {
			freeIndex = i;
		}
	}
	if (!create || freeIndex < 0) {
		return NULL;
	}
	memset(&g_slots[freeIndex], 0, sizeof(Slot));
	g_slots[freeIndex].render = render;
	return &g_slots[freeIndex];
}

static void EnsureLine(Slot* slot, int delayMs, int frameBytes, int sampleRate) {
	int delayFrames = delayMs <= 0 ? 0 : delayMs * sampleRate / 1000;
	if (slot->ready && slot->delayFrames == delayFrames && slot->frameBytes == frameBytes) {
		return;
	}
	delay_line_free(&slot->line);
	memset(&slot->line, 0, sizeof(slot->line));
	delay_line_init(&slot->line, delayFrames, frameBytes, sampleRate);
	slot->delayFrames = delayFrames;
	slot->frameBytes = frameBytes;
	slot->ready = slot->line.data != NULL;
}

static IAudioClient* ClientForRender(IAudioRenderClient* render) {
	IAudioClient* fromTls = (IAudioClient*)TlsGetValue(g_tls);
	int offset;
	int matches = 0;
	IAudioClient* found = NULL;
	if (FormatOf(fromTls)) {
		return fromTls;
	}
	if (FormatOf(g_lastClient)) {
		return g_lastClient;
	}
	for (offset = 0; offset <= 512; offset += (int)sizeof(void*)) {
		IAudioClient* candidate;
		if (!Readable((char*)render + offset, (int)sizeof(void*))) {
			continue;
		}
		candidate = *(IAudioClient**)((char*)render + offset);
		if (!FormatOf(candidate)) {
			continue;
		}
		matches++;
		found = candidate;
	}
	return matches == 1 ? found : NULL;
}

static int ProcessDead(DWORD pid) {
	DWORD code = 0;
	HANDLE process;
	if (!pid) {
		return 0;
	}
	process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
	if (!process || !GetExitCodeProcess(process, &code) || code != STILL_ACTIVE) {
		if (process) {
			CloseHandle(process);
		}
		return 1;
	}
	CloseHandle(process);
	return 0;
}

static HRESULT STDMETHODCALLTYPE HookGetPadding(IAudioClient* self, UINT32* padding) {
	if (!g_installing && FormatOf(self)) {
		TlsSetValue(g_tls, self);
		g_lastClient = self;
	}
	return g_getPadding(self, padding);
}

static HRESULT STDMETHODCALLTYPE HookGetBuffer(IAudioRenderClient* self, UINT32 frames, BYTE** data) {
	HRESULT hr = g_getBuffer(self, frames, data);
	if (!g_installing && SUCCEEDED(hr) && data && *data) {
		EnterCriticalSection(&g_slotsLock);
		Slot* slot = FindSlot(self, 1);
		if (slot) {
			slot->data = *data;
			slot->frames = frames;
		}
		LeaveCriticalSection(&g_slotsLock);
	}
	return hr;
}

static HRESULT STDMETHODCALLTYPE HookReleaseBuffer(IAudioRenderClient* self, UINT32 frames, DWORD flags) {
	int delayMs = g_control ? g_control->delayMs : 0;
	int rewritten = 0;
	if (!g_installing && delayMs > 0 && frames > 0) {
		EnterCriticalSection(&g_slotsLock);
		Slot* slot = FindSlot(self, 0);
		BYTE* data = slot ? slot->data : NULL;
		LeaveCriticalSection(&g_slotsLock);
		WAVEFORMATEX* format = FormatOf(ClientForRender(self));
		if (g_control && (g_control->parentPid || g_control->injectorPid)) {
			DWORD now = GetTickCount();
			static DWORD lastParentCheck = 0;
			if (now - lastParentCheck > 200) {
				lastParentCheck = now;
				if (ProcessDead(g_control->parentPid) || ProcessDead(g_control->injectorPid)) {
					g_control->delayMs = 0;
					delayMs = 0;
				}
			}
		}
		if (slot && data && format && delayMs > 0) {
			int bytes = (int)frames * (int)format->nBlockAlign;
			if (bytes > 0 && bytes <= 1024 * 1024 && Readable(data, bytes)) {
				unsigned char* delayed = (unsigned char*)malloc((size_t)bytes);
				if (delayed) {
					EnsureLine(slot, delayMs, format->nBlockAlign, (int)format->nSamplesPerSec);
					if (slot->ready) {
						if (flags & kSilentFlag) {
							memset(delayed, 0, (size_t)bytes);
							delay_line_write(&slot->line, delayed, (int)frames);
						} else {
							delay_line_write(&slot->line, data, (int)frames);
						}
						memset(delayed, 0, (size_t)bytes);
						delay_line_read(&slot->line, delayed, (int)frames);
						memcpy(data, delayed, (size_t)bytes);
						rewritten = 1;
						if (g_control) {
							InterlockedIncrement(&g_control->rewrittenFrames);
						}
					}
					free(delayed);
				}
			}
		}
	}
	if (rewritten) {
		flags &= ~kSilentFlag;
	}
	return g_releaseBuffer(self, frames, flags);
}

static void Patch(void** vtable, int index, void* hook, void** original) {
	DWORD oldProtect = 0;
	VirtualProtect(&vtable[index], sizeof(void*), PAGE_EXECUTE_READWRITE, &oldProtect);
	*original = vtable[index];
	vtable[index] = hook;
	VirtualProtect(&vtable[index], sizeof(void*), oldProtect, &oldProtect);
}

static DWORD WINAPI Install(LPVOID) {
	HRESULT hr;
	IMMDeviceEnumerator* enumerator = NULL;
	IMMDevice* device = NULL;
	IAudioClient* client = NULL;
	IAudioRenderClient* render = NULL;
	WAVEFORMATEX* mix = NULL;
	void** clientTable;
	void** renderTable;
	wchar_t name[96];

	g_tls = TlsAlloc();
	InitializeCriticalSection(&g_slotsLock);
	wsprintfW(name, L"Local\\DeskreenAudioDelay_%lu", GetCurrentProcessId());
	HANDLE mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, name);
	if (!mapping) {
		return 0;
	}
	g_control = (DelayControl*)MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(DelayControl));
	if (!g_control) {
		CloseHandle(mapping);
		return 0;
	}

	hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
	if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
		g_control->status = -1;
		return 0;
	}
	hr = CoCreateInstance(
		__uuidof(MMDeviceEnumerator),
		NULL,
		CLSCTX_ALL,
		__uuidof(IMMDeviceEnumerator),
		(void**)&enumerator
	);
	if (FAILED(hr)) {
		g_control->status = -1;
		return 0;
	}
	hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
	if (FAILED(hr)) {
		g_control->status = -1;
		return 0;
	}
	hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void**)&client);
	if (FAILED(hr)) {
		g_control->status = -1;
		return 0;
	}
	if (FAILED(client->GetMixFormat(&mix)) || FAILED(client->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 100000, 0, mix, NULL))) {
		g_control->status = -1;
		return 0;
	}
	g_formatOffset = FindFormatOffset(client);
	hr = client->GetService(__uuidof(IAudioRenderClient), (void**)&render);
	if (FAILED(hr) || g_formatOffset < 0) {
		g_control->status = -1;
		return 0;
	}
	clientTable = *(void***)client;
	renderTable = *(void***)render;
	render->Release();
	client->Release();
	if (mix) {
		CoTaskMemFree(mix);
	}
	device->Release();
	enumerator->Release();

	Patch(clientTable, 6, (void*)HookGetPadding, (void**)&g_getPadding);
	Patch(renderTable, 3, (void*)HookGetBuffer, (void**)&g_getBuffer);
	Patch(renderTable, 4, (void*)HookReleaseBuffer, (void**)&g_releaseBuffer);
	g_installing = 0;
	g_control->status = 1;
	return 0;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
	(void)instance;
	(void)reserved;
	if (reason == DLL_PROCESS_ATTACH) {
		DisableThreadLibraryCalls(instance);
		HANDLE thread = CreateThread(NULL, 0, Install, NULL, 0, NULL);
		if (thread) {
			CloseHandle(thread);
		}
	}
	return TRUE;
}
