// src/plugin-server.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { createInterface } from "node:readline";

// ../acp-agent/src/json-rpc-message.ts
function parseJsonRpcLine(line) {
  if (line.trim() === "") {
    return { kind: "invalid", reason: "empty" };
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "invalid", reason: "malformed-json" };
  }
  if (!isPlainObject(value)) {
    return { kind: "invalid", reason: "not-an-object" };
  }
  if (value.jsonrpc !== "2.0") {
    return { kind: "invalid", reason: "invalid-jsonrpc-version" };
  }
  const hasMethod = typeof value.method === "string";
  const hasId = isJsonRpcId(value.id);
  const hasResult = Object.prototype.hasOwnProperty.call(value, "result");
  const hasError = Object.prototype.hasOwnProperty.call(value, "error");
  if (hasResult && hasError) {
    return { kind: "invalid", reason: "result-and-error" };
  }
  if (hasResult || hasError) {
    return parseResponse(value, hasId, hasError);
  }
  if (hasMethod && hasId) {
    return parseRequest(value);
  }
  if (hasMethod && !Object.prototype.hasOwnProperty.call(value, "id")) {
    return parseNotification(value);
  }
  return { kind: "invalid", reason: "unrecognized-shape" };
}
function parseResponse(value, hasId, hasError) {
  if (!hasId) {
    return { kind: "invalid", reason: "response-missing-id" };
  }
  const id = value.id;
  if (!isJsonRpcId(id)) {
    return { kind: "invalid", reason: "response-missing-id" };
  }
  if (hasError) {
    const error = parseErrorObject(value.error);
    if (error === void 0) {
      return { kind: "invalid", reason: "invalid-error" };
    }
    return { kind: "response", message: { jsonrpc: "2.0", id, error } };
  }
  return { kind: "response", message: { jsonrpc: "2.0", id, result: value.result } };
}
function parseRequest(value) {
  const id = value.id;
  const method = value.method;
  if (!isJsonRpcId(id) || typeof method !== "string") {
    return { kind: "invalid", reason: "unrecognized-shape" };
  }
  const message = { jsonrpc: "2.0", id, method };
  if (Object.prototype.hasOwnProperty.call(value, "params")) {
    message.params = value.params;
  }
  return { kind: "request", message };
}
function parseNotification(value) {
  const method = value.method;
  if (typeof method !== "string") {
    return { kind: "invalid", reason: "unrecognized-shape" };
  }
  const message = { jsonrpc: "2.0", method };
  if (Object.prototype.hasOwnProperty.call(value, "params")) {
    message.params = value.params;
  }
  return { kind: "notification", message };
}
function parseErrorObject(value) {
  if (!isPlainObject(value)) {
    return void 0;
  }
  if (typeof value.code !== "number" || typeof value.message !== "string") {
    return void 0;
  }
  const error = {
    code: value.code,
    message: value.message
  };
  if (Object.prototype.hasOwnProperty.call(value, "data")) {
    error.data = value.data;
  }
  return error;
}
function isJsonRpcId(value) {
  return typeof value === "number" || typeof value === "string";
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../acp-agent/src/grok-mcp-status.ts
var STATUSES = /* @__PURE__ */ new Set(["connected", "connecting", "disconnected", "failed", "error", "ready", "starting", "stopped", "unavailable", "pending", "initializing", "disabled"]);
var TRANSPORTS = /* @__PURE__ */ new Set(["stdio", "http", "sse"]);
function projectGrokMcpStatus(params) {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return void 0;
  const input = params;
  const name = input.name ?? input.serverName ?? input.serverId;
  if (typeof name !== "string" || !name.trim() || name.length > 160 || /[\r\n\0]/.test(name)) return void 0;
  if (typeof input.status !== "string" || !STATUSES.has(input.status)) return void 0;
  const detail = typeof input.detail === "object" && input.detail !== null ? input.detail : void 0;
  const reportedTransport = input.transport ?? detail?.transport;
  const transport = typeof reportedTransport === "string" && TRANSPORTS.has(reportedTransport) ? reportedTransport : void 0;
  return {
    name,
    status: input.status,
    ...transport ? { transport } : {},
    ...input.status === "failed" || input.status === "error" || input.status === "unavailable" ? { reason: "Grok reported a connection error. Inspect the server on the Host with grok mcp." } : {}
  };
}

// ../acp-agent/src/acp-errors.ts
var AcpRpcError = class extends Error {
  name = "AcpRpcError";
  code;
  rpcMessage;
  data;
  method;
  constructor(options) {
    super(`ACP RPC error ${options.code} for method ${options.method}: ${options.rpcMessage}`);
    this.name = "AcpRpcError";
    this.method = options.method;
    this.code = options.code;
    this.rpcMessage = options.rpcMessage;
    this.data = options.data;
  }
};
var AcpRequestTimeoutError = class extends Error {
  name = "AcpRequestTimeoutError";
  method;
  timeoutMs;
  constructor(method, timeoutMs) {
    super(`ACP request timed out for method ${method} after ${timeoutMs}ms`);
    this.name = "AcpRequestTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
};
var AcpConnectionClosedError = class extends Error {
  name = "AcpConnectionClosedError";
  method;
  reason;
  constructor(options) {
    const method = options?.method;
    const reason = options?.reason;
    super(formatClosedMessage(method, reason));
    this.name = "AcpConnectionClosedError";
    if (method !== void 0) {
      this.method = method;
    }
    if (reason !== void 0) {
      this.reason = reason;
    }
  }
};
var AcpProtocolShapeError = class extends Error {
  name = "AcpProtocolShapeError";
  method;
  reason;
  constructor(method, reason) {
    super(`ACP protocol shape error for method ${method}: ${reason}`);
    this.name = "AcpProtocolShapeError";
    this.method = method;
    this.reason = reason;
  }
};
function formatClosedMessage(method, reason) {
  const parts = ["ACP connection closed"];
  if (method !== void 0) {
    parts.push(`during method ${method}`);
  }
  if (reason !== void 0) {
    parts.push(`(${reason})`);
  }
  return parts.join(" ");
}

// ../acp-agent/src/json-rpc-connection.ts
var DEFAULT_TIMEOUT_MS = 3e4;
var METHOD_NOT_FOUND = -32601;
var INTERNAL_ERROR = -32603;
var JsonRpcConnection = class {
  transport;
  defaultTimeoutMs;
  droppedNotificationMethods;
  onProtocolIssue;
  pending = /* @__PURE__ */ new Map();
  notificationListeners = /* @__PURE__ */ new Set();
  closeListeners = /* @__PURE__ */ new Set();
  requestHandlers = /* @__PURE__ */ new Map();
  nextId = 1;
  isClosed = false;
  closePromise;
  constructor(transport, options) {
    this.transport = transport;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.droppedNotificationMethods = options?.droppedNotificationMethods ?? /* @__PURE__ */ new Set();
    this.onProtocolIssue = options?.onProtocolIssue;
    transport.onLine((line) => {
      this.handleLine(line);
    });
    transport.onClose((info) => {
      this.handleTransportClose(info);
    });
  }
  get closed() {
    return this.isClosed;
  }
  request(method, params, options) {
    if (this.isClosed) {
      return Promise.reject(new AcpConnectionClosedError({ method, reason: "closed" }));
    }
    const signal = options?.signal;
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    return new Promise((resolve3, reject) => {
      const entry = {
        method,
        resolve: (value) => {
          resolve3(value);
        },
        reject,
        timer: void 0,
        signal,
        onAbort: void 0
      };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.forgetPending(id);
          reject(new AcpRequestTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }
      if (signal !== void 0) {
        const onAbort = () => {
          this.forgetPending(id);
          reject(signal.reason);
        };
        entry.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pending.set(id, entry);
      try {
        this.sendPayload(this.buildRequest(id, method, params));
      } catch (error) {
        this.forgetPending(id);
        reject(error);
      }
    });
  }
  notify(method, params) {
    if (this.isClosed) {
      throw new AcpConnectionClosedError({ method, reason: "closed" });
    }
    this.sendPayload(this.buildNotification(method, params));
  }
  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }
  setRequestHandler(method, handler) {
    this.requestHandlers.set(method, handler);
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method);
      }
    };
  }
  onClose(listener) {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }
  close() {
    if (this.closePromise !== void 0) {
      return this.closePromise;
    }
    this.closePromise = this.closeInternal({ code: null, signal: null, reason: "closed" });
    return this.closePromise;
  }
  async closeInternal(info) {
    this.markClosed(info);
    await this.transport.close();
  }
  handleTransportClose(info) {
    this.markClosed(info);
  }
  markClosed(info) {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    const reason = info.reason ?? "closed";
    for (const [id, entry] of this.pending) {
      this.forgetPending(id);
      entry.reject(new AcpConnectionClosedError({ method: entry.method, reason }));
    }
    for (const listener of this.closeListeners) {
      try {
        listener(info);
      } catch (error) {
        this.reportIssue({
          kind: "handler-failed",
          reason: errorName(error)
        });
      }
    }
  }
  handleLine(line) {
    if (this.isClosed) {
      return;
    }
    const parsed = parseJsonRpcLine(line);
    if (parsed.kind === "invalid") {
      this.reportIssue({ kind: "invalid-line", reason: parsed.reason });
      return;
    }
    if (parsed.kind === "request") {
      void this.dispatchInboundRequest(parsed.message);
      return;
    }
    if (parsed.kind === "notification") {
      this.dispatchNotification(parsed.message.method, parsed.message.params);
      return;
    }
    this.dispatchResponse(parsed.message);
  }
  dispatchNotification(method, params) {
    if (this.droppedNotificationMethods.has(method)) {
      return;
    }
    for (const listener of this.notificationListeners) {
      try {
        listener(method, params);
      } catch (error) {
        this.reportIssue({
          kind: "handler-failed",
          method,
          reason: errorName(error)
        });
      }
    }
  }
  async dispatchInboundRequest(message) {
    const handler = this.requestHandlers.get(message.method);
    if (handler === void 0) {
      this.sendInboundError(message.id, METHOD_NOT_FOUND, "Method not found");
      return;
    }
    try {
      const result = await handler(message.params);
      this.sendInboundResult(message.id, result);
    } catch {
      this.sendInboundError(message.id, INTERNAL_ERROR, "Internal error");
    }
  }
  dispatchResponse(message) {
    const entry = this.pending.get(message.id);
    if (entry === void 0) {
      this.reportIssue({
        kind: "unmatched-response",
        reason: `unmatched id ${String(message.id)}`
      });
      return;
    }
    this.forgetPending(message.id);
    if ("error" in message) {
      const rpcError = new AcpRpcError({
        method: entry.method,
        code: message.error.code,
        rpcMessage: message.error.message,
        ...message.error.data !== void 0 ? { data: message.error.data } : {}
      });
      entry.reject(rpcError);
      return;
    }
    entry.resolve(message.result);
  }
  forgetPending(id) {
    const entry = this.pending.get(id);
    if (entry === void 0) {
      return;
    }
    this.pending.delete(id);
    if (entry.timer !== void 0) {
      clearTimeout(entry.timer);
    }
    if (entry.signal !== void 0 && entry.onAbort !== void 0) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
  }
  sendInboundResult(id, result) {
    if (this.isClosed) {
      return;
    }
    this.sendPayload({ jsonrpc: "2.0", id, result });
  }
  sendInboundError(id, code, message) {
    if (this.isClosed) {
      return;
    }
    this.sendPayload({ jsonrpc: "2.0", id, error: { code, message } });
  }
  sendPayload(payload) {
    this.transport.send(JSON.stringify(payload));
  }
  buildRequest(id, method, params) {
    if (params === void 0) {
      return { jsonrpc: "2.0", id, method };
    }
    return { jsonrpc: "2.0", id, method, params };
  }
  buildNotification(method, params) {
    if (params === void 0) {
      return { jsonrpc: "2.0", method };
    }
    return { jsonrpc: "2.0", method, params };
  }
  reportIssue(issue) {
    if (this.onProtocolIssue === void 0) {
      return;
    }
    this.onProtocolIssue(issue);
  }
};
function errorName(error) {
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown";
}

// ../acp-agent/src/grok-acp-methods.ts
var GROK_DROPPED_NOTIFICATION_METHODS = /* @__PURE__ */ new Set([
  "_x.ai/mcp/servers_updated",
  "_x.ai/settings/update",
  "_x.ai/announcements/update"
]);
var GROK_XAI_METHODS = {
  sessionsList: "_x.ai/sessions/list",
  sessionRename: "_x.ai/session/rename",
  sessionDelete: "_x.ai/session/delete",
  interject: "_x.ai/interject"
};

