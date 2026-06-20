# dash.ts — Learning Book

> **How this book works:** Each chapter maps to a phase of building our DASH player.
> Concepts come *before* code. Every section ends with key takeaways and a "what to test" checklist.
> This file grows as we progress — never overwritten, always appended.

---

## Chapter 0: The Roadmap

### What we're building

A fully functional MPEG-DASH adaptive streaming player written in TypeScript, called **dash.ts**. By the end you will:

- Understand how streaming video actually works at the protocol level
- Have built every layer of the pipeline yourself, from scratch
- Own a portfolio piece with two standout features: **Explainable ABR** and a **Buffer Visualizer**

---

### The 6-Phase Learning Path

```
Phase 1 — Foundations         Concepts: DASH, MPD, segments, MSE, ABR
                               Code:     Project scaffold + EventEmitter + Logger + Player shell

Phase 2 — Parsing             Concepts: MPD XML structure, Periods, AdaptationSets, Representations
                               Code:     MPDParser + full TypeScript type model

Phase 3 — First Bytes on Screen  Concepts: MSE SourceBuffer, init segments, media segments, codec strings
                                   Code:     MSEController + SegmentLoader (fetch + append)

Phase 4 — Smart Buffering     Concepts: buffer starvation, buffer health, fetch scheduling
                               Code:     BufferManager + download pipeline loop

Phase 5 — Adaptive Bitrate    Concepts: bandwidth estimation, EWMA, quality ladders, hysteresis
                               Code:     BandwidthEstimator + ABRController

Phase 6 — Portfolio Features  Concepts: explainability, debug UIs, event-driven visualisation
                               Code:     ABRLogger + BufferVisualizer UI panel
```

Each phase teaches the "why" first, then the "how", then has you test something real in the browser.

---

### Minimum concepts before you write a single line

You need to understand exactly four things before Phase 1 code starts:

1. **What DASH is** — a standard for delivering video in chunks over HTTP
2. **What an MPD is** — an XML manifest that describes those chunks
3. **What MSE is** — a browser API that lets JavaScript feed bytes to a `<video>` element
4. **What ABR is** — the algorithm that picks which quality chunk to download next

All four are explained in Chapter 1 below.

---

## Chapter 1: DASH Fundamentals & Streaming Concepts

### 1.1 The Problem DASH Solves

Before adaptive streaming existed, browsers used **progressive download**:

```
Browser:  GET /video.mp4
Server:   200 OK  [starts streaming the whole file]
Browser:  plays from byte 0 → EOF
```

This works, but has a fatal flaw: the server sends you a **single, fixed quality** file. If you have a fast connection, you get the same quality as someone on a slow connection. If your speed drops mid-video, the buffer empties and you stall.

DASH solves this by breaking the video into **small time-based chunks** and letting the player pick which quality to download for each chunk based on current network conditions.

---

### 1.2 How DASH Works — The Big Picture

```
                  ┌─────────────────────────────────────┐
                  │          DASH Server (CDN)           │
                  │                                     │
                  │  manifest.mpd  ←── describes it all │
                  │                                     │
                  │  video_720p/   init.mp4  seg1.m4s   │
                  │  video_480p/   init.mp4  seg1.m4s   │
                  │  video_360p/   init.mp4  seg1.m4s   │
                  │  audio/        init.mp4  seg1.m4s   │
                  └─────────────────────────────────────┘
                            ↑  HTTP GET  ↑
                  ┌─────────────────────────────────────┐
                  │         dash.ts (our player)         │
                  │                                     │
                  │  1. Fetch manifest.mpd               │
                  │  2. Parse it → find available quals  │
                  │  3. Pick best quality (ABR)           │
                  │  4. Fetch init segment               │
                  │  5. Fetch media segments in a loop   │
                  │  6. Push bytes into <video> via MSE  │
                  └─────────────────────────────────────┘
```

The player is in complete control. It decides what to download and when.

---

### 1.3 The MPD — Media Presentation Description

The MPD is an XML file. Think of it as a **table of contents** for the video. Here's a simplified example:

