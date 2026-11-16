import crypto from "node:crypto";

/** 文档给出的输入限制 */
export const LIMITS = {
  maxBytes: 4.7 * 1024 * 1024,
  maxSide: 4096,
  minRatio: 1 / 3,
  maxRatio: 3,
};

const HOST = "visual.volcengineapi.com";
const REGION = "cn-north-1";
const SERVICE = "cv";
const API_VERSION = "2022-08-31";
const REQ_KEY = "jimeng_i2i_seed3_tilesr_cvtob";

const ERROR_TEXT: Record<number, string> = {
  50411: "输入图片未通过内容审核",
  50511: "输出图片未通过内容审核",
  50412: "输入文本未通过审核",
  50512: "输出文本未通过审核",
  50413: "输入内容含敏感词或版权词",
  50518: "输入图片存在版权风险",
  50519: "输出图片存在版权风险",
  50520: "审核服务异常",
  50521: "版权词服务异常",
  50522: "版权图服务异常",
  50429: "请求过于频繁（QPS 超限）",
  50430: "并发任务超限",
  50500: "服务内部错误",
  50501: "服务算法错误",
};

const RETRYABLE = new Set([50429, 50430, 50511, 50519]);

export class VolcError extends Error {
  code: number;
  retryable: boolean;

  constructor(code: number, message: string) {
    super(ERROR_TEXT[code] || message || `接口调用失败（${code}）`);
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/** RFC3986 编码，火山签名的 query 与 header 都按这个规则归一化 */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function credentials() {
  const ak = process.env.VOLC_AK?.trim();
  const sk = process.env.VOLC_SK?.trim();
  return { ak, sk };
}

export function hasCredentials(): boolean {
  const { ak, sk } = credentials();
  return Boolean(ak && sk);
}

/** 没配置 AK/SK 或显式开启时走本地 Mock，保证 UI 可以先跑通 */
export function useMock(): boolean {
  if (process.env.USE_MOCK === "1") return true;
  if (process.env.USE_MOCK === "0") return false;
  return !hasCredentials();
}

function buildAuthorization(
  ak: string,
  sk: string,
  action: string,
  body: string,
): Record<string, string> {
  const xDate = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  const dateStamp = xDate.slice(0, 8);

  const query = `Action=${rfc3986(action)}&Version=${rfc3986(API_VERSION)}`;
  const bodyHash = sha256Hex(body);
  // 火山不把 content-type 纳入签名；canonical headers 之后必须紧跟一个空行
  const signedHeaders = "host;x-content-sha256;x-date";
  const canonicalHeaders = [
    `host:${HOST}`,
    `x-content-sha256:${bodyHash}`,
    `x-date:${xDate}`,
  ].join("\n");

  const canonicalRequest = [
    "POST",
    "/",
    query,
    `${canonicalHeaders}\n`,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kSigning = hmac(
    hmac(hmac(hmac(sk, dateStamp), REGION), SERVICE),
    "request",
  );
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  return {
    "X-Date": xDate,
    "X-Content-Sha256": bodyHash,
    "Content-Type": "application/json",
    Authorization: `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function post(action: string, body: Record<string, unknown>) {
  const { ak, sk } = credentials();
  if (!ak || !sk) {
    throw new VolcError(401, "服务端未配置 VOLC_AK / VOLC_SK");
  }

  const payload = JSON.stringify(body);
  const url = `https://${HOST}/?Action=${rfc3986(action)}&Version=${rfc3986(API_VERSION)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthorization(ak, sk, action, payload),
    body: payload,
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new VolcError(res.status, `接口返回非 JSON（HTTP ${res.status}）`);
  }

  // 先判断外层 code，再判断 data.status，与文档要求一致
  if (json.code !== 10000) {
    throw new VolcError(Number(json.code) || res.status, json.message || "");
  }
  return json;
}

export async function submitTask(params: {
  base64: string;
  resolution: "4k" | "8k";
  scale: number;
}): Promise<string> {
  const json = await post("CVSync2AsyncSubmitTask", {
    req_key: REQ_KEY,
    binary_data_base64: [params.base64],
    resolution: params.resolution,
    scale: Math.round(params.scale),
  });

  const taskId = json?.data?.task_id;
  if (!taskId) {
    throw new VolcError(json.code, "提交成功但没有返回 task_id");
  }
  return String(taskId);
}

export type RemoteTask = {
  status: "in_queue" | "generating" | "done" | "not_found" | "expired";
  imageUrl?: string;
  message?: string;
};

export async function getTask(taskId: string): Promise<RemoteTask> {
  const json = await post("CVSync2AsyncGetResult", {
    req_key: REQ_KEY,
    task_id: taskId,
    // 必须显式要图片链接，否则会返回体积巨大的 base64
    req_json: JSON.stringify({ return_url: true }),
  });

  const data = json?.data ?? {};
  const status = data.status as RemoteTask["status"];

  return {
    status,
    imageUrl: Array.isArray(data.image_urls) ? data.image_urls[0] : undefined,
    message: json.message,
  };
}
