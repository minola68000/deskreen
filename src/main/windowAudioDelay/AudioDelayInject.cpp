#include <audioclient.h>
#include <math.h>
#include <mmdeviceapi.h>
#include <objbase.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tlhelp32.h>
#include <windows.h>

#ifdef DESKREEN_EMBED_HOOK
#include "hook_bytes.h"
#endif

struct DelayControl {
	volatile LONG delayMs;
	volatile LONG rewrittenFrames;
	volatile LONG status;
	DWORD parentPid;
	DWORD injectorPid;
};

static int ClampDelay(int value);

static volatile LONG g_quit = 0;
static DelayControl* g_controls[16];
static int g_controlCount = 0;

static DWORD WINAPI StdinThread(LPVOID) {
	char line[64];
	while (fgets(line, 64, stdin)) {
		int i;
		if (strncmp(line, "quit", 4) == 0) {
			g_quit = 1;
			return 0;
		}
		if (strncmp(line, "delay ", 6) == 0) {
			int delay = ClampDelay(atoi(line + 6));
			for (i = 0; i < g_controlCount; i++) {
				g_controls[i]->delayMs = delay;
			}
		}
	}
	g_quit = 1;
	return 0;
}

static int ClampDelay(int value) {
	if (value < 0) {
		return 0;
	}
	if (value > 10000) {
		return 10000;
	}
	return value;
}

static int IsWow64(DWORD pid) {
	BOOL wow = FALSE;
	HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
	if (!process) {
		return 0;
	}
	IsWow64Process(process, &wow);
	CloseHandle(process);
	return wow ? 1 : 0;
}

static int IsAncestorOfSelf(DWORD pid) {
	DWORD self = GetCurrentProcessId();
	HANDLE snap;
	PROCESSENTRY32W entry;
	DWORD cursor;
	int guard;
	if (pid == self) {
		return 1;
	}
	snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
	if (snap == INVALID_HANDLE_VALUE) {
		return 0;
	}
	entry.dwSize = sizeof(entry);
	cursor = self;
	if (!Process32FirstW(snap, &entry)) {
		CloseHandle(snap);
		return 0;
	}
	for (guard = 0; guard < 32; guard++) {
		int found = 0;
		DWORD parent = 0;
		if (!Process32FirstW(snap, &entry)) {
			break;
		}
		do {
			if (entry.th32ProcessID == cursor) {
				parent = entry.th32ParentProcessID;
				found = 1;
				break;
			}
		} while (Process32NextW(snap, &entry));
		if (!found || parent == 0 || parent == cursor) {
			break;
		}
		if (parent == pid) {
			CloseHandle(snap);
			return 1;
		}
		cursor = parent;
	}
	CloseHandle(snap);
	return 0;
}