```xml
<MPD mediaPresentationDuration="PT1M30S">
  <Period>

    <!-- Video tracks (multiple qualities) -->
    <AdaptationSet mimeType="video/mp4" codecs="avc1.640028">
      <Representation id="1" bandwidth="500000"  width="640"  height="360"/>
      <Representation id="2" bandwidth="1500000" width="1280" height="720"/>
      <Representation id="3" bandwidth="4000000" width="1920" height="1080"/>
    </AdaptationSet>

    <!-- Audio track -->
    <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2">
      <Representation id="4" bandwidth="128000"/>
    </AdaptationSet>

  </Period>
</MPD>
```

The hierarchy is:

```
MPD
└── Period          (a chapter of the video, e.g. a live show segment)
    └── AdaptationSet   (a logical stream: "all video tracks" or "all audio tracks")
        └── Representation  (one specific quality/bitrate option)
            └── Segment      (a small time chunk, e.g. 2 seconds of video at that quality)
```

**Key vocabulary:**

| Term | Meaning |
|------|---------|
| **Period** | A contiguous section of the presentation (often just one for VOD) |
| **AdaptationSet** | A group of interchangeable streams (video or audio) |
| **Representation** | One specific encoding: a bitrate + resolution + codec |
| **Segment** | A tiny time-slice of media (typically 2–6 seconds) |
| **Init segment** | A special first segment that contains codec metadata (no actual frames) |
| **Media segment** | A normal segment containing encoded audio/video frames |

---

### 1.4 Segments — What We Actually Download

Each Representation is split into many small files:

```
init.mp4          ← "here is how to decode me" (codec config, no frames)
segment-001.m4s   ← frames 0–2 seconds
segment-002.m4s   ← frames 2–4 seconds
segment-003.m4s   ← frames 4–6 seconds
...
```

> **Why `.m4s`?** These are **fMP4** (fragmented MP4) files. Unlike a regular MP4 that is one big blob, fMP4 segments are independently decodable chunks that can be concatenated. The browser (via MSE) can receive them in real time and start decoding before the full video arrives.

The URL pattern for segments is described in the MPD:
```xml
<SegmentTemplate
  initialization="video_$RepresentationID$/init.mp4"
  media="video_$RepresentationID$/seg_$Number$.m4s"
  startNumber="1"
  duration="180000"
  timescale="90000"
/>
```

`duration / timescale` = `180000 / 90000` = **2 seconds per segment**.

---

### 1.5 Media Source Extensions (MSE)

Normally, you give a `<video>` element a `src` URL and it downloads everything itself. MSE is a browser API that says:

> "Hey browser, I want to feed you the bytes myself, chunk by chunk."

This is how every streaming player works under the hood (Netflix, YouTube, Twitch, Disney+, etc.).

The MSE flow:

```typescript
// 1. Create a MediaSource object and wire it to the <video> element
const mediaSource = new MediaSource();
video.src = URL.createObjectURL(mediaSource);

// 2. When the MediaSource is ready, add a SourceBuffer for video
mediaSource.addEventListener('sourceopen', () => {
  const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.640028"');

  // 3. Fetch the init segment and append it
  const initData = await fetch('video_720p/init.mp4').then(r => r.arrayBuffer());
  sourceBuffer.appendBuffer(initData);

  // 4. Fetch media segments and keep appending them
  const seg1 = await fetch('video_720p/seg_1.m4s').then(r => r.arrayBuffer());
  sourceBuffer.appendBuffer(seg1);
  // ... and so on
});
```

The `<video>` element sees a continuous stream of bytes and plays them — it has no idea they came from separate HTTP requests.

**MSE key concepts:**

| Concept | What it means |
|---------|--------------|
| `MediaSource` | The coordinator that manages SourceBuffers |
| `SourceBuffer` | A queue that you append bytes into (one per track: video, audio) |
| `appendBuffer()` | Push an ArrayBuffer of media data |
| `buffered` | A TimeRange showing what's currently buffered |
| `updateend` event | Fires when the SourceBuffer finishes processing an append |

> ⚠️ **Critical rule:** You can only call `appendBuffer()` when the SourceBuffer is not already processing (i.e., `sourceBuffer.updating === false`). We'll build a queue system to handle this.

---

### 1.6 Adaptive Bitrate (ABR) — The Heart of the Player

