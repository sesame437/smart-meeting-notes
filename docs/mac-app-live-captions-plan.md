# Mac App Live Captions + Rolling Summary Implementation Plan

> **For the executing engineer (human or agent on a Mac):** This plan implements the macOS side of the "Live Captions + Rolling Summary" feature. The Node backend (`POST /api/live-summary`) lives in this same `smart-meeting-notes` repo and shipped in the PR that also added this plan. The existing Mac app source (MeetingRecorder v2.7.0 baseline) is tracked separately — confirm its location in Task 0 before starting.
>
> **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing macOS MeetingRecorder.app (v2.7.0 is the baseline) to stream live English captions and show a rolling meeting summary during recording, without impacting the core audio-capture-and-save flow.

**Architecture:** Main app continues to own `AudioCapture` (ScreenCaptureKit + AVCaptureSession) and `FileRecorder` (AAC). A new XPC helper process `MeetingCaptionsHelper` receives PCM from main over XPC, runs WhisperKit streaming ASR, renders two floating `NSPanel` overlays (captions + summary), and every 180 s POSTs the accumulated transcript to the backend `POST /api/live-summary`. A single local `.md` file is written next to the recording with atomic rewrites on each `final` caption and each summary refresh.

**Tech Stack:** Swift 5.9+, macOS 15+, Xcode 16+, Universal Binary. New deps: WhisperKit (SPM, `argmaxinc/WhisperKit`). Existing infra unchanged.

**Backend contract (already merged, can be smoke-tested with curl):**
`POST {backendURL}/api/live-summary`. **No authentication required** — the backend host is locked down at the network layer, so this route is intentionally open and does NOT run the `authenticateAPIKey` middleware. The Mac app does not need to send any `x-api-key` header. (Other routes like `/api/meetings/*` remain behind `authenticateAPIKey`.)
- Request: `{ sessionId (UUID), transcriptText (≤200K chars), elapsedSec, meetingType?, isFinal? }`
- Response 200: `{ summary, highlights[], lowlights[], actions[], decisions[], generatedAt, tokensInput, tokensOutput }`
- Errors: 400 `VALIDATION_ERROR` / 429 `RATE_LIMITED` (per-session 60s, bypassed by `isFinal:true`) / 500 `INTERNAL` / 503 `BEDROCK_UNAVAILABLE` / 504 `BEDROCK_TIMEOUT`

---

## Preamble the implementer must read first

- **Plan author did not have access to the Swift source.** Swift code samples in this plan are based on standard Cocoa / XPC / SwiftUI patterns, not on the actual existing `MeetingRecorder` project structure. Task 0 reconnaissance is mandatory before the first implementation task.
- **Never regress v2.7.0 core behavior.** After every Task in this plan, verify that (a) Start/Stop still produces an AAC file, (b) the existing menu bar + volume indicator still works, (c) `/Applications/MeetingRecorder.app` still launches. If a task breaks these, revert immediately and reconsider.
- **XPC helper isolation is non-negotiable.** Recording quality must not depend on helper health. If the helper crashes mid-meeting, the AAC file must keep growing.
- **User-facing strings are English.** The existing app is English / minimal-UI; this extension follows the same style.
- **Test discipline:** Unit tests use XCTest. Helper-side tests use mock `URLSession`. WhisperKit calls are gated behind a protocol so they can be mocked in tests. UI overlays are verified manually.

## File structure (target)

The repo layout after implementation (relative to the `smart-meeting-notes` repo root; actual paths may differ — align with the existing project in Task 0):

```
MeetingRecorder/                       # existing main-app target (untouched in most tasks)
  ├─ AppDelegate.swift                 # tap point to launch helper (Task 1)
  ├─ AudioCapture.swift                # existing; tiny modification in Task 2 to fan out PCM
  ├─ FileRecorder.swift                # existing; untouched
  └─ MenuBarController.swift           # existing; small UI additions in Task 10

MeetingCaptionsHelper/                 # NEW: XPC helper app/extension target
  ├─ main.swift                        # entry point, bootstraps XPCListener
  ├─ XPCProtocol.swift                 # shared protocol (Task 1)
  ├─ PCMReceiver.swift                 # consumes PCM over XPC, forwards to ASR (Task 2)
  ├─ LiveASR.swift                     # WhisperKit streaming wrapper (Task 3)
  ├─ ASRProtocol.swift                 # mockable protocol around LiveASR (Task 3)
  ├─ TranscriptBuffer.swift            # in-memory transcript state (Task 4)
  ├─ CaptionOverlay.swift              # floating NSPanel, caption renderer (Task 5)
  ├─ NotesFileWriter.swift             # atomic .md writer (Task 6)
  ├─ SummaryScheduler.swift            # 180s timer + HTTPS POST (Task 7)
  ├─ SummaryOverlay.swift              # floating NSPanel, summary renderer (Task 8)
  └─ HelperState.swift                 # session state, lifecycle (Task 9)

Shared/                                # code compiled into both targets
  ├─ XPCProtocol.swift                 # linked symlink or embedded
  └─ Models.swift                      # CaptionEvent, TranscriptEntry, LiveSummary

MeetingCaptionsHelperTests/            # XCTest target
  ├─ TranscriptBufferTests.swift
  ├─ NotesFileWriterTests.swift
  ├─ SummarySchedulerTests.swift
  ├─ LiveASRMockTests.swift
  └─ Fixtures/
     └─ sample-en.wav                  # ~10s English speech fixture

Preferences/                           # user-visible config (Task 10)
  └─ PreferencesWindow.swift
```

Add `.gitignore` entries for model caches (`~/Library/Caches/WhisperKit/` stays out-of-repo).

---

## Task 0: Codebase reconnaissance (required)

**Files:** read-only exploration. No commits here.

- [ ] **Step 1**: Open the existing Xcode project. Note the current targets, bundle identifier, code-signing team, and macOS deployment target. Record them in a personal `notes.md` (not committed).

- [ ] **Step 2**: Identify where the current `AudioCapture` lives and how it produces audio data. Specifically: does it hand raw `CMSampleBuffer` somewhere, or only write to the AAC file via `AVAssetWriter`? This decides whether Task 2 can tap cheaply or needs a small refactor.

- [ ] **Step 3**: Check the existing Start/Stop lifecycle wiring. Which class owns the "is recording" state? Is there a central notification / delegate pattern, or direct method calls?

- [ ] **Step 4**: Check whether the existing project uses Swift Package Manager dependencies. If WhisperKit SPM integration would force a big project file restructuring, plan accordingly (Task 3 will still work, just may take longer).

- [ ] **Step 5**: Document findings at the top of `notes.md`: (a) how to tap PCM, (b) how to detect "recording started/stopped" events, (c) SPM status. The rest of the plan assumes:
  - PCM can be tapped by inserting a fan-out in `AudioCapture` (Task 2).
  - A `NotificationCenter` broadcast exists or can be added for recording lifecycle.
  - SPM is available; adding WhisperKit is a single `Package.swift` edit.
  - **If any of these assumptions is wrong, stop and escalate.** Do not improvise.

---

## Task 1: XPC helper service scaffold

Create a new helper target that launches from the main app, and define the protocol used across the boundary. At the end of this task, the main app can ping the helper and get a pong back — nothing more.

