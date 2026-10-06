// Runnable integration check: Windows encoding, decoding and microphone, no external codecs.
#include "recording.cpp"
#include <iostream>
#include <fstream>
#include <cmath>
#include <io.h>
#include <fcntl.h>

static std::vector<BYTE> solid(bool blue) {
    std::vector<BYTE> pixels(width * height * 3 / 2, blue ? 41 : 82);
    for (UINT i = width * height; i < pixels.size(); i += 2) { pixels[i] = blue ? 240 : 90; pixels[i + 1] = blue ? 110 : 240; }
    return pixels;
}

static std::vector<BYTE> solidPNG() {
    std::vector<BYTE> pixels(width * height * 4, 255);
    ComPtr<IWICBitmap> bitmap; ComPtr<IStream> stream;
    check(imaging->CreateBitmapFromMemory(width, height, GUID_WICPixelFormat32bppBGRA, width * 4, static_cast<UINT>(pixels.size()), pixels.data(), &bitmap));
    check(CreateStreamOnHGlobal(nullptr, TRUE, &stream));
    ComPtr<IWICBitmapEncoder> encoder; ComPtr<IWICBitmapFrameEncode> output;
    check(imaging->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder));
    check(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache));
    check(encoder->CreateNewFrame(&output, nullptr)); check(output->Initialize(nullptr));
    check(output->SetSize(width, height)); WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    check(output->SetPixelFormat(&format)); check(output->WriteSource(bitmap.Get(), nullptr));
    check(output->Commit()); check(encoder->Commit());
    STATSTG stat{}; check(stream->Stat(&stat, STATFLAG_NONAME));
    HGLOBAL global; check(GetHGlobalFromStream(stream.Get(), &global));
    auto data = static_cast<BYTE*>(GlobalLock(global));
    std::vector<BYTE> png(data, data + stat.cbSize.LowPart); GlobalUnlock(global);
    return png;
}

static void fixture(const wchar_t* path, bool microphone) {
    check(RecordingBegin(path, TRUE));
    recording->started = now();
    recording->lastFrame = solid(false);
    recording->videoFrame(recording->lastFrame);
    if (microphone) check(RecordingMicrophone());
    for (UINT frame = 1; frame < 60; ++frame) {
        recording->lastFrame = solid(frame >= 30);
        std::lock_guard<std::mutex> lock(recording->mutex);
        recording->videoFrame(recording->lastFrame);
        if (!microphone) {
            std::vector<short> samples(audioRate / fps);
            for (UINT i = 0; i < samples.size(); ++i) samples[i] = static_cast<short>(10000 * sin(2 * 3.141592653589793 * 440 * (frame * samples.size() + i) / audioRate));
            recording->sample(recording->audio, reinterpret_cast<BYTE*>(samples.data()), static_cast<DWORD>(samples.size() * 2), frame * frameDuration, frameDuration);
        }
        // A real microphone uses wall-clock time; synthesized fixtures run quickly.
        if (microphone) std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    check(RecordingFinish());
}

static ComPtr<IMFSourceReader> reader(const wchar_t* path) {
    ComPtr<IMFAttributes> attributes; ComPtr<IMFSourceReader> source;
    check(MFCreateAttributes(&attributes, 1));
    check(attributes->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE));
    check(MFCreateSourceReaderFromURL(path, attributes.Get(), &source));
    return source;
}