// ../acp-agent/src/acp-client.ts
var AcpClient = class {
  connection;
  constructor(connection) {
    this.connection = connection;
  }
  initialize(params) {
    return this.connection.request("initialize", params).then((result) => {
      return parseInitializeResult(result);
    });
  }
  newSession(params) {
    return this.connection.request("session/new", params).then((result) => {
      return parseSessionSetupResult("session/new", result);
    });
  }
  loadSession(params) {
    return this.connection.request("session/load", params).then((result) => {
      return parseSessionSetupResult("session/load", result, params.sessionId);
    });
  }
  resumeSession(params) {
    return this.connection.request("session/resume", params).then((result) => {
      return parseSessionSetupResult("session/resume", result, params.sessionId);
    });
  }
  listSessions(params = {}) {
    return this.connection.request("session/list", params).then((result) => {
      return parseSessionListResult(result);
    });
  }
  prompt(params, options) {
    const requestOptions = options?.signal === void 0 ? { timeoutMs: 0 } : { timeoutMs: 0, signal: options.signal };
    return this.connection.request("session/prompt", params, requestOptions).then((result) => parsePromptResult(result));
  }
  cancel(sessionId) {
    this.connection.notify("session/cancel", { sessionId });
  }
  setMode(sessionId, modeId) {
    return this.connection.request("session/set_mode", { sessionId, modeId });
  }
  setConfigOption(sessionId, configId, value) {
    return this.connection.request("session/set_config_option", {
      sessionId,
      configId,
      value
    });
  }
  async xaiListSessions() {
    const result = await this.connection.request(GROK_XAI_METHODS.sessionsList, {});
    return parseXaiSessionList(result);
  }
  xaiRenameSession(sessionId, title) {
    return this.connection.request(GROK_XAI_METHODS.sessionRename, { sessionId, title });
  }
  xaiDeleteSession(sessionId) {
    return this.connection.request(GROK_XAI_METHODS.sessionDelete, { sessionId });
  }
  async xaiInterject(sessionId, text2) {
    const result = await this.connection.request(GROK_XAI_METHODS.interject, {
      sessionId,
      text: text2
    });
    return parseInterjectResult(result);
  }
};
function parseInitializeResult(value) {
  const object = asObject(value, "initialize", "result");
  const protocolVersion = object.protocolVersion;
  if (typeof protocolVersion !== "number") {
    throw new AcpProtocolShapeError("initialize", "protocolVersion must be a number");
  }
  const result = { protocolVersion };
  if (Object.prototype.hasOwnProperty.call(object, "agentCapabilities")) {
    result.agentCapabilities = object.agentCapabilities;
  }
  if (Object.prototype.hasOwnProperty.call(object, "authMethods")) {
    const authMethods = parseAuthMethods(object.authMethods);
    if (authMethods !== void 0) {
      result.authMethods = authMethods;
    }
  }
  if (Object.prototype.hasOwnProperty.call(object, "_meta")) {
    result._meta = parseMeta(object._meta, "initialize");
  }
  return result;
}
function parseAuthMethods(value) {
  if (!Array.isArray(value)) {
    throw new AcpProtocolShapeError("initialize", "authMethods must be an array");
  }
  return value.map((entry, index) => {
    const object = asObject(entry, "initialize", `authMethods[${index}]`);
    const id = object.id;
    if (typeof id !== "string") {
      throw new AcpProtocolShapeError("initialize", `authMethods[${index}].id must be a string`);
    }
    const method = { id };
    if (typeof object.name === "string") {
      method.name = object.name;
    }
    if (typeof object.description === "string") {
      method.description = object.description;
    }
    return method;
  });
}
function parseSessionSetupResult(method, value, fallbackSessionId) {
  const object = asObject(value, method, "result");
  const reported = object.sessionId;
  const sessionId = typeof reported === "string" && reported.length > 0 ? reported : fallbackSessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new AcpProtocolShapeError(method, "sessionId must be a string");
  }
  const result = { sessionId };
  if (Object.prototype.hasOwnProperty.call(object, "modes")) {
    result.modes = object.modes;
  }
  if (Object.prototype.hasOwnProperty.call(object, "models")) {
    result.models = object.models;
  }
  if (Object.prototype.hasOwnProperty.call(object, "configOptions")) {
    result.configOptions = object.configOptions;
  }
  if (Object.prototype.hasOwnProperty.call(object, "_meta")) {
    result._meta = parseMeta(object._meta, method);
  }
  return result;
}
function parseSessionListResult(value) {
  const object = asObject(value, "session/list", "result");
  const sessions = object.sessions;
  if (!Array.isArray(sessions)) {
    throw new AcpProtocolShapeError("session/list", "sessions must be an array");
  }
  const result = {
    sessions: sessions.map((entry, index) => asObject(entry, "session/list", `sessions[${index}]`))
  };
  if (typeof object.nextCursor === "string") {
    result.nextCursor = object.nextCursor;
  }
  return result;
}
function parsePromptResult(value) {
  const object = asObject(value, "session/prompt", "result");
  const stopReason = object.stopReason;
  if (typeof stopReason !== "string") {
    throw new AcpProtocolShapeError("session/prompt", "stopReason must be a string");
  }
  const result = { stopReason };
  if (Object.prototype.hasOwnProperty.call(object, "_meta")) {
    result._meta = parseMeta(object._meta, "session/prompt");
  }
  return result;
}
function parseXaiSessionList(value) {
  const object = asObject(value, GROK_XAI_METHODS.sessionsList, "result");
  const sessions = extractXaiSessions(object);
  if (!Array.isArray(sessions)) {
    throw new AcpProtocolShapeError(GROK_XAI_METHODS.sessionsList, "sessions must be an array");
  }
  const entries = [];
  for (const raw of sessions) {
    const entry = parseXaiSessionEntry(raw);
    if (entry !== void 0) {
      entries.push(entry);
    }
  }
  return entries;
}
function extractXaiSessions(object) {
  if (Array.isArray(object.sessions)) {
    return object.sessions;
  }
  const nested = object.result;
  if (isPlainObject2(nested) && Array.isArray(nested.sessions)) {
    return nested.sessions;
  }
  return void 0;
}
function parseXaiSessionEntry(value) {
  if (!isPlainObject2(value) || typeof value.sessionId !== "string") {
    return void 0;
  }
  const entry = { sessionId: value.sessionId };
  if (Object.prototype.hasOwnProperty.call(value, "title")) {
    entry.title = value.title;
  }
  if (typeof value.cwd === "string") {
    entry.cwd = value.cwd;
  }
  if (typeof value.isWorktree === "boolean") {
    entry.isWorktree = value.isWorktree;
  }
  if (typeof value.modelId === "string") {
    entry.modelId = value.modelId;
  }
  if (typeof value.reasoningEffort === "string") {
    entry.reasoningEffort = value.reasoningEffort;
  }
  if (typeof value.yolo === "boolean") {
    entry.yolo = value.yolo;
  }
  if (typeof value.activity === "string") {
    entry.activity = value.activity;
  }
  if (typeof value.resident === "boolean") {
    entry.resident = value.resident;
  }
  if (typeof value.lastChangeUnixMs === "number") {
    entry.lastChangeUnixMs = value.lastChangeUnixMs;
  }
  if (isPlainObject2(value.origin)) {
    const origin = {};
    if (typeof value.origin.kind === "string") {
      origin.kind = value.origin.kind;
    }
    entry.origin = origin;
  }
  return entry;
}
function parseInterjectResult(value) {
  const object = asObject(value, GROK_XAI_METHODS.interject, "result");
  const nested = object.result;
  const status = isPlainObject2(nested) ? nested.status : object.status;
  if (typeof status !== "string") {
    throw new AcpProtocolShapeError(GROK_XAI_METHODS.interject, "status must be a string");
  }
  return { status };
}
function parseMeta(value, method) {
  return asObject(value, method, "_meta");
}
function asObject(value, method, label) {
  if (!isPlainObject2(value)) {
    throw new AcpProtocolShapeError(method, `${label} must be an object`);
  }
  return value;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../acp-agent/src/grok-generated-media.ts
function normalizeGrokMediaPresentation(toolName, presentation) {
  const kind = toolName === "image_gen" ? "image" : toolName === "video_gen" ? "video" : void 0;
  if (kind === void 0) return presentation;
  let path;
  try {
    const receipt = JSON.parse(presentation.output?.text ?? "");
    if (typeof receipt === "object" && receipt !== null && !Array.isArray(receipt)) {
      const value = receipt.path;
      if (typeof value === "string" && value.trim() !== "") path = value;
    }
  } catch {
  }
  return {
    ...presentation,
    kind,
    routedToolName: toolName,
    ...path !== void 0 ? { targetPaths: [path] } : {}
  };
}

// ../acp-agent/src/grok-tool-projection.ts
var MAX_OUTPUT_CHARS = 16e3;
function mapAcpToolKind(acpKind) {
  switch (acpKind) {
    case "read":
    case "edit":
    case "delete":
    case "move":
    case "search":
      return "filesystem";
    case "execute":
      return "shell";
    case "fetch":
      return "web";
    default:
      return "other";
  }
}
function actionVerbFor(acpKind, done) {
  switch (acpKind) {
    case "edit":
      return done ? "Edited" : "Editing";
    case "delete":
      return done ? "Edited" : "Editing";
    case "move":
      return done ? "Edited" : "Editing";
    case "read":
      return done ? "Read" : "Reading";
    case "search":
      return done ? "Searched" : "Searching";
    case "execute":
      return "Ran command";
    case "fetch":
      return done ? "Fetched" : "Fetching";
    default:
      return void 0;
  }
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function readString(record2, key) {
  const value = record2?.[key];
  return typeof value === "string" && value !== "" ? value : void 0;
}
function parseStatus(value) {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "failed" ? value : void 0;
}
function pushUnique(target, value) {
  if (!target.includes(value)) {
    target.push(value);
  }
}
function truncateOutput(text2) {
  if (text2.length <= MAX_OUTPUT_CHARS) {
    return { text: text2, truncated: false };
  }
  return { text: text2.slice(text2.length - MAX_OUTPUT_CHARS), truncated: true };
}
function createGrokToolState(update, now) {
  const toolCallId = readString(update, "toolCallId") ?? "";
  const meta = asRecord(asRecord(update._meta)?.["x.ai/tool"]);
  const toolName = readString(meta, "name") ?? readString(update, "title") ?? "tool";
  const state = {
    toolCallId,
    toolName,
    status: parseStatus(update.status) ?? "pending",
    readOnly: meta?.read_only === true,
    paths: [],
    changedPaths: [],
    startedAt: now
  };
  applyGrokToolUpdate(state, update, now);
  return state;
}
function applyGrokToolUpdate(state, update, now) {
  const kind = readString(update, "kind");
  if (kind !== void 0) {
    state.acpKind = kind;
  }
  const title = readString(update, "title");
  if (title !== void 0 && title !== state.toolName) {
    state.title = title;
  }
  const status = parseStatus(update.status);
  if (status !== void 0) {
    state.status = status;
    if ((status === "completed" || status === "failed") && state.endedAt === void 0) {
      state.endedAt = now;
    }
  }
  const rawInput = asRecord(update.rawInput);
  const command = readString(rawInput, "command") ?? readString(rawInput, "cmd");
  if (command !== void 0) {
    state.command = command;
  }
  for (const key of ["path", "file_path", "filePath", "target_file"]) {
    const path = readString(rawInput, key);
    if (path !== void 0) {
      pushUnique(state.paths, path);
    }
  }
  if (Array.isArray(update.locations)) {
    for (const location of update.locations) {
      const path = readString(asRecord(location), "path");
      if (path !== void 0) {
        pushUnique(state.paths, path);
      }
    }
  }
  if (Array.isArray(update.content)) {
    applyContent(state, update.content);
  }
  const rawOutput = asRecord(update.rawOutput);
  if (rawOutput !== void 0) {
    applyRawOutput(state, rawOutput);
  }
}
function applyContent(state, content) {
  const texts = [];
  for (const item of content) {
    const block = asRecord(item);
    if (block === void 0) {
      continue;
    }
    if (block.type === "diff") {
      const path = readString(block, "path");
      if (path !== void 0) {
        pushUnique(state.paths, path);
        pushUnique(state.changedPaths, path);
      }
      continue;
    }
    if (block.type === "content") {
      const inner = asRecord(block.content);
      const text2 = readString(inner, "text");
      if (text2 !== void 0) {
        texts.push(text2);
      }
    }
  }
  if (texts.length > 0) {
    const joined = truncateOutput(texts.join("\n"));
    state.outputText = joined.text;
    state.outputTruncated = joined.truncated;
  }
}
function applyRawOutput(state, rawOutput) {
  const generatedPath = readString(rawOutput, "path");
  if (generatedPath !== void 0) {
    pushUnique(state.paths, generatedPath);
  }
  const generatedFileName = readString(rawOutput, "filename");
  if (generatedFileName !== void 0 && generatedPath === void 0) {
    pushUnique(state.paths, generatedFileName);
  }
  const exitCode = rawOutput.exit_code;
  if (typeof exitCode === "number" || exitCode === null) {
    state.exitCode = exitCode;
  }
  if (rawOutput.timed_out === true) {
    state.timedOut = true;
  }
  const output = readString(rawOutput, "output");
  if (output !== void 0) {
    const truncated = truncateOutput(output);
    state.outputText = truncated.text;
    state.outputTruncated = truncated.truncated || rawOutput.truncated === true;
  }
  const edits = asRecord(rawOutput.EditsApplied);
  const editedPath = readString(edits, "path") ?? readString(edits, "file_path");
  if (editedPath !== void 0) {
    pushUnique(state.changedPaths, editedPath);
  }
}
function isGrokToolTerminal(state) {
  return state.status === "completed" || state.status === "failed";
}
function presentGrokTool(state) {
  const done = isGrokToolTerminal(state);
  const presentation = {
    kind: mapAcpToolKind(state.acpKind),
    title: state.title ?? state.toolName,
    startedAt: state.startedAt
  };
  const verb = actionVerbFor(state.acpKind, done);
  if (verb !== void 0) {
    presentation.actionVerb = verb;
  }
  if (state.command !== void 0) {
    presentation.command = state.command;
  }
  if (state.paths.length > 0) {
    presentation.targetPaths = [...state.paths];
  }
  if (state.changedPaths.length > 0) {
    presentation.changedPaths = [...state.changedPaths];
  }
  if (state.exitCode !== void 0) {
    presentation.exitCode = state.exitCode;
  }
  if (state.outputText !== void 0) {
    presentation.output = {
      text: state.outputText,
      ...state.outputTruncated === true ? { truncated: true } : {}
    };
  }
  if (state.endedAt !== void 0) {
    presentation.endedAt = state.endedAt;
    const duration = Date.parse(state.endedAt) - Date.parse(state.startedAt);
    if (Number.isFinite(duration) && duration >= 0) {
      presentation.durationMs = duration;
    }
  }
  if (state.status === "failed") {
    presentation.error = {
      category: state.timedOut === true ? "timeout" : "execution",
      message: state.timedOut === true ? "Command timed out" : state.exitCode !== void 0 && state.exitCode !== null ? `Exited with code ${state.exitCode}` : "Tool failed"
    };
  }
  return normalizeGrokMediaPresentation(state.toolName, presentation);
}

// ../acp-agent/src/grok-workflow-projection.ts
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function text(value) {
  return typeof value === "string" ? value.slice(0, 4e3) : void 0;
}
function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function projectGrokWorkflow(value, sessionId) {
  const state = record(record(value).state);
  const workflowId = text(state.run_id);
  const name = text(state.name);
  const status = text(state.status);
  if (!workflowId || !/^wf_[a-zA-Z0-9_-]+$/.test(workflowId) || !name || !status) return void 0;
  const history = (Array.isArray(state.history) ? state.history : []).slice(-64).map((item) => {
    const entry = record(item);
    return { event: text(entry.event) ?? "unknown", ...text(entry.detail) ? { detail: text(entry.detail) } : {}, ...text(entry.at) ? { at: text(entry.at) } : {} };
  });
  const entered = new Set(history.filter((entry) => entry.event === "phase_entered").map((entry) => entry.detail));
  const currentPhase = text(state.current_phase);
  const phases = (Array.isArray(state.phases) ? state.phases : []).slice(0, 64).map((item) => {
    const phase = record(item);
    const title = text(phase.title) ?? "Phase";
    return { title, ...typeof phase.detail === "string" ? { detail: phase.detail.slice(0, 4e3) } : {}, status: status === "completed" ? "done" : title === currentPhase ? "active" : entered.has(title) ? "done" : "pending" };
  });
  const agents = (Array.isArray(state.agents) ? state.agents : []).slice(0, 128).map((item) => {
    const entry = record(item);
    const phase = text(entry.phase);
    const tokensUsed = count(entry.tokens_used);
    return { id: text(entry.agent_id) ?? "unknown", label: text(entry.label) ?? "Agent", status: text(entry.state) ?? "unknown", ...phase ? { phase } : {}, ...tokensUsed !== void 0 ? { tokensUsed } : {} };
  });
  const message = text(state.pause_message) ?? text(state.error);
  const elapsedMs = count(state.elapsed_ms_floor);
  return {
    workflowId,
    sessionId,
    agentId: "grok",
    name,
    objective: text(state.objective) ?? "",
    status,
    revision: count(state.revision) ?? 0,
    phases,
    agents,
    history: history.map((entry) => ({ event: entry.event, ...entry.detail !== void 0 ? { detail: entry.detail } : {}, ...entry.at !== void 0 ? { at: entry.at } : {} })),
    reportAvailable: false,
    ...currentPhase ? { currentPhase } : {},
    ...message ? { message } : {},
    ...elapsedMs !== void 0 ? { elapsedMs } : {}
  };
}

// ../acp-agent/src/grok-turn-projector.ts
function asRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function contentText(content) {
  const block = asRecord2(content);
  if (block?.type === "text" && typeof block.text === "string") {
    return block.text;
  }
  return void 0;
}
var GrokTurnProjector = class {
  runId;
  createMessageId;
  now;
  assistantMessageId;
  lastAssistantMessageId;
  tools = /* @__PURE__ */ new Map();
  constructor(options) {
    this.runId = options.runId;
    this.createMessageId = options.createMessageId;
    this.now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  }
  /** Assistant message that received the most recent text, if any. */
  get latestAssistantMessageId() {
    return this.assistantMessageId ?? this.lastAssistantMessageId;
  }
  /** Project one `session/update` params.update object. */
  project(update) {
    const record2 = asRecord2(update);
    const result = { events: [], signals: [] };
    if (record2 === void 0) {
      return result;
    }
    switch (record2.sessionUpdate) {
      case "agent_message_chunk": {
        const text2 = contentText(record2.content);
        if (text2 !== void 0 && text2 !== "") {
          const messageId = this.ensureAssistantMessage(result.events);
          result.events.push({ type: "message/text_delta", messageId, delta: text2, ...this.run() });
        }
        break;
      }
      case "agent_thought_chunk": {
        const text2 = contentText(record2.content);
        if (text2 !== void 0 && text2 !== "") {
          const messageId = this.ensureAssistantMessage(result.events);
          result.events.push({
            type: "message/thinking_delta",
            messageId,
            delta: text2,
            ...this.run()
          });
        }
        break;
      }
      case "tool_call":
        this.projectToolCall(record2, result.events);
        break;
      case "tool_call_update":
        this.projectToolUpdate(record2, result.events);
        break;
      case "session_info_update": {
        if (typeof record2.title === "string" && record2.title.trim() !== "") {
          result.signals.push({ kind: "title", title: record2.title.trim() });
        }
        break;
      }
      case "current_mode_update": {
        if (typeof record2.currentModeId === "string") {
          result.signals.push({ kind: "mode", modeId: record2.currentModeId });
        }
        break;
      }
      case "available_commands_update": {
        if (Array.isArray(record2.availableCommands)) {
          result.signals.push({ kind: "commands", commands: record2.availableCommands });
        }
        break;
      }
      case "config_option_update": {
        if (Array.isArray(record2.configOptions)) {
          result.signals.push({ kind: "config-options", configOptions: record2.configOptions });
        }
        break;
      }
      case "plan": {
        if (Array.isArray(record2.entries)) {
          result.signals.push({ kind: "plan", entries: record2.entries });
        }
        break;
      }
      default:
        break;
    }
    return result;
  }
  /**
   * Close the open assistant message and terminate tools still open at turn
   * end. Returns the id of the last assistant message (for usage binding).
   */
  finish(outcome) {
    const events = [];
    for (const state of this.tools.values()) {
      if (!isGrokToolTerminal(state)) {
        state.status = outcome === "completed" ? "completed" : "failed";
        state.endedAt = this.now();
        events.push(this.toolEnd(state));
      }
    }
    this.closeAssistantMessage(events);
    return events;
  }
  projectToolCall(record2, events) {
    const toolCallId = typeof record2.toolCallId === "string" ? record2.toolCallId : "";
    if (toolCallId === "") {
      return;
    }
    const existing = this.tools.get(toolCallId);
    if (existing !== void 0) {
      this.projectToolUpdate(record2, events);
      return;
    }
    const responseMessageId = this.assistantMessageId ?? this.lastAssistantMessageId ?? this.ensureAssistantMessage(events);
    this.closeAssistantMessage(events);
    const state = createGrokToolState(record2, this.now());
    state.responseMessageId = responseMessageId;
    this.tools.set(toolCallId, state);
    events.push({
      type: "tool/start",
      toolCallId,
      toolName: state.toolName,
      presentation: presentGrokTool(state),
      ...responseMessageId !== void 0 ? { responseMessageId } : {},
      ...this.run()
    });
    if (isGrokToolTerminal(state)) {
      events.push(this.toolEnd(state));
    }
  }
  projectToolUpdate(record2, events) {
    const toolCallId = typeof record2.toolCallId === "string" ? record2.toolCallId : "";
    const state = this.tools.get(toolCallId);
    if (state === void 0) {
      if (toolCallId !== "") {
        this.projectToolCall({ ...record2, sessionUpdate: "tool_call" }, events);
      }
      return;
    }
    if (isGrokToolTerminal(state)) {
      return;
    }
    applyGrokToolUpdate(state, record2, this.now());
    if (isGrokToolTerminal(state)) {
      events.push(this.toolEnd(state));
      return;
    }
    events.push({
      type: "tool/update",
      toolCallId,
      delta: "",
      presentation: presentGrokTool(state),
      ...this.run()
    });
  }
  toolEnd(state) {
    return {
      type: "tool/end",
      toolCallId: state.toolCallId,
      isError: state.status === "failed",
      presentation: presentGrokTool(state),
      ...state.responseMessageId !== void 0 ? { responseMessageId: state.responseMessageId } : {},
      ...this.run()
    };
  }
  ensureAssistantMessage(events) {
    if (this.assistantMessageId !== void 0) {
      return this.assistantMessageId;
    }
    const messageId = this.createMessageId();
    this.assistantMessageId = messageId;
    events.push({ type: "message/start", messageId, role: "assistant", ...this.run() });
    return messageId;
  }
  closeAssistantMessage(events) {
    if (this.assistantMessageId === void 0) {
      return;
    }
    events.push({ type: "message/end", messageId: this.assistantMessageId, ...this.run() });
    this.lastAssistantMessageId = this.assistantMessageId;
    this.assistantMessageId = void 0;
  }
  run() {
    return this.runId !== void 0 ? { runId: this.runId } : {};
  }
};

// ../acp-agent/src/grok-session-options.ts
var GROK_PERMISSION_MODES = [
  { id: "default", label: "Default", description: "Ask before edits and commands" },
  { id: "acceptEdits", label: "Accept edits", description: "Apply edits without asking" },
  { id: "auto", label: "Auto", description: "Grok decides when to ask" },
  { id: "dontAsk", label: "Don't ask", description: "Deny anything that would ask" },
  { id: "bypassPermissions", label: "Always approve", description: "Run everything without asking" },
  { id: "plan", label: "Plan", description: "Plan first, no edits" }
];
function asRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function readString2(record2, key) {
  const value = record2?.[key];
  return typeof value === "string" && value !== "" ? value : void 0;
}
function parseGrokModelState(value) {
  const record2 = asRecord3(value);
  if (record2 === void 0 || !Array.isArray(record2.availableModels)) {
    return void 0;
  }
  const models = [];
  const defaultEffortByModel = /* @__PURE__ */ new Map();
  for (const entry of record2.availableModels) {
    const model = asRecord3(entry);
    const id = readString2(model, "modelId");
    if (id === void 0) {
      continue;
    }
    const option = { id, label: readString2(model, "name") ?? id };
    const description = readString2(model, "description");
    if (description !== void 0) {
      option.description = description;
    }
    const meta = asRecord3(model?._meta);
    if (typeof meta?.totalContextTokens === "number") {
      option.contextTokens = meta.totalContextTokens;
    }
    if (meta?.supportsReasoningEffort === true && Array.isArray(meta.reasoningEfforts)) {
      const efforts = [];
      for (const effort of meta.reasoningEfforts) {
        const effortRecord = asRecord3(effort);
        const effortId = readString2(effortRecord, "value") ?? readString2(effortRecord, "id");
        if (effortId !== void 0) {
          efforts.push(effortId);
          if (effortRecord?.default === true) {
            defaultEffortByModel.set(id, effortId);
          }
        }
      }
      if (efforts.length > 0) {
        option.efforts = efforts;
      }
      const current = readString2(meta, "reasoningEffort");
      if (current !== void 0 && !defaultEffortByModel.has(id)) {
        defaultEffortByModel.set(id, current);
      }
    }
    models.push(option);
  }
  const state = { models, defaultEffortByModel };
  const currentModelId = readString2(record2, "currentModelId");
  if (currentModelId !== void 0) {
    state.currentModelId = currentModelId;
  }
  return state;
}
function parseGrokConfigCurrent(value) {
  const current = {};
  if (!Array.isArray(value)) {
    return current;
  }
  for (const entry of value) {
    const option = asRecord3(entry);
    const id = readString2(option, "id");
    const currentValue = readString2(option, "currentValue");
    if (currentValue === void 0) {
      continue;
    }
    if (id === "model") {
      current.modelId = currentValue;
    } else if (id === "reasoning_effort") {
      current.effortId = currentValue;
    }
  }
  return current;
}
function parseGrokCommands(value) {
  const commands = [];
  for (const entry of value) {
    const record2 = asRecord3(entry);
    const name = readString2(record2, "name");
    if (name === void 0) {
      continue;
    }
    const command = { name };
    const description = readString2(record2, "description");
    if (description !== void 0) {
      command.description = description;
    }
    const hint = readString2(asRecord3(record2?.input), "hint");
    if (hint !== void 0) {
      command.inputHint = hint;
    }
    commands.push(command);
  }
  return commands;
}
var GrokSessionOptionsState = class {
  modelState = { models: [], defaultEffortByModel: /* @__PURE__ */ new Map() };
  currentModelId;
  currentEffortId;
  currentModeId;
  modeConfirmed = true;
  autoApprove;
  commands = [];
  applyModels(value) {
    const parsed = parseGrokModelState(value);
    if (parsed === void 0) {
      return;
    }
    this.modelState = parsed;
    if (this.currentModelId === void 0 && parsed.currentModelId !== void 0) {
      this.currentModelId = parsed.currentModelId;
    }
  }
  applyConfigOptions(value) {
    const current = parseGrokConfigCurrent(value);
    if (current.modelId !== void 0) {
      this.currentModelId = current.modelId;
    }
    if (current.effortId !== void 0) {
      this.currentEffortId = current.effortId;
    }
  }
  applyCommands(value) {
    this.commands = parseGrokCommands(value);
  }
  /** A mode switch was requested; confirmed only if Grok acknowledges it. */
  requestMode(modeId) {
    this.currentModeId = modeId;
    this.modeConfirmed = false;
  }
  confirmMode(modeId) {
    this.currentModeId = modeId;
    this.modeConfirmed = true;
  }
  setAutoApprove(autoApprove) {
    this.autoApprove = autoApprove;
  }
  get modelId() {
    return this.currentModelId;
  }
  modelSupportsEffort(modelId, effortId) {
    const model = this.modelState.models.find((candidate) => candidate.id === modelId);
    return model?.efforts?.includes(effortId) === true;
  }
  hasModel(modelId) {
    return this.modelState.models.some((candidate) => candidate.id === modelId);
  }
  snapshot(agentId) {
    const options = {
      agentId,
      models: this.modelState.models,
      modes: GROK_PERMISSION_MODES,
      modeConfirmed: this.modeConfirmed,
      commands: this.commands
    };
    if (this.currentModelId !== void 0) {
      options.currentModelId = this.currentModelId;
    }
    const effort = this.currentEffortId ?? (this.currentModelId !== void 0 ? this.modelState.defaultEffortByModel.get(this.currentModelId) : void 0);
    if (effort !== void 0) {
      options.currentEffortId = effort;
    }
    if (this.currentModeId !== void 0) {
      options.currentModeId = this.currentModeId;
    }
    if (this.autoApprove !== void 0) {
      options.autoApprove = this.autoApprove;
    }
    return options;
  }
};

// ../contracts/src/agent-failure.ts
var AGENT_FAILURE_ORIGINS = ["provider", "transport", "protocol", "runtime"];
var AGENT_FAILURE_CODES = [
  "provider-authentication",
  "provider-quota",
  "provider-rate-limit",
  "provider-http-error",
  "provider-unavailable",
  "model-request-timeout",
  "model-stream-missing-finish",
  "model-stream-stalled",
  "context-limit-exceeded",
  "backend-worker-crash",
  "backend-protocol-error",
  "unknown-agent-failure"
];
var AGENT_FAILURE_MESSAGE_MAX_CHARS = 500;
var ORIGIN_SET = new Set(AGENT_FAILURE_ORIGINS);
var CODE_SET = new Set(AGENT_FAILURE_CODES);
var SECRET_FRAGMENT = /(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*|api[_-]?key\s*[:=]\s*\S+)/gi;
function boundAgentFailureText(value, maxChars) {
  const redacted = value.replace(SECRET_FRAGMENT, "[redacted]");
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return redacted.slice(0, maxChars);
}
function createUnknownAgentFailure(message, options) {
  return {
    code: "unknown-agent-failure",
    origin: "runtime",
    message: boundAgentFailureText(message, AGENT_FAILURE_MESSAGE_MAX_CHARS),
    retriable: options?.retriable === true
  };
}

// ../contracts/src/agent-plugin-manifest.ts
var AGENT_PLUGIN_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

// ../contracts/src/agent-plugin-protocol.ts
var AGENT_PLUGIN_PROTOCOL_VERSION = 1;
var AGENT_PLUGIN_MAX_FRAME_BYTES = 2 * 1024 * 1024;
var AGENT_PLUGIN_METHODS = [
  "plugin/initialize",
  "check",
  "catalog/list",
  "catalog/rename",
  "catalog/delete",
  "session/new",
  "session/load",
  "session/resume",
  "session/prompt",
  "session/cancel",
  "session/options",
  "session/model",
  "session/effort",
  "session/mode",
  "session/commands",
  "session/interject",
  "session/interject-cancel",
  "session/mcp-status",
  "session/workflows",
  "session/workflow-report",
  "session/release",
  "plugin/dispose",
  "permission/request",
  "intervention/event"
];

// ../contracts/src/agent-plugin-frame.ts
var AgentPluginProtocolError = class extends Error {
  name = "AgentPluginProtocolError";
};
function fail(reason) {
  throw new AgentPluginProtocolError(`agent-plugin-protocol-error: ${reason}`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isIdentity(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/.test(value);
}
function parseScope(value) {
  if (!isRecord(value)) return fail("invalid scope");
  if (value.kind === "plugin" && Object.keys(value).length === 1) return { kind: "plugin" };
  if (value.kind === "session" && isIdentity(value.sessionId) && isIdentity(value.runtimeGenerationId) && Object.keys(value).length === 3) {
    return { kind: "session", sessionId: value.sessionId, runtimeGenerationId: value.runtimeGenerationId };
  }
  return fail("invalid session identity");
}
function sameScope(left, right) {
  return left.kind === "plugin" ? right.kind === "plugin" : right.kind === "session" && left.sessionId === right.sessionId && left.runtimeGenerationId === right.runtimeGenerationId;
}
function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isMethod(value) {
  return typeof value === "string" && AGENT_PLUGIN_METHODS.some((method) => method === value);
}
function isPluginMethod(method) {
  return method.startsWith("plugin/") || method.startsWith("catalog/") || method === "check";
}
var FAILURE_CODES = ["invalid-request", "unsupported", "unavailable", "backend-error", "cancelled", "migration-required"];
function parseAgentPluginFrame(line, expected = {}) {
  if (new TextEncoder().encode(line).byteLength > AGENT_PLUGIN_MAX_FRAME_BYTES || /[\r\n]/.test(line)) {
    return fail("invalid frame size or framing");
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return fail("invalid JSON");
  }
  if (!isRecord(value) || value.protocolVersion !== AGENT_PLUGIN_PROTOCOL_VERSION) return fail("unsupported protocol");
  const scope = parseScope(value.scope);
  if (expected.scope && !sameScope(scope, expected.scope)) return fail("stale or foreign generation");
  if (expected.kind && value.kind !== expected.kind) return fail("unexpected frame kind");
  if (value.kind === "event") {
    if (scope.kind !== "session" || !("emission" in value) || !hasOnlyKeys(value, ["protocolVersion", "kind", "scope", "emission"]) || expected.requestId || expected.method) {
      return fail("invalid notification");
    }
    return { protocolVersion: 1, kind: "event", scope, emission: value.emission };
  }
  if (value.kind !== "request" && value.kind !== "response" || !isIdentity(value.requestId) || !isMethod(value.method)) {
    return fail("invalid request correlation");
  }
  if (scope.kind === "plugin" !== isPluginMethod(value.method)) return fail("method scope mismatch");
  if (expected.requestId && value.requestId !== expected.requestId || expected.method && value.method !== expected.method) {
    return fail("response correlation mismatch");
  }
  const base = { protocolVersion: 1, scope, requestId: value.requestId, method: value.method };
  if (value.kind === "request") {
    if (!("params" in value) || !hasOnlyKeys(value, ["protocolVersion", "kind", "scope", "requestId", "method", "params"])) {
      return fail("invalid request envelope");
    }
    return { ...base, kind: "request", params: value.params };
  }
  if (value.ok === true && "result" in value && hasOnlyKeys(value, ["protocolVersion", "kind", "scope", "requestId", "method", "ok", "result"])) {
    return { ...base, kind: "response", ok: true, result: value.result };
  }
  if (value.ok === false && hasOnlyKeys(value, ["protocolVersion", "kind", "scope", "requestId", "method", "ok", "error"]) && isRecord(value.error)) {
    const error = value.error;
    if (hasOnlyKeys(error, ["code", "message"]) && typeof error.message === "string") {
      const code = FAILURE_CODES.find((candidate) => candidate === error.code);
      if (code) return { ...base, kind: "response", ok: false, error: { code, message: error.message } };
    }
  }
  return fail("invalid response envelope");
}

// ../contracts/src/host.ts
var TOOL_KINDS = [
  "filesystem",
  "shell",
  "git",
  "web",
  "mcp",
  "process",
  "image",
  "video",
  "subagent",
  "health",
  "other"
];
var TOOL_KIND_SET = new Set(TOOL_KINDS);

// ../contracts/src/piwin-error.ts
var PiwinError = class extends Error {
  code;
  category;
  retryable;
  constructor(code, message, options) {
    super(message, options?.cause !== void 0 ? { cause: options.cause } : void 0);
    this.name = new.target.name;
    this.code = code;
    this.category = options?.category ?? "unknown";
    this.retryable = options?.retryable ?? false;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  /**
   * Convert to a serializable {@link PiwinErrorView} for IPC / push events.
   */
  toView() {
    return {
      category: this.category,
      message: this.message,
      code: this.code,
      ...this.retryable ? { retryable: true } : {}
    };
  }
};
function formatError(error) {
  if (error instanceof PiwinError) {
    return error.message;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message !== "") {
      return message;
    }
    return error.name !== "Error" ? error.name : "An unexpected error occurred.";
  }
  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed !== "" ? trimmed : "An unexpected error occurred.";
  }
  if (error === null || error === void 0) {
    return "An unexpected error occurred.";
  }
  try {
    const str = String(error);
    return str !== "" ? str : "An unexpected error occurred.";
  } catch {
    return "An unexpected error occurred.";
  }
}

// ../contracts/src/tool-registration.ts
var HOST_TOOL_PERMISSION_ACTIONS = [
  "filesystem:read",
  "filesystem:list",
  "file-write",
  "bash",
  "network:web_search",
  "network:web_fetch",
  "network:image-gen",
  "network:video-gen",
  "process:start",
  "process:stop",
  "process:list",
  "process:logs",
  "browser:navigate",
  "browser:screenshot",
  "browser:snapshot",
  "browser:click",
  "browser:type",
  "browser:fill-form",
  "browser:scroll",
  "browser:find",
  "browser:back",
  "browser:forward",
  "browser:wait",
  "browser:lock",
  "browser:status",
  "browser:restart",
  "browser:viewport",
  "browser:tabs",
  "browser:dialog",
  "browser:upload",
  "browser:console",
  "browser:network",
  "notes:note_list",
  "notes:note_search",
  "notes:note_read",
  "notes:note_write",
  "notes:note_update",
  "notes:note_delete",
  "knowledge:knowledge_list",
  "knowledge:knowledge_search",
  "knowledge:knowledge_read",
  "flashcards:create",
  "flashcards:batch-create",
  "flashcards:list",
  "flashcards:delete",
  "extensions:install",
  "extensions:list",
  "capabilities:install",
  "capabilities:search",
  "planning:create",
  "planning:update",
  "subagent:run",
  "subagent:playbook",
  "artifact:instructions",
  "toolbox:route",
  "mcp:trusted",
  "device:health-read"
];
var HOST_TOOL_PERMISSION_ACTION_SET = new Set(
  HOST_TOOL_PERMISSION_ACTIONS
);
var MAX_HOST_TOOL_DURATION_MS = 30 * 60 * 1e3;

// ../contracts/src/browser.ts
var BROWSER_FRAME_MAX_HEADER_BYTES = 4 * 1024;
var MAX_BROWSER_FRAME_BINARY_BYTES = 12 * 1024 * 1024;
var MAX_WEB_ELEMENT_TEXT_BYTES = 2 * 1024;
var MAX_WEB_ELEMENT_HTML_BYTES = 8 * 1024;
var MAX_BROWSER_INSERT_TEXT_BYTES = 8 * 1024;

// ../contracts/src/web.ts
var DEFAULT_FETCH_CACHE_MAX_BYTES = 24 * 1024 * 1024;

// ../contracts/src/subscription-oauth.ts
var V1_SUBSCRIPTION_PROVIDER_IDS = [
  "kimi-coding",
  "openai-codex",
  "anthropic",
  "xai",
  "github-copilot",
  "devin"
];
var CLAUDE_CODE_OAUTH_PROVIDER_ID = "anthropic-claude-code";
var SUBSCRIPTION_OAUTH_PROVIDER_IDS = [
  ...V1_SUBSCRIPTION_PROVIDER_IDS,
  CLAUDE_CODE_OAUTH_PROVIDER_ID
];
var AUTH_LOGIN_IDLE_MS = 15 * 60 * 1e3;
var V1_SUBSCRIPTION_PROVIDER_META = {
  "kimi-coding": { name: "Kimi Code", oauthOrigin: "oauth://kimi-coding" },
  "openai-codex": { name: "ChatGPT Codex", oauthOrigin: "oauth://openai-codex" },
  anthropic: { name: "Claude", oauthOrigin: "oauth://anthropic" },
  xai: { name: "Grok", oauthOrigin: "oauth://xai" },
  "github-copilot": { name: "GitHub Copilot", oauthOrigin: "oauth://github-copilot" },
  devin: { name: "Devin", oauthOrigin: "oauth://devin" }
};
var CLAUDE_CODE_OAUTH_PROVIDER_META = {
  name: "Claude Code",
  oauthOrigin: "oauth://anthropic-claude-code"
};
var SUBSCRIPTION_OAUTH_PROVIDER_META = {
  ...V1_SUBSCRIPTION_PROVIDER_META,
  [CLAUDE_CODE_OAUTH_PROVIDER_ID]: CLAUDE_CODE_OAUTH_PROVIDER_META
};
var AUTH_CLI_PROVIDER_IDS = [
  ...V1_SUBSCRIPTION_PROVIDER_IDS,
  "<extension-provider>"
].join("|");

// ../contracts/src/subscription-chat-surface.ts
var SUBSCRIPTION_CHAT_SURFACES = {
  xai: { baseUrl: "https://api.x.ai/v1", vendor: "xai" }
};

// ../contracts/src/native-search-adapters.ts
var SUBSCRIPTION_ORIGIN_VENDORS = Object.fromEntries(
  Object.entries(SUBSCRIPTION_CHAT_SURFACES).map(([id, surface]) => [`oauth://${id}`, surface.vendor])
);

// ../contracts/src/voice-live.ts
var LIVE_SDP_OFFER_MAX_BYTES = 256 * 1024;

// ../contracts/src/live-spoken-contract.ts
var PIWIN_LIVE_SPOKEN_CONTRACT = [
  "You are the speaking face of this work session. The agent on the chat page is the same session's hands. Sound like one person; do not explain internals.",
  "Stay in the call for greetings, confirmations, speech corrections, and questions you can already answer from the startup context and later Host context updates.",
  "Reactions, incomplete fragments, and preferences about talking or confirmations are not work. Mentioning HTML or code does not authorize creating it. Wait for a complete actionable request; clarify only when needed.",
  "Send questions about delegated task status or results through the same handover path so Host can return authoritative state without duplicating work. Preserve them as questions. Only start the same work again when the user explicitly asks to redo it. Respect requests for silence or no confirmation without another acknowledgement.",
  "Hand over new work only when the user requests work requiring files, tools, search, permissions, or project facts that are not already in the startup context or later Host updates. Preserve the user request, negations and uncertainty in the user language. Never rewrite a reaction, fragment, status question or speech preference as an imperative work order.",
  "While work runs, stay available for conversation but do not fill silence or repeat acknowledgements. New actionable direction \u2192 another candidate request. Stop current work \u2192 exactly STOP_CURRENT_RUN. Stop talking or confirming is not stop work.",
  "When a result arrives, continue from your last spoken line with one short takeaway. Do not announce that a work session finished."
].join(" ");
var PIWIN_LIVE_CODEX_APPENDIX = "New work and questions about delegated task status or results use the live delegation channel. Host context feedback says whether work was admitted, reused, or kept in voice. Only say work was accepted after that feedback. Never re-delegate a rejected conversational fragment.";
var PIWIN_LIVE_TOOL_APPENDIX = "For workspace work or questions about delegated task status or results, call delegate_to_work_session with the user request for Host intent review or reuse. STOP_CURRENT_RUN only to halt the current run. Wait for Host feedback; a tool call alone is not task acceptance.";
var PIWIN_LIVE_WORK_PREAMBLE = [
  "<live_work_session>",
  "A voice call is bound to this session. The following voice_brief is a task handover, not typed user speech and not a quote to recite.",
  "Write for the chat page (tools, files, normal assistant style). Do not ask the voice layer questions; the user can see this page and can type or speak a steer.",
  "</live_work_session>"
].join("\n");
function composeLiveSpokenInstructions(channel) {
  const appendix = channel === "native-delegation" ? PIWIN_LIVE_CODEX_APPENDIX : PIWIN_LIVE_TOOL_APPENDIX;
  return `${PIWIN_LIVE_SPOKEN_CONTRACT} ${appendix}`;
}

// ../contracts/src/live-delegation-instruction.ts
var PIWIN_LIVE_INSTRUCTIONS = composeLiveSpokenInstructions("native-delegation");

// ../contracts/src/live-session-context.ts
var LIVE_STARTUP_CONTEXT_INPUT_MAX_BYTES = 24 * 1024;
var PIWIN_LIVE_STARTUP_CONTEXT_HEADER = [
  "Startup context from the bound work session before this call started.",
  "It may be summarized. Use it to answer questions about the earlier conversation.",
  "Do not recite it unless relevant. The chat page remains the source of truth."
].join(" ");

// ../contracts/src/media.ts
var MEDIA_SAVE_CHUNK_MAX_BYTES = 384 * 1024;
var MEDIA_READ_WIRE_SAFE_BYTES = 700 * 1024;

// ../contracts/src/attachment.ts
var ATTACHMENT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif"
];
var ATTACHMENT_DOCUMENT_MIME_TYPES = ["application/pdf"];
var ATTACHMENT_TEXT_MIME_TYPES = [
  "application/json",
  "application/javascript",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/xml",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "image/svg+xml",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml"
];
var TEXT_MIME_TYPES = new Set(ATTACHMENT_TEXT_MIME_TYPES);
var DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES = [
  ...ATTACHMENT_IMAGE_MIME_TYPES.filter((mimeType) => mimeType !== "image/jpg"),
  ...ATTACHMENT_DOCUMENT_MIME_TYPES,
  "text/*",
  ...ATTACHMENT_TEXT_MIME_TYPES.filter((mimeType) => !mimeType.startsWith("text/"))
];
var EXTENSION_TO_MIME = {
  ".c": "text/x-c",
  ".cc": "text/x-c++",
  ".cpp": "text/x-c++",
  ".cs": "text/x-csharp",
  ".css": "text/css",
  ".csv": "text/csv",
  ".diff": "text/x-diff",
  ".gif": "image/gif",
  ".go": "text/x-go",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".html": "text/html",
  ".java": "text/x-java-source",
  ".js": "application/javascript",
  ".jsx": "application/javascript",
  ".json": "application/json",
  ".kt": "text/x-kotlin",
  ".kts": "text/x-kotlin",
  ".less": "text/css",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".mjs": "application/javascript",
  ".patch": "text/x-diff",
  ".pdf": "application/pdf",
  ".php": "text/x-php",
  ".pl": "text/x-perl",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".rs": "text/x-rust",
  ".scss": "text/css",
  ".sh": "application/x-sh",
  ".sql": "application/sql",
  ".svg": "image/svg+xml",
  ".swift": "text/x-swift",
  ".toml": "application/toml",
  ".ts": "application/typescript",
  ".tsx": "application/typescript",
  ".txt": "text/plain",
  ".vue": "text/html",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".zsh": "application/x-sh"
};
var ATTACHMENT_FILE_ACCEPT = [
  ...ATTACHMENT_IMAGE_MIME_TYPES,
  ...ATTACHMENT_DOCUMENT_MIME_TYPES,
  ...ATTACHMENT_TEXT_MIME_TYPES,
  "text/*",
  ...Object.keys(EXTENSION_TO_MIME)
].join(",");

// ../contracts/src/artifact.ts
var CANONICAL_ARTIFACT_LANGUAGE = "artifact-html";
var DEFAULT_MAX_ARTIFACT_BYTES = 100 * 1024;
var DEFAULT_ARTIFACT_DECISION_PROMPT = [
  '[piwin-prompt-meta kind="artifact:decision" version="9" applies="artifacts-enabled"]',
  '<artifact-decision-policy name="piwin-proactive-surfaces">',
  "## Decision Criteria",
  "Choose the presentation that makes the user's information easiest to scan, understand, search, copy, compare, and reuse.",
  "Proactively use Artifacts for structured or information-dense content even without an explicit UI request. Prefer a compact interactive or visually grouped Artifact over a long Markdown wall of text.",
  "",
  'The Canvas trigger is **user intent**, not response shape or length. Ask: would the user benefit from viewing this as its own workspace beside the conversation, in the right-side Canvas panel? If yes, declare `surface="canvas"`.',
  "MUST use Canvas when the primary deliverable is a standalone analytical artifact: architecture reviews, plan reviews, code-base or design reviews, security audits, delivery reports, findings write-ups, quantitative breakdowns, timelines, or large comparison tables. If you catch yourself about to dump a Markdown wall or a large Markdown table as the answer, stop and emit Canvas instead.",
  "",
  "### 1. Ordinary Markdown (Default for simple text)",
  "- Short answers (1\u20132 paragraphs), direct code explanations, debugging, or simple snippets.",
  "- When the user explicitly requests plain text, Markdown, source code, raw HTML, or a code snippet.",
  "- When the user asks to explain, debug, teach, or comment on a specific code snippet and no interactive presentation is useful.",
  "- When the user asked to fix code, implement a change, or produce a patch/PR \u2014 the code is the deliverable, not a Canvas.",
  "- When a small list or simple table is clearer than an Artifact.",
  "",
  "### 2. Inline Artifact (`artifact-html` without surface attr)",
  "Default Artifact surface when the result fits in the conversation.",
  "- Cheatsheets, command summaries, reference guides, comparisons, comparative tables, matrices, timelines, catalogs, checklists, or categorized overviews.",
  "- Many items, categories, commands, options, examples, or reference entries.",
  "- Content benefiting from search, filtering, copying, sorting, tabs, accordions, or grouping within the chat stream.",
  "- A dense table, list, or long explanation that would be difficult to scan as ordinary Markdown.",
  "- Answers the user is likely to save, revisit, compare, or reuse.",
  "If the answer is between a long Markdown block and a compact searchable Artifact, choose the Artifact.",
  "",
  '### 3. Canvas Artifact (`artifact-html` with `surface="canvas"`)',
  "Canvas is the right-side workspace panel. It auto-opens. Use it for work the user will read or operate as a document/workspace, not as a chat bubble.",
  "- Full app/page prototypes, multi-step flows with local state, interactive tools/calculators, or dashboards requiring a dedicated wide workspace.",
  "- A coordinated workspace or result that should remain beside the conversation, or a layout whose utility requires sustained width.",
  "- Standalone reports and reviews (MUST): architecture / plan / design / code-base reviews, audits, delivery reports, findings. Design a scannable hierarchy \u2014 status, grouped findings, comparisons \u2014 not a Markdown document pasted into a single `<pre>` or article. Ordinary in-thread comments on a specific snippet stay Markdown.",
  "- Already written to a file this turn: do not repeat the file in a Canvas. A Canvas still earns its place when it shows what the text cannot at a glance \u2014 conclusions, status, key comparisons \u2014 and points to the file for the full text.",
  'Declare Canvas explicitly with `surface="canvas"`. A completed Canvas opens the right workspace automatically; do not ask the user to click a second launcher before using it.',
  "</artifact-decision-policy>"
].join("\n");
function formatArtifactProtocol() {
  const fenceClose = "```";
  const inlineOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title"`;
  const canvasOpen = `\`\`\`${CANONICAL_ARTIFACT_LANGUAGE} title="Short descriptive title" surface="canvas"`;
  const svgOpen = '```svg title="Short descriptive title"';
  return [
    '[piwin-prompt-meta kind="artifact:runtime" version="12" applies="artifacts-enabled"]',
    "## HTML Artifact Runtime Contract",
    "",
    "### Success",
    "A self-contained artifact fence that renders correctly in the chat column sandbox.",
    "",
    "### Fences",
    "Opening fence starts at column 0 of its own line. Keep `title` and `surface` on that same opening line; do not wrap attributes onto the next line. HTML/SVG body follows. Closing fence alone on its own line. Never append the opening fence to a sentence.",
    "",
    "Inline:",
    inlineOpen,
    "<!-- body fragment: HTML/CSS + optional small inline JS -->",
    fenceClose,
    "",
    "Canvas:",
    canvasOpen,
    "<!-- self-contained HTML/CSS + optional small inline JS -->",
    fenceClose,
    "",
    "SVG:",
    svgOpen,
    "<!-- self-contained SVG, no external refs -->",
    fenceClose,
    "",
    "### Constraints (break without these)",
    "- Colors: for proactive artifacts (including reports, reviews, and voice-delegated tasks), use only `--piwin-artifact-*` theme vars (`surface`, `text`, `muted`, `accent`, `border`, `bg`) to adapt to host theme. These six are the whole set: never invent other names (e.g. `surface-elevated`), never write `var(--piwin-artifact-x, <fallback>)` with your own palette, and never hard-code hex/rgb colors for text, backgrounds, or borders (no `color: #fff`, no dark slate cards). For states, tint with `color-mix(in srgb, var(--piwin-artifact-accent) 12%, transparent)`. Only when the user explicitly asks for a custom look (e.g. custom SVG, a styled HTML page, or an explicit UI design) may you style freely with custom colors.",
    "- Inline code & tokens: inline `<code>` and technical identifiers must use a neutral translucent background `color-mix(in srgb, var(--piwin-artifact-text) 8%, transparent)` with text `var(--piwin-artifact-text)`. Never use reddish, maroon, or brownish backgrounds for code tokens (red is strictly reserved for errors/diff deletions). Badges use muted neutral for inactive/hidden, accent for ready/visible, amber for estimate/progress.",
    "- Host theme: a client may supply the send-time host theme (`light` or `dark`) as advisory context. Match it. On a light host never produce a dark-mode design (dark page, dark stage, dark slate cards, light-on-dark text); on a dark host never produce a glaring white page. This also applies when the user asks for a custom look: pick a palette that sits naturally on the host background unless the user explicitly asks for the opposite mode. Without a hint, stay on the theme vars so either mode works.",
    "- Proactive visual tone is flat and quiet: no gradients, glows, glassmorphism, or decorative emoji in headings or labels. Hierarchy comes from type size/weight, spacing, borders, and grouping.",
    "- Outermost wrapper background: transparent on Inline and Canvas; surface colors on inner cards only. Never paint html/body/the outer stage as a dark full-bleed page \u2014 that becomes a black Canvas on a paper host. Dark `pre`/`code` islands may keep their own contrast pair.",
    "- Inline layout is a 360\u2013760px chat column; fluid grids; not a full-page landing. Inline grows with its content: no page-level or nested vertical scroll regions; let the conversation own vertical scrolling; never add horizontal scrolling to Inline. No viewport-filling height (`100vh`/`100%`) or page-level overflow on html/body/outer wrapper for Inline.",
    "- A client may supply a send-time Inline column width as advisory context. Never hardcode it: use width:100%, max-width:100%, min-width:0, border-box sizing and container queries to adapt through resizing and replay. Remain readable at 360px and adapt below that where needed. A width hint does not request artifact generation.",
    "- Tables: wrap long data cells with `overflow-wrap: break-word` only. Never `word-break: break-word`, `word-break: break-all`, or `overflow-wrap: anywhere` \u2014 they collapse column min-content to 1ch. Row/column labels may `white-space: nowrap` or `width: max-content`. `min-width: 0` is for the outer stage, not table columns. Inline: no page-level horizontal scroll; stack with `@container` before wrapping labels. Canvas: dense comparisons keep label min-content; table `overflow-x: auto` is allowed. Dense wide comparisons belong on Canvas.",
    '- **Canvas Viewport**: The Canvas iframe is the design viewport. Root layout (and the primary stage) uses `width: 100%` and `height: 100%` / `100dvh` of that iframe. Do not lock a phone/poster width or an `aspect-ratio` that letterboxes empty bars; extra panel width is scene/layout space. If the UI needs a wide workspace or horizontal scrolling, declare `surface="canvas"`.',
    "- Repeated cards/items are siblings \u2014 no card-in-card.",
    '- Session vault images: `<img data-piwin-media="<mediaId>" alt="short label">`. Never `data:image`, never local filesystem paths, never markdown images for vault assets.',
    "- If the user only needs to pick among generated images, the attachment cards are enough \u2014 do not wrap them in a second HTML copy.",
    "",
    "### Streaming & Progressive Enhancement",
    "- **CSS First**: Emit complete `<style>` blocks before any visible HTML markup.",
    "- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.",
    "- **Static First**: Core content must exist in static HTML; JS strictly for enhancement (content remains readable if JS fails)."
  ].join("\n");
}
var ARTIFACT_RUNTIME_CONTRACT = formatArtifactProtocol();

// ../contracts/src/mobile-access.ts
var LOCAL_MOBILE_ACCESS_COMMAND_TYPES = [
  "mobile-access/status",
  "mobile-access/start",
  "mobile-access/stop",
  "mobile-access/create-pairing-code",
  "mobile-access/list-devices",
  "mobile-access/revoke-device"
];
var LOCAL_MOBILE_ACCESS_COMMAND_TYPE_SET = new Set(LOCAL_MOBILE_ACCESS_COMMAND_TYPES);

// ../contracts/src/host-pairing.ts
var HOST_PAIRING_COMMAND_TYPES = [
  "host/pairing-status",
  "host/pairing-create-code",
  "host/pairing-list-devices",
  "host/pairing-revoke-device",
  "host/pairing-set-enabled"
];
var HOST_PAIRING_COMMAND_TYPE_SET = new Set(HOST_PAIRING_COMMAND_TYPES);

// ../contracts/src/project.ts
var PROJECT_PREVIEW_CHUNK_BYTES = 384 * 1024;
var PROJECT_PREVIEW_INLINE_WIRE_BYTES = 900 * 1024;

// ../contracts/src/session-transcript-page.ts
var SESSION_TRANSCRIPT_PAGE_MIN_BYTES = 16 * 1024;
var SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES = 256 * 1024;
var SESSION_TRANSCRIPT_PAGE_MAX_BYTES = 512 * 1024;

// ../contracts/src/session-user-message-index.ts
var SESSION_USER_MESSAGE_INDEX_MAX_BYTES = 128 * 1024;

// ../contracts/src/session-cold-storage.ts
var COLD_STORAGE_PLAN_TTL_MS = 10 * 60 * 1e3;

// ../contracts/src/pet.ts
var PET_SPRITE_COLS = 8;
var PET_SPRITE_ROWS = 9;
var PET_CELL_WIDTH = 192;
var PET_CELL_HEIGHT = 208;
var PET_SHEET_WIDTH = PET_SPRITE_COLS * PET_CELL_WIDTH;
var PET_SHEET_HEIGHT = PET_SPRITE_ROWS * PET_CELL_HEIGHT;

// ../contracts/src/plan.ts
var MAX_PLAN_JSON_BYTES = 64 * 1024;

// ../contracts/src/goal.ts
var GOAL_TOOL_NAMES = ["goal_complete", "goal_blocked", "goal_wait"];
var GOAL_TOOL_NAME_SET = new Set(GOAL_TOOL_NAMES);

// ../contracts/src/orchestration-scheme-fusion.ts
var FUSION_SCHEME_ID = "fusion";
var FUSION_SIDEKICK_ROLE = "sidekick";

// ../contracts/src/orchestration-scheme-reviewed-delivery.ts
var REVIEWED_DELIVERY_SCHEME_ID = "reviewed-delivery";
var REVIEWED_DELIVERY_REVIEWER_ROLE = "reviewer";

// ../contracts/src/orchestration-scheme-auto.ts
var AUTO_SCHEME_ID = "auto";
var AUTO_SCOUT_ROLE = "scout";
var AUTO_SIDEKICK_ROLE = "sidekick";
var AUTO_REVIEWER_ROLE = "reviewer";
var AUTO_TESTER_ROLE = "tester";
var AUTO_SCOUT_SOURCE = { schemeId: "ultra-code", role: "scout" };
var PIWIN_SCHEME_PLAYBOOK_TOOL_NAME = "piwin_scheme_playbook";
var AUTO_LEAD_REVIEW_LIMIT = {
  maxFiles: 5,
  maxChangedLines: 300
};
var AUTO_PREAMBLE = `<orchestration_discipline scheme="auto">
You are the Lead. Before acting, output one line: [Goal] + [minimal files to read / scouts to start].

## Information gathering (strict)
- Every new read or search must be able to change the current answer; otherwise skip it.
- Stop gathering once the answer is determined. No "just to double-check" reads.
- In this thread: no repo-wide grep or scan, no unrelated neighbor directories, old snapshots, backup copies, or unrelated plugins.
- Wide search only through role="scout", and only with a stated question whose answer changes the plan.

## Coding
- State assumptions. If the request has several readings or the scope is unclear, ask in one sentence instead of picking silently.
- Minimum change for the request: no speculative abstraction, no drive-by refactor, optimization, or formatting.
- Remove only orphans your own change created; mention unrelated dead code instead of deleting it.

## Routing
- Unknown location or missing evidence -> scout (start in parallel, wait once, spot-check cited file:line).
- Decided, mechanical implementation -> sidekick (single writer, same lane, you review).
- Architecture, ambiguous requirements, UX judgment -> do it yourself; never delegate judgment.
- Candidate over ${AUTO_LEAD_REVIEW_LIMIT.maxFiles} files or ${AUTO_LEAD_REVIEW_LIMIT.maxChangedLines} changed lines -> independent reviewer before apply (Host enforces).
- After apply -> start tester WITHOUT waiting, tell the user now what changed and what they can try by hand; the tester report arrives later.

Before the first use of a role in this conversation, call ${PIWIN_SCHEME_PLAYBOOK_TOOL_NAME} with that role for its exact loop.
</orchestration_discipline>`;
var AUTO_TESTER_REPORT_CONTRACT = `<tester_contract>
You verify one delivered change against acceptance criteria. You run in a snapshot of the user's workspace; your edits are never applied.

## Priorities
1. Exercise the real behavior: run the CLI command, or start the preview on a NON-default port and drive the UI. Capture output or screenshots.
2. Run existing tests and typecheck scoped to the touched area only.
3. Add a regression test only when you reproduced a failure, and state that it fails before the fix.

## Do not
- Write tests to raise coverage.
- Change source code to make checks pass.
- Give style or taste opinions.

## Output Format
Line 1: exactly one of pass | fail | blocked
Body:
- Each acceptance criterion -> evidence (command + exit code, screenshot path, or output excerpt)
- For fail: minimal reproduction steps
- For blocked: what was missing
</tester_contract>`;
var AUTO_ROLE_PLAYBOOKS = {
  [AUTO_SCOUT_ROLE]: `<playbook role="scout">
1. Write one bounded question per scout: target, where to look, required evidence (file:line, signatures, quotes). State why the answer changes your plan.
2. Start independent scouts with piwin_subagent_start; use piwin_subagent_run when one synchronous scout is enough.
3. Call piwin_subagent_wait once for all required scouts before synthesizing.
4. Treat reports as compressed clues: spot-check a few cited file:line locations. Do not redo the scouts' searches.
5. Scouts never edit, decide architecture, or spawn children.
</playbook>`,
  [AUTO_SIDEKICK_ROLE]: `<playbook role="sidekick">
1. Write a self-contained brief: goal, scope, constraints, success_criteria. Never paste this conversation; the sidekick cannot see it.
2. piwin_subagent_start role="sidekick", then piwin_subagent_wait. Read only the Result (line 1 done | blocked | escalate).
3. escalate, or repeated failure of the same kind: take the work back here.
4. Review the checks yourself. If the candidate is within the Lead review limit, piwin_subagent_review_submit on the exact result ref; if approved, piwin_subagent_result_apply with that result and the returned reviewRef as approvedBy.
5. Over the limit, the Lead review is refused: start role="reviewer" with reviewOf set to that exact result (see the reviewer playbook).
6. One decision per candidate. For changes, send a new brief; the same sidekick lane continues. A candidate you will not apply (finished another way, or superseded) is closed with piwin_subagent_result_discard on that exact result.
7. Never run more than one writer; do not use start as a map-reduce coordinator.
</playbook>`,
  [AUTO_REVIEWER_ROLE]: `<playbook role="reviewer">
1. piwin_subagent_start role="reviewer" with reviewOf = the exact result ref from wait. The reviewer is read-only and submits a structured decision.
2. piwin_subagent_wait; read the durable decision: approved | changes-requested | blocked.
3. approved: piwin_subagent_result_apply with that result and the reviewRef as approvedBy.
4. changes-requested: send the sidekick a new brief with the findings; review the new candidate again.
5. blocked: stop and explain to the user. Do not loop more than twice on the same change.
</playbook>`,
  [AUTO_TESTER_ROLE]: `<playbook role="tester">
1. Only after apply. Write acceptance criteria as the user would state them (observable behavior), not the implementation.
2. piwin_subagent_start role="tester" and do NOT call piwin_subagent_wait for it. The Host runs it in a snapshot of the current workspace, including uncommitted changes.
3. In the same reply, tell the user what changed and what they can try by hand while the tester runs.
4. The tester report arrives later as a [piwin-tester-report] block or a follow-up turn: fold it into a complete answer (pass | fail | blocked with evidence).
5. If the user's new message will change the code under test, cancel the running tester with piwin_subagent_cancel and start a new one after the change.
6. At most one tester runs per conversation; starting a new one replaces the old.
</playbook>`
};
var BUILTIN_AUTO_SCHEME = {
  id: AUTO_SCHEME_ID,
  name: "Auto",
  description: "Lead routes by need: scouts gather evidence, the sidekick implements, a reviewer checks large changes, and a background tester verifies while you try it by hand. Models come from Ultra Code, Fusion, and Reviewed Delivery",
  source: "builtin",
  defaultRole: AUTO_SCOUT_ROLE,
  defaultProfileId: "explorer",
  exposeSpawnMetadata: false,
  maxConcurrency: 6,
  maxTasksPerRun: 12,
  waitPolicy: "await-all",
  members: [
    {
      role: AUTO_SCOUT_ROLE,
      description: "Read-only evidence gathering for wide or heavy reads: locate symbols, trace calls, scan large files. Returns file:line citations.",
      fallback: "main",
      inheritFrom: { ...AUTO_SCOUT_SOURCE }
    },
    {
      role: AUTO_SIDEKICK_ROLE,
      description: "Single writer for decided, mechanical implementation in a retained worktree. Reports done, blocked, or escalate.",
      fallback: "main",
      inheritFrom: { schemeId: FUSION_SCHEME_ID, role: FUSION_SIDEKICK_ROLE },
      behavior: { lane: "persistent", leadReviewLimit: { ...AUTO_LEAD_REVIEW_LIMIT } }
    },
    {
      role: AUTO_REVIEWER_ROLE,
      description: "Independent read-only review of one frozen sidekick candidate; required above the Lead review limit.",
      fallback: "main",
      inheritFrom: { schemeId: REVIEWED_DELIVERY_SCHEME_ID, role: REVIEWED_DELIVERY_REVIEWER_ROLE }
    },
    {
      role: AUTO_TESTER_ROLE,
      description: "Background verification after apply, in a snapshot of the current workspace. Proves behavior with evidence; never applied.",
      profileId: "tester",
      isolation: "worktree",
      fallback: "none",
      reportContract: AUTO_TESTER_REPORT_CONTRACT,
      behavior: { detached: true }
    }
  ],
  systemPreamble: AUTO_PREAMBLE
};

// ../contracts/src/subagent-worktree-gc.ts
var SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var SUBAGENT_WORKTREE_GC_GRACE_MS = 2 * 60 * 1e3;

// ../contracts/src/permission.ts
var DEFAULT_AGENT_MODE_RULES = [
  "- **Pragmatic Delivery**: Satisfy the user's stated goal with the minimal correct change; produce clear evidence of what was verified.",
  "- **Resolve Ambiguity**: If success criteria, stack choices, or architecture constraints are ambiguous, state the concrete options and ask.",
  "- **Defensive Boundary**: Do not expand scope, invent unrequested features, or push through blockers; surface conflicts immediately.",
  "- **Empirical Verification**: Never claim done, fixed, or passing without running checks/tests in this environment.",
  "- **Permission & Safety**: Host enforces permissions; adhere strictly to tool denials rather than restating policy.",
  "- **Evidence-First**: Favor concrete outcomes and test evidence over verbose process narration."
];
var DEFAULT_AGENT_MODE_SYSTEM_PROMPT = [
  '[piwin-prompt-meta kind="mode:agent-default" version="6" applies="generation"]',
  "<agent_contract>",
  "## Operating Contract",
  ...DEFAULT_AGENT_MODE_RULES,
  "</agent_contract>"
].join("\n");
var AGENT_MODE_SYSTEM_PREAMBLES = {
  agent: [
    '[piwin-prompt-meta kind="mode:agent" version="5" applies="every-turn"]',
    "Operating contract for this turn:",
    ...DEFAULT_AGENT_MODE_RULES
  ].join("\n"),
  goal: [
    '[piwin-prompt-meta kind="mode:goal" version="2" applies="goal-mode"]',
    "You are in Goal Mode (Autonomous Goal Execution Loop).",
    "- **Goal**: Fully achieve the stated objective and acceptance criteria autonomously through iterative execution.",
    "- **Loop**: Explore, modify files, run tests, and self-correct until all criteria are met.",
    "- **Completion**: When fully achieved and verified by build/test evidence, invoke `goal_complete` (or report delivery evidence).",
    "- **Blockers**: If blocked by an insurmountable issue or requiring an essential human decision, invoke `goal_blocked` immediately.",
    "- **No False Claims**: Empirical verification is strictly required before marking complete."
  ].join("\n")
};

// ../contracts/src/walkthrough.ts
var MAX_WALKTHROUGH_PROMPT_BYTES = 16 * 1024;
var DEFAULT_CONCISE_PROMPT = [
  '[piwin-prompt-meta kind="concise-chat" version="2" applies="when-enabled"]',
  '<walkthrough-context priority="critical">',
  "  <instruction>",
  "    A detailed Walkthrough Artifact is generated after this turn.",
  "    Success for chat: 2-3 sentences on whether the request is fulfilled and what changed.",
  "    Put diffs, long paths, and validation logs in the walkthrough \u2014 not in chat.",
  "  </instruction>",
  "</walkthrough-context>"
].join("\n");
var DEFAULT_CONCISE_PROMPT_ZH = [
  "[piwin walkthrough context]",
  "\u672C\u8F6E\u5BF9\u8BDD\u7ED3\u675F\u540E\u5C06\u81EA\u52A8\u751F\u6210\u8BE6\u7EC6\u7684 Walkthrough\u3002",
  "\u8BF7\u4FDD\u6301\u4E3B\u56DE\u7B54\u7B80\u6D01\uFF1A\u7528 2-3 \u53E5\u8BDD\u603B\u7ED3\u8F93\u51FA\u7ED3\u679C\u3002",
  "\u4E0D\u8981\u5728\u804A\u5929\u6846\u4E2D\u91CD\u590D\u8D34\u5927\u6BB5\u4EE3\u7801\u5757\u3001\u6587\u4EF6\u8DEF\u5F84\u6216\u9010\u6B65\u8BF4\u660E\u2014\u2014\u540E\u7EED\u7684 Walkthrough \u5C06\u5305\u542B\u8FD9\u4E9B\u5185\u5BB9\u3002",
  "[end walkthrough context]"
].join("\n");

// ../contracts/src/client-tool.ts
var MAX_CLIENT_TOOL_REQUEST_BYTES = 32 * 1024;
var MAX_CLIENT_TOOL_RESULT_BYTES = 128 * 1024;
var MAX_CLIENT_TOOL_CAPABILITIES_FRAME_BYTES = 8 * 1024;
var CLIENT_TOOL_CLOCK_SKEW_MS = 10 * 60 * 1e3;

// ../contracts/src/apple-health.ts
var APPLE_HEALTH_METRIC_IDS = [
  "steps",
  "active-energy",
  "exercise-minutes",
  "workouts",
  "sleep-duration",
  "sleep-stages",
  "resting-heart-rate",
  "heart-rate-variability"
];
var HEALTH_TOOL_CARD_STATUSES = [
  "waiting-for-phone",
  "awaiting-consent",
  "awaiting-healthkit-authorization",
  "reading",
  "completed",
  "partial",
  "denied",
  "no-data",
  "phone-offline",
  "timed-out",
  "cancelled",
  "failed"
];
var HEALTH_TOOL_CARD_STATUS_SET = new Set(HEALTH_TOOL_CARD_STATUSES);
var METRIC_SET = new Set(APPLE_HEALTH_METRIC_IDS);

// ../contracts/src/speech.ts
var SPEECH_MAX_AUDIO_BYTES = 15 * 1024 * 1024;
var SPEECH_MAX_DURATION_MS = 2 * 60 * 1e3;

// ../contracts/src/run-intervention.ts
var RUN_INTERVENTION_MAX_TEXT_BYTES = 64 * 1024;
var RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN = 256 * 1024;

// ../contracts/src/queued-turn.ts
var QUEUED_TURN_MAX_TEXT_BYTES = 64 * 1024;
var QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION = 512 * 1024;

// ../contracts/src/agent-backend.ts
var AGENT_BACKEND_IDS = ["pi", "grok"];
var AGENT_BACKEND_ID_SET = new Set(AGENT_BACKEND_IDS);

// ../contracts/src/agent-backend-capabilities.ts
var SESSION_BACKEND_OPERATIONS = [
  "prompt",
  "cancel",
  "queue",
  "intervene",
  "setModel",
  "setEffort",
  "setMode",
  "slashCommands",
  "fileReferences",
  "images",
  "rename",
  "delete",
  "archive",
  "pin",
  "export",
  "fork",
  "rewind",
  "duplicate",
  "pause",
  "compact",
  "conversationTree",
  "coldStorage",
  "hostSubagents",
  "hostTools"
];
var BACKEND_PERMISSION_OPTION_KINDS = /* @__PURE__ */ new Set([
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always"
]);
function isBackendPermissionOptionKind(value) {
  return typeof value === "string" && BACKEND_PERMISSION_OPTION_KINDS.has(value);
}
var PI_SUPPORTED = { supported: true };
function createPiSessionCapabilities() {
  const operations = {};
  for (const operation of SESSION_BACKEND_OPERATIONS) {
    operations[operation] = PI_SUPPORTED;
  }
  return { agentId: "pi", operations };
}

// ../contracts/src/subscription-billing-notice.ts
var CLAUDE_EXTRA_USAGE_SETTINGS_URL = "https://claude.ai/settings/usage";
var ZH_ANTHROPIC_NOTICE = {
  kind: "third-party-extra-usage",
  title: "\u4E0D\u8D70\u5957\u9910\u5185\u989D\u5EA6",
  body: "piwin \u662F\u7B2C\u4E09\u65B9\u5BA2\u6237\u7AEF\u3002Claude Pro/Max \u7684 5 \u5C0F\u65F6 / \u5468\u9650\u989D\u53EA\u7ED9 Claude.ai\u3001Claude Code \u548C Cowork\u3002\u8FD9\u91CC\u6309 extra usage \u9010 token \u8BA1\u8D39\uFF1B\u6CA1\u5F00 extra \u6216\u989D\u5EA6\u7528\u5B8C\u4F1A\u76F4\u63A5\u5931\u8D25\u3002",
  compact: "\u5F53\u524D Claude \u5957\u9910\u6309 extra usage \u8BA1\u8D39\uFF0C\u4E0D\u8D70\u5957\u9910\u9650\u989D\u3002",
  afterLogin: `Claude \u5DF2\u767B\u5F55\u3002\u672C\u5BA2\u6237\u7AEF\u6309 extra usage \u8BA1\u8D39\uFF0C\u4E0D\u8D70\u5957\u9910\u9650\u989D\u3002\u7BA1\u7406\uFF1A${CLAUDE_EXTRA_USAGE_SETTINGS_URL}`,
  manageUrl: CLAUDE_EXTRA_USAGE_SETTINGS_URL,
  manageLabel: "\u7BA1\u7406 extra usage",
  planWindowsCaption: "\u4E0A\u9762\u7684 5 \u5C0F\u65F6 / \u5468\u9650\u989D\u662F\u5B98\u65B9\u5BA2\u6237\u7AEF\u7528\u7684\uFF0C\u672C\u5BA2\u6237\u7AEF\u4E0D\u6263\u8FD9\u4E9B\u3002",
  extraUsageLabel: "Extra usage\uFF08\u672C\u5BA2\u6237\u7AEF\u5B9E\u9645\u6263\u8D39\uFF09",
  extraUsageOffHint: "\u672A\u542F\u7528 extra \u65F6\uFF0C\u5728\u6B64\u53D1\u8BF7\u6C42\u4F1A\u5931\u8D25\u3002\u5230 claude.ai/settings/usage \u5F00\u542F\u3002",
  errorPolicy: `\u7B2C\u4E09\u65B9\u5BA2\u6237\u7AEF\u6309 extra usage \u8BA1\u8D39\uFF0C\u4E0D\u8D70\u5957\u9910\u9650\u989D\u3002\u8BF7\u5230 ${CLAUDE_EXTRA_USAGE_SETTINGS_URL} \u5F00\u542F\u6216\u589E\u52A0\u989D\u5EA6\u3002`,
  errorExhausted: `Extra usage \u5DF2\u7528\u5B8C\u3002\u5230 ${CLAUDE_EXTRA_USAGE_SETTINGS_URL} \u52A0\u989D\u5EA6\u540E\u518D\u8BD5\u3002\u672C\u5BA2\u6237\u7AEF\u4E0D\u8D70\u5957\u9910\u5185\u9650\u989D\u3002`
};
var EN_ANTHROPIC_NOTICE = {
  kind: "third-party-extra-usage",
  title: "Not billed from plan limits",
  body: "piwin is a third-party client. Claude Pro/Max 5-hour and weekly limits apply only to Claude.ai, Claude Code, and Cowork. Usage here is billed per token from extra usage. Requests fail if extra usage is off or exhausted.",
  compact: "This Claude subscription bills extra usage, not plan limits.",
  afterLogin: `Signed in to Claude. Third-party usage draws from extra usage, not plan limits. Manage: ${CLAUDE_EXTRA_USAGE_SETTINGS_URL}`,
  manageUrl: CLAUDE_EXTRA_USAGE_SETTINGS_URL,
  manageLabel: "Manage extra usage",
  planWindowsCaption: "The 5-hour / weekly meters are for official clients. This client does not consume them.",
  extraUsageLabel: "Extra usage (this client)",
  extraUsageOffHint: "Requests fail while extra usage is off. Enable it at claude.ai/settings/usage.",
  errorPolicy: `Third-party apps draw from extra usage, not plan limits. Enable or add extra usage at ${CLAUDE_EXTRA_USAGE_SETTINGS_URL}.`,
  errorExhausted: `You are out of extra usage. Add more at ${CLAUDE_EXTRA_USAGE_SETTINGS_URL}. This client does not use plan limits.`
};

// ../acp-agent/src/grok-protocol-projection.ts
function asRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function readString3(record2, key) {
  const value = record2?.[key];
  return typeof value === "string" && value !== "" ? value : void 0;
}
function riskKindFor(acpKind) {
  switch (acpKind) {
    case "execute":
      return "command";
    case "edit":
    case "delete":
    case "move":
      return "file-write";
    case "fetch":
      return "network";
    default:
      return "unknown";
  }
}
function parseGrokPermissionRequest(params, agentId) {
  const record2 = asRecord4(params);
  if (record2 === void 0 || !Array.isArray(record2.options)) {
    return void 0;
  }
  const options = [];
  for (const entry of record2.options) {
    const option = asRecord4(entry);
    const optionId = readString3(option, "optionId");
    const kind = option?.kind;
    if (optionId === void 0 || !isBackendPermissionOptionKind(kind)) {
      continue;
    }
    options.push({ optionId, kind, label: readString3(option, "name") ?? optionId });
  }
  if (options.length === 0) {
    return void 0;
  }
  const toolCall = asRecord4(record2.toolCall);
  const acpKind = readString3(toolCall, "kind");
  const title = readString3(toolCall, "title") ?? "Grok wants to run a tool";
  const rawInput = asRecord4(toolCall?.rawInput);
  const command = readString3(rawInput, "command");
  const paths = [];
  for (const key of ["path", "file_path", "filePath"]) {
    const path = readString3(rawInput, key);
    if (path !== void 0) {
      paths.push(path);
    }
  }
  if (Array.isArray(toolCall?.locations)) {
    for (const location of toolCall.locations) {
      const path = readString3(asRecord4(location), "path");
      if (path !== void 0 && !paths.includes(path)) {
        paths.push(path);
      }
    }
  }
  const context = {
    kind: riskKindFor(acpKind),
    summary: title,
    backendOptions: options,
    backendAgentId: agentId
  };
  if (command !== void 0) {
    context.command = command;
  }
  if (paths.length > 0) {
    context.paths = paths;
  }
  const prompt = {
    action: acpKind ?? "tool",
    detail: command ?? paths[0] ?? title,
    context,
    options
  };
  const toolCallId = readString3(toolCall, "toolCallId");
  if (toolCallId !== void 0) {
    prompt.toolCallId = toolCallId;
  }
  return prompt;
}
function readNumber(record2, keys) {
  for (const key of keys) {
    const value = record2?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return void 0;
}
function parseGrokPromptUsage(meta) {
  const usage = asRecord4(meta?.usage);
  if (usage === void 0) {
    return void 0;
  }
  const inputTokens = readNumber(usage, ["inputTokens", "input_tokens"]);
  const outputTokens = readNumber(usage, ["outputTokens", "output_tokens"]);
  const cacheReadTokens = readNumber(usage, ["cachedReadTokens", "cacheReadTokens", "cached_read_tokens"]);
  const cacheWriteTokens = readNumber(usage, ["cacheCreationTokens", "cache_creation_tokens"]);
  const reasoningTokens = readNumber(usage, ["reasoningTokens", "reasoning_tokens"]);
  const totalTokens = readNumber(usage, ["totalTokens", "total_tokens"]) ?? (inputTokens ?? 0) + (outputTokens ?? 0);
  const result = { totalTokens };
  const modelId = readString3(meta, "modelId");
  if (modelId !== void 0) result.modelId = modelId;
  if (inputTokens !== void 0) result.inputTokens = inputTokens;
  if (outputTokens !== void 0) result.outputTokens = outputTokens;
  if (cacheReadTokens !== void 0) result.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== void 0) result.cacheWriteTokens = cacheWriteTokens;
  if (reasoningTokens !== void 0) result.reasoningTokens = reasoningTokens;
  const durationMs = readNumber(usage, ["apiDurationMs", "durationMs"]);
  if (durationMs !== void 0) result.durationMs = durationMs;
  return result;
}
function catalogTitle(value) {
  if (typeof value === "string") {
    return value.trim() === "" ? void 0 : value.trim();
  }
  const record2 = asRecord4(value);
  const text2 = readString3(record2, "text") ?? readString3(record2, "value") ?? readString3(record2, "title");
  return text2?.trim() === "" ? void 0 : text2?.trim();
}
function projectGrokCatalogEntry(entry) {
  const session = { backendSessionId: entry.sessionId };
  const title = catalogTitle(entry.title);
  if (title !== void 0) session.title = title;
  if (entry.cwd !== void 0) session.cwd = entry.cwd;
  if (entry.activity !== void 0) session.activity = entry.activity;
  if (entry.isWorktree !== void 0) session.isWorktree = entry.isWorktree;
  if (entry.lastChangeUnixMs !== void 0) session.lastChangeUnixMs = entry.lastChangeUnixMs;
  if (entry.modelId !== void 0) session.modelId = entry.modelId;
  if (entry.yolo !== void 0) session.autoApprove = entry.yolo;
  if (entry.origin?.kind !== void 0) session.originKind = entry.origin.kind;
  return session;
}
function classifyGrokStopReason(stopReason, context) {
  switch (stopReason) {
    case "end_turn":
      return { status: "completed", stopReason: "stop" };
    case "max_tokens":
    case "max_turn_requests":
    case "max_turns":
      return { status: "completed", stopReason: "length" };
    case "cancelled":
      if (context.permissionRejected && !context.userCancelled) {
        return { status: "aborted", reason: "permission-rejected" };
      }
      return { status: "aborted", reason: "user-cancelled" };
    case "refusal":
      return { status: "failed", message: "Grok refused the request" };
    default:
      return { status: "failed", message: `Grok stopped: ${stopReason}` };
  }
}

// src/grok-capabilities.ts
var GROK_AGENT_ID = "grok";
function createGrokSessionCapabilities() {
  const capabilities = createPiSessionCapabilities();
  capabilities.agentId = GROK_AGENT_ID;
  const unsupported = (reason) => ({ supported: false, reason });
  capabilities.operations.images = unsupported("Grok does not accept images yet");
  capabilities.operations.fork = unsupported("Forking Grok sessions is not available yet");
  capabilities.operations.rewind = unsupported("Rewinding Grok sessions is not available yet");
  capabilities.operations.duplicate = unsupported("Grok sessions cannot be duplicated");
  capabilities.operations.pause = unsupported("Grok has no pause; use Stop");
  capabilities.operations.compact = unsupported("Use the /compact command in Grok sessions");
  capabilities.operations.conversationTree = unsupported("Grok keeps a linear history");
  capabilities.operations.coldStorage = unsupported("Grok keeps its own session storage");
  capabilities.operations.hostSubagents = unsupported("Grok runs its own subagents");
  capabilities.operations.hostTools = unsupported("Grok uses its own tools and MCP servers");
  return capabilities;
}

// src/grok-cli-detection.ts
import { access, constants, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

// src/grok-permission-mode.ts
var PERMISSION_MODE_LINE = /^\s*permission_mode\s*=\s*(.+?)\s*$/;
function readGrokPermissionMode(toml) {
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const match = PERMISSION_MODE_LINE.exec(line);
    if (match === null) {
      continue;
    }
    return unquoteToml(match[1] ?? "");
  }
  return void 0;
}
function unquoteToml(raw) {
  if (raw.length >= 2) {
    const quote = raw[0];
    if ((quote === '"' || quote === "'") && raw[raw.length - 1] === quote) {
      const inner = raw.slice(1, -1).trim();
      return inner.length > 0 ? inner : void 0;
    }
  }
  if (raw.length === 0 || raw.includes(" ") || raw.startsWith("#")) {
    return void 0;
  }
  return raw;
}

// src/grok-process-transport.ts
import { spawn } from "node:child_process";
var DEFAULT_KILL_TIMEOUT_MS = 3e3;
var DEFAULT_STDERR_RING_CHARS = 16384;
var GrokProcessClosedError = class extends Error {
  name = "GrokProcessClosedError";
  constructor() {
    super("Grok ACP process is closed");
    this.name = "GrokProcessClosedError";
  }
};
function createGrokProcessTransport(options) {
  return new GrokStdioTransport(options);
}
function defaultSpawn(command, args, options) {
  const spawnOptions = {
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  };
  if (options.cwd !== void 0) {
    spawnOptions.cwd = options.cwd;
  }
  const child = spawn(command, [...args], spawnOptions);
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdin === null || stdout === null || stderr === null) {
    child.kill("SIGKILL");
    throw new GrokProcessClosedError();
  }
  const grokChild = {
    stdin,
    stdout,
    stderr,
    kill(signal) {
      return child.kill(signal);
    },
    on: bindChildEvents(child)
  };
  if (typeof child.pid === "number") {
    grokChild.pid = child.pid;
  }
  return grokChild;
}
var GrokStdioTransport = class {
  pid;
  child;
  killTimeoutMs;
  stderrRingChars;
  lineListeners = /* @__PURE__ */ new Set();
  closeListeners = /* @__PURE__ */ new Set();
  exitWaiters = [];
  stdoutCarry = "";
  stderrBuffer = "";
  closed = false;
  exited = false;
  closeEmitted = false;
  closePromise;
  killTimer;
  constructor(options) {
    this.killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
    this.stderrRingChars = options.stderrRingBytes ?? DEFAULT_STDERR_RING_CHARS;
    const spawnChild = options.spawn ?? defaultSpawn;
    const spawnOptions = {
      env: options.env ?? process.env
    };
    if (options.cwd !== void 0) {
      spawnOptions.cwd = options.cwd;
    }
    this.child = spawnChild(options.binaryPath, ["agent", "stdio"], spawnOptions);
    this.pid = this.child.pid;
    this.child.stdout.on("data", (chunk) => {
      this.handleStdout(asText(chunk));
    });
    this.child.stderr.on("data", (chunk) => {
      this.appendStderr(asText(chunk));
    });
    this.child.on("exit", (code, signal) => {
      this.handleExit({ code, signal: signal ?? null });
    });
    this.child.on("error", (error) => {
      this.handleExit({
        code: null,
        signal: null,
        reason: `${error.name}: ${error.message}`
      });
    });
  }
  send(line) {
    if (this.closed || this.child.stdin.writable === false) {
      throw new GrokProcessClosedError();
    }
    this.child.stdin.write(`${line}
`);
  }
  onLine(listener) {
    this.lineListeners.add(listener);
    return () => {
      this.lineListeners.delete(listener);
    };
  }
  onClose(listener) {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }
  stderrTail() {
    return this.stderrBuffer;
  }
  close() {
    if (this.closePromise !== void 0) {
      return this.closePromise;
    }
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }
  async closeInternal() {
    this.closed = true;
    if (this.exited) {
      return;
    }
    if (this.child.stdin.writable !== false) {
      this.child.stdin.end();
    }
    this.child.kill("SIGTERM");
    const exitedBeforeKill = await this.waitForExitOrTimeout();
    if (exitedBeforeKill || this.exited) {
      return;
    }
    this.child.kill("SIGKILL");
    await this.waitForExit();
  }
  handleStdout(chunk) {
    this.stdoutCarry += chunk;
    while (true) {
      const newlineIndex = this.stdoutCarry.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      let line = this.stdoutCarry.slice(0, newlineIndex);
      this.stdoutCarry = this.stdoutCarry.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if (line.length === 0) {
        continue;
      }
      for (const listener of [...this.lineListeners]) {
        listener(line);
      }
    }
  }
  appendStderr(chunk) {
    if (this.stderrRingChars <= 0) {
      this.stderrBuffer = "";
      return;
    }
    const next = this.stderrBuffer + chunk;
    this.stderrBuffer = next.length <= this.stderrRingChars ? next : next.slice(next.length - this.stderrRingChars);
  }
  handleExit(info) {
    this.exited = true;
    this.closed = true;
    if (this.killTimer !== void 0) {
      clearTimeout(this.killTimer);
      this.killTimer = void 0;
    }
    const waiters = this.exitWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
    if (this.closeEmitted) {
      return;
    }
    this.closeEmitted = true;
    for (const listener of [...this.closeListeners]) {
      listener(info);
    }
  }
  waitForExit() {
    if (this.exited) {
      return Promise.resolve();
    }
    return new Promise((resolve3) => {
      this.exitWaiters.push(resolve3);
    });
  }
  waitForExitOrTimeout() {
    if (this.exited) {
      return Promise.resolve(true);
    }
    return new Promise((resolve3) => {
      const onExit = () => {
        if (this.killTimer !== void 0) {
          clearTimeout(this.killTimer);
          this.killTimer = void 0;
        }
        resolve3(true);
      };
      this.exitWaiters.push(onExit);
      this.killTimer = setTimeout(() => {
        this.killTimer = void 0;
        const index = this.exitWaiters.indexOf(onExit);
        if (index >= 0) {
          this.exitWaiters.splice(index, 1);
        }
        resolve3(false);
      }, this.killTimeoutMs);
    });
  }
};
function bindChildEvents(child) {
  return ((event, listener) => child.on(event, listener));
}
function asText(chunk) {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}

// src/grok-cli-detection.ts
var GROK_VERIFIED_VERSIONS = /* @__PURE__ */ new Set(["1.0.41", "1.0.44"]);
var AGENT_ID = "grok";
var DEFAULT_HANDSHAKE_TIMEOUT_MS = 15e3;
var UNAVAILABLE_REASON_MAX = 200;
function resolveGrokBinaryCandidates(env, homeDir, platform) {
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (value) => {
    if (value === void 0 || value.length === 0 || seen.has(value)) {
      return;
    }
    seen.add(value);
    candidates.push(value);
  };
  push(env.PIWIN_GROK_BIN);
  const pathApi = platform === "win32" ? win32 : posix;
  const delimiter = platform === "win32" ? ";" : ":";
  const binaryName = platform === "win32" ? "grok.exe" : "grok";
  const pathValue = env.PATH ?? "";
  for (const entry of pathValue.split(delimiter)) {
    if (entry.length === 0) {
      continue;
    }
    push(pathApi.join(entry, binaryName));
  }
  push(pathApi.join(homeDir, ".grok", "bin", "grok"));
  return candidates;
}
async function detectGrokCli(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? pathExistsExecutable;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const checkedAt = (options.now ?? isoNow)();
  const searched = options.binaryPath !== void 0 ? [options.binaryPath] : resolveGrokBinaryCandidates(env, homeDir, platform);
  let binaryPath;
  for (const candidate of searched) {
    if (await fileExists(candidate)) {
      binaryPath = candidate;
      break;
    }
  }
  if (binaryPath === void 0) {
    return { agentId: AGENT_ID, state: "not-installed", searched, checkedAt };
  }
  const createTransport = options.createTransport ?? ((path) => createGrokProcessTransport({ binaryPath: path, env }));
  let connection;
  let status;
  try {
    connection = new JsonRpcConnection(createTransport(binaryPath), {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      defaultTimeoutMs: handshakeTimeoutMs
    });
    const result = await new AcpClient(connection).initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "piwin", version: "0" }
    });
    status = statusFromInitialize(result, binaryPath, checkedAt);
  } catch (error) {
    status = {
      agentId: AGENT_ID,
      state: "unavailable",
      binaryPath,
      reason: formatUnavailableReason(error),
      checkedAt
    };
  } finally {
    if (connection !== void 0) {
      await connection.close().catch(() => void 0);
    }
  }
  if (status.state === "ready" || status.state === "unauthenticated") {
    const readPermissionMode = options.readPermissionMode ?? readPermissionModeFromConfig;
    const permissionMode = await readPermissionMode(homeDir).catch(() => void 0);
    if (permissionMode !== void 0 && permissionMode.length > 0) {
      status.permissionMode = permissionMode;
    }
  }
  return status;
}
function statusFromInitialize(result, binaryPath, checkedAt) {
  const meta = result._meta ?? {};
  const version = meta.agentVersion;
  if (typeof version !== "string" || version.length === 0) {
    return {
      agentId: AGENT_ID,
      state: "unavailable",
      binaryPath,
      reason: "agent did not report a version",
      checkedAt
    };
  }
  const defaultAuthMethodId = typeof meta.defaultAuthMethodId === "string" ? meta.defaultAuthMethodId : void 0;
  const authenticated = defaultAuthMethodId === "cached_token" || result.authMethods === void 0 || result.authMethods.length === 0;
  const status = {
    agentId: AGENT_ID,
    state: authenticated ? "ready" : "unauthenticated",
    binaryPath,
    version,
    supportStatus: GROK_VERIFIED_VERSIONS.has(version) ? "verified" : "unverified",
    checkedAt
  };
  if (defaultAuthMethodId !== void 0) {
    status.defaultAuthMethodId = defaultAuthMethodId;
  }
  const options = new GrokSessionOptionsState();
  options.applyModels(meta.modelState);
  if (Array.isArray(meta.availableCommands)) {
    options.applyCommands(meta.availableCommands);
  }
  status.options = options.snapshot(AGENT_ID);
  return status;
}
function formatUnavailableReason(error) {
  const text2 = error instanceof Error ? `${error.name}: ${error.message}` : `Error: ${String(error)}`;
  return text2.length <= UNAVAILABLE_REASON_MAX ? text2 : text2.slice(0, UNAVAILABLE_REASON_MAX);
}
async function readPermissionModeFromConfig(homeDir) {
  try {
    const toml = await readFile(join(homeDir, ".grok", "config.toml"), "utf8");
    return readGrokPermissionMode(toml);
  } catch {
    return void 0;
  }
}
async function pathExistsExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}

