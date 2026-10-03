// Windows-only recording. Linked to OS components and a static C++ runtime.
#define NOMINMAX
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <wincodec.h>
#include <d3d11.h>
#include <dxgi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Foundation.h>
#include <wrl/client.h>
#include <vector>
#include <thread>
#include <mutex>
#include <atomic>
#include <condition_variable>
#include <memory>
#include <chrono>

using Microsoft::WRL::ComPtr;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
constexpr UINT width = 1920, height = 1080, fps = 20, audioRate = 48000;
constexpr LONGLONG frameDuration = 10000000 / fps;
static ComPtr<IWICImagingFactory> imaging;
static thread_local std::wstring lastError;
static void checked(HRESULT result, const wchar_t* operation) { if (FAILED(result)) throw winrt::hresult_error(result, operation); }
#define WIDE_INNER(text) L##text
#define WIDE(text) WIDE_INNER(text)
#define check(operation) checked((operation), WIDE(#operation))
static LONGLONG now() {
    LARGE_INTEGER counter, frequency;
    QueryPerformanceCounter(&counter); QueryPerformanceFrequency(&frequency);
    return counter.QuadPart / frequency.QuadPart * 10000000 + counter.QuadPart % frequency.QuadPart * 10000000 / frequency.QuadPart;
}

struct Recorder {
    ComPtr<IMFSinkWriter> writer;
    DWORD video = 0, audio = 0;
    LONGLONG started = 0, frames = 0, audioFrames = 0;
    bool microphone = false;
    std::vector<BYTE> lastFrame;
    std::mutex mutex, startupMutex;
    std::condition_variable startup;
    std::thread audioThread;
    std::atomic<bool> stopAudio{false};
    bool audioReady = false;
    HRESULT audioResult = S_OK;

