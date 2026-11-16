import "dotenv/config";
import express from "express";
import multer from "multer";
import archiver from "archiver";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getTask, hasCredentials, submitTask, useMock, LIMITS, VolcError } from "./volc.ts";
import { assertUpload, extOf } from "./image.ts";
import {
  getTaskRecord,
  patchTaskRecord,
  putTaskRecord,
  resultExists,
  resultPath,
  saveResult,
  type TaskRecord,
} from "./store.ts";

const PORT = Number(process.env.API_PORT || 8787);
const MOCK = useMock();

const app = express();
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

function publicTask(record: TaskRecord) {
  return {
    taskId: record.taskId,
    fileName: record.fileName,
    resolution: record.resolution,
    scale: record.scale,
    status: record.status,
    mock: record.mock,
    error: record.error,
    retryable: record.retryable,
    elapsedMs: Date.now() - record.submittedAt,
    resultUrl: record.resultFile ? `/files/${record.resultFile}` : undefined,
  };
}

function fail(res: express.Response, error: unknown) {
  if (error instanceof VolcError) {
    return res.status(error.code === 401 ? 401 : 502).json({
      error: error.message,
      code: error.code,
      retryable: error.retryable,
    });
  }
  // fetch 抛出的 TypeError 属于网络层抖动（连接中断/超时），远端任务通常还在跑
  if (error instanceof TypeError) {
    return res.status(502).json({ error: "网络请求失败（上游连接中断），稍后重试", retryable: true });
  }
  const message = error instanceof Error ? error.message : String(error);
  return res.status(400).json({ error: message, retryable: false });
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`下载结果图失败（HTTP ${res.status}）`);
  return Buffer.from(await res.arrayBuffer());
}

app.get("/api/health", (_req, res) => {
  res.json({
    mock: MOCK,
    hasCredentials: hasCredentials(),
    maxBytes: LIMITS.maxBytes,
    maxSide: LIMITS.maxSide,
    minRatio: LIMITS.minRatio,
    maxRatio: LIMITS.maxRatio,
  });
});

// 提交任务：前端逐张上传，直接交给火山换 task_id
app.post("/api/tasks", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) throw new Error("没有收到图片文件");

    const kind = assertUpload(req.file.buffer);
    const resolution = req.body.resolution === "8k" ? "8k" : "4k";
    const rawScale = Number(req.body.scale ?? 50);
    const scale = Number.isFinite(rawScale)
      ? Math.min(100, Math.max(0, Math.round(rawScale)))
      : 50;

    let taskId = "";
    if (MOCK) {
      taskId = `mock_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    } else {
      taskId = await submitTask({
        base64: req.file.buffer.toString("base64"),
        resolution,
        scale,
      });
    }

    const record: TaskRecord = {
      taskId,
      fileName: req.file.originalname || "image",
      resolution,
      scale,
      status: "in_queue",
      submittedAt: Date.now(),
      updatedAt: Date.now(),
      mock: MOCK,
    };

    // Mock 直接把输入图当结果存下来，保证 UI 全链路可用
    if (MOCK) {
      record.resultFile = saveResult(taskId, req.file.buffer, extOf(kind));
    }

    putTaskRecord(record);
    res.json(publicTask(record));
  } catch (error) {
    fail(res, error);
  }
});

// 轮询任务：done 时立刻把结果图落盘，规避 24h 链接过期
app.get("/api/tasks/:taskId", async (req, res) => {
  const record = getTaskRecord(req.params.taskId);
  if (!record) {
    return res.status(404).json({ error: "任务不存在（本地记录已丢失，请重新提交）" });
  }
  if (record.status === "done" || record.status === "failed") {
    return res.json(publicTask(record));
  }

  try {
    if (record.mock) {
      const elapsed = Date.now() - record.submittedAt;
      if (elapsed < 3500) {
        patchTaskRecord(record.taskId, { status: "generating" });
      } else {
        patchTaskRecord(record.taskId, { status: "done" });
      }
      return res.json(publicTask(getTaskRecord(record.taskId)!));
    }

    const remote = await getTask(record.taskId);
    if (remote.status === "not_found" || remote.status === "expired") {
      patchTaskRecord(record.taskId, {
        status: "failed",
        retryable: false,
        error:
          remote.status === "expired"
            ? "任务已过期，请重新提交"
            : "任务不存在或已过期（接口仅保留 12 小时）",
      });
      return res.json(publicTask(getTaskRecord(record.taskId)!));
    }

    if (remote.status === "done") {
      if (!remote.imageUrl) throw new Error("任务已完成但没有返回图片链接");
      const buffer = await download(remote.imageUrl);
      const fileName = saveResult(record.taskId, buffer, "png");
      patchTaskRecord(record.taskId, { status: "done", resultFile: fileName });
      return res.json(publicTask(getTaskRecord(record.taskId)!));
    }

    patchTaskRecord(record.taskId, { status: remote.status });
    res.json(publicTask(getTaskRecord(record.taskId)!));
  } catch (error) {
    fail(res, error);
  }
});

// 多选打包下载
app.post("/api/zip", (req, res) => {
  const ids: string[] = Array.isArray(req.body?.taskIds) ? req.body.taskIds : [];
  const records = ids
    .map((id) => getTaskRecord(id))
    .filter(
      (r): r is TaskRecord =>
        Boolean(r && r.status === "done" && r.resultFile && resultExists(r.resultFile)),
    );

  if (!records.length) {
    return res.status(400).json({ error: "没有可打包的结果" });
  }

  res.attachment(`jimeng_upscale_${Date.now()}.zip`);
  const zip = archiver("zip", { zlib: { level: 6 } });
  zip.on("error", (err) => {
    console.error("[zip]", err);
    res.destroy();
  });
  zip.pipe(res);

  for (const record of records) {
    const ext = path.extname(record.resultFile!);
    const base = path.basename(record.fileName, path.extname(record.fileName));
    zip.file(resultPath(record.resultFile!), {
      name: `${base}_${record.resolution}_s${record.scale}${ext}`,
    });
  }
  void zip.finalize();
});

app.get("/files/:name", (req, res) => {
  const name = path.basename(String(req.params.name));
  if (!resultExists(name)) return res.status(404).json({ error: "文件不存在" });
  res.sendFile(resultPath(name));
});

// 生产模式直接托管构建产物
const distDir = path.resolve(process.cwd(), "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "图片超过 4.7MB 上限", retryable: false });
  }
  console.error("[server]", err);
  res.status(500).json({ error: err?.message || "服务端异常", retryable: false });
});

app.listen(PORT, () => {
  console.log(`[api] http://localhost:${PORT}  ${MOCK ? "MOCK 模式" : "真实接口模式"}`);
  if (!MOCK && !hasCredentials()) console.warn("[api] 未检测到 VOLC_AK / VOLC_SK");
});