// src/grok-media-proposal.ts
import { relative, resolve, sep } from "node:path";

// src/grok-output-context.ts
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
function assertSafePathSegment(id, label) {
  if (id.length === 0 || id === "." || id === ".." || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    throw new Error(`Invalid ${label}`);
  }
}
function grokSessionOutputRoot(context, home = homedir2()) {
  assertSafePathSegment(context.backendSessionId, "Grok session id");
  return join2(home, ".grok", "sessions", encodeURIComponent(context.cwd), context.backendSessionId);
}

// src/grok-media-proposal.ts
var DIRECTORY_IDS = { image: "images", video: "videos" };
function attachGrokMediaProposal(event, context) {
  if (event.type !== "tool/end" || event.isError || !event.presentation) return { event };
  const presentation = normalizeGrokMediaPresentation(event.presentation.routedToolName ?? "", event.presentation);
  if (presentation.kind !== "image" && presentation.kind !== "video") return { event: { ...event, presentation } };
  const sourcePath = presentation.targetPaths?.[0];
  const relativePath = sourcePath === void 0 ? void 0 : relativePathWithin(
    resolve(grokSessionOutputRoot(context), DIRECTORY_IDS[presentation.kind]),
    sourcePath
  );
  const presentationWithoutGrant = stripSourcePath(presentation, sourcePath, relativePath);
  if (relativePath === void 0) return { event: { ...event, presentation: presentationWithoutGrant } };
  return {
    event: { ...event, presentation: presentationWithoutGrant },
    media: [{
      directoryId: DIRECTORY_IDS[presentation.kind],
      relativePath,
      kind: presentation.kind,
      importKey: `grok:${context.backendSessionId}:${relativePath}`,
      prompt: presentation.title.replace(/^(?:imagine|image_gen|video_gen):\s*/u, ""),
      ...presentation.endedAt ? { createdAt: presentation.endedAt } : {}
    }]
  };
}
function stripSourcePath(presentation, sourcePath, relativePath) {
  const { targetPaths: _grant, output, ...rest } = presentation;
  const text2 = sourcePath && output?.text ? output.text.split(sourcePath).join(relativePath ?? "[redacted]") : output?.text;
  return {
    ...rest,
    ...relativePath ? { targetPaths: [relativePath] } : {},
    ...text2 !== void 0 && output ? { output: { ...output, text: text2 } } : {}
  };
}
function relativePathWithin(root, sourcePath) {
  const resolvedRoot = resolve(root);
  const resolvedSource = resolve(sourcePath);
  if (resolvedSource !== resolvedRoot && !resolvedSource.startsWith(resolvedRoot + sep)) return void 0;
  const value = relative(resolvedRoot, resolvedSource);
  return value.split(sep).every((segment) => segment !== ".." && segment !== "" && !segment.includes("\0")) ? value : void 0;
}