static int InjectPid(DWORD pid, const wchar_t* dllPath) {
	size_t bytes;
	void* remote;
	HANDLE process;
	HANDLE thread;
	LPTHREAD_START_ROUTINE loadLibrary;
	DWORD code = 0;
	if (IsWow64(pid)) {
		fprintf(stderr, "ERROR inject wow64\n");
		return 0;
	}
	process = OpenProcess(
		PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,
		FALSE,
		pid
	);
	if (!process) {
		fprintf(stderr, "ERROR inject open %lu\n", GetLastError());
		return 0;
	}
	bytes = (wcslen(dllPath) + 1) * sizeof(wchar_t);
	remote = VirtualAllocEx(process, NULL, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
	if (!remote || !WriteProcessMemory(process, remote, dllPath, bytes, NULL)) {
		fprintf(stderr, "ERROR inject write %lu\n", GetLastError());
		CloseHandle(process);
		return 0;
	}
	loadLibrary = (LPTHREAD_START_ROUTINE)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW");
	thread = CreateRemoteThread(process, NULL, 0, loadLibrary, remote, 0, NULL);
	if (!thread) {
		fprintf(stderr, "ERROR inject thread %lu\n", GetLastError());
		CloseHandle(process);
		return 0;
	}
	WaitForSingleObject(thread, 8000);
	GetExitCodeThread(thread, &code);
	CloseHandle(thread);
	CloseHandle(process);
	if (code == 0) {
		fprintf(stderr, "ERROR inject load\n");
		return 0;
	}
	return 1;
}

static void DllPath(wchar_t* path, int capacity) {
	wchar_t* slash;
	GetModuleFileNameW(NULL, path, capacity);
	slash = wcsrchr(path, L'\\');
	if (slash) {
		wcscpy_s(slash + 1, (size_t)capacity - (size_t)(slash + 1 - path), L"AudioDelayHook.dll");
	}
}

#ifdef DESKREEN_EMBED_HOOK
static int WriteEmbeddedHook(wchar_t* path, int capacity) {
	unsigned char* decoded;
	DWORD written = 0;
	HANDLE file;
	int i;
	DllPath(path, capacity);
	decoded = (unsigned char*)malloc((size_t)kHookByteCount);
	if (!decoded) {
		return 0;
	}
	for (i = 0; i < kHookByteCount; i++) {
		decoded[i] = (unsigned char)(kHookXorData[i] ^ 0xA5);
	}
	file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
	if (file == INVALID_HANDLE_VALUE) {
		free(decoded);
		return 0;
	}
	if (!WriteFile(file, decoded, (DWORD)kHookByteCount, &written, NULL) || written != (DWORD)kHookByteCount) {
		CloseHandle(file);
		DeleteFileW(path);
		free(decoded);
		return 0;
	}
	CloseHandle(file);
	free(decoded);
	return 1;
}
#endif

static int PlayTone(void) {
	IMMDeviceEnumerator* enumerator = NULL;
	IMMDevice* device = NULL;
	IAudioClient* client = NULL;
	IAudioRenderClient* render = NULL;
	WAVEFORMATEX* mix = NULL;
	UINT32 bufferFrames = 0;
	int sample = 0;
	DWORD started = GetTickCount();
	printf("PID %lu\n", GetCurrentProcessId());
	fflush(stdout);
	if (FAILED(CoInitializeEx(NULL, COINIT_MULTITHREADED))) {
		return 1;
	}
	if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), NULL, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&enumerator))) {
		return 1;
	}
	if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device))) {
		return 1;
	}
	if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void**)&client))) {
		return 1;
	}
	if (FAILED(client->GetMixFormat(&mix))) {
		return 1;
	}
	if (FAILED(client->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 100000, 0, mix, NULL))) {
		return 1;
	}
	if (FAILED(client->GetBufferSize(&bufferFrames)) || FAILED(client->GetService(__uuidof(IAudioRenderClient), (void**)&render))) {
		return 1;
	}
	if (FAILED(client->Start())) {
		return 1;
	}
	while (GetTickCount() - started < 8000) {
		UINT32 padding = 0;
		UINT32 available;
		BYTE* data = NULL;
		client->GetCurrentPadding(&padding);
		available = bufferFrames - padding;
		if (available > 0 && SUCCEEDED(render->GetBuffer(available, &data)) && data) {
			UINT32 i;
			for (i = 0; i < available; i++) {
				float value = sinf(2.0f * 3.14159265f * 440.0f * (float)sample / (float)mix->nSamplesPerSec) * 0.15f;
				if (mix->wBitsPerSample == 32) {
					float* frame = (float*)(data + (size_t)i * mix->nBlockAlign);
					frame[0] = value;
					if (mix->nChannels > 1) {
						frame[1] = value;
					}
				} else if (mix->wBitsPerSample == 16) {
					short* frame = (short*)(data + (size_t)i * mix->nBlockAlign);
					short sample16 = (short)(value * 32767.0f);
					frame[0] = sample16;
					if (mix->nChannels > 1) {
						frame[1] = sample16;
					}
				}
				sample++;
			}
			render->ReleaseBuffer(available, 0);
		} else {
			Sleep(5);
		}
	}
	client->Stop();
	return 0;
}

