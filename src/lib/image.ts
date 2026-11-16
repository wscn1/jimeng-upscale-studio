export const MAX_BYTES = 4.7 * 1024 * 1024;
export const MAX_SIDE = 4096;
export const MIN_RATIO = 1 / 3;
export const MAX_RATIO = 3;

type Prep = {
  file: File;
  width: number;
  height: number;
  notes: string[];
};

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function isSupported(file: File) {
  if (file.type === "image/jpeg" || file.type === "image/png") return true;
  return /\.(jpe?g|png)$/i.test(file.name);
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error("图片解码失败（可能是 HEIC/WebP 或文件已损坏），请转为 JPEG/PNG");
  }
}

function drawToBlob(
  bitmap: ImageBitmap,
  crop: { x: number; y: number; width: number; height: number },
  outWidth: number,
  outHeight: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(outWidth));
  canvas.height = Math.max(1, Math.round(outHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas，无法压缩图片");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
      "image/jpeg",
      quality,
    );
  });
}

/**
 * 把输入图收敛到接口允许的范围内：
 * JPEG/PNG、≤4.7MB、长边 ≤4096、宽高比 1:3 ~ 3:1。
 * 已经合规的图片会原样返回，不做任何重编码。
 */
export async function prepareImage(file: File): Promise<Prep> {
  if (!isSupported(file)) {
    throw new Error("仅支持 JPEG / PNG 格式");
  }

  const bitmap = await loadBitmap(file);
  const originW = bitmap.width;
  const originH = bitmap.height;
  const notes: string[] = [];

  const ratio = originW / originH;
  let crop = { x: 0, y: 0, width: originW, height: originH };

  if (ratio > MAX_RATIO) {
    crop.width = Math.round(originH * MAX_RATIO);
    crop.x = Math.round((originW - crop.width) / 2);
    notes.push("已居中裁切至 3:1");
  } else if (ratio < MIN_RATIO) {
    crop.height = Math.round(originW / MIN_RATIO);
    crop.y = Math.round((originH - crop.height) / 2);
    notes.push("已居中裁切至 1:3");
  }

  const cropped = crop.width !== originW || crop.height !== originH;
  const needDownscale = Math.max(crop.width, crop.height) > MAX_SIDE;
  const needShrink = file.size > MAX_BYTES;

  if (!cropped && !needDownscale && !needShrink) {
    bitmap.close();
    return { file, width: originW, height: originH, notes };
  }

  let outW = crop.width;
  let outH = crop.height;
  if (needDownscale) {
    const k = MAX_SIDE / Math.max(outW, outH);
    outW = Math.round(outW * k);
    outH = Math.round(outH * k);
    notes.push(`已压缩到 ${outW}×${outH}`);
  }

  let blob: Blob | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const quality of [0.92, 0.85, 0.78, 0.7, 0.62]) {
      const candidate = await drawToBlob(bitmap, crop, outW, outH, quality);
      if (!blob || candidate.size < blob.size) blob = candidate;
      if (candidate.size <= MAX_BYTES) {
        blob = candidate;
        break;
      }
    }
    if (blob && blob.size <= MAX_BYTES) break;
    outW = Math.round(outW * 0.85);
    outH = Math.round(outH * 0.85);
  }

  bitmap.close();

  if (!blob) throw new Error("图片压缩失败");
  if (blob.size > MAX_BYTES) {
    throw new Error("图片体积过大，压缩后仍超过 4.7MB，请先手动缩小");
  }

  const needsJpeg = cropped || needDownscale || needShrink;
  if (needsJpeg && file.type === "image/png") {
    notes.push("已转为 JPEG 以控制体积");
  }

  return {
    file: new File([blob], `${stripExt(file.name)}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    }),
    width: outW,
    height: outH,
    notes,
  };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