// src/grok-notification-router.ts
import { randomUUID } from "node:crypto";
function asRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
var GrokNotificationRouter = class {
  projector;
  replayBuffer;
  options;
  sink;
  constructor(options, sink) {
    this.options = options;
    this.sink = sink;
  }
  /** Start a live turn; the returned projector is closed by the caller. */
  beginTurn(runId) {
    const projector = new GrokTurnProjector({
      ...runId !== void 0 ? { runId } : {},
      createMessageId: () => `grok-${randomUUID()}`,
      ...this.sink.now ? { now: this.sink.now } : {}
    });
    this.projector = projector;
    return projector;
  }
  endTurn() {
    this.projector = void 0;
  }
  beginReplay(buffer) {
    this.replayBuffer = buffer;
    this.projector = this.createReplayProjector();
  }
  endReplay() {
    if (this.projector !== void 0 && this.replayBuffer !== void 0) {
      this.replayBuffer.push(...this.projector.finish("completed"));
    }
    this.projector = void 0;
    this.replayBuffer = void 0;
  }
  /**
   * Handle one notification. `boundSessionId` is empty until `session/new`
   * returns: Grok pushes setup-time updates before the id exists, and one
   * process serves exactly one session, so there is no cross-talk.
   */
  handle(method, params, boundSessionId) {
    const record2 = asRecord5(params);
    if (method === "_x.ai/models/update") {
      this.options.applyModels(params);
      this.sink.publishOptions();
      return;
    }
    if (method !== "session/update" || record2 === void 0) {
      return;
    }
    if (boundSessionId !== "" && record2.sessionId !== boundSessionId) {
      return;
    }
    const update = asRecord5(record2.update);
    if (this.replayBuffer !== void 0 && update?.sessionUpdate === "user_message_chunk") {
      this.replayBuffer.push(...this.replayUserMessage(update));
      return;
    }
    const projector = this.projector;
    if (projector === void 0) {
      this.applySignals(new GrokTurnProjector({ createMessageId: () => "idle" }).project(update).signals);
      return;
    }
    const projection = projector.project(update);
    if (this.replayBuffer !== void 0) {
      this.replayBuffer.push(...projection.events);
    } else {
      this.sink.emitAll(projection.events);
    }
    this.applySignals(projection.signals);
  }
  /** Replay a user row: close open assistant text, then emit a user message. */
  replayUserMessage(update) {
    const events = [];
    if (this.projector !== void 0) {
      events.push(...this.projector.finish("completed"));
    }
    this.projector = this.createReplayProjector();
    const content = asRecord5(update.content);
    const text2 = typeof content?.text === "string" ? content.text : "";
    if (text2 !== "") {
      const messageId = `grok-replay-${randomUUID()}`;
      events.push(
        { type: "message/start", messageId, role: "user" },
        { type: "message/text_delta", messageId, delta: text2 },
        { type: "message/end", messageId }
      );
    }
    return events;
  }
  createReplayProjector() {
    return new GrokTurnProjector({
      createMessageId: () => `grok-replay-${randomUUID()}`,
      ...this.sink.now ? { now: this.sink.now } : {}
    });
  }
  applySignals(signals) {
    let optionsChanged = false;
    for (const signal of signals) {
      switch (signal.kind) {
        case "title":
          this.sink.onTitle(signal.title);
          break;
        case "mode":
          this.options.confirmMode(signal.modeId);
          optionsChanged = true;
          break;
        case "commands":
          this.options.applyCommands(signal.commands);
          optionsChanged = true;
          break;
        case "config-options":
          this.options.applyConfigOptions(signal.configOptions);
          optionsChanged = true;
          break;
        case "plan":
          break;
      }
    }
    if (optionsChanged) {
      this.sink.publishOptions();
    }
  }
};

