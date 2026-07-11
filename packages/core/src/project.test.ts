import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "./project";
import type { ConversationConfig } from "./types";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("Project.delete removes the project directory and all nested artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-delete-"));
  const dir = join(root, "projects", "demo");
  await mkdir(join(dir, "audio"), { recursive: true });
  await mkdir(join(dir, "clips"), { recursive: true });
  await mkdir(join(dir, "composition", "media", "clips"), { recursive: true });
  await writeFile(join(dir, "project.json"), "{}");
  await writeFile(join(dir, "audio", "conversation.mp3"), "audio");
  await writeFile(join(dir, "clips", "turn-0-0.mp4"), "clip");
  await writeFile(join(dir, "composition", "media", "clips", "turn-0-0.mp4"), "linked clip");
  await writeFile(join(dir, "output.mp4"), "render");

  assert.equal(await Project.delete(root, "demo"), true);
  assert.equal(await exists(dir), false);
});

test("Project.delete ignores directories without project.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-delete-"));
  const dir = join(root, "projects", "_roster");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "avatar.png"), "shared cache");

  assert.equal(await Project.delete(root, "_roster"), false);
  assert.equal(await exists(dir), true);
});

test("Project.load refuses an outdated schemaVersion (clean cutover, no migration)", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-schema-"));
  const config: ConversationConfig = {
    topic: "Old schema refusal",
    hosts: [
      {
        id: "host_a",
        name: "Ada",
        speaker: "HOST_A",
        model: "google/gemini-3.1-flash-tts-preview",
        voice: "Aoede",
        side: "left",
      },
      {
        id: "host_b",
        name: "Theo",
        speaker: "HOST_B",
        model: "google/gemini-3.1-flash-tts-preview",
        voice: "Puck",
        side: "right",
      },
    ],
  };
  const project = await Project.create(config, root, "old-schema");
  // Simulate a project written by an older release: legacy shape + old version.
  project.state.schemaVersion = 2 as never;
  project.state.stills = {
    hosts: { host_a: { idlePath: "stills/host_a-idle.png" } },
  } as never;
  await project.save();

  await assert.rejects(
    () => Project.load(root, "old-schema"),
    /unsupported project\.json schema.*found 2/,
  );
});

test("Project.load fills new non-breaking option defaults on an existing schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-defaults-"));
  const config: ConversationConfig = {
    topic: "Keep old projects opening",
    hosts: [
      { id: "host_a", name: "Ada", speaker: "HOST_A", model: "google/model", voice: "Aoede", side: "left" },
      { id: "host_b", name: "Theo", speaker: "HOST_B", model: "google/model", voice: "Puck", side: "right" },
    ],
  };
  const project = await Project.create(config, root, "defaults");
  delete (project.state.options as Partial<typeof project.state.options>).visualTreatment;
  await project.save();

  const loaded = await Project.load(root, "defaults");
  assert.equal(loaded?.state.options.visualTreatment, "minimal");
});