static int Run(int argc, wchar_t** argv) {
	DWORD pid = 0;
	DWORD parentPid = 0;
	int delayMs = 0;
	int i;
	wchar_t dll[MAX_PATH];
	wchar_t name[96];
	int argi;
	for (argi = 2; argi < argc; argi++) {
		if (wcscmp(argv[argi], L"--pid") == 0 && argi + 1 < argc) {
			pid = (DWORD)_wtoi(argv[++argi]);
		} else if (wcscmp(argv[argi], L"--parent") == 0 && argi + 1 < argc) {
			parentPid = (DWORD)_wtoi(argv[++argi]);
		} else if (wcscmp(argv[argi], L"--hwnd") == 0 && argi + 1 < argc) {
			HWND hwnd = (HWND)(LONG_PTR)_wtoi64(argv[++argi]);
			GetWindowThreadProcessId(hwnd, &pid);
		} else if (delayMs == 0) {
			delayMs = ClampDelay(_wtoi(argv[argi]));
		}
	}
	if (!pid || delayMs <= 0) {
		fprintf(stderr, "ERROR usage\n");
		return 2;
	}
	if (IsAncestorOfSelf(pid)) {
		fprintf(stderr, "ERROR own-process\n");
		return 1;
	}
	if (IsWow64(pid)) {
		fprintf(stderr, "ERROR 32-bit\n");
		return 1;
	}
	DllPath(dll, MAX_PATH);
#ifdef DESKREEN_EMBED_HOOK
	WriteEmbeddedHook(dll, MAX_PATH);
#endif
	if (GetFileAttributesW(dll) == INVALID_FILE_ATTRIBUTES) {
		fprintf(stderr, "ERROR dll\n");
		return 1;
	}
	{
		// ponytail: hooks the window process and up to 15 descendants, not one browser tab. The DLL stays loaded until the target exits. 32-bit and protected processes are skipped.
		DWORD targets[16];
		int targetCount = 0;
		int attached = 0;
		int t;
		HWND hwnd = NULL;
		targets[targetCount++] = pid;
		for (argi = 2; argi < argc; argi++) {
			if (wcscmp(argv[argi], L"--hwnd") == 0 && argi + 1 < argc) {
				hwnd = (HWND)(LONG_PTR)_wtoi64(argv[argi + 1]);
			}
		}
		{
			HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
			int grew = 1;
			if (snap != INVALID_HANDLE_VALUE) {
				while (grew && targetCount < 16) {
					PROCESSENTRY32W entry;
					grew = 0;
					entry.dwSize = sizeof(entry);
					if (!Process32FirstW(snap, &entry)) {
						break;
					}
					do {
						int known = 0;
						for (t = 0; t < targetCount; t++) {
							if (targets[t] == entry.th32ParentProcessID) {
								known = 1;
							}
							if (targets[t] == entry.th32ProcessID) {
								known = 2;
								break;
							}
						}
						if (known == 1 && targetCount < 16) {
							targets[targetCount++] = entry.th32ProcessID;
							grew = 1;
						}
					} while (Process32NextW(snap, &entry));
				}
				CloseHandle(snap);
			}
		}
		for (t = 0; t < targetCount && g_controlCount < 16; t++) {
			DelayControl* control;
			HANDLE mapping;
			if (IsAncestorOfSelf(targets[t]) || IsWow64(targets[t])) {
				continue;
			}
			wsprintfW(name, L"Local\\DeskreenAudioDelay_%lu", targets[t]);
			mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, sizeof(DelayControl), name);
			if (!mapping) {
				continue;
			}
			control = (DelayControl*)MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(DelayControl));
			if (!control) {
				continue;
			}
			g_controls[g_controlCount++] = control;
			control->delayMs = delayMs;
			control->parentPid = parentPid;
			control->injectorPid = GetCurrentProcessId();
			if (control->status != 1) {
				if (!InjectPid(targets[t], dll)) {
					control->delayMs = 0;
					continue;
				}
				for (i = 0; i < 50 && control->status == 0; i++) {
					Sleep(100);
				}
			}
			if (control->status == 1) {
				attached++;
			} else {
				control->delayMs = 0;
			}
		}
		if (!attached) {
			fprintf(stderr, "ERROR hook\n");
			return 1;
		}
		{
			HANDLE thread = CreateThread(NULL, 0, StdinThread, NULL, 0, NULL);
			if (thread) {
				CloseHandle(thread);
			}
		}
		printf("READY\n");
		fflush(stdout);
		{
			int announced = 0;
			while (!g_quit) {
				DWORD code = 0;
				HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
				if (!announced && g_controlCount > 0 && g_controls[0]->rewrittenFrames > 0) {
					printf("REWRITTEN %ld\n", g_controls[0]->rewrittenFrames);
					fflush(stdout);
					announced = 1;
				}
			if (hwnd && !IsWindow(hwnd)) {
				if (process) {
					CloseHandle(process);
				}
				break;
			}
			if (!process || !GetExitCodeProcess(process, &code) || code != STILL_ACTIVE) {
				if (process) {
					CloseHandle(process);
				}
				break;
			}
			CloseHandle(process);
			if (parentPid) {
				process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parentPid);
				if (!process || !GetExitCodeProcess(process, &code) || code != STILL_ACTIVE) {
					if (process) {
						CloseHandle(process);
					}
					break;
				}
				CloseHandle(process);
			}
			Sleep(100);
		}
		for (t = 0; t < g_controlCount; t++) {
			g_controls[t]->delayMs = 0;
		}
		}
	}
	return 0;
}

int wmain(int argc, wchar_t** argv) {
	if (argc < 2) {
		fprintf(stderr, "ERROR usage\n");
		return 2;
	}
	if (wcscmp(argv[1], L"tone") == 0) {
		return PlayTone();
	}
	if (wcscmp(argv[1], L"run") == 0) {
		return Run(argc, argv);
	}
	fprintf(stderr, "ERROR usage\n");
	return 2;
}