    Recorder(const wchar_t* path, bool withMicrophone) : microphone(withMicrophone) {
        ComPtr<IMFAttributes> attributes;
        check(MFCreateAttributes(&attributes, 2));
        check(attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, FALSE));
        check(attributes->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE));
        check(MFCreateSinkWriterFromURL(path, nullptr, attributes.Get(), &writer));
        ComPtr<IMFMediaType> output, input;
        check(MFCreateMediaType(&output));
        check(output->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
        check(output->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264));
        check(output->SetUINT32(MF_MT_AVG_BITRATE, 8000000));
        check(output->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive));
        check(MFSetAttributeSize(output.Get(), MF_MT_FRAME_SIZE, width, height));
        check(MFSetAttributeRatio(output.Get(), MF_MT_FRAME_RATE, fps, 1));
        check(MFSetAttributeRatio(output.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1));
        check(writer->AddStream(output.Get(), &video));
        check(MFCreateMediaType(&input));
        check(output->CopyAllItems(input.Get()));
        check(input->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12));
        check(writer->SetInputMediaType(video, input.Get(), nullptr));
        if (microphone) {
            output.Reset(); input.Reset();
            check(MFCreateMediaType(&output));
            check(output->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio));
            check(output->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC));
            check(output->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 1));
            check(output->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, audioRate));
            check(output->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16));
            check(output->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 20000));
            check(writer->AddStream(output.Get(), &audio));
            check(MFCreateMediaType(&input));
            check(input->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio));
            check(input->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM));
            check(input->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 1));
            check(input->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, audioRate));
            check(input->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16));
            check(input->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, 2));
            check(input->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, audioRate * 2));
            check(writer->SetInputMediaType(audio, input.Get(), nullptr));
        }
        check(writer->BeginWriting());
    }
    void sample(DWORD stream, const BYTE* data, DWORD size, LONGLONG timestamp, LONGLONG duration) {
        ComPtr<IMFMediaBuffer> buffer; ComPtr<IMFSample> sample;
        check(MFCreateMemoryBuffer(size, &buffer));
        BYTE* destination = nullptr;
        check(buffer->Lock(&destination, nullptr, nullptr));
        memcpy(destination, data, size); check(buffer->Unlock());
        check(buffer->SetCurrentLength(size));
        check(MFCreateSample(&sample)); check(sample->AddBuffer(buffer.Get()));
        check(sample->SetSampleTime(timestamp)); check(sample->SetSampleDuration(duration));
        check(writer->WriteSample(stream, sample.Get()));
    }
    void videoFrame(const std::vector<BYTE>& nv12) {
        sample(video, nv12.data(), static_cast<DWORD>(nv12.size()), frames * frameDuration, frameDuration);
        ++frames;
    }
    void frame(const BYTE* png, UINT size) {
        ComPtr<IWICStream> stream; ComPtr<IWICBitmapDecoder> decoder;
        ComPtr<IWICBitmapFrameDecode> bitmap; ComPtr<IWICFormatConverter> converter;
        check(imaging->CreateStream(&stream)); check(stream->InitializeFromMemory(const_cast<BYTE*>(png), size));
        check(imaging->CreateDecoderFromStream(stream.Get(), nullptr, WICDecodeMetadataCacheOnLoad, &decoder));
        check(decoder->GetFrame(0, &bitmap));
        UINT w, h; check(bitmap->GetSize(&w, &h));
        if (w != width || h != height) check(E_INVALIDARG);
        check(imaging->CreateFormatConverter(&converter));
        check(converter->Initialize(bitmap.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom));
        std::vector<BYTE> bgra(width * height * 4), nv12(width * height * 3 / 2);
        check(converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(bgra.size()), bgra.data()));
        auto clamp = [](int value) { return static_cast<BYTE>(value < 0 ? 0 : value > 255 ? 255 : value); };
        for (UINT y = 0; y < height; ++y) for (UINT x = 0; x < width; ++x) {
            auto pixel = &bgra[(y * width + x) * 4];
            nv12[y * width + x] = clamp(((66 * pixel[2] + 129 * pixel[1] + 25 * pixel[0] + 128) >> 8) + 16);
        }
        for (UINT y = 0; y < height; y += 2) for (UINT x = 0; x < width; x += 2) {
            int r = 0, g = 0, b = 0;
            for (UINT dy = 0; dy < 2; ++dy) for (UINT dx = 0; dx < 2; ++dx) {
                auto pixel = &bgra[((y + dy) * width + x + dx) * 4]; b += pixel[0]; g += pixel[1]; r += pixel[2];
            }
            r /= 4; g /= 4; b /= 4;
            auto offset = width * height + y / 2 * width + x;
            nv12[offset] = clamp(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
            nv12[offset + 1] = clamp(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
        }
        std::lock_guard<std::mutex> lock(mutex);
        if (!started) started = now();
        auto target = (now() - started) / frameDuration;
        while (frames < target && !lastFrame.empty()) videoFrame(lastFrame);
        videoFrame(nv12); lastFrame = std::move(nv12);
    }
    void startMicrophone() {
        if (!microphone || audioThread.joinable()) check(E_INVALIDARG);
        audioThread = std::thread([this] {
            auto initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
            ComPtr<IAudioClient> client;
            try {
                check(initialized);
                ComPtr<IMMDeviceEnumerator> devices; ComPtr<IMMDevice> device;
                ComPtr<IAudioCaptureClient> capture;
                check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&devices)));
                check(devices->GetDefaultAudioEndpoint(eCapture, eConsole, &device));
                check(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client));
                WAVEFORMATEX format{WAVE_FORMAT_PCM, 1, audioRate, audioRate * 2, 2, 16, 0};
                check(client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, 1000000, 0, &format, nullptr));
                check(client->GetService(IID_PPV_ARGS(&capture))); check(client->Start());
                LONGLONG base = std::max<LONGLONG>(0, now() - started);
                bool received = false;
                while (!stopAudio) {
                    UINT count; check(capture->GetNextPacketSize(&count));
                    while (count) {
                        BYTE* data; DWORD flags; UINT samples;
                        check(capture->GetBuffer(&data, &samples, &flags, nullptr, nullptr));
                        std::vector<BYTE> silence;
                        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { silence.resize(samples * 2); data = silence.data(); }
                        try {
                            std::lock_guard<std::mutex> lock(mutex);
                            sample(audio, data, samples * 2, base + audioFrames * 10000000 / audioRate, samples * 10000000LL / audioRate);
                            audioFrames += samples;
                        } catch (...) { capture->ReleaseBuffer(samples); throw; }
                        check(capture->ReleaseBuffer(samples));
                        if (!received) { std::lock_guard<std::mutex> lock(startupMutex); received = true; audioReady = true; startup.notify_one(); }
                        check(capture->GetNextPacketSize(&count));
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(5));
                }
            } catch (winrt::hresult_error const& error) { std::lock_guard<std::mutex> lock(startupMutex); audioResult = error.code(); startup.notify_one(); }
            catch (...) { std::lock_guard<std::mutex> lock(startupMutex); audioResult = E_FAIL; startup.notify_one(); }
            if (client) client->Stop();
            client.Reset();
            if (SUCCEEDED(initialized)) CoUninitialize();
        });
        std::unique_lock<std::mutex> lock(startupMutex);
        if (!startup.wait_for(lock, std::chrono::seconds(5), [this] { return audioReady || FAILED(audioResult); })) check(HRESULT_FROM_WIN32(ERROR_TIMEOUT));
        check(audioResult);
    }
    void finish() {
        stopAudio = true;
        if (audioThread.joinable()) audioThread.join();
        std::lock_guard<std::mutex> lock(mutex);
        if (started) { auto target = (now() - started) / frameDuration + 1; while (frames < target) videoFrame(lastFrame); }
        auto result = writer->Finalize(); writer.Reset();
        if (frames) check(result);
        check(audioResult);
    }
    ~Recorder() { stopAudio = true; if (audioThread.joinable()) audioThread.join(); }
};

