# Mail signals hero video

Original Canvas motion graphics for SendMailOS. This is a symbolic illustration of email requests, routing and delivered messages, not a recording of live sends or customer activity. No external imagery, model service, API credentials or real email infrastructure is involved.

`scene.html` draws deterministic frames of a twelve-second loop at 1280 × 720. Packet envelopes and light bits travel real cubic paths. API hardware, routed branches and message cards occupy the right side; the left 44 percent remains a quiet navy surface for the website heading.

Render from the LumaSite directory:

```sh
node marketing/video/render.mjs
```

The script uses the project's Playwright browser and local FFmpeg (`FFMPEG_PATH` can override its path). It streams 360 PNG frames directly into H.264 encoding at 30fps, CRF19, yuv420p, no audio and faststart. Output assets and machine-readable provenance are written under `marketing/assets/`.

All motion uses integer multiples of the twelve-second period. Rendering frame360 produces the same pixels as frame0, making the loop seamless. Delivery labels are illustrative; a real `202 Accepted` APIresponse means accepted for processing and is not itself a delivery confirmation.