static void inspect(const wchar_t* path) {
    auto source = reader(path);
    ComPtr<IMFMediaType> native, decoded;
    check(source->GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, &native));
    GUID subtype; check(native->GetGUID(MF_MT_SUBTYPE, &subtype));
    if (subtype != MFVideoFormat_H264) check(E_FAIL);
    check(source->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE));
    check(source->SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM, TRUE));
    check(MFCreateMediaType(&decoded));
    check(decoded->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
    check(decoded->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32));
    check(source->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, decoded.Get()));
    check(source->GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, &decoded));
    UINT w, h; check(MFGetAttributeSize(decoded.Get(), MF_MT_FRAME_SIZE, &w, &h));
    unsigned long long red = 0, blue = 0, green = 0, frames = 0, audioSamples = 0;
    int peak = 0;
    for (;;) {
        ComPtr<IMFSample> sample; DWORD flags; LONGLONG timestamp;
        check(source->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, nullptr, &flags, &timestamp, &sample));
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) break;
        if (!sample) continue;
        ComPtr<IMFMediaBuffer> buffer; check(sample->ConvertToContiguousBuffer(&buffer));
        BYTE* pixels; DWORD length; check(buffer->Lock(&pixels, nullptr, &length));
        for (DWORD i = 0; i + 3 < length; i += 4) {
            auto b = pixels[i], g = pixels[i + 1], r = pixels[i + 2];
            red += r > 200 && g < 60 && b < 60;
            blue += b > 200 && r < 60 && g < 60;
            green += g > 200 && r < 60 && b < 60;
        }
        check(buffer->Unlock()); ++frames;
    }
    source = reader(path); native.Reset();
    auto hasAudio = SUCCEEDED(source->GetNativeMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, &native));
    if (hasAudio) {
        check(native->GetGUID(MF_MT_SUBTYPE, &subtype)); if (subtype != MFAudioFormat_AAC) check(E_FAIL);
        check(source->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE));
        check(source->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE));
        decoded.Reset(); check(MFCreateMediaType(&decoded));
        check(decoded->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio)); check(decoded->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM));
        check(decoded->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16));
        check(source->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, decoded.Get()));
        for (;;) {
            ComPtr<IMFSample> sample; DWORD flags;
            check(source->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, nullptr, &flags, nullptr, &sample));
            if (flags & MF_SOURCE_READERF_ENDOFSTREAM) break;
            if (!sample) continue;
            ComPtr<IMFMediaBuffer> buffer; check(sample->ConvertToContiguousBuffer(&buffer));
            BYTE* data; DWORD length; check(buffer->Lock(&data, nullptr, &length));
            for (DWORD i = 0; i + 1 < length; i += 2) peak = std::max(peak, std::abs(static_cast<int>(*reinterpret_cast<short*>(data + i))));
            audioSamples += length / 2; check(buffer->Unlock());
        }
    }
    if (!frames || w != width || h != height) check(E_FAIL);
    std::cout << "{\"video\":\"h264\",\"audio\":\"" << (hasAudio ? "aac" : "none") << "\",\"width\":" << w << ",\"height\":" << h << ",\"frames\":" << frames << ",\"red\":" << red << ",\"blue\":" << blue << ",\"green\":" << green << ",\"audioSamples\":" << audioSamples << ",\"audioPeak\":" << peak << "}" << std::endl;
}

int wmain(int argc, wchar_t** argv) {
    try {
        check(RecordingInitialize());
        if (argc != 3 && argc != 4) check(E_INVALIDARG);
        if (std::wstring(argv[1]) == L"presentation") {
            if (argc != 4) check(E_INVALIDARG);
            check(RecordingBeginPresentation(argv[2], argv[3]));
            auto png = solidPNG();
            for (int frame = 0; frame < 40; ++frame) {
                check(RecordingFrame(png.data(), static_cast<UINT>(png.size())));
                if (frame == 20) std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }
            check(RecordingFinish()); inspect(argv[2]);
        } else if (std::wstring(argv[1]) == L"encode" || std::wstring(argv[1]) == L"encode-presentation") {
            if (std::wstring(argv[1]) == L"encode-presentation") { if (argc != 4) check(E_INVALIDARG); check(RecordingBeginPresentation(argv[2], argv[3])); }
            else check(RecordingBegin(argv[2], FALSE));
            _setmode(_fileno(stdin), _O_BINARY);
            UINT length;
            while (std::cin.read(reinterpret_cast<char*>(&length), sizeof(length))) {
                if (!length || length > 16 * 1024 * 1024) check(E_INVALIDARG);
                std::vector<BYTE> data(length);
                if (!std::cin.read(reinterpret_cast<char*>(data.data()), length)) check(E_INVALIDARG);
                check(RecordingFrame(data.data(), length));
            }
            check(RecordingFinish());
        } else if (std::wstring(argv[1]) == L"inspect") inspect(argv[2]);
        else { fixture(argv[2], std::wstring(argv[1]) == L"microphone"); inspect(argv[2]); }
        return 0;
    } catch (winrt::hresult_error const& error) {
        std::wcerr << L"Native check failed: 0x" << std::hex << static_cast<UINT>(error.code()) << L" " << error.message().c_str() << L" " << RecordingError() << std::endl;
        RecordingFinish(); return 1;
    }
}