struct WindowCapture {
    HWND window;
    ComPtr<ID3D11Device> device; ComPtr<ID3D11DeviceContext> context;
    ComPtr<ID3D11Texture2D> staging;
    IDirect3DDevice directDevice{nullptr};
    GraphicsCaptureItem item{nullptr};
    Direct3D11CaptureFramePool pool{nullptr};
    GraphicsCaptureSession session{nullptr};
    winrt::Windows::Graphics::SizeInt32 size;
    std::vector<BYTE> previous;
    WindowCapture(HWND handle) : window(handle) {
        if (!GraphicsCaptureSession::IsSupported()) check(E_NOTIMPL);
        auto created = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, &device, nullptr, &context);
        if (FAILED(created)) created = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, &device, nullptr, &context);
        check(created);
        ComPtr<IDXGIDevice> dxgi; check(device.As(&dxgi));
        winrt::com_ptr<IInspectable> inspectable;
        check(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), inspectable.put()));
        directDevice = inspectable.as<IDirect3DDevice>();
        auto factory = winrt::get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        check(factory->CreateForWindow(window, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item)));
        size = item.Size();
        pool = Direct3D11CaptureFramePool::CreateFreeThreaded(directDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
        session = pool.CreateCaptureSession(item); session.StartCapture();
    }
    std::vector<BYTE> frame() {
        Direct3D11CaptureFrame frame{nullptr};
        auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        do {
            frame = pool.TryGetNextFrame();
            if (frame || !previous.empty() || IsIconic(window)) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        } while (std::chrono::steady_clock::now() < deadline);
        if (!frame) { if (previous.empty()) check(HRESULT_FROM_WIN32(ERROR_TIMEOUT)); return previous; }
        auto content = frame.ContentSize();
        if (content.Width <= 0 || content.Height <= 0 || content.Width > 8192 || content.Height > 8192 || static_cast<UINT64>(content.Width) * content.Height > 32 * 1024 * 1024) check(E_INVALIDARG);
        ComPtr<ID3D11Texture2D> texture;
        auto access = frame.Surface().as<Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        check(access->GetInterface(IID_PPV_ARGS(&texture)));
        D3D11_TEXTURE2D_DESC description; texture->GetDesc(&description);
        auto w = std::min<UINT>(content.Width, description.Width), h = std::min<UINT>(content.Height, description.Height);
        description.Usage = D3D11_USAGE_STAGING; description.BindFlags = 0; description.CPUAccessFlags = D3D11_CPU_ACCESS_READ; description.MiscFlags = 0;
        staging.Reset(); check(device->CreateTexture2D(&description, nullptr, &staging));
        context->CopyResource(staging.Get(), texture.Get());
        D3D11_MAPPED_SUBRESOURCE mapped; check(context->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped));
        // Copy before unmapping; WIC owns only a view of this buffer.
        std::vector<BYTE> pixels(w * h * 4);
        for (UINT y = 0; y < h; ++y) memcpy(pixels.data() + y * w * 4, static_cast<BYTE*>(mapped.pData) + y * mapped.RowPitch, w * 4);
        context->Unmap(staging.Get(), 0);
        ComPtr<IWICBitmap> bitmap; ComPtr<IStream> stream;
        check(imaging->CreateBitmapFromMemory(w, h, GUID_WICPixelFormat32bppBGRA, w * 4, static_cast<UINT>(pixels.size()), pixels.data(), &bitmap));
        check(CreateStreamOnHGlobal(nullptr, TRUE, &stream));
        ComPtr<IWICBitmapEncoder> encoder; ComPtr<IWICBitmapFrameEncode> output;
        check(imaging->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder));
        check(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache));
        check(encoder->CreateNewFrame(&output, nullptr)); check(output->Initialize(nullptr));
        check(output->SetSize(w, h)); WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
        check(output->SetPixelFormat(&format)); check(output->WriteSource(bitmap.Get(), nullptr));
        check(output->Commit()); check(encoder->Commit());
        STATSTG stat{}; check(stream->Stat(&stat, STATFLAG_NONAME));
        HGLOBAL global; check(GetHGlobalFromStream(stream.Get(), &global));
        auto data = static_cast<BYTE*>(GlobalLock(global));
        previous.assign(data, data + stat.cbSize.LowPart); GlobalUnlock(global);
        frame.Close();
        if (content.Width != size.Width || content.Height != size.Height) { size = content; pool.Recreate(directDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size); }
        return previous;
    }
    ~WindowCapture() { try { if (session) session.Close(); if (pool) pool.Close(); } catch (...) {} }
};

