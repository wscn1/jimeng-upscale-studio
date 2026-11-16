import { LIMITS } from "./volc.ts";

export type ImageKind = "jpeg" | "png";

/** 用文件头判断真实格式，不信任客户端给的 MIME */
export function detectImage(buffer: Buffer): ImageKind | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length > 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  return null;
}

export function extOf(kind: ImageKind): string {
  return kind === "png" ? "png" : "jpg";
}

export function assertUpload(buffer: Buffer): ImageKind {
  const kind = detectImage(buffer);
  if (!kind) {
    throw new Error("仅支持 JPEG / PNG 格式");
  }
  if (buffer.length > LIMITS.maxBytes) {
    const mb = (buffer.length / 1024 / 1024).toFixed(2);
    throw new Error(`图片体积 ${mb}MB 超过 4.7MB 上限，请先压缩或降低分辨率`);
  }
  return kind;
}

/** 读 PNG 尺寸（IHDR），仅用于 Mock 场景下的结果展示 */
export function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (detectImage(buffer) !== "png" || buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