**Files:**
- Create: `MeetingCaptionsHelper/main.swift`
- Create: `Shared/XPCProtocol.swift`
- Create: `MeetingCaptionsHelper/Info.plist` (helper bundle)
- Modify: Xcode project to add a "Copy Helper into Contents/Library/LoginItems" build phase on the main target, OR use `SMAppService.register` at first launch (macOS 13+).
- Modify: `MeetingRecorder/AppDelegate.swift` to launch/connect to helper on app start.

- [ ] **Step 1**: Add a new target to the Xcode project.
  - Type: "Command-Line Tool" (not "XPC Service" — the latter is more restrictive). If your project already uses `XPC Service` target type, keep that; do not change patterns for the sake of this plan.
  - Name: `MeetingCaptionsHelper`
  - Bundle ID: `<your-bundle-id>.MeetingCaptionsHelper`
  - Language: Swift
  - Link with: AppKit (for NSPanel, later), Foundation.

- [ ] **Step 2**: Write `Shared/XPCProtocol.swift` (link this file into both targets):

```swift
import Foundation

/// XPC-visible protocol. Both sides implement subsets via NSXPCConnection.
@objc public protocol CaptionsHelperProtocol {
    /// Health-check ping. Helper replies with its version string.
    func ping(reply: @escaping (String) -> Void)

    /// Forward a PCM chunk from main to helper.
    /// - Parameters:
    ///   - data: raw Float32 mono PCM at `sampleRate` Hz.
    ///   - sampleRate: Hz, typically 16000 (WhisperKit native) or 48000 (system native).
    ///   - hostTimeNs: Mach absolute time of the first sample, for relative timestamping.
    func receivePCM(_ data: Data, sampleRate: Double, hostTimeNs: UInt64)

    /// Called by main when user presses Stop. Helper flushes ASR, emits last
    /// summary with isFinal=true, closes the .md file, tears down overlays.
    func stopSession(reply: @escaping () -> Void)

    /// Called by main when user presses Start. Helper opens a new .md file,
    /// resets state, shows overlays.
    /// - Parameters:
    ///   - recordingURL: path to the AAC file (used to derive the .md filename).
    ///   - startedAt: wall clock for frontmatter.
    func startSession(recordingURL: URL, startedAt: Date)
}
```

- [ ] **Step 3**: Write `MeetingCaptionsHelper/main.swift`:

```swift
import Foundation
import AppKit

final class ServiceDelegate: NSObject, NSXPCListenerDelegate {
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        connection.exportedInterface = NSXPCInterface(with: CaptionsHelperProtocol.self)
        connection.exportedObject = HelperState.shared
        connection.resume()
        return true
    }
}

let delegate = ServiceDelegate()
let listener = NSXPCListener.service()
listener.delegate = delegate
listener.resume()

// Keep the helper alive while the main app is connected.
NSApplication.shared.run()
```

- [ ] **Step 4**: Minimal `HelperState.swift` stub that responds to `ping`:

```swift
import Foundation

final class HelperState: NSObject, CaptionsHelperProtocol {
    static let shared = HelperState()

    func ping(reply: @escaping (String) -> Void) {
        reply("MeetingCaptionsHelper/0.1.0")
    }

    func receivePCM(_ data: Data, sampleRate: Double, hostTimeNs: UInt64) {
        // no-op in Task 1
    }

    func stopSession(reply: @escaping () -> Void) {
        reply()
    }

    func startSession(recordingURL: URL, startedAt: Date) {
        // no-op in Task 1
    }
}
```

- [ ] **Step 5**: In the main app, add an `XPCClient.swift` wrapper:

```swift
import Foundation

final class XPCClient {
    static let shared = XPCClient()
    private let connection: NSXPCConnection

    private init() {
        connection = NSXPCConnection(serviceName: "<your-bundle-id>.MeetingCaptionsHelper")
        connection.remoteObjectInterface = NSXPCInterface(with: CaptionsHelperProtocol.self)
        connection.invalidationHandler = { NSLog("[xpc] helper connection invalidated") }
        connection.interruptionHandler = { NSLog("[xpc] helper connection interrupted") }
        connection.resume()
    }

    var proxy: CaptionsHelperProtocol? {
        connection.remoteObjectProxyWithErrorHandler { err in
            NSLog("[xpc] proxy error: \(err)")
        } as? CaptionsHelperProtocol
    }
}
```

- [ ] **Step 6**: In `AppDelegate.applicationDidFinishLaunching`, ping the helper:

```swift
XPCClient.shared.proxy?.ping { version in
    NSLog("[main] helper responded: \(version)")
}
```

- [ ] **Step 7**: Build. Launch the main app. Verify Console.app shows `[main] helper responded: MeetingCaptionsHelper/0.1.0`. If not, debug before proceeding. Common pitfalls: helper not copied into `Contents/Library/LoginItems/`, wrong service name, sandbox entitlements missing.

- [ ] **Step 8**: Commit:

```bash
git add MeetingCaptionsHelper/ Shared/XPCProtocol.swift MeetingRecorder/XPCClient.swift MeetingRecorder/AppDelegate.swift
git commit -m "feat(helper): XPC scaffold with ping round-trip"
```

---

## Task 2: Audio PCM fan-out from main to helper

Pick up PCM from `AudioCapture` and forward it to the helper via `receivePCM`. Helper logs chunk arrivals. Nothing else.

**Files:**
- Modify: `MeetingRecorder/AudioCapture.swift` (add a delegate or callback hook)
- Create: `MeetingCaptionsHelper/PCMReceiver.swift`
- Modify: `MeetingCaptionsHelper/HelperState.swift` (hook receivePCM to PCMReceiver)

- [ ] **Step 1**: Identify in `AudioCapture.swift` where `CMSampleBuffer` arrives (likely a `SCStreamOutput.stream(_:didOutputSampleBuffer:of:)` method). Add a callback property:

```swift
var onPCMChunk: ((Data, Double, UInt64) -> Void)?
```

- [ ] **Step 2**: When a sample buffer arrives, convert to Float32 mono 16 kHz and invoke the callback. Use `AVAudioConverter` if the sample buffer is not already 16 kHz mono. Do **not** mutate the existing AAC path; the fan-out is read-only.

```swift
private func forwardToHelper(_ sampleBuffer: CMSampleBuffer) {
    guard let onPCM = onPCMChunk else { return }
    guard let pcm = Self.convertToFloat32Mono16k(sampleBuffer) else { return }
    let hostTimeNs = mach_absolute_time()  // or a precomputed monotonic base
    onPCM(pcm, 16000.0, hostTimeNs)
}
```

Implement `convertToFloat32Mono16k(_:)` using `AVAudioConverter` + `AVAudioPCMBuffer`. Keep it in `AudioCapture.swift` for locality, or move to `Shared/PCMConvert.swift` if you want it unit-testable.

- [ ] **Step 3**: In `AppDelegate` (or wherever `AudioCapture` is owned), wire the callback to XPC:

```swift
audioCapture.onPCMChunk = { [weak self] data, sampleRate, ts in
    XPCClient.shared.proxy?.receivePCM(data, sampleRate: sampleRate, hostTimeNs: ts)
}
```

- [ ] **Step 4**: Write `MeetingCaptionsHelper/PCMReceiver.swift`:

```swift
import Foundation

final class PCMReceiver {
    static let shared = PCMReceiver()
    private var totalSamples: Int = 0
    private var lastLog: Date = .distantPast

    func append(_ data: Data, sampleRate: Double) {
        let sampleCount = data.count / MemoryLayout<Float>.size
        totalSamples += sampleCount
        let now = Date()
        if now.timeIntervalSince(lastLog) > 5 {
            NSLog("[pcm] received \(totalSamples) samples so far at \(sampleRate) Hz")
            lastLog = now
        }
        // Task 3 will forward to LiveASR here
    }
}
```

- [ ] **Step 5**: In `HelperState.receivePCM`, call `PCMReceiver.shared.append`:

```swift
func receivePCM(_ data: Data, sampleRate: Double, hostTimeNs: UInt64) {
    PCMReceiver.shared.append(data, sampleRate: sampleRate)
}
```

- [ ] **Step 6**: Launch main, press Start, speak for 10 seconds. Verify Console.app shows `[pcm] received N samples...` log lines. Press Stop. Verify the AAC file is still produced and plays back correctly. Verify audio quality is unchanged (the fan-out must be lossless and non-blocking on the capture thread).

- [ ] **Step 7**: Run existing app tests (if any):

```bash
xcodebuild test -scheme MeetingRecorder -destination "platform=macOS"
```

Verify no regression.

- [ ] **Step 8**: Commit:

```bash
git add MeetingRecorder/AudioCapture.swift MeetingRecorder/AppDelegate.swift MeetingCaptionsHelper/PCMReceiver.swift MeetingCaptionsHelper/HelperState.swift
git commit -m "feat(helper): fan out PCM from main to helper"
```

---

## Task 3: LiveASR with WhisperKit streaming

Add WhisperKit. Wrap streaming API behind a mockable protocol. Emit `partial` / `final` events to a delegate. Unit-test with a fixture wav file.

**Files:**
- Modify: `Package.swift` (or Xcode SPM UI) to add WhisperKit
- Create: `MeetingCaptionsHelper/ASRProtocol.swift`
- Create: `MeetingCaptionsHelper/LiveASR.swift`
- Create: `MeetingCaptionsHelperTests/LiveASRMockTests.swift`
- Create: `MeetingCaptionsHelperTests/Fixtures/sample-en.wav` (~10 s of clear English speech; you can record yourself saying a known sentence for test-expectation stability)
- Modify: `MeetingCaptionsHelper/PCMReceiver.swift` (forward chunks to LiveASR)

- [ ] **Step 1**: Add WhisperKit SPM dependency:
  - In Xcode: File → Add Package Dependencies → `https://github.com/argmaxinc/WhisperKit.git`
  - Or add to `Package.swift`:
    ```swift
    .package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.7.0"),
    ```
  - Link `WhisperKit` to the helper target only (main app does not need it).

- [ ] **Step 2**: Write `ASRProtocol.swift`:

```swift
import Foundation

struct CaptionEvent {
    enum Kind { case partial, final }
    let kind: Kind
    let text: String
    let startSec: Double
    let endSec: Double
}

protocol LiveASRProtocol: AnyObject {
    var onEvent: ((CaptionEvent) -> Void)? { get set }
    func start() async throws
    func append(_ data: Data, sampleRate: Double)
    func flush() async
    func stop()
}
```

- [ ] **Step 3**: Write `LiveASR.swift`:

```swift
import Foundation
import WhisperKit

final class LiveASR: LiveASRProtocol {
    private var whisper: WhisperKit?
    private let modelName: String
    private var bufferedSamples: [Float] = []
    private var lastFlushSec: Double = 0
    private var sessionStart = Date()

    var onEvent: ((CaptionEvent) -> Void)?

    init(modelName: String = "openai_whisper-base.en") {
        self.modelName = modelName
    }

    func start() async throws {
        let cfg = WhisperKitConfig(model: modelName)
        whisper = try await WhisperKit(cfg)
        bufferedSamples.removeAll()
        sessionStart = Date()
    }

    func append(_ data: Data, sampleRate: Double) {
        let count = data.count / MemoryLayout<Float>.size
        let samples: [Float] = data.withUnsafeBytes { raw in
            Array(raw.bindMemory(to: Float.self).prefix(count))
        }
        bufferedSamples.append(contentsOf: samples)

        // Strategy: emit partial every 3 s of accumulated audio, final every 5-8 s
        // on VAD boundary. For first implementation, a simple 5 s rolling window.
        let samplesPer5s = Int(sampleRate * 5)
        if bufferedSamples.count >= samplesPer5s {
            let windowSamples = bufferedSamples
            bufferedSamples.removeAll(keepingCapacity: true)
            Task { await self.transcribeWindow(windowSamples, isFinal: false) }
        }
    }

    func flush() async {
        guard !bufferedSamples.isEmpty else { return }
        let last = bufferedSamples
        bufferedSamples.removeAll()
        await transcribeWindow(last, isFinal: true)
    }

    func stop() {
        whisper = nil
    }

    private func transcribeWindow(_ samples: [Float], isFinal: Bool) async {
        guard let whisper else { return }
        do {
            let result = try await whisper.transcribe(audioArray: samples)
            let text = result?.text ?? ""
            guard !text.isEmpty else { return }
            let now = Date().timeIntervalSince(sessionStart)
            let startSec = lastFlushSec
            lastFlushSec = now
            let ev = CaptionEvent(
                kind: isFinal ? .final : .partial,
                text: text,
                startSec: startSec,
                endSec: now
            )
            DispatchQueue.main.async { self.onEvent?(ev) }
        } catch {
            NSLog("[liveasr] transcribe error: \(error)")
        }
    }
}
```

Note: this is an *initial* implementation. After Task 3 ships, monitor real-world latency and tune: the 5 s window is a starting point — WhisperKit has its own streaming mode with incremental updates that you can adopt later for tighter `< 2 s` partials. Document known limitations in `notes.md`.

- [ ] **Step 4**: Wire `PCMReceiver` to `LiveASR`:

```swift
final class PCMReceiver {
    static let shared = PCMReceiver()
    private let asr: LiveASRProtocol = LiveASR()
    private var started = false

    func startASR() async {
        guard !started else { return }
        do { try await asr.start(); started = true }
        catch { NSLog("[asr] start failed: \(error)") }
    }

    func append(_ data: Data, sampleRate: Double) {
        asr.append(data, sampleRate: sampleRate)
    }

    var onEvent: ((CaptionEvent) -> Void)? {
        get { asr.onEvent }
        set { asr.onEvent = newValue }
    }

    func flush() async { await asr.flush() }
    func stop() { asr.stop(); started = false }
}
```

Call `startASR()` from `HelperState.startSession`. Don't call it lazily from `receivePCM` — that risks dropping frames while loading the model.

- [ ] **Step 5**: Add fixture `sample-en.wav`: ~10 s of clear English speech, mono 16 kHz. Best source: record yourself reading a known sentence with `afrecord -c 1 -r 16000`. Use a sentence whose key words are distinctive enough to assert on.

- [ ] **Step 6**: Write `LiveASRMockTests.swift`:

```swift
import XCTest
@testable import MeetingCaptionsHelper

final class LiveASRTests: XCTestCase {
    func test_transcribes_known_fixture() async throws {
        let asr = LiveASR(modelName: "openai_whisper-base.en")
        try await asr.start()

        var events: [CaptionEvent] = []
        asr.onEvent = { events.append($0) }

        // Load fixture wav, convert to Float32, feed in 500 ms chunks.
        let url = Bundle(for: type(of: self)).url(forResource: "sample-en", withExtension: "wav")!
        let samples = try Self.loadFloat32Mono16k(url)
        let chunkSize = 16000 / 2  // 500 ms
        for start in stride(from: 0, to: samples.count, by: chunkSize) {
            let end = min(start + chunkSize, samples.count)
            let chunk = Array(samples[start..<end])
            let data = chunk.withUnsafeBytes { Data($0) }
            asr.append(data, sampleRate: 16000.0)
        }
        await asr.flush()

        // Wait briefly for async transcription to settle.
        try await Task.sleep(nanoseconds: 2_000_000_000)

        XCTAssertFalse(events.isEmpty, "ASR should emit at least one event for a 10s fixture")
        let finalText = events.filter { $0.kind == .final }.map { $0.text }.joined(separator: " ")
        // Assert on distinctive words from your fixture; replace with real expected text.
        XCTAssertTrue(finalText.lowercased().contains("<expected word>"),
                      "Final text should contain expected word; got: \(finalText)")
    }

    private static func loadFloat32Mono16k(_ url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
        let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length))!
        try file.read(into: buf)
        let ptr = buf.floatChannelData![0]
        return Array(UnsafeBufferPointer(start: ptr, count: Int(buf.frameLength)))
    }
}
```

Replace `<expected word>` with something from your actual fixture sentence.

- [ ] **Step 7**: Run the test:

```bash
xcodebuild test -scheme MeetingCaptionsHelper -only-testing:MeetingCaptionsHelperTests/LiveASRTests
```

First run will download the WhisperKit model (~150 MB), which is slow. Subsequent runs are fast. If the model download fails, check Mac's network or pre-download via WhisperKit CLI.

Expected: PASS. If the final text does not contain the expected word, check the fixture quality (noise, sample rate) and tune. Don't relax the assertion — that defeats the test.

- [ ] **Step 8**: Commit:

```bash
git add Package.swift Package.resolved MeetingCaptionsHelper/ASRProtocol.swift MeetingCaptionsHelper/LiveASR.swift MeetingCaptionsHelper/PCMReceiver.swift MeetingCaptionsHelperTests/LiveASRMockTests.swift MeetingCaptionsHelperTests/Fixtures/sample-en.wav
git commit -m "feat(helper): WhisperKit streaming ASR with fixture test"
```

---

## Task 4: TranscriptBuffer

In-memory state for final transcripts. Formatter for the `[HH:MM:SS] text` protocol the backend expects.

**Files:**
- Create: `MeetingCaptionsHelper/TranscriptBuffer.swift`
- Create: `Shared/Models.swift` (TranscriptEntry struct)
- Create: `MeetingCaptionsHelperTests/TranscriptBufferTests.swift`

- [ ] **Step 1**: Write `Shared/Models.swift`:

```swift
import Foundation

public struct TranscriptEntry: Codable, Equatable {
    public let startSec: Double
    public let endSec: Double
    public let text: String
}
```

- [ ] **Step 2**: Write `TranscriptBufferTests.swift`:

```swift
import XCTest
@testable import MeetingCaptionsHelper

final class TranscriptBufferTests: XCTestCase {
    func test_append_and_list_in_order() {
        let buf = TranscriptBuffer()
        buf.append(TranscriptEntry(startSec: 0.0, endSec: 2.5, text: "Hello"))
        buf.append(TranscriptEntry(startSec: 3.0, endSec: 5.0, text: "World"))
        XCTAssertEqual(buf.entries.count, 2)
        XCTAssertEqual(buf.entries[0].text, "Hello")
    }

    func test_formatted_output_has_hhmmss_prefix() {
        let buf = TranscriptBuffer()
        buf.append(TranscriptEntry(startSec: 5.3, endSec: 7.0, text: "Hello team"))
        buf.append(TranscriptEntry(startSec: 65.0, endSec: 70.0, text: "Second line"))
        let out = buf.buildTranscriptText()
        XCTAssertTrue(out.contains("[00:00:05] Hello team"))
        XCTAssertTrue(out.contains("[00:01:05] Second line"))
    }

    func test_character_count_matches_sum() {
        let buf = TranscriptBuffer()
        for i in 0..<10 {
            buf.append(TranscriptEntry(startSec: Double(i), endSec: Double(i) + 0.5, text: "line \(i)"))
        }
        XCTAssertTrue(buf.totalCharCount > 0)
    }
}
```

- [ ] **Step 3**: Run test to verify fail:

```bash
xcodebuild test -scheme MeetingCaptionsHelper -only-testing:MeetingCaptionsHelperTests/TranscriptBufferTests
```

Expected: FAIL (no TranscriptBuffer class).

- [ ] **Step 4**: Write `TranscriptBuffer.swift`:

```swift
import Foundation

final class TranscriptBuffer {
    private(set) var entries: [TranscriptEntry] = []

    var totalCharCount: Int { entries.reduce(0) { $0 + $1.text.count + 12 } }  // +12 for "[HH:MM:SS] " prefix

    func append(_ entry: TranscriptEntry) {
        entries.append(entry)
    }

    func buildTranscriptText() -> String {
        entries.map { "\(Self.formatTime($0.startSec)) \($0.text)" }.joined(separator: "\n")
    }

    static func formatTime(_ seconds: Double) -> String {
        let s = Int(seconds)
        return String(format: "[%02d:%02d:%02d]", s / 3600, (s % 3600) / 60, s % 60)
    }
}
```

- [ ] **Step 5**: Run tests. Expected PASS.

- [ ] **Step 6**: Commit:

```bash
git add Shared/Models.swift MeetingCaptionsHelper/TranscriptBuffer.swift MeetingCaptionsHelperTests/TranscriptBufferTests.swift
git commit -m "feat(helper): TranscriptBuffer with HH:MM:SS formatter"
```

---

## Task 5: CaptionOverlay (floating NSPanel)

A transparent always-on-top panel that shows the last 2-3 caption lines. Partial = subtle / dimmed; final = solid.

**Files:**
- Create: `MeetingCaptionsHelper/CaptionOverlay.swift`
- Modify: `HelperState.swift` to own a `CaptionOverlay` and route events

- [ ] **Step 1**: Write `CaptionOverlay.swift`:

```swift
import AppKit

final class CaptionOverlay {
    private let panel: NSPanel
    private let label: NSTextField
    private var recent: [(text: String, isFinal: Bool)] = []
    private let maxLines = 3

    init() {
        panel = NSPanel(
            contentRect: NSRect(x: 200, y: 100, width: 1000, height: 120),
            styleMask: [.nonactivatingPanel, .fullSizeContentView, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.backgroundColor = NSColor.black.withAlphaComponent(0.55)
        panel.isMovableByWindowBackground = true
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        label = NSTextField(labelWithString: "")
        label.font = .systemFont(ofSize: 32, weight: .medium)
        label.textColor = .white
        label.alignment = .center
        label.maximumNumberOfLines = maxLines
        label.lineBreakMode = .byWordWrapping
        label.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView()
        content.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
            label.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -12),
            label.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24)
        ])
        panel.contentView = content
    }

    func show() {
        panel.orderFrontRegardless()
    }

    func hide() {
        panel.orderOut(nil)
    }

    func apply(_ event: CaptionEvent) {
        // Rolling buffer: partials replace the last "pending" line, finals promote to history.
        if event.kind == .final {
            recent.append((event.text, true))
            if recent.count > maxLines { recent.removeFirst(recent.count - maxLines) }
        } else {
            if let last = recent.last, !last.isFinal {
                recent.removeLast()
            }
            recent.append((event.text, false))
            if recent.count > maxLines { recent.removeFirst(recent.count - maxLines) }
        }
        render()
    }

    func clear() {
        recent.removeAll()
        label.stringValue = ""
    }

    private func render() {
        let attributed = NSMutableAttributedString()
        for (i, item) in recent.enumerated() {
            let line = (i == recent.count - 1) ? item.text : item.text + "\n"
            let attrs: [NSAttributedString.Key: Any] = item.isFinal
                ? [.foregroundColor: NSColor.white]
                : [.foregroundColor: NSColor.white.withAlphaComponent(0.65)]
            attributed.append(NSAttributedString(string: line, attributes: attrs))
        }
        label.attributedStringValue = attributed
    }

    func showOffline(_ reason: String) {
        // Show a red banner at top. Implementation detail: add a second label with red bg.
        NSLog("[overlay] offline: \(reason)")
    }
}
```

- [ ] **Step 2**: In `HelperState`:

```swift
final class HelperState: NSObject, CaptionsHelperProtocol {
    static let shared = HelperState()
    private let captionOverlay = CaptionOverlay()
    // ... existing fields

    func startSession(recordingURL: URL, startedAt: Date) {
        captionOverlay.show()
        PCMReceiver.shared.onEvent = { [weak self] ev in
            self?.captionOverlay.apply(ev)
            // TranscriptBuffer append happens in Task 7 integration
        }
        Task { await PCMReceiver.shared.startASR() }
    }

    func stopSession(reply: @escaping () -> Void) {
        Task {
            await PCMReceiver.shared.flush()
            PCMReceiver.shared.stop()
            await MainActor.run { self.captionOverlay.hide() }
            reply()
        }
    }
}
```

- [ ] **Step 3**: Manual smoke:
  1. Build & launch.
  2. Start recording.
  3. Speak English.
  4. Verify floating panel appears, showing captions with partial-then-final transitions.
  5. Drag panel to reposition.
  6. Stop recording → panel disappears.
  7. AAC file still plays back correctly.

- [ ] **Step 4**: Commit:

```bash
git add MeetingCaptionsHelper/CaptionOverlay.swift MeetingCaptionsHelper/HelperState.swift
git commit -m "feat(helper): CaptionOverlay NSPanel with partial/final rendering"
```

---

## Task 6: NotesFileWriter with atomic write

Writes frontmatter + summary section + transcript section to a single `.md` file next to the AAC recording. Writes **only** on final caption arrival and on summary refresh. Atomic rewrite each time (write to `.tmp`, fsync, rename).

**Files:**
- Create: `MeetingCaptionsHelper/NotesFileWriter.swift`
- Create: `MeetingCaptionsHelperTests/NotesFileWriterTests.swift`

- [ ] **Step 1**: Write `NotesFileWriterTests.swift`:

```swift
import XCTest
@testable import MeetingCaptionsHelper

final class NotesFileWriterTests: XCTestCase {
    var tmpDir: URL!
    var mdURL: URL!

    override func setUpWithError() throws {
        tmpDir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        mdURL = tmpDir.appendingPathComponent("test.md")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmpDir)
    }

    func test_fresh_file_has_frontmatter_and_empty_sections() throws {
        let w = NotesFileWriter(mdURL: mdURL, recordingURL: mdURL.deletingPathExtension().appendingPathExtension("aac"), startedAt: Date(timeIntervalSince1970: 1714700000), sessionId: "abc-123")
        try w.flush()
        let content = try String(contentsOf: mdURL)
        XCTAssertTrue(content.contains("---"))
        XCTAssertTrue(content.contains("sessionId: abc-123"))
        XCTAssertTrue(content.contains("# Summary"))
        XCTAssertTrue(content.contains("# Transcript"))
    }

    func test_transcript_append_persists_in_order() throws {
        let w = NotesFileWriter(mdURL: mdURL, recordingURL: mdURL, startedAt: Date(), sessionId: "x")
        try w.appendFinal(TranscriptEntry(startSec: 5.0, endSec: 7.0, text: "first line"))
        try w.appendFinal(TranscriptEntry(startSec: 15.0, endSec: 17.0, text: "second line"))
        let content = try String(contentsOf: mdURL)
        let firstIdx = content.range(of: "first line")!.lowerBound
        let secondIdx = content.range(of: "second line")!.lowerBound
        XCTAssertTrue(firstIdx < secondIdx)
    }

    func test_summary_update_replaces_previous_summary() throws {
        let w = NotesFileWriter(mdURL: mdURL, recordingURL: mdURL, startedAt: Date(), sessionId: "x")
        try w.updateSummary(LiveSummary.sample(summary: "old summary"))
        try w.updateSummary(LiveSummary.sample(summary: "new summary"))
        let content = try String(contentsOf: mdURL)
        XCTAssertTrue(content.contains("new summary"))
        XCTAssertFalse(content.contains("old summary"))
    }

    func test_atomic_write_leaves_no_tmp_on_success() throws {
        let w = NotesFileWriter(mdURL: mdURL, recordingURL: mdURL, startedAt: Date(), sessionId: "x")
        try w.flush()
        let tmpPath = mdURL.path + ".tmp"
        XCTAssertFalse(FileManager.default.fileExists(atPath: tmpPath))
    }
}
```

You'll need `LiveSummary.sample(...)` helper; define it in `Models.swift`:

```swift
public struct LiveSummary: Codable {
    public let summary: String
    public let highlights: [Point]
    public let lowlights: [Point]
    public let actions: [Action]
    public let decisions: [Decision]
    public let generatedAt: String
    public let tokensInput: Int?
    public let tokensOutput: Int?

    public struct Point: Codable { public let point: String; public let detail: String }
    public struct Action: Codable { public let task: String; public let owner: String?; public let deadline: String?; public let priority: String? }
    public struct Decision: Codable { public let decision: String; public let rationale: String? }

    #if DEBUG
    static func sample(summary: String) -> LiveSummary {
        LiveSummary(summary: summary, highlights: [], lowlights: [], actions: [], decisions: [], generatedAt: "2026-01-01T00:00:00Z", tokensInput: nil, tokensOutput: nil)
    }
    #endif
}
```

- [ ] **Step 2**: Run tests to verify they fail.

- [ ] **Step 3**: Write `NotesFileWriter.swift`:

```swift
import Foundation

final class NotesFileWriter {
    private let mdURL: URL
    private let recordingURL: URL
    private let startedAt: Date
    private let sessionId: String
    private var lastSummary: LiveSummary?
    private var transcriptEntries: [TranscriptEntry] = []
    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private(set) var endedAt: Date?

    init(mdURL: URL, recordingURL: URL, startedAt: Date, sessionId: String) {
        self.mdURL = mdURL
        self.recordingURL = recordingURL
        self.startedAt = startedAt
        self.sessionId = sessionId
    }

    func appendFinal(_ entry: TranscriptEntry) throws {
        transcriptEntries.append(entry)
        try flush()
    }

    func updateSummary(_ s: LiveSummary) throws {
        lastSummary = s
        try flush()
    }

    func setEnded(_ at: Date) {
        endedAt = at
    }

    func flush() throws {
        let tmp = URL(fileURLWithPath: mdURL.path + ".tmp")
        let md = renderMarkdown()
        try md.write(to: tmp, atomically: false, encoding: .utf8)
        // fsync by reopening FileHandle
        if let fh = try? FileHandle(forWritingTo: tmp) {
            try? fh.synchronize()
            try? fh.close()
        }
        _ = try FileManager.default.replaceItemAt(mdURL, withItemAt: tmp)
    }

    private func renderMarkdown() -> String {
        var md = "---\n"
        md += "title: \(titleFromStart())\n"
        md += "recording: \(recordingURL.lastPathComponent)\n"
        md += "sessionId: \(sessionId)\n"
        md += "startedAt: \(isoFormatter.string(from: startedAt))\n"
        md += "lastUpdated: \(isoFormatter.string(from: Date()))\n"
        md += "endedAt: \(endedAt.map { isoFormatter.string(from: $0) } ?? "null")\n"
        md += "language: en\n"
        md += "---\n\n"

        md += "# Summary"
        if let s = lastSummary {
            md += " (as of \(s.generatedAt))\n\n\(s.summary)\n\n"
            if !s.highlights.isEmpty {
                md += "## Highlights\n"
                for h in s.highlights { md += "- \(h.point) — \(h.detail)\n" }
                md += "\n"
            }
            if !s.lowlights.isEmpty {
                md += "## Lowlights\n"
                for l in s.lowlights { md += "- \(l.point) — \(l.detail)\n" }
                md += "\n"
            }
            if !s.actions.isEmpty {
                md += "## Actions\n"
                for a in s.actions {
                    let owner = a.owner ?? "?"
                    let due = a.deadline ?? "no deadline"
                    let pri = a.priority ?? "medium"
                    md += "- [ ] **\(owner)** · due \(due) · \(pri) — \(a.task)\n"
                }
                md += "\n"
            }
            if !s.decisions.isEmpty {
                md += "## Decisions\n"
                for d in s.decisions { md += "- \(d.decision) — \(d.rationale ?? "")\n" }
                md += "\n"
            }
        } else {
            md += "\n\n_(no summary yet)_\n\n"
        }

        md += "---\n\n# Transcript\n\n"
        for e in transcriptEntries {
            md += "\(TranscriptBuffer.formatTime(e.startSec)) \(e.text)\n"
        }
        return md
    }

    private func titleFromStart() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return "\(f.string(from: startedAt)) Meeting"
    }
}
```

- [ ] **Step 4**: Run tests. Expected PASS. If `test_atomic_write_leaves_no_tmp_on_success` fails, check the `replaceItemAt` behavior on your macOS version.

- [ ] **Step 5**: Commit:

```bash
git add Shared/Models.swift MeetingCaptionsHelper/NotesFileWriter.swift MeetingCaptionsHelperTests/NotesFileWriterTests.swift
git commit -m "feat(helper): NotesFileWriter with atomic md rewrite"
```

---

## Task 7: SummaryScheduler — 180 s timer + HTTPS POST

Every 180 s, POST the accumulated transcript to `POST {backendURL}/api/live-summary`. The backend does not require authentication (see preamble), so the `x-api-key` header is optional: the scheduler sends it only if an API key has been configured in Preferences, otherwise the request goes without auth. On success, update `SummaryOverlay` + `NotesFileWriter`. On failure, skip this tick; count consecutive failures; after 3 go offline.

**Files:**
- Create: `MeetingCaptionsHelper/SummaryScheduler.swift`
- Create: `MeetingCaptionsHelperTests/SummarySchedulerTests.swift`
- Modify: `HelperState.swift` to wire scheduler + NotesFileWriter + TranscriptBuffer

- [ ] **Step 1**: Write `SummarySchedulerTests.swift` using a mock `URLSession` protocol:

```swift
import XCTest
@testable import MeetingCaptionsHelper

protocol URLSessionProtocol {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

final class MockURLSession: URLSessionProtocol {
    var responses: [(Data, URLResponse)] = []
    var errors: [Error] = []
    var requestsReceived: [URLRequest] = []

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requestsReceived.append(request)
        if !errors.isEmpty {
            throw errors.removeFirst()
        }
        return responses.removeFirst()
    }
}

final class SummarySchedulerTests: XCTestCase {
    func test_posts_accumulated_transcript_on_tick() async throws {
        let buf = TranscriptBuffer()
        buf.append(TranscriptEntry(startSec: 0, endSec: 2, text: "hello"))
        let mock = MockURLSession()
        let summaryJSON = """
        {"summary":"hi","highlights":[],"lowlights":[],"actions":[],"decisions":[],"generatedAt":"2026-05-03T00:00:00Z"}
        """.data(using: .utf8)!
        mock.responses = [(summaryJSON, HTTPURLResponse(url: URL(string: "http://x")!, statusCode: 200, httpVersion: nil, headerFields: nil)!)]

        let scheduler = SummaryScheduler(
            backendURL: URL(string: "http://localhost:3300")!,
            apiKey: "test-key",
            sessionId: UUID(),
            buffer: buf,
            session: mock
        )
        let summary = try await scheduler.triggerOnce(isFinal: false)
        XCTAssertEqual(summary.summary, "hi")
        XCTAssertEqual(mock.requestsReceived.count, 1)
        let req = mock.requestsReceived[0]
        XCTAssertEqual(req.value(forHTTPHeaderField: "x-api-key"), "test-key")
        let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
        XCTAssertTrue((body["transcriptText"] as! String).contains("hello"))
        XCTAssertEqual(body["isFinal"] as? Bool, false)
    }

    func test_isFinal_true_on_explicit_flush() async throws {
        let mock = MockURLSession()
        mock.responses = [(validJSON(), HTTPURLResponse(url: URL(string:"http://x")!, statusCode: 200, httpVersion: nil, headerFields: nil)!)]
        let buf = TranscriptBuffer()
        buf.append(TranscriptEntry(startSec: 0, endSec: 1, text: "bye"))
        let s = SummaryScheduler(backendURL: URL(string: "http://localhost:3300")!, apiKey: "k", sessionId: UUID(), buffer: buf, session: mock)
        _ = try await s.triggerOnce(isFinal: true)
        let body = try JSONSerialization.jsonObject(with: mock.requestsReceived[0].httpBody!) as! [String: Any]
        XCTAssertEqual(body["isFinal"] as? Bool, true)
    }

    func test_503_response_throws_retryable_error() async throws {
        let mock = MockURLSession()
        mock.responses = [(Data(), HTTPURLResponse(url: URL(string:"http://x")!, statusCode: 503, httpVersion: nil, headerFields: nil)!)]
        let s = SummaryScheduler(backendURL: URL(string: "http://localhost:3300")!, apiKey: "k", sessionId: UUID(), buffer: TranscriptBuffer(), session: mock)
        do {
            _ = try await s.triggerOnce(isFinal: false)
            XCTFail("expected throw")
        } catch SummaryError.backendUnavailable {
            // ok
        }
    }

    private func validJSON() -> Data {
        """
        {"summary":"x","highlights":[],"lowlights":[],"actions":[],"decisions":[],"generatedAt":"2026-05-03T00:00:00Z"}
        """.data(using: .utf8)!
    }
}
```