// src/grok-event-delivery.ts
var GrokEventDelivery = class {
  constructor(deliver, prepare) {
    this.deliver = deliver;
    this.prepare = prepare;
  }
  pending = Promise.resolve();
  emit(event) {
    if (!this.prepare) {
      this.deliver(event);
      return;
    }
    const prepare = this.prepare;
    this.pending = this.pending.then(async () => {
      this.deliver(await prepare(event));
    });
  }
  flush() {
    return this.pending;
  }
};

// src/grok-session-selection.ts
async function selectGrokModel(target, modelId) {
  if (!target.options.hasModel(modelId)) {
    throw new Error(`unknown-grok-model: ${modelId}`);
  }
  const result = await target.client.setConfigOption(target.backendSessionId(), "model", modelId);
  target.options.applyConfigOptions(readConfigOptions(result));
  target.options.applyConfigOptions([{ id: "model", currentValue: modelId }]);
  target.publishOptions();
}
async function selectGrokEffort(target, effortId) {
  const modelId = target.options.modelId;
  if (modelId !== void 0 && !target.options.modelSupportsEffort(modelId, effortId)) {
    throw new Error(`unsupported-grok-effort: ${effortId}`);
  }
  const result = await target.client.setConfigOption(target.backendSessionId(), "reasoning_effort", effortId);
  target.options.applyConfigOptions(readConfigOptions(result));
  target.options.applyConfigOptions([{ id: "reasoning_effort", currentValue: effortId }]);
  target.publishOptions();
}
async function selectGrokMode(target, modeId) {
  target.options.requestMode(modeId);
  target.publishOptions();
  await target.client.setMode(target.backendSessionId(), modeId);
}
async function applyGrokInitialSelections(target, input) {
  if (input.modelId !== void 0 && input.modelId !== target.options.modelId && target.options.hasModel(input.modelId)) {
    await selectGrokModel(target, input.modelId);
  }
  if (input.effortId !== void 0) {
    const modelId = target.options.modelId;
    if (modelId === void 0 || target.options.modelSupportsEffort(modelId, input.effortId)) {
      await selectGrokEffort(target, input.effortId);
    }
  }
  if (input.modeId !== void 0) {
    await selectGrokMode(target, input.modeId);
  }
}
function readConfigOptions(result) {
  return typeof result === "object" && result !== null && !Array.isArray(result) ? result.configOptions : void 0;
}