static std::unique_ptr<Recorder> recording;
static std::unique_ptr<WindowCapture> windowCapture;
template<typename Action> static HRESULT guarded(Action action) {
    try { lastError.clear(); action(); return S_OK; }
    catch (winrt::hresult_error const& error) { lastError = error.message().c_str(); return error.code(); }
    catch (...) { lastError = L"Native recording failed."; return E_FAIL; }
}
#define EXPORT extern "C" __declspec(dllexport)
EXPORT const wchar_t* RecordingError() { return lastError.c_str(); }
EXPORT HRESULT RecordingInitialize() { return guarded([] { check(RoInitialize(RO_INIT_MULTITHREADED)); check(MFStartup(MF_VERSION)); check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&imaging))); }); }
EXPORT HRESULT RecordingBegin(const wchar_t* path, BOOL microphone) { return guarded([&] { if (recording) check(E_UNEXPECTED); recording = std::make_unique<Recorder>(path, microphone != FALSE); }); }
EXPORT HRESULT RecordingFrame(const BYTE* data, UINT size) { return guarded([&] { if (!recording) check(E_UNEXPECTED); recording->frame(data, size); }); }
EXPORT HRESULT RecordingMicrophone() { return guarded([] { if (!recording) check(E_UNEXPECTED); recording->startMicrophone(); }); }
EXPORT HRESULT RecordingFinish() { return guarded([] { auto current = std::move(recording); windowCapture.reset(); if (current) current->finish(); }); }
EXPORT HRESULT RecordingWindow(HWND window, BYTE** data, UINT* size) { return guarded([&] {
    if (!windowCapture || windowCapture->window != window) windowCapture = std::make_unique<WindowCapture>(window);
    auto png = windowCapture->frame(); *size = static_cast<UINT>(png.size());
    *data = static_cast<BYTE*>(CoTaskMemAlloc(*size)); if (!*data) check(E_OUTOFMEMORY);
    memcpy(*data, png.data(), *size);
}); }
EXPORT void RecordingFree(BYTE* data) { CoTaskMemFree(data); }
