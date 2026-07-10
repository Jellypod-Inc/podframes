import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComposition, type BuildInput } from "./builder";
import { buildTrimmedTimeline, mapSourceTimeToTrimmed } from "./trim";

test("buildTrimmedTimeline removes clip time from the audio timeline", () => {
  const timeline = buildTrimmedTimeline(
    [
      {
        turnIndex: 0,
        hostId: "host_a",
        speaker: "HOST_A",
        start: 0,
        end: 5,
        text: "hello there",
        words: [{ text: "hello", start: 1, end: 2, turnIndex: 0 }],
        segments: [{ audioPath: "audio/turn-0-0.mp3", durationSec: 5 }],
        mediaType: "audio/mpeg",
        durationSec: 5,
      },
    ],
    [
      {
        id: "turn-0-0",
        role: "avatar",
        hostId: "host_a",
        turnIndex: 0,
        segIndex: 0,
        path: "video/turn-0-0.mp4",
        durationSec: 5,
        trimStartSec: 0.4,
        trimEndSec: 0.7,
        sourceImage: "avatars/host_a.png",
      },
    ],
  );

  assert.equal(timeline.durationSec, 3.9);
  assert.equal(timeline.turns[0]!.end, 3.9);
  assert.equal(timeline.turns[0]!.segments[0]!.durationSec, 3.9);
  assert.deepEqual(timeline.turns[0]!.words[0], { text: "hello", start: 0.6, end: 1.6, turnIndex: 0 });
  assert.equal(mapSourceTimeToTrimmed(timeline.segments, 2), 1.6);
});

test("buildComposition tiles already-trimmed clips on the shortened audio window", () => {
  const input: BuildInput = {
    width: 1280,
    height: 720,
    fps: 30,
    title: "Trim test",
    hook: "Trim the weird tail",
    topic: "clip trims",
    durationSec: 3.9,
    audioSrc: "media/audio.mp3",
    fonts: [],
    hosts: [
      { id: "host_a", name: "Ada", speaker: "HOST_A", model: "google/model", voice: "Aoede", side: "left" },
      { id: "host_b", name: "Theo", speaker: "HOST_B", model: "elevenlabs/model", voice: "Warren", side: "right" },
    ],
    clips: [
      {
        id: "turn-0-0",
        role: "avatar",
        hostId: "host_a",
        turnIndex: 0,
        segIndex: 0,
        src: "media/clips/turn-0-0.mp4",
        durationSec: 3.9,
      },
    ],
    turns: [
      {
        turnIndex: 0,
        hostId: "host_a",
        speaker: "HOST_A",
        start: 0,
        end: 3.9,
        text: "hello",
        words: [],
        segments: [{ audioPath: "audio/turn-0-0.mp3", durationSec: 3.9 }],
        mediaType: "audio/mpeg",
        durationSec: 3.9,
      },
    ],
    captions: [],
    cues: [],
    hostAvatars: { host_a: "media/avatars/host_a.png" },
    captionStyle: "clean",
    captionColor: "#22D3EE",
  };
  const html = buildComposition(input);

  assert.match(
    html,
    /class="clip seg seg-fallback" src="media\/avatars\/host_a\.png"[^>]+data-start="0" data-duration="3\.9" data-track-index="1"/,
  );
  assert.match(
    html,
    /class="clip seg seg-video" src="media\/clips\/turn-0-0\.mp4"[^>]+data-start="0" data-duration="3\.9" data-track-index="0"/,
  );
  assert.doesNotMatch(html, /id="episode-open"/);

  const cinematic = buildComposition({ ...input, visualTreatment: "cinematic" });
  assert.match(cinematic, /id="episode-open"[^>]+treatment-cinematic/);
  assert.doesNotMatch(cinematic, /PODFRAMES \/|EDITORIAL CUT|CINEMATIC CUT|STORY ROUTED/);
});

test("buildComposition keeps multi-segment tracks exactly contiguous (no authored gaps)", () => {
  const input: BuildInput = {
    width: 1280,
    height: 720,
    fps: 30,
    title: "Seam test",
    hook: "No poster flashes at seams",
    topic: "gapless tiling",
    durationSec: 8,
    audioSrc: "media/audio.mp3",
    fonts: [],
    hosts: [
      { id: "host_a", name: "Ada", speaker: "HOST_A", model: "google/model", voice: "Aoede", side: "left" },
      { id: "host_b", name: "Theo", speaker: "HOST_B", model: "elevenlabs/model", voice: "Warren", side: "right" },
    ],
    clips: [
      { id: "turn-0-0", role: "avatar", hostId: "host_a", turnIndex: 0, segIndex: 0, src: "media/clips/turn-0-0.mp4", durationSec: 3.9 },
      { id: "turn-1-0", role: "avatar", hostId: "host_b", turnIndex: 1, segIndex: 0, src: "media/clips/turn-1-0.mp4", durationSec: 4.1 },
    ],
    turns: [
      {
        turnIndex: 0,
        hostId: "host_a",
        speaker: "HOST_A",
        start: 0,
        end: 3.9,
        text: "hello",
        words: [],
        segments: [{ audioPath: "audio/turn-0-0.mp3", durationSec: 3.9 }],
        mediaType: "audio/mpeg",
        durationSec: 3.9,
      },
      {
        turnIndex: 1,
        hostId: "host_b",
        speaker: "HOST_B",
        start: 3.9,
        end: 8,
        text: "hi there",
        words: [],
        segments: [{ audioPath: "audio/turn-1-0.mp3", durationSec: 4.1 }],
        mediaType: "audio/mpeg",
        durationSec: 4.1,
      },
    ],
    captions: [
      { id: "cg-0", hostId: "host_a", start: 0.4, end: 2.1, words: [{ text: "hello", start: 0.4, end: 2.1 }], text: "hello" },
      { id: "cg-1", hostId: "host_b", start: 4.2, end: 6, words: [{ text: "hi", start: 4.2, end: 6 }], text: "hi" },
    ],
    cues: [],
    hostAvatars: { host_a: "media/avatars/host_a.png", host_b: "media/avatars/host_b.png" },
    captionStyle: "clean",
    captionColor: "#22D3EE",
  };
  const html = buildComposition(input);

  // Interior tiles keep their FULL authored duration on both tracks — a shaved
  // epsilon would open a real gap where neither the clip nor its fallback is
  // visible and the base poster (host A's face) flashes mid host-B turn.
  assert.match(html, /turn-0-0\.mp4"[^>]+data-start="0" data-duration="3\.9" data-track-index="0"/);
  assert.match(html, /turn-1-0\.mp4"[^>]+data-start="3\.9" data-duration="4\.1" data-track-index="0"/);
  assert.match(html, /host_a\.png"[^>]+data-start="0" data-duration="3\.9" data-track-index="1"/);
  assert.match(html, /host_b\.png"[^>]+data-start="3\.9" data-duration="4\.1" data-track-index="1"/);

  // Minimal never opts anything out of the layout audit's occlusion check.
  assert.doesNotMatch(html, /data-layout-allow-occlusion/);

  // Rich treatments flag ONLY the elements the cold-open slate covers: the
  // caption inside the intro window gets the opt-out, the later one keeps the guard.
  const editorial = buildComposition({ ...input, visualTreatment: "editorial" });
  assert.match(editorial, /id="cg-0"[^>]*data-layout-allow-occlusion/);
  assert.doesNotMatch(editorial, /id="cg-1"[^>]*data-layout-allow-occlusion/);
});