// src/grok-prompt-outcome.ts
function mapGrokPromptResult(result, context) {
  const terminal = classifyGrokStopReason(result.stopReason, {
    userCancelled: context.userCancelled,
    permissionRejected: context.permissionRejected
  });
  const usageEvent = buildUsageEvent(result, context);
  switch (terminal.status) {
    case "completed":
      return {
        outcome: { status: "completed", stopReason: terminal.stopReason },
        finish: "completed",
        ...usageEvent ? { usageEvent } : {}
      };
    case "aborted":
      return {
        outcome: terminal.reason === "permission-rejected" ? { status: "completed", stopReason: "handled" } : { status: "aborted", stopReason: "aborted" },
        finish: "aborted",
        ...usageEvent ? { usageEvent } : {}
      };
    case "failed":
      return {
        outcome: { status: "failed", stopReason: "error", failure: createUnknownAgentFailure(terminal.message) },
        finish: "failed",
        ...usageEvent ? { usageEvent } : {}
      };
  }
}
function mapGrokPromptError(error, context) {
  if (context.userCancelled) {
    return { status: "aborted", stopReason: "aborted" };
  }
  return {
    status: "failed",
    stopReason: "error",
    failure: {
      code: context.connectionClosed ? "backend-worker-crash" : "backend-protocol-error",
      origin: "protocol",
      message: `Grok: ${formatError(error)}`.slice(0, 500),
      retriable: false
    }
  };
}
function buildUsageEvent(result, context) {
  const usage = parseGrokPromptUsage(result._meta);
  const messageId = context.lastAssistantMessageId;
  if (usage === void 0 || messageId === void 0) {
    return void 0;
  }
  return {
    type: "usage/finalized",
    measurement: {
      measurementId: `${context.productSessionId}:${messageId}`,
      sessionId: context.productSessionId,
      ...context.runId !== void 0 ? { runId: context.runId } : {},
      messageId,
      ...usage.modelId !== void 0 ? { modelId: usage.modelId } : {},
      ...usage.inputTokens !== void 0 ? { promptTokens: usage.inputTokens } : {},
      ...usage.outputTokens !== void 0 ? { completionTokens: usage.outputTokens } : {},
      ...usage.cacheReadTokens !== void 0 ? { cacheReadTokens: usage.cacheReadTokens } : {},
      ...usage.cacheWriteTokens !== void 0 ? { cacheWriteTokens: usage.cacheWriteTokens } : {},
      totalTokens: usage.totalTokens,
      ...usage.durationMs !== void 0 ? { durationMs: usage.durationMs } : {},
      stopReason: result.stopReason,
      recordedAt: context.recordedAt
    }
  };
}
function toGrokContentBlocks(input) {
  const blocks = [{ type: "text", text: input.text }];
  for (const ref of input.contextRefs ?? []) {
    if (ref.kind === "file") {
      const path = `${ref.projectPath.replace(/\/$/, "")}/${ref.relativePath}`;
      blocks.push({ type: "resource_link", uri: `file://${path}`, name: ref.label });
    }
  }
  return blocks;
}
async function waitForCondition(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve3) => setTimeout(resolve3, 50));
  }
  return predicate();
}

