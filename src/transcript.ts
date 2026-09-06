import type {
  ControlUiPanel,
  ControlUiSurfaceProps,
  ControlUiViewContext,
} from "openclaw/plugin-sdk/control-ui";
import { parseLocalFileTarget, renderMarkdown } from "./markdown.ts";
import styles from "./styles.ts";
import { chooseTranscript } from "./ui-preference.ts";

type ViewProps = Pick<ControlUiSurfaceProps["transcript"], "sessionKey" | "agentId"> &
  Partial<Pick<ControlUiSurfaceProps["transcript"], "messages" | "stream" | "loading">>;
type ViewContext = ControlUiViewContext<ViewProps>;
type Capabilities = { nativeOpen: boolean; sessionId?: string; root?: string };
type Preview = {
  sessionKey: string;
  agentId: string;
  path: string;
  expectedSessionId?: string;
  expectedRoot?: string;
  nativeOpen: boolean;
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function capabilities(value: unknown): Capabilities {
  if (!record(value)) return { nativeOpen: false };
  return {
    nativeOpen: value.nativeOpen === true,
    ...(nonempty(value.sessionId) ? { sessionId: value.sessionId } : {}),
    ...(nonempty(value.root) ? { root: value.root } : {}),
  };
}

/** A complete plugin-owned view. It never reaches into the host's built-in DOM. */
function mountView(container: HTMLElement, initial: ViewContext, showTranscript: boolean) {
  const document = container.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const element = node("section");
  const shadow = element.attachShadow({ mode: "open" });
  const stylesheet = node("style", styles);
  const shell = node("div");
  shell.className = "extras-shell";
  const header = node("header");
  header.append(node("h2", "Math & Files"));
  const explanation = node("p", showTranscript
    ? "Plugin transcript · The composer and session remain managed by OpenClaw."
    : "Preview a session file. Opening its default application always requires your click.");
  explanation.className = "muted";
  header.append(explanation);
  const grid = node("div");
  grid.className = showTranscript ? "extras-grid" : "extras-grid panel-only";
  const transcript = node("div");
  transcript.className = "transcript";
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-label", "Math & Files transcript");
  const previewPane = node("section");
  previewPane.className = "preview";
  previewPane.setAttribute("aria-label", "File preview");
  previewPane.hidden = true;
  if (showTranscript) grid.append(transcript);
  grid.append(previewPane);
  shell.append(header);
  let current = initial;
  let generation = 0;
  let disposed = false;
  let selected: Preview | undefined;
  let openButton: HTMLButtonElement | undefined;
  let status: HTMLElement | undefined;
  let busy = false;
  const alive = () => !disposed && !current.signal.aborted && current.presented !== false;
  const valid = (epoch: number) => alive() && epoch === generation;
  const identity = () => ({ sessionKey: current.props.sessionKey, agentId: current.props.agentId });
  const canOpen = () => Boolean(alive() && current.host.connection.connected && current.host.connection.canAdmin && selected?.nativeOpen && selected.expectedSessionId && selected.expectedRoot);
  const syncButton = () => { if (openButton) openButton.disabled = busy || !canOpen(); };
  const connectionState = () => `${current.host.connection.connected}:${current.host.connection.canRead}:${current.host.connection.canAdmin}`;
  let lastConnection = connectionState();
  const onHostChange = () => {
    const next = connectionState();
    if (next !== lastConnection) clearPreview();
    lastConnection = next;
    syncButton();
  };

  function clearPreview() {
    generation += 1;
    selected = undefined;
    openButton = undefined;
    status = undefined;
    busy = false;
    previewPane.replaceChildren();
    previewPane.hidden = true;
    grid.classList.remove("preview-open");
  }
  function showStatus(message: string, error = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("preview-error", error);
  }
  function beginPreview() {
    clearPreview();
    previewPane.hidden = false;
    grid.classList.add("preview-open");
    const heading = node("h3", "File preview");
    status = node("p", "Loading file preview…");
    status.className = "preview-status";
    status.setAttribute("role", "status");
    previewPane.append(heading, status);
  }

  async function openNative() {
    if (busy || !canOpen() || !selected) return;
    const target = selected;
    const epoch = generation;
    const host = current.host;
    busy = true;
    syncButton();
    showStatus("Checking file access…");
    try {
      const latest = capabilities(await host.request("dashboardExtras.capabilities", { sessionKey: target.sessionKey, agentId: target.agentId }));
      if (!valid(epoch) || selected !== target) return;
      if (!canOpen() || !latest.nativeOpen || latest.sessionId !== target.expectedSessionId || latest.root !== target.expectedRoot) {
        target.nativeOpen = false;
        showStatus("The session or workspace changed. Preview the file again before opening it.", true);
        return;
      }
      const result = await host.request("dashboardExtras.openLocalFile", {
        sessionKey: target.sessionKey,
        agentId: target.agentId,
        path: target.path,
        expectedSessionId: target.expectedSessionId,
        expectedRoot: target.expectedRoot,
      });
      if (!valid(epoch) || selected !== target) return;
      if (record(result) && result.opened === true) {
        showStatus("Opened in the default application.");
      } else {
        showStatus("Could not open this file. Check that it still exists and is allowed for this session.", true);
      }
    } catch {
      if (valid(epoch)) showStatus("Could not open this file. Check your connection and file permissions, then try again.", true);
    } finally {
      if (valid(epoch)) { busy = false; syncButton(); }
    }
  }

  async function previewFile(rawPath: string) {
    if (!alive()) return;
    const path = parseLocalFileTarget(rawPath);
    beginPreview();
    if (!path || !nonempty(current.props.sessionKey) || !nonempty(current.props.agentId)) {
      showStatus("File preview is unavailable because the file target or session identity could not be verified.", true);
      return;
    }
    const scope = { sessionKey: current.props.sessionKey, agentId: current.props.agentId };
    const epoch = generation;
    const host = current.host;
    try {
      // Availability failure must not take down mathematical rendering or a read-only preview.
      let access: Capabilities = { nativeOpen: false };
      try { access = capabilities(await host.request("dashboardExtras.capabilities", scope)); } catch { /* native opening remains unavailable */ }
      if (!valid(epoch)) return;
      const response = await host.request("sessions.files.get", { ...scope, path });
      if (!valid(epoch)) return;
      if (!record(response) || response.sessionKey !== scope.sessionKey || !record(response.file) || !nonempty(response.file.path)) {
        showStatus("File preview is unavailable because the session response could not be verified.", true);
        return;
      }
      const file = response.file;
      const rootMatches = nonempty(access.root) && response.root === access.root;
      const name = node("p", nonempty(file.name) ? file.name : "Selected file");
      name.className = "preview-name";
      previewPane.insertBefore(name, status ?? null);
      if (file.missing === true) {
        showStatus("This file is missing or no longer available to the session.", true);
        return;
      }
      if (typeof file.content === "string" && file.contentEncoding !== "base64" && file.previewKind !== "unsupported" && file.previewKind !== "image") {
        previewPane.insertBefore(node("pre", file.content), status ?? null);
      } else {
        previewPane.insertBefore(node("p", "This binary file cannot be previewed as text. You can open it explicitly when native opening is available."), status ?? null);
      }
      selected = {
        ...scope,
        path: file.path as /* Validated by nonempty(response.file.path) above. */ string,
        expectedSessionId: access.sessionId,
        expectedRoot: rootMatches ? access.root : undefined,
        nativeOpen: access.nativeOpen && rootMatches,
      };
      const actions = node("div");
      actions.className = "preview-actions";
      openButton = node("button", "Open in Default Application");
      openButton.type = "button";
      openButton.addEventListener("click", () => { void openNative(); });
      const close = node("button", "Close preview");
      close.type = "button";
      close.addEventListener("click", clearPreview);
      actions.append(openButton, close);
      previewPane.append(actions);
      showStatus(canOpen()
        ? "Previewing a file never opens another application."
        : "Native opening is unavailable: administrator access and verified local session metadata are required.");
      syncButton();
    } catch {
      if (valid(epoch)) showStatus("Could not load this file preview. Check the file path and session access, then try again.", true);
    }
  }

  function structured(parent: HTMLElement, label: string, value: unknown) {
    const details = node("details");
    details.append(node("summary", label));
    const seen = new WeakSet<object>();
    let text: string;
    try {
      text = JSON.stringify(value, (_key, child: unknown) => {
        if (typeof child === "bigint") return String(child);
        if (typeof child === "object" && child !== null) {
          if (seen.has(child)) return "[Repeated reference]";
          seen.add(child);
        }
        return child;
      }, 2) ?? String(value);
    } catch { text = "Structured content could not be decoded."; }
    const content = node("pre", text.length > 16000 ? `${text.slice(0, 16000)}\n… ${text.length - 16000} additional characters` : text);
    details.append(content);
    if (text.length > 16000) {
      const expand = node("button", "Show complete structured content");
      expand.type = "button";
      expand.addEventListener("click", () => { content.textContent = text; expand.remove(); });
      details.append(expand);
    }
    parent.append(details);
  }
  function markdown(parent: HTMLElement, source: string) {
    const body = node("div");
    body.className = "markdown";
    // The shared renderer performs pre-Markdown math extraction and sanitization.
    body.innerHTML = renderMarkdown(source);
    parent.append(body);
  }
  function block(parent: HTMLElement, value: unknown) {
    if (typeof value === "string") { markdown(parent, value); return; }
    if (record(value) && (value.type === "text" || value.type === "output_text") && typeof value.text === "string") {
      markdown(parent, value.text);
      return;
    }
    if (record(value) && value.type === "thinking" && typeof value.thinking === "string") {
      const details = node("details");
      details.append(node("summary", "Reasoning"));
      markdown(details, value.thinking);
      parent.append(details);
      return;
    }
    const kind = record(value) && typeof value.type === "string" ? value.type : "Structured content";
    structured(parent, record(value) && typeof value.name === "string" ? `${kind}: ${value.name}` : kind, value);
  }
  function message(value: unknown) {
    const article = node("article");
    article.className = "message";
    const item = record(value) && record(value.message) ? value.message : value;
    const role = node("div", record(item) && typeof item.role === "string" ? item.role : "Message");
    role.className = "message-role";
    article.append(role);
    if (record(item) && "content" in item) {
      if (Array.isArray(item.content)) {
        if (item.content.length === 0) structured(article, "Message details", item);
        for (const content of item.content) block(article, content);
      } else block(article, item.content);
      const extras = Object.fromEntries(Object.entries(item).filter(([key]) => !["role", "content", "id", "timestamp"].includes(key)));
      if (Object.keys(extras).length) structured(article, "Message details", extras);
    } else if (typeof item === "string") markdown(article, item);
    else structured(article, "Message details", item);
    return article;
  }
  function renderTranscript() {
    if (!showTranscript) return;
    const atEnd = transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 40;
    const oldOffset = transcript.scrollTop;
    transcript.replaceChildren();
    if (current.props.loading) {
      const loading = node("p", "Loading messages…");
      loading.className = "loading muted";
      transcript.append(loading);
    }
    const messages = current.props.messages ?? [];
    for (const value of messages) transcript.append(message(value));
    if (current.props.stream) {
      const stream = node("article");
      stream.className = "message stream";
      stream.append(node("h3", "Assistant · streaming"));
      markdown(stream, current.props.stream);
      transcript.append(stream);
    }
    if (!messages.length && !current.props.stream && !current.props.loading) transcript.append(node("p", "No messages in the current transcript snapshot."));
    transcript.scrollTop = atEnd ? transcript.scrollHeight : oldOffset;
  }
  const activateLink = (event: Event) => {
    const target = event.target;
    if (!(target instanceof document.defaultView!.Element)) return;
    const anchor = target.closest<HTMLElement>("a[data-file-path]");
    if (!anchor || !shadow.contains(anchor)) return;
    const path = anchor.dataset.filePath;
    if (!path) return;
    event.preventDefault();
    void previewFile(path);
  };
  shadow.addEventListener("click", activateLink);
  shadow.addEventListener("keydown", event => {
    const key = (event as KeyboardEvent).key;
    if (key === "Enter" || key === " ") activateLink(event);
  });
  if (!showTranscript) {
    const form = node("form");
    form.className = "panel-input";
    const input = node("input");
    input.type = "text";
    input.placeholder = "Session file path";
    input.setAttribute("aria-label", "Session file path");
    const submit = node("button", "Preview file");
    submit.type = "submit";
    form.append(input, submit);
    form.addEventListener("submit", event => { event.preventDefault(); void previewFile(input.value); });
    shell.append(form);
  } else {
    const restore = node("button", "Use built-in transcript");
    restore.type = "button";
    restore.addEventListener("click", () => { if (alive()) chooseTranscript(current.host, "builtin"); });
    header.append(restore);
  }
  shell.append(grid);
  shadow.append(stylesheet, shell);
  container.append(element);
  let stopHost = current.host.subscribe(onHostChange);
  const onAbort = () => clearPreview();
  current.signal.addEventListener("abort", onAbort, { once: true });
  renderTranscript();
  return {
    update(next: ViewContext) {
      if (disposed) return;
      const previous = identity();
      const changedHost = next.host !== current.host;
      if (next.props.sessionKey !== previous.sessionKey || next.props.agentId !== previous.agentId || next.presented === false || next.signal !== current.signal || changedHost) clearPreview();
      if (next.signal !== current.signal) {
        current.signal.removeEventListener("abort", onAbort);
        next.signal.addEventListener("abort", onAbort, { once: true });
      }
      if (changedHost) stopHost();
      current = next;
      if (changedHost) stopHost = current.host.subscribe(onHostChange);
      onHostChange();
      renderTranscript();
      syncButton();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPreview();
      current.signal.removeEventListener("abort", onAbort);
      stopHost();
      element.remove();
    },
  };
}

export function mountTranscript(container: HTMLElement, context: ControlUiViewContext<ControlUiSurfaceProps["transcript"]>) {
  return mountView(container, context, true);
}

export function mountFilePanel(container: HTMLElement, context: Parameters<ControlUiPanel["mount"]>[1]) {
  return mountView(container, context, false);
}
