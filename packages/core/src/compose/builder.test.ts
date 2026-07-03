import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComposition } from "./builder";
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
  const html = buildComposition({
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
  });

  assert.match(
    html,
    /class="seg seg-fallback" src="media\/avatars\/host_a\.png"[^>]+data-start="0" data-duration="3\.9"/,
  );
  assert.match(
    html,
    /class="seg seg-video" src="media\/clips\/turn-0-0\.mp4"[^>]+data-start="0" data-duration="3\.9"/,
  );
});
