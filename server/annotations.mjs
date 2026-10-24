import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config.mjs";

const ANNOTATIONS_DIR = path.join(DATA_DIR, "annotations");
const MAX_ANNOTATION_BYTES = 12 * 1024 * 1024;

function fileNameFor(fingerprint) {
  const digest = createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);
  return `${digest}.json`;
}

function filePathFor(fingerprint) {
  return path.join(ANNOTATIONS_DIR, fileNameFor(fingerprint));
}

function validateFingerprint(fingerprint) {
  if (typeof fingerprint !== "string" || !fingerprint.trim()) {
    throw Object.assign(new Error("缺少 PDF 指纹"), { status: 400 });
  }
  if (fingerprint.length > 256) {
    throw Object.assign(new Error("PDF 指纹过长"), { status: 400 });
  }
  return fingerprint;
}

function validateAnnotations(annotations) {
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    throw Object.assign(new Error("批注数据格式不正确"), { status: 400 });
  }
  let serialized;
  try {
    serialized = JSON.stringify(annotations);
  } catch {
    throw Object.assign(new Error("批注数据无法序列化"), { status: 400 });
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_ANNOTATION_BYTES) {
    throw Object.assign(new Error("批注数据过大"), { status: 413 });
  }
  return serialized;
}

export async function readAnnotations(fingerprint) {
  const filePath = filePathFor(validateFingerprint(fingerprint));
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.annotations) {
      throw new Error("invalid annotation file");
    }
    return {
      annotations: parsed.annotations,
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    console.warn("[annotations] 无法读取：", error.message);
    return null;
  }
}

export async function writeAnnotations(fingerprint, annotations) {
  const safeFingerprint = validateFingerprint(fingerprint);
  const serialized = validateAnnotations(annotations);
  const filePath = filePathFor(safeFingerprint);
  const savedAt = Date.now();

  await fs.mkdir(ANNOTATIONS_DIR, { recursive: true });

  if (Object.keys(annotations).length === 0) {
    await fs.rm(filePath, { force: true });
    return { savedAt, empty: true };
  }

  const tempPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const payload = JSON.stringify({
    version: 1,
    fingerprint: safeFingerprint,
    savedAt,
    annotations: JSON.parse(serialized),
  });
  await fs.writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
  return { savedAt, empty: false };
}