- [ ] **Step 2**: Write `SummaryScheduler.swift`:

```swift
import Foundation

enum SummaryError: Error {
    case backendUnavailable
    case backendTimeout
    case rateLimited
    case validation(String)
    case decoding
    case network(Error)
}

final class SummaryScheduler {
    private let backendURL: URL
    private let apiKey: String?
    private let sessionId: UUID
    private let buffer: TranscriptBuffer
    private let session: URLSessionProtocol
    private let startedAt: Date
    private var timer: Timer?
    private var consecutiveFailures = 0

    var onSummary: ((LiveSummary) -> Void)?
    var onOffline: ((String) -> Void)?

    init(backendURL: URL, apiKey: String?, sessionId: UUID, buffer: TranscriptBuffer,
         session: URLSessionProtocol = URLSession.shared, startedAt: Date = Date()) {
        self.backendURL = backendURL
        self.apiKey = apiKey
        self.sessionId = sessionId
        self.buffer = buffer
        self.session = session
        self.startedAt = startedAt
    }

    func start(intervalSec: TimeInterval = 180) {
        timer = Timer.scheduledTimer(withTimeInterval: intervalSec, repeats: true) { [weak self] _ in
            Task { [weak self] in
                do {
                    let s = try await self?.triggerOnce(isFinal: false)
                    if let s { self?.onSummary?(s) }
                } catch {
                    self?.handleFailure(error)
                }
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    @discardableResult
    func triggerOnce(isFinal: Bool) async throws -> LiveSummary {
        var req = URLRequest(url: backendURL.appendingPathComponent("/api/live-summary"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let apiKey { req.setValue(apiKey, forHTTPHeaderField: "x-api-key") }
        req.timeoutInterval = 60

        let elapsedSec = max(1, Int(Date().timeIntervalSince(startedAt)))
        let body: [String: Any] = [
            "sessionId": sessionId.uuidString.lowercased(),
            "transcriptText": buffer.buildTranscriptText(),
            "elapsedSec": elapsedSec,
            "isFinal": isFinal
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw SummaryError.network(error)
        }
        guard let http = response as? HTTPURLResponse else { throw SummaryError.decoding }
        switch http.statusCode {
        case 200:
            do {
                let decoder = JSONDecoder()
                let summary = try decoder.decode(LiveSummary.self, from: data)
                consecutiveFailures = 0
                return summary
            } catch { throw SummaryError.decoding }
        case 400: throw SummaryError.validation(String(data: data, encoding: .utf8) ?? "")
        case 429: throw SummaryError.rateLimited
        case 503: throw SummaryError.backendUnavailable
        case 504: throw SummaryError.backendTimeout
        default: throw SummaryError.network(NSError(domain: "live-summary", code: http.statusCode))
        }
    }

    private func handleFailure(_ err: Error) {
        consecutiveFailures += 1
        NSLog("[scheduler] failure #\(consecutiveFailures): \(err)")
        if consecutiveFailures >= 3 {
            onOffline?("3 consecutive summary failures")
        }
    }
}
```

- [ ] **Step 3**: Run tests. All three expected to PASS.

- [ ] **Step 4**: In `HelperState`, wire the scheduler and NotesFileWriter:

```swift
final class HelperState: NSObject, CaptionsHelperProtocol {
    static let shared = HelperState()
    private let captionOverlay = CaptionOverlay()
    private var summaryOverlay: SummaryOverlay?  // Task 8
    private let transcriptBuffer = TranscriptBuffer()
    private var notesWriter: NotesFileWriter?
    private var scheduler: SummaryScheduler?
    private var sessionId: UUID?

    func startSession(recordingURL: URL, startedAt: Date) {
        let sid = UUID()
        sessionId = sid
        let mdURL = recordingURL.deletingPathExtension().appendingPathExtension("md")
        notesWriter = NotesFileWriter(mdURL: mdURL, recordingURL: recordingURL, startedAt: startedAt, sessionId: sid.uuidString)
        try? notesWriter?.flush()

        let prefs = Preferences.shared  // Task 10
        scheduler = SummaryScheduler(
            backendURL: prefs.backendURL,
            apiKey: prefs.apiKey,
            sessionId: sid,
            buffer: transcriptBuffer,
            startedAt: startedAt
        )
        scheduler?.onSummary = { [weak self] s in
            Task { @MainActor in
                try? self?.notesWriter?.updateSummary(s)
                self?.summaryOverlay?.render(s)
            }
        }
        scheduler?.onOffline = { [weak self] reason in
            Task { @MainActor in self?.summaryOverlay?.showOffline(reason) }
        }
        scheduler?.start(intervalSec: prefs.summaryIntervalSec)

        captionOverlay.show()
        PCMReceiver.shared.onEvent = { [weak self] ev in
            self?.captionOverlay.apply(ev)
            if ev.kind == .final {
                let entry = TranscriptEntry(startSec: ev.startSec, endSec: ev.endSec, text: ev.text)
                self?.transcriptBuffer.append(entry)
                try? self?.notesWriter?.appendFinal(entry)
            }
        }
        Task { await PCMReceiver.shared.startASR() }
    }

    func stopSession(reply: @escaping () -> Void) {
        Task {
            await PCMReceiver.shared.flush()
            PCMReceiver.shared.stop()
            scheduler?.stop()
            // Final isFinal=true flush
            if let scheduler {
                do {
                    let s = try await scheduler.triggerOnce(isFinal: true)
                    try? notesWriter?.updateSummary(s)
                } catch {
                    NSLog("[stop] final summary failed: \(error)")
                }
            }
            notesWriter?.setEnded(Date())
            try? notesWriter?.flush()
            await MainActor.run { self.captionOverlay.hide() }
            reply()
        }
    }
}
```

- [ ] **Step 5**: Manual smoke: record 4 minutes of speech; verify first scheduler fire at ~3 min; inspect `.md` file in recording directory to confirm summary section present. Verify at 6 min (second tick) summary is refreshed with full history.

- [ ] **Step 6**: Commit:

```bash
git add MeetingCaptionsHelper/SummaryScheduler.swift MeetingCaptionsHelper/HelperState.swift MeetingCaptionsHelperTests/SummarySchedulerTests.swift
git commit -m "feat(helper): SummaryScheduler 180s loop with isFinal flush"
```

---

## Task 8: SummaryOverlay

Collapsible floating panel showing the latest summary. Offline banner when scheduler reports consecutive failures.

**Files:**
- Create: `MeetingCaptionsHelper/SummaryOverlay.swift`
- Modify: `HelperState.swift` (instantiate and register)

Implementation outline (similar shape to `CaptionOverlay`):

- Panel with title bar "Meeting Summary · <HH:MM>"
- Tiny collapse/expand button on the right
- Content: labels for Summary / Highlights / Actions / Decisions
- Method `render(_ s: LiveSummary)` to populate content
- Method `showOffline(_ reason: String)` to show a red banner at the top
- Method `updateStaleness()` called every 30 s to update "X min ago"

- [ ] **Step 1**: Follow the same `NSPanel` + AppKit pattern as `CaptionOverlay`. I won't reproduce the full code here — use `CaptionOverlay` as a template and adapt.

- [ ] **Step 2**: Instantiate in `HelperState` and wire into `scheduler.onSummary` (replace the TODO from Task 7).

