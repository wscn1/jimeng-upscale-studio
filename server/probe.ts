import "dotenv/config";
import fs from "node:fs";
import { assertUpload } from "./image.ts";
import { hasCredentials, submitTask, getTask, useMock } from "./volc.ts";

/**
 * 联通性自检：npm run probe -- ./sample.jpg
 * 用于在打开页面前先确认签名与鉴权是否正确。
 */
const file = process.argv[2];
if (!file) {
  console.error("用法: npm run probe -- ./sample.jpg");
  process.exit(1);
}

const buffer = fs.readFileSync(file);
const kind = assertUpload(buffer);
console.log(`输入: ${file} (${kind}, ${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

if (useMock()) {
  console.log("当前是 MOCK 模式（未配置 AK/SK 或 USE_MOCK=1），跳过真实请求");
  process.exit(0);
}
if (!hasCredentials()) {
  console.error("未配置 VOLC_AK / VOLC_SK");
  process.exit(1);
}

const taskId = await submitTask({
  base64: buffer.toString("base64"),
  resolution: "4k",
  scale: 50,
});
console.log(`提交成功 task_id=${taskId}`);

const startedAt = Date.now();
const deadline = startedAt + 10 * 60 * 1000;
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  const remote = await getTask(taskId);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[${elapsed}s] ${remote.status}`);
  if (remote.status === "done") {
    console.log(`结果链接: ${remote.imageUrl}`);
    break;
  }
  if (remote.status === "not_found" || remote.status === "expired") {
    console.error("任务不存在或已过期");
    process.exit(1);
  }
  if (Date.now() > deadline) {
    console.error("轮询超时");
    process.exit(1);
  }
}