ABR is the algorithm that answers: **"For the next segment, which Representation (quality) should I download?"**

The simplest approach is bandwidth-based:

```
estimated_bandwidth = bytes_downloaded / time_taken

if estimated_bandwidth > rep.bandwidth * 1.2:
    upgrade to higher quality
elif estimated_bandwidth < rep.bandwidth * 0.8:
    downgrade to lower quality
```

But a real ABR also considers **buffer health**: if the buffer is nearly empty, play it safe and download the lowest quality. If the buffer is full, it's safe to try a higher quality.

```
                    Buffer Health (seconds ahead)
High  ┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      ┃         ↑ safe to upgrade
      ┃
Med   ┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      ┃         ↑ stay at current
      ┃
Low   ┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      ┃         ↑ emergency: lowest quality
      ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          360p    480p   720p  1080p
```

We'll implement this incrementally — starting with the dumbest possible ABR (always pick lowest quality) and refining it in Phase 5.

---

### 1.7 The Streaming Pipeline — End to End

Here is the full mental model for what our player does every second:

```
┌─────────────────────────────────────────────────────────────────┐
│                       STREAMING LOOP                            │
│                                                                 │
│  1. Check buffer: how many seconds are buffered ahead?          │
│     → if > 30s: sleep, we have enough                           │
│     → if < 30s: we need to download the next segment            │
│                                                                 │
│  2. Ask ABR: which Representation (quality) should I use?       │
│     → ABR looks at bandwidth + buffer health → picks quality    │
│                                                                 │
│  3. Build the URL for the next segment of that Representation   │
│                                                                 │
│  4. Fetch the segment (measure time for bandwidth estimate)     │
│                                                                 │
│  5. Append to SourceBuffer via MSE                              │
│                                                                 │
│  6. Repeat from step 1                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.8 Chapter 1 — Architecture Preview

We're introducing only the modules needed right now:

```
src/
├── utils/
│   ├── EventEmitter.ts   ← typed pub/sub, everything talks through this
│   └── Logger.ts         ← namespaced console logger
└── player/
    └── Player.ts         ← wraps <video>, owns the MediaSource lifecycle
```

We are deliberately **not** touching MPD parsing, SegmentLoader, or ABR yet. Those come in later chapters. Getting the foundation right first makes everything else cleaner.

---

### 1.9 Why EventEmitter First?

In a streaming player, many things happen asynchronously and independently:
- The network reports a new bandwidth estimate
- The buffer reports it's running low
- The video element reports it stalled
- The ABR wants to switch quality

Rather than passing callbacks everywhere and creating tight coupling, we use an **event bus**: each module fires events, and any other module can listen. This is the same pattern used in dash.js, Shaka Player, and hls.js.

```typescript
// Without EventEmitter: tight coupling
bufferManager.onLow = () => abrController.downgrade();

// With EventEmitter: loose coupling
emitter.on('buffer:low', () => abrController.downgrade());
emitter.on('buffer:low', () => logger.warn('Buffer is low!'));
emitter.on('buffer:low', () => ui.showSpinner());
// Each listener is independent — BufferManager doesn't know about any of them
```

---

### ✅ Chapter 1 Key Takeaways

| Concept | One-line summary |
|---------|-----------------|
| DASH | HTTP-based adaptive streaming: video split into chunks, player picks quality |
| MPD | XML manifest describing all available qualities, periods, and segment URLs |
| Segment | A small time-slice of media (init segment + media segments in fMP4 format) |
| MSE | Browser API letting JS feed bytes to `<video>` without a single `src` URL |
| SourceBuffer | The MSE queue you `appendBuffer()` into |
| ABR | Algorithm that picks quality based on bandwidth + buffer health |
| EventEmitter | Decoupled pub/sub so modules don't directly reference each other |

---

### 📌 What to observe after Chapter 1 implementation

1. Open the browser dev tools → **Console** tab
2. You should see Logger output from the Player initializing
3. Open **Application → Media** (Chrome) or the **Media** panel — you'll see the MediaSource attached but with no buffered data yet (that's Phase 3)
4. Try emitting a custom event and listening to it — confirm the EventEmitter types work correctly

---

*Next: Chapter 2 — Parsing the MPD (XML → TypeScript types → usable manifest object)*

---
