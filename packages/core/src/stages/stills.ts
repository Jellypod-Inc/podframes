import { fileExists } from "../util/fs";
import type { GeminiClient } from "../clients/gemini";
import type { Project } from "../project";
import type { StageContext } from "./context";
import type { AvatarImagesArtifact, Host, HostAvatarImage } from "../types";

/** A shared "set bible" so every still and clip lives in the same studio. */
function studioBible(aspect: string): string {
  return [
    "Setting: a modern podcast studio set with dark charcoal acoustic foam panels,",
    "subtle electric-cyan rim lighting, a wooden table with two professional broadcast",
    "microphones on boom arms, soft neutral key light, natural depth of field.",
    "Style: photorealistic, premium, editorial. Neutral expressions unless stated.",
    `Framing: ${aspect} aspect ratio, eye-level, stable neutral podcast camera.`,
  ].join(" ");
}

function describeHost(h: Host): string {
  return `the ${h.side} host (${h.name}): ${h.appearance ?? "a podcast host"}`;
}

function neutralHostPrompt(h: Host, bible: string): string {
  return [
    `Single-host neutral talking-head portrait of ${describeHost(h)}. ${bible}`,
    "Plain chest-up framing, eye-level, seated at the microphone, facing the camera.",
    "Neutral relaxed pose, mouth closed, hands resting still or out of frame.",
    "Do not zoom out, do not make a tight close-up, do not change camera angle, do not add hand gestures.",
    "No on-screen text.",
  ].join(" ");
}

export async function runStills(ctx: StageContext): Promise<void> {
  const { project, gemini, reporter } = ctx;
  const log = reporter.stage("stills");
  const { config, options } = project.state;
  const aspect = config.aspectRatio ?? "16:9";

  if (project.state.stills && project.stageDone("stills")) {
    log.info("cached");
    return;
  }

  const bible = studioBible(aspect);
  const uploads = project.state.uploads ?? {};
  // Match the generation size to what the video stage actually consumes: 720p
  // renders downscale a 2K still immediately, so 1K is free money saved.
  const imageSize = options.videoResolution === "1080p" ? "2K" : "1K";

  // Per-host base avatar images. A host with an uploaded/base reference uses
  // that exact image as the first frame the video stage animates. Text-only
  // hosts get one neutral generated avatar image.
  const hosts: AvatarImagesArtifact["hosts"] = {};
  let generated = 0;
  await Promise.all(
    config.hosts.map(async (h) => {
      const uploaded = uploads[h.id];

      let imageRel: string;
      if (uploaded) {
        // Fail HERE with an actionable message, not as a raw ffmpeg/link ENOENT
        // three stages later — the referenced file can be missing when a roster
        // sync failed or the file was removed out-of-band.
        if (!fileExists(project.abs(uploaded))) {
          throw new Error(
            `avatar image missing for ${h.name}: ${uploaded} — re-pick the face (or re-upload) in Step 1`,
          );
        }
        imageRel = uploaded;
      } else {
        const imagePath = project.path("stills", `${h.id}-avatar.png`);
        if (!fileExists(imagePath)) {
          log.info(`generating ${h.name} base avatar`);
          await gemini.generateImageToFile({
            model: options.imageModel,
            prompt: neutralHostPrompt(h, bible),
            aspectRatio: aspect,
            imageSize,
            outputPath: imagePath,
          });
          generated++;
        }
        imageRel = project.rel(imagePath);
      }

      hosts[h.id] = { imagePath: imageRel };
    }),
  );

  project.state.stills = { hosts };
  project.markDone("stills", { images: generated, uploaded: Object.keys(uploads).length });
  await project.save();
  log.success(`base avatars ready (${generated} generated, ${Object.keys(uploads).length} uploaded)`);
}

/**
 * Regenerate ONE host's base avatar independently. The web studio no longer uses
 * this for roster hosts; it exists for API/CLI callers that only provide text.
 * Mutates `project.state.stills` but does NOT save or invalidate downstream.
 */
export async function castHost(project: Project, gemini: GeminiClient, hostId: string): Promise<HostAvatarImage> {
  const { config, options } = project.state;
  const aspect = config.aspectRatio ?? "16:9";
  const host = config.hosts.find((h) => h.id === hostId);
  if (!host) throw new Error(`unknown host: ${hostId}`);

  const bible = studioBible(aspect);
  const imageSize = options.videoResolution === "1080p" ? "2K" : "1K";
  const uploaded = project.state.uploads?.[hostId];

  let imageRel: string;
  if (uploaded) {
    imageRel = uploaded;
  } else {
    const imagePath = project.path("stills", `${hostId}-avatar.png`);
    await gemini.generateImageToFile({
      model: options.imageModel,
      prompt: neutralHostPrompt(host, bible),
      aspectRatio: aspect,
      imageSize,
      outputPath: imagePath,
    });
    imageRel = project.rel(imagePath);
  }

  const avatar: HostAvatarImage = { imagePath: imageRel };
  project.state.stills = project.state.stills ?? { hosts: {} };
  project.state.stills.hosts[hostId] = avatar;
  return avatar;
}