// src/grok-session-handle.ts
var CANCEL_GRACE_MS = 5e3;
var SESSION_SETUP_TIMEOUT_MS = 6e4;
var GrokSessionHandle = class _GrokSessionHandle {
  id;
  backendAgentId = GROK_AGENT_ID;
  backendSessionId;
  client;
  connection;
  ports;
  options = new GrokSessionOptionsState();
  notifications;
  delivery;
  listeners = /* @__PURE__ */ new Set();
  interventionListeners = /* @__PURE__ */ new Set();
  promptAbort;
  userCancelled = false;
  permissionRejected = false;
  released = false;
  constructor(input) {
    this.id = input.productSessionId;
    this.backendSessionId = "";
    this.client = input.client;
    this.connection = input.connection;
    this.ports = input.ports;
    this.delivery = new GrokEventDelivery(
      (event) => {
        for (const listener of this.listeners) listener(event);
      },
      input.ports.prepareEvent ? (event) => input.ports.prepareEvent?.(event, this.backendSessionId) ?? Promise.resolve(event) : void 0
    );
    this.notifications = new GrokNotificationRouter(this.options, {
      emitAll: (events) => this.emitAll(events),
      onTitle: (title) => this.ports.onTitle(title),
      publishOptions: () => this.publishOptions(),
      ...input.ports.now ? { now: input.ports.now } : {}
    });
  }
  /** Spawn Grok, initialize, and create / resume / load the native session. */
  static async open(input, ports) {
    const connection = new JsonRpcConnection(ports.createTransport(input.cwd), {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      defaultTimeoutMs: SESSION_SETUP_TIMEOUT_MS
    });
    const client = new AcpClient(connection);
    try {
      const init = await client.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "piwin", version: "0" }
      });
      const agentVersion = typeof init._meta?.agentVersion === "string" ? init._meta.agentVersion : void 0;
      const handle = new _GrokSessionHandle({ productSessionId: input.productSessionId, client, connection, ports });
      handle.attach();
      handle.options.applyModels(init._meta?.modelState);
      const replayEvents = [];
      const mcpServers = [];
      let setup;
      if (input.backendSessionId === void 0) {
        setup = await client.newSession({ cwd: input.cwd, mcpServers });
      } else if (input.replay === true) {
        handle.notifications.beginReplay(replayEvents);
        try {
          setup = await client.loadSession({ sessionId: input.backendSessionId, cwd: input.cwd, mcpServers });
        } finally {
          handle.notifications.endReplay();
        }
      } else {
        setup = await client.resumeSession({ sessionId: input.backendSessionId, cwd: input.cwd, mcpServers });
      }
      handle.backendSessionId = setup.sessionId;
      if (ports.prepareEvent) {
        for (let index = 0; index < replayEvents.length; index += 1) {
          const event = replayEvents[index];
          if (event) replayEvents[index] = await ports.prepareEvent(event, setup.sessionId);
        }
      }
      handle.options.applyModels(setup.models);
      handle.options.applyConfigOptions(setup.configOptions);
      await applyGrokInitialSelections(handle.selectionTarget(), input);
      handle.publishOptions();
      return {
        handle,
        backendSessionId: setup.sessionId,
        ...agentVersion !== void 0 ? { agentVersion } : {},
        replayEvents
      };
    } catch (error) {
      await connection.close().catch(() => void 0);
      throw error;
    }
  }
  /** Current backend option snapshot. */
  getBackendOptions() {
    return this.options.snapshot(GROK_AGENT_ID);
  }
  async setModel(modelId) {
    await selectGrokModel(this.selectionTarget(), modelId);
  }
  async setEffort(effortId) {
    await selectGrokEffort(this.selectionTarget(), effortId);
  }
  async setMode(modeId) {
    await selectGrokMode(this.selectionTarget(), modeId);
  }
  async prompt(input) {
    if (this.released) {
      throw new Error("grok-session-released");
    }
    if (this.promptAbort !== void 0) {
      throw new Error("grok-prompt-active: Host admits one Grok prompt at a time");
    }
    const runId = this.ports.getCurrentRunId();
    const projector = this.notifications.beginTurn(runId);
    this.promptAbort = new AbortController();
    this.userCancelled = false;
    this.permissionRejected = false;
    try {
      const result = await this.client.prompt(
        { sessionId: this.backendSessionId, prompt: toGrokContentBlocks(input) },
        { signal: this.promptAbort.signal }
      );
      const mapped = mapGrokPromptResult(result, {
        productSessionId: this.id,
        runId,
        lastAssistantMessageId: projector.latestAssistantMessageId,
        userCancelled: this.userCancelled,
        permissionRejected: this.permissionRejected,
        recordedAt: this.now()
      });
      this.emitAll(projector.finish(mapped.finish));
      if (mapped.usageEvent !== void 0) {
        this.emit(mapped.usageEvent);
      }
      return mapped.outcome;
    } catch (error) {
      this.emitAll(projector.finish(this.userCancelled ? "aborted" : "failed"));
      return mapGrokPromptError(error, {
        userCancelled: this.userCancelled,
        connectionClosed: this.connection.closed
      });
    } finally {
      await this.delivery.flush();
      this.notifications.endTurn();
      this.promptAbort = void 0;
    }
  }
  async abort() {
    const active = this.promptAbort;
    if (active === void 0) {
      return;
    }
    this.userCancelled = true;
    if (!this.connection.closed) {
      try {
        this.client.cancel(this.backendSessionId);
      } catch (error) {
        this.ports.onTransportClosed(`cancel failed: ${formatError(error)}`);
      }
    }
    const settled = await waitForCondition(() => this.promptAbort !== active, CANCEL_GRACE_MS);
    if (!settled) {
      active.abort(new Error("grok-cancel-timeout"));
      await this.release();
    }
  }
  steer() {
    return Promise.reject(new Error("steer-unsupported: Grok sessions use run interventions"));
  }
  followUp() {
    return Promise.reject(new Error("follow-up-unsupported: Grok sessions use queued turns"));
  }
  /** Interject text into the running turn; applies at Grok's next step. */
  async armRunIntervention(intervention) {
    if (this.promptAbort === void 0) {
      throw new Error("run-intervention-no-active-turn");
    }
    const base = {
      interventionId: intervention.interventionId,
      revision: intervention.revision,
      runId: intervention.runId,
      runtimeGenerationId: intervention.runtimeGenerationId
    };
    const claimed = await this.emitIntervention({ type: "claim", ...base });
    if (!claimed) {
      return;
    }
    try {
      await this.client.xaiInterject(this.backendSessionId, intervention.text);
      await this.emitIntervention({ type: "applied", ...base });
    } catch (error) {
      await this.emitIntervention({ type: "failed", ...base, reason: formatError(error) });
    }
  }
  async cancelRunIntervention() {
    return false;
  }
  subscribeRunInterventions(listener) {
    this.interventionListeners.add(listener);
    return () => {
      this.interventionListeners.delete(listener);
    };
  }
  async getMessages() {
    return [];
  }
  async getTree() {
    return { root: null, activeLeafId: null };
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  needsProductHistoryInjection() {
    return false;
  }
  async release() {
    if (this.released) {
      return;
    }
    this.released = true;
    await this.connection.close();
  }
  attach() {
    this.connection.onNotification((method, params) => {
      if (method === "_x.ai/mcp/server_status") this.ports.onMcpStatus?.(params);
      this.notifications.handle(method, params, this.backendSessionId);
    });
    this.connection.setRequestHandler(
      "session/request_permission",
      (params) => this.handlePermissionRequest(params)
    );
    this.connection.onClose((info) => {
      if (!this.released) {
        this.released = true;
        this.ports.onTransportClosed(info.reason ?? `exit ${String(info.code)}`);
      }
    });
  }
  selectionTarget() {
    return {
      client: this.client,
      options: this.options,
      backendSessionId: () => this.backendSessionId,
      publishOptions: () => this.publishOptions()
    };
  }
  async handlePermissionRequest(params) {
    const prompt = parseGrokPermissionRequest(params, GROK_AGENT_ID);
    if (prompt === void 0) {
      return { outcome: { outcome: "cancelled" } };
    }
    const signal = this.promptAbort?.signal ?? new AbortController().signal;
    const decision = await this.ports.requestPermission({ sessionId: this.id, prompt, signal });
    if ("cancelled" in decision) {
      return { outcome: { outcome: "cancelled" } };
    }
    const chosen = prompt.options.find((option) => option.optionId === decision.optionId);
    if (chosen === void 0) {
      return { outcome: { outcome: "cancelled" } };
    }
    if (chosen.kind === "reject_once" || chosen.kind === "reject_always") {
      this.permissionRejected = true;
    }
    return { outcome: { outcome: "selected", optionId: chosen.optionId } };
  }
  async emitIntervention(event) {
    let accepted = false;
    for (const listener of this.interventionListeners) {
      const result = await listener(event);
      accepted = accepted || result.accepted;
    }
    return accepted;
  }
  publishOptions() {
    this.ports.onOptionsChanged(this.getBackendOptions());
  }
  emit(event) {
    this.delivery.emit(event);
  }
  emitAll(events) {
    for (const event of events) {
      this.emit(event);
    }
  }
  now() {
    return this.ports.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
  }
};

