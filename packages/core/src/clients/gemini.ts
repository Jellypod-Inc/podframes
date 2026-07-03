import { GoogleGenAI, Type } from "@google/genai";
import { readFile } from "node:fs/promises";
import { writeBytes } from "../util/fs";

export { Type };

export interface GeminiClientOptions {
  apiKey: string;
}

export interface ImageInput {
  /** Raw image bytes or base64 string. */
  data: Uint8Array | string;
  mimeType?: string;
}

export interface GenerateImageArgs {
  model: string;
  prompt: string;
  /** Reference / source images (for editing or character consistency). */
  images?: ImageInput[];
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
}

const toBase64 = (data: Uint8Array | string): string =>
  typeof data === "string" ? data : Buffer.from(data).toString("base64");

/** Thin, defensive wrapper over @google/genai for podframes' three Gemini stages. */
export class GeminiClient {
  readonly ai: GoogleGenAI;

  constructor(opts: GeminiClientOptions) {
    if (!opts.apiKey) throw new Error("GEMINI_API_KEY is required");
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  /** Plain text generation (script writing, etc.). */
  async generateText(args: {
    model: string;
    contents: string;
    system?: string;
    thinkingLevel?: "minimal" | "low" | "medium" | "high";
    temperature?: number;
  }): Promise<string> {
    const res = await this.ai.models.generateContent({
      model: args.model,
      contents: args.contents,
      config: {
        ...(args.system ? { systemInstruction: args.system } : {}),
        ...(args.temperature != null ? { temperature: args.temperature } : {}),
        ...(args.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: args.thinkingLevel as never } }
          : {}),
      },
    });
    const text = res.text;
    if (!text) throw new Error("Gemini returned no text");
    return text;
  }

  /** Structured JSON generation validated against a responseSchema (Type-based). */
  async generateStructured<T>(args: {
    model: string;
    contents: string;
    system?: string;
    schema: unknown;
    thinkingBudget?: number;
  }): Promise<T> {
    const res = await this.ai.models.generateContent({
      model: args.model,
      contents: args.contents,
      config: {
        ...(args.system ? { systemInstruction: args.system } : {}),
        responseMimeType: "application/json",
        responseSchema: args.schema as never,
        ...(args.thinkingBudget != null
          ? { thinkingConfig: { thinkingBudget: args.thinkingBudget } }
          : {}),
      },
    });
    const text = res.text;
    if (!text) throw new Error("Gemini returned no structured output");
    return JSON.parse(text) as T;
  }

  /** Generate or edit an image (Nano Banana). Returns the first image part. */
  async generateImage(args: GenerateImageArgs): Promise<GeneratedImage> {
    const parts: unknown[] = [{ text: args.prompt }];
    for (const img of args.images ?? []) {
      parts.push({
        inlineData: { mimeType: img.mimeType ?? "image/png", data: toBase64(img.data) },
      });
    }

    const res = await this.ai.models.generateContent({
      model: args.model,
      contents: parts as never,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}),
          ...(args.imageSize ? { imageSize: args.imageSize } : {}),
        },
      } as never,
    });

    const candidateParts = res.candidates?.[0]?.content?.parts ?? [];
    for (const part of candidateParts) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
      if (inline?.data) {
        return {
          bytes: Buffer.from(inline.data, "base64"),
          mimeType: inline.mimeType ?? "image/png",
        };
      }
    }
    throw new Error("Gemini image model returned no image part");
  }

  /** Convenience: generate an image straight to a file. */
  async generateImageToFile(args: GenerateImageArgs & { outputPath: string }): Promise<string> {
    const { bytes } = await this.generateImage(args);
    await writeBytes(args.outputPath, bytes);
    return args.outputPath;
  }

}

/** Read an image file into an {@link ImageInput}. */
export async function imageInputFromFile(path: string): Promise<ImageInput> {
  const bytes = await readFile(path);
  const mimeType = path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  return { data: new Uint8Array(bytes), mimeType };
}