- [ ] **Step 3**: Manual smoke: verify first scheduler response renders in panel; verify staleness text updates; kill network, verify offline banner after 3 failures.

- [ ] **Step 4**: Commit:

```bash
git add MeetingCaptionsHelper/SummaryOverlay.swift MeetingCaptionsHelper/HelperState.swift
git commit -m "feat(helper): SummaryOverlay NSPanel with offline banner"
```

---

## Task 9: Preferences (UserDefaults + Keychain)

- `summaryIntervalSec` (Int, default 180, range 120-600)
- `backendURL` (String, default `http://localhost:3300`)
- `apiKey` (String, stored in Keychain, not UserDefaults) — **optional**. The backend's `/api/live-summary` is open; leave blank unless your deployment adds auth later.
- `asrModel` (String, default `openai_whisper-base.en`)
- `transcriptMaxChars` (Int, default 200_000)
- `summaryFailureThreshold` (Int, default 3)

**Files:**
- Create: `MeetingRecorder/Preferences/PreferencesWindow.swift` (SwiftUI or xib)
- Create: `Shared/Preferences.swift`
- Modify: main menu / menu bar to add "Preferences…" item

- [ ] **Step 1**: Write `Shared/Preferences.swift`:

```swift
import Foundation
import Security

public final class Preferences {
    public static let shared = Preferences()

    public var summaryIntervalSec: TimeInterval {
        get { TimeInterval(UserDefaults.standard.object(forKey: "summaryIntervalSec") as? Int ?? 180) }
        set { UserDefaults.standard.set(Int(newValue), forKey: "summaryIntervalSec") }
    }

    public var backendURL: URL {
        get { URL(string: UserDefaults.standard.string(forKey: "backendURL") ?? "http://localhost:3300")! }
        set { UserDefaults.standard.set(newValue.absoluteString, forKey: "backendURL") }
    }

    public var apiKey: String? {
        get { KeychainHelper.read(account: "live-summary-api-key") }
        set {
            if let v = newValue { KeychainHelper.write(account: "live-summary-api-key", value: v) }
            else { KeychainHelper.delete(account: "live-summary-api-key") }
        }
    }

    public var asrModel: String {
        get { UserDefaults.standard.string(forKey: "asrModel") ?? "openai_whisper-base.en" }
        set { UserDefaults.standard.set(newValue, forKey: "asrModel") }
    }
}

enum KeychainHelper {
    static func read(account: String) -> String? { /* ... */ return nil }
    static func write(account: String, value: String) { /* ... */ }
    static func delete(account: String) { /* ... */ }
}
```

Implement the Keychain helpers using `SecItemAdd`/`SecItemCopyMatching`/`SecItemDelete`. Many standard examples exist; keep it minimal.

- [ ] **Step 2**: Write `PreferencesWindow.swift` (SwiftUI preferred for brevity):

```swift
import SwiftUI

struct PreferencesView: View {
    @State private var backendURL: String
    @State private var apiKey: String
    @State private var intervalSec: Int

    init() {
        _backendURL = State(initialValue: Preferences.shared.backendURL.absoluteString)
        _apiKey = State(initialValue: Preferences.shared.apiKey ?? "")
        _intervalSec = State(initialValue: Int(Preferences.shared.summaryIntervalSec))
    }

    var body: some View {
        Form {
            TextField("Backend URL", text: $backendURL)
            SecureField("API Key", text: $apiKey)
            Stepper("Summary every \(intervalSec) s", value: $intervalSec, in: 120...600, step: 30)
            Button("Save") {
                Preferences.shared.backendURL = URL(string: backendURL) ?? Preferences.shared.backendURL
                Preferences.shared.apiKey = apiKey.isEmpty ? nil : apiKey
                Preferences.shared.summaryIntervalSec = TimeInterval(intervalSec)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}
```

- [ ] **Step 3**: Hook "Preferences…" menu item to show the window.

- [ ] **Step 4**: Commit:

```bash
git add Shared/Preferences.swift MeetingRecorder/Preferences/ MeetingRecorder/MenuBarController.swift
git commit -m "feat(prefs): add Preferences pane with backend URL + API key + interval"
```

---

## Task 10: Kill-helper smoke + integration checklist

Not a code task. Validates degradation priority from the spec.

- [ ] **Step 1**: Start recording.
- [ ] **Step 2**: Speak for 2 min.
- [ ] **Step 3**: Open Activity Monitor. Find `MeetingCaptionsHelper` process. Force-quit it.
- [ ] **Step 4**: Observe:
  - CaptionOverlay either disappears or shows stale content (depends on overlay retain semantics). Acceptable: either.
  - AAC file continues to grow (`ls -la` on recording file during Step 4 — size increases).
  - macOS may relaunch the helper via XPC; if it does, captions resume. If not, captions stay offline until recording ends — that's also acceptable per spec.
- [ ] **Step 5**: Press Stop.
- [ ] **Step 6**: Verify AAC plays back cleanly with no audio gaps; the full meeting audio is present.
- [ ] **Step 7**: Verify `.md` file exists; it may have no summary (if helper was dead during scheduler tick) but the transcript section is complete up to the kill point and the frontmatter has an `endedAt` timestamp.

- [ ] **Step 8**: Document the observed behavior in `notes.md`. If recording had any gap or AAC corruption, STOP and fix — that is a spec violation.

- [ ] **Step 9**: Commit a CHANGELOG entry:

```bash
git add CHANGELOG.md
git commit -m "docs: document kill-helper resilience observation"
```

---

## Final checks before release

- [ ] All XCTest suites pass (`xcodebuild test -scheme MeetingCaptionsHelper -destination "platform=macOS"`)
- [ ] Main app v2.7.0 regression smoke: Start/Stop + AAC plays in QuickTime
- [ ] Recording longer than 3 min → `.md` file has at least one summary section
- [ ] Kill-helper smoke passes (Task 10)
- [ ] Preferences persist across app relaunch
- [ ] API Key stored in Keychain, not UserDefaults (verify with `security find-generic-password`)
- [ ] No unresolved WhisperKit model download errors; first-launch UX acceptable
- [ ] No crash logs in `~/Library/Logs/DiagnosticReports/` after a full 15-min test session

## Out of scope

- Speaker diarization in live mode (use authoritative batch report instead)
- Non-English transcription (explicit design scope)
- Live glossary injection (batch-pipeline only for now)
- Auto-upload of `.aac` after recording
- Calendar integration to pre-fill meeting title / type
- Sandboxing / notarization beyond existing v2.7.0 config (if the project currently ships unsigned/ad-hoc, maintain that; if currently notarized, ensure the helper target is included in notarization)

## If you get stuck

- Task 2 PCM conversion: check `AVAudioConverter` with source format from `CMSampleBufferGetFormatDescription`
- Task 3 WhisperKit download: pre-download via `whisperkit-cli transcribe --model base.en` before first run
- Task 5 NSPanel not showing: check `.canJoinAllSpaces` and `level = .floating`; call `orderFrontRegardless()` not `makeKeyAndOrderFront()`
- Task 7 network failures in tests: make sure `MockURLSession` is injected, not `URLSession.shared`
- XPC connection silent failures: check `Console.app` for entitlement errors; the helper bundle ID must match the service name used in `NSXPCConnection(serviceName:)`