// src/grok-workflows.ts
import { constants as constants2 } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { resolve as resolve2, sep as sep2 } from "node:path";
async function readGrokWorkflows(context) {
  const root = grokSessionOutputRoot(context);
  const workflows = [];
  for (const id of await listWorkflowIds(root)) {
    const raw = await readBoundedFile(root, `workflows/${id}/state.json`, 128 * 1024);
    if (!raw) continue;
    const snapshot = projectGrokWorkflow(JSON.parse(raw), context.sessionId);
    if (!snapshot || snapshot.workflowId !== id) continue;
    const report = await readBoundedFile(root, `workflows/${id}/scratch/report.md`, 256 * 1024);
    workflows.push({ ...snapshot, reportAvailable: Boolean(report?.trim()) });
  }
  return workflows;
}
async function readGrokWorkflowReport(context, workflowId) {
  if (!/^wf_[a-zA-Z0-9_-]+$/.test(workflowId)) return void 0;
  const text2 = await readBoundedFile(grokSessionOutputRoot(context), `workflows/${workflowId}/scratch/report.md`, 256 * 1024);
  return text2?.trim() ? text2 : void 0;
}
async function listWorkflowIds(root) {
  try {
    const realRoot = await realpath(root);
    const directory = await realpath(resolve2(root, "workflows"));
    if (!directory.startsWith(realRoot + sep2)) throw new Error("workflow directory escapes session root");
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^wf_[a-zA-Z0-9_-]+$/.test(entry.name)).map((entry) => entry.name).sort().reverse().slice(0, 8);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
async function readBoundedFile(root, relativePath, maxBytes) {
  const target = resolve2(root, relativePath);
  if (!target.startsWith(resolve2(root) + sep2)) throw new Error("workflow path escapes session root");
  try {
    const realRoot = await realpath(root);
    const realTarget = await realpath(target);
    if (!realTarget.startsWith(realRoot + sep2)) throw new Error("workflow symlink escapes session root");
    const handle = await open(realTarget, constants2.O_RDONLY | constants2.O_NOFOLLOW);
    try {
      const details = await handle.stat();
      if (!details.isFile() || details.size > maxBytes) throw new Error("workflow file exceeds read limit");
      const bytes = Buffer.alloc(details.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return bytes.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissing(error)) return void 0;
    throw error;
  }
}
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// src/plugin-server.ts
async function serveAgentPlugin(io) {
  const env = io.env ?? process.env;
  const pending = /* @__PURE__ */ new Map();
  const slots = /* @__PURE__ */ new Map();
  let binaryPath;
  let initialized = false;
  let stopped = false;
  let writeChain = Promise.resolve();
  const write = (frame) => {
    const line = `${JSON.stringify(frame)}
`;
    writeChain = writeChain.then(() => new Promise((resolve3, reject) => {
      io.output.write(line, (error) => error ? reject(error) : resolve3());
    }));
  };
  const fail2 = (frame, code, message) => {
    write({ protocolVersion: 1, kind: "response", scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: false, error: { code, message } });
  };
  const callHost = (scope, method, params) => {
    const requestId = randomUUID2();
    return new Promise((resolve3, reject) => {
      pending.set(requestId, { resolve: resolve3, reject });
      write({ protocolVersion: 1, kind: "request", scope, requestId, method, params });
    });
  };
  const emit = (scope, emission) => {
    write({ protocolVersion: 1, kind: "event", scope, emission });
  };
  const lines = createInterface({ input: io.input });
  const done = new Promise((resolve3) => {
    lines.on("close", () => resolve3());
  });
  lines.on("line", (line) => {
    void handleLine(line).catch((error) => {
      io.output.emit("error", error instanceof Error ? error : new Error(formatError(error)));
    });
  });
  await done;
  await releaseAll();
  async function handleLine(line) {
    if (stopped || line.trim() === "") return;
    const frame = parseAgentPluginFrame(line);
    if (frame.kind === "response") {
      const waiter = pending.get(frame.requestId);
      pending.delete(frame.requestId);
      if (!waiter) return;
      frame.ok ? waiter.resolve(frame.result) : waiter.reject(new Error(frame.error.message));
      return;
    }
    if (frame.kind !== "request") return;
    try {
      const result = await dispatch(frame);
      write({ protocolVersion: 1, kind: "response", scope: frame.scope, requestId: frame.requestId, method: frame.method, ok: true, result });
      if (frame.method === "plugin/dispose") stopped = true;
    } catch (error) {
      fail2(frame, error instanceof PluginRequestError ? error.code : "backend-error", formatError(error));
    }
  }
  async function dispatch(frame) {
    if (frame.method === "plugin/initialize") return initialize(frame.params);
    if (!initialized) throw new PluginRequestError("unavailable", "plugin is not initialized");
    switch (frame.method) {
      case "check":
        return detectGrokCli({ env, ...binaryPath ? { binaryPath } : {} });
      case "catalog/list":
        return (await withClient(void 0, (client) => client.xaiListSessions())).map(projectGrokCatalogEntry);
      case "catalog/rename":
        return catalogMutate(frame.params, (client, id, title) => client.xaiRenameSession(id, title));
      case "catalog/delete":
        return catalogMutate(frame.params, (client, id) => client.xaiDeleteSession(id));
      case "session/new":
        return openSession(frame, true);
      case "session/load":
        return openSession(frame, false, true);
      case "session/resume":
        return openSession(frame, false, false);
      case "session/prompt":
        return prompt(frame);
      case "session/cancel":
        await requireSlot(frame).handle.abort();
        return null;
      case "session/options":
        return requireSlot(frame).handle.getBackendOptions();
      case "session/model":
        return select(frame, "model");
      case "session/effort":
        return select(frame, "effort");
      case "session/mode":
        return select(frame, "mode");
      case "session/commands":
        return requireSlot(frame).handle.getBackendOptions().commands;
      case "session/interject":
        await requireSlot(frame).handle.armRunIntervention(parseIntervention(frame.params));
        return null;
      case "session/interject-cancel":
        return requireSlot(frame).handle.cancelRunIntervention();
      case "session/mcp-status":
        return { servers: requireSlot(frame).mcp, observed: requireSlot(frame).mcpObserved };
      case "session/workflows":
        return readGrokWorkflows(outputContext(requireSlot(frame)));
      case "session/workflow-report":
        return workflowReport(frame);
      case "session/release":
        await release(frame.scope.kind === "session" ? frame.scope.sessionId : "");
        return null;
      case "plugin/dispose":
        await releaseAll();
        return null;
      default:
        throw new PluginRequestError("unavailable", "method is not served by this adapter");
    }
  }
  function initialize(params) {
    const record2 = asRecord6(params);
    const runtime = asRecord6(record2?.runtime);
    if (record2?.agentId !== "grok" || typeof record2.pluginRevision !== "string" || record2.hostProtocolVersion !== 1) {
      throw new PluginRequestError("invalid-request", "unsupported plugin initialization");
    }
    if (typeof runtime?.binaryPath === "string") binaryPath = runtime.binaryPath;
    initialized = true;
    return { agentId: "grok", protocolVersion: 1 };
  }
  async function openSession(frame, create, replay = false) {
    if (frame.scope.kind !== "session") throw new PluginRequestError("invalid-request", "session scope required");
    const params = asRecord6(frame.params);
    const binding = asRecord6(params?.binding);
    const cwd = params?.cwd;
    const backendSessionId = typeof binding?.backendSessionId === "string" ? binding.backendSessionId : void 0;
    if (typeof cwd !== "string" || cwd.length === 0 || binding?.agentId !== "grok" || !create && backendSessionId === void 0) {
      throw new PluginRequestError("invalid-request", "invalid session open");
    }
    const path = await requireBinary();
    await release(frame.scope.sessionId);
    const scope = frame.scope;
    const slot = { scope, handle: void 0, cwd, mcp: [], mcpObserved: false };
    const ports = {
      createTransport: (sessionCwd) => createGrokProcessTransport({ binaryPath: path, cwd: sessionCwd, env }),
      requestPermission: async ({ prompt: prompt2 }) => parseDecision(await callHost(scope, "permission/request", {
        action: prompt2.action,
        detail: prompt2.detail,
        context: prompt2.context,
        options: prompt2.options,
        ...slot.runId ? { runId: slot.runId } : {}
      })),
      onOptionsChanged: (options) => emit(scope, { type: "options", options }),
      onTitle: (title) => emit(scope, { type: "title", title }),
      onTransportClosed: (reason) => emit(scope, { type: "closed", reason }),
      getCurrentRunId: () => slot.runId,
      onMcpStatus: (value) => {
        const status = projectGrokMcpStatus(value);
        slot.mcpObserved = true;
        if (!status) return;
        slot.mcp = [...slot.mcp.filter((server) => server.name !== status.name), status];
        emit(scope, { type: "mcp-status", servers: slot.mcp, observed: true });
      }
    };
    const opened = await GrokSessionHandle.open({
      productSessionId: scope.sessionId,
      cwd,
      ...!create && backendSessionId !== void 0 ? { backendSessionId, replay } : {}
    }, ports);
    slot.handle = opened.handle;
    slots.set(scope.sessionId, slot);
    opened.handle.subscribe((event) => emitAgent(slot, event));
    opened.handle.subscribeRunInterventions(async (event) => {
      const result = asRecord6(await callHost(scope, "intervention/event", event));
      return { accepted: result?.accepted === true };
    });
    return {
      backendSessionId: opened.backendSessionId,
      ...opened.agentVersion !== void 0 ? { agentVersion: opened.agentVersion } : {},
      capabilities: createGrokSessionCapabilities(),
      options: opened.handle.getBackendOptions(),
      replayEvents: opened.replayEvents.map((event) => {
        const proposed = emissionFor(slot, event);
        return proposed.media ? { type: "agent", event: proposed.event, media: proposed.media } : { type: "agent", event: proposed.event };
      })
    };
  }
  async function prompt(frame) {
    const slot = requireSlot(frame);
    const params = asRecord6(frame.params);
    const input = asRecord6(params?.input);
    if (typeof params?.runId !== "string" || typeof input?.text !== "string") throw new PluginRequestError("invalid-request", "invalid prompt");
    if (Array.isArray(input.images) && input.images.length > 0) throw new PluginRequestError("unavailable", "Grok does not accept images yet");
    slot.runId = params.runId;
    return slot.handle.prompt(input);
  }
  async function select(frame, kind) {
    const slot = requireSlot(frame);
    const id = asRecord6(frame.params)?.[`${kind}Id`];
    if (typeof id !== "string") throw new PluginRequestError("invalid-request", `missing ${kind}`);
    if (kind === "model") await slot.handle.setModel(id);
    else if (kind === "effort") await slot.handle.setEffort(id);
    else await slot.handle.setMode(id);
    return slot.handle.getBackendOptions();
  }
  async function workflowReport(frame) {
    const slot = requireSlot(frame);
    const workflowId = asRecord6(frame.params)?.workflowId;
    if (typeof workflowId !== "string") throw new PluginRequestError("invalid-request", "invalid workflow id");
    const text2 = await readGrokWorkflowReport(outputContext(slot), workflowId);
    if (text2 === void 0) throw new PluginRequestError("unavailable", "workflow report not found");
    return { workflowId, text: text2 };
  }
  async function catalogMutate(params, run) {
    const record2 = asRecord6(params);
    if (typeof record2?.backendSessionId !== "string" || record2.title !== void 0 && typeof record2.title !== "string") {
      throw new PluginRequestError("invalid-request", "invalid catalog change");
    }
    await withClient(void 0, (client) => run(client, record2.backendSessionId, typeof record2.title === "string" ? record2.title : ""));
    return null;
  }
  async function withClient(cwd, run) {
    const path = await requireBinary();
    const connection = new JsonRpcConnection(createGrokProcessTransport({ binaryPath: path, ...cwd ? { cwd } : {}, env }), {
      droppedNotificationMethods: GROK_DROPPED_NOTIFICATION_METHODS,
      defaultTimeoutMs: 15e3
    });
    try {
      const client = new AcpClient(connection);
      await client.initialize({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "piwin", version: "0" } });
      return await run(client);
    } finally {
      await connection.close().catch(() => void 0);
    }
  }
  async function requireBinary() {
    if (binaryPath !== void 0) return binaryPath;
    const status = await detectGrokCli({ env });
    if (status.state === "not-installed") throw new PluginRequestError("unavailable", "Grok CLI is not installed");
    binaryPath = status.binaryPath;
    return status.binaryPath;
  }
  function requireSlot(frame) {
    if (frame.scope.kind !== "session") throw new PluginRequestError("invalid-request", "session scope required");
    const slot = slots.get(frame.scope.sessionId);
    if (!slot || slot.scope.runtimeGenerationId !== frame.scope.runtimeGenerationId) {
      throw new PluginRequestError("unavailable", "session is not open in this generation");
    }
    return slot;
  }
  function emitAgent(slot, event) {
    const proposed = emissionFor(slot, event);
    emit(slot.scope, proposed.media ? { type: "agent", event: proposed.event, media: proposed.media } : { type: "agent", event: proposed.event });
  }
  function emissionFor(slot, event) {
    return attachGrokMediaProposal(event, outputContext(slot));
  }
  function outputContext(slot) {
    return { sessionId: slot.scope.sessionId, backendSessionId: slot.handle.backendSessionId, cwd: slot.cwd };
  }
  async function release(sessionId) {
    const slot = slots.get(sessionId);
    slots.delete(sessionId);
    await slot?.handle.release();
  }
  async function releaseAll() {
    await Promise.all([...slots.keys()].map((sessionId) => release(sessionId)));
  }
}
var PluginRequestError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  name = "PluginRequestError";
};
function parseDecision(value) {
  const record2 = asRecord6(value);
  if (record2?.cancelled === true) return { cancelled: true };
  if (typeof record2?.optionId === "string") return { optionId: record2.optionId };
  return { cancelled: true };
}
function parseIntervention(value) {
  const record2 = asRecord6(value);
  if (!record2 || typeof record2.interventionId !== "string" || typeof record2.revision !== "number" || typeof record2.sessionId !== "string" || typeof record2.runId !== "string" || typeof record2.runtimeGenerationId !== "string" || typeof record2.sequence !== "number" || typeof record2.text !== "string") {
    throw new PluginRequestError("invalid-request", "invalid interjection");
  }
  return {
    interventionId: record2.interventionId,
    revision: record2.revision,
    sessionId: record2.sessionId,
    runId: record2.runId,
    runtimeGenerationId: record2.runtimeGenerationId,
    sequence: record2.sequence,
    text: record2.text
  };
}
function asRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}

// src/main.ts
await serveAgentPlugin({ input: process.stdin, output: process.stdout });
