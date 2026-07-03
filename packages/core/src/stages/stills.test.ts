import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "../project";
import { Reporter } from "../util/events";
import { runStills } from "./stills";
import type { ConversationConfig, Host } from "../types";
import type { GeminiClient } from "../clients/gemini";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function host(id: string, name: string, side: "left" | "right"): Host {
  return {
    id,
    name,
    speaker: id === "host_a" ? "HOST_A" : "HOST_B",
    model: "google/gemini-3.1-flash-tts-preview",
    voice: id === "host_a" ? "Aoede" : "Puck",
    side,
    appearance: `${name} test host`,
  };
}

test("runStills uses uploaded/base avatars directly without generating variants", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-stills-"));
  const config: ConversationConfig = {
    topic: "Base avatar passthrough",
    hosts: [host("host_a", "Ada", "left"), host("host_b", "Theo", "right")],
  };
  const project = await Project.create(config, root, "base-avatar-passthrough");
  project.state.uploads = {
    host_a: "stills/host_a-base.png",
    host_b: "stills/host_b-base.png",
  };
  // The referenced files must EXIST — the stage preflights them and fails
  // loudly otherwise (instead of a raw ffmpeg ENOENT three stages later).
  await mkdir(project.path("stills"), { recursive: true });
  await writeFile(project.path("stills", "host_a-base.png"), "png");
  await writeFile(project.path("stills", "host_b-base.png"), "png");

  const gemini = {
    generateImageToFile: async () => {
      throw new Error("Gemini should not be called for uploaded/base avatars");
    },
  } as unknown as GeminiClient;

  await runStills({ project, gemini, env: {}, reporter: new Reporter({ console: false }) });

  assert.deepEqual(project.state.stills?.hosts.host_a, {
    imagePath: "stills/host_a-base.png",
  });
  assert.deepEqual(project.state.stills?.hosts.host_b, {
    imagePath: "stills/host_b-base.png",
  });
  assert.equal(await exists(project.path("stills", "two-shot.png")), false);
  assert.equal(await exists(project.path("stills", "host_a-idle.png")), false);
  assert.equal(await exists(project.path("stills", "host_a-speaking.png")), false);
  assert.equal(await exists(project.path("stills", "host_a-avatar.png")), false);
});

test("runStills fails loudly when a referenced avatar image is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "podframes-stills-"));
  const config: ConversationConfig = {
    topic: "Missing avatar preflight",
    hosts: [host("host_a", "Ada", "left"), host("host_b", "Theo", "right")],
  };
  const project = await Project.create(config, root, "missing-avatar");
  project.state.uploads = { host_a: "stills/host_a-base.png" }; // file never created

  const gemini = {
    generateImageToFile: async () => {
      throw new Error("Gemini should not be called for uploaded/base avatars");
    },
  } as unknown as GeminiClient;

  await assert.rejects(
    () => runStills({ project, gemini, env: {}, reporter: new Reporter({ console: false }) }),
    /avatar image missing for Ada.*re-pick the face/,
  );
});
