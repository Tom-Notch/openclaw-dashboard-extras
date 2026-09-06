import type { ControlUiSurfaceProps, ControlUiViewContext } from 'openclaw/plugin-sdk/control-ui';
import { enhanceNativeMath } from './native-math.ts';

type Context = ControlUiViewContext<ControlUiSurfaceProps['transcript']>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value) && !/[\x00-\x1f\x7f]/u.test(value);
type Binding = { path: string; sessionId: string; root: string };
type Action = { view: HTMLElement; path: string; button?: HTMLButtonElement; status?: HTMLElement; binding?: Binding; busy: boolean; active: boolean };

/** Compose the actual host transcript; the adapter owns no messages or chat state. */
export function mountNativeTranscript(container: HTMLElement, initial: Context) {
  const document = container.ownerDocument;
  const native = document.createElement('div');
  native.style.display = 'contents';
  native.dataset.dashboardExtrasNative = '';
  container.append(native);
  const unmount = initial.mountDefault(native);
  // The transcript API gives the correct pane identity even with split sessions.
  // This single documented DOM seam reaches only its enclosing pane's file
  // toolbar. Never traverse the document or use a globally selected session.
  const pane = container.closest<HTMLElement>('openclaw-chat-pane') ?? container;
  let current = initial;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const actions = new Map<HTMLElement, Action>();
  const mathSnapshots = new WeakMap<HTMLElement, string>();
  const live = () => !disposed && !current.signal.aborted && current.presented !== false;
  const connected = () => live() && current.host.connection.connected && current.host.connection.canRead;
  const scope = () => ({ sessionKey: current.props.sessionKey, agentId: current.props.agentId });
  function pathOf(view: HTMLElement): string {
    if (view.matches('.sidebar-file-view')) return view.querySelector('.sidebar-file-view__path')?.getAttribute('title') ?? '';
    // Images and unsupported binary files have no text editor/path toolbar.
    // Only the native workspace-file preview shapes are eligible, never an
    // arbitrary attachment URL or HTML link. The RPC still revalidates the file.
    const content = (view as HTMLElement & { content?: unknown }).content;
    if (!record(content)) return '';
    if (content.kind === 'image' && text(content.rawText) && typeof content.src === 'string' && content.src.startsWith('data:image/')) return content.rawText;
    if (content.kind === 'markdown' && typeof content.rawText === 'string' && content.rawText.startsWith('This file is not previewable inline.')) {
      const match = /^- Path: (`+)([^\r\n]+)\1$/mu.exec(content.rawText);
      return match?.[2] ?? '';
    }
    return '';
  }
  function actionTarget(view: HTMLElement): Element | null {
    return view.matches('.sidebar-file-view') ? view.querySelector('.sidebar-file-view__footer') : view.querySelector('.sidebar-content');
  }
  const valid = (action: Action) => connected() && action.active && pane.contains(action.view) && pathOf(action.view) === action.path;
  const label = /^zh/iu.test(current.host.locale) ? '用默认应用打开' : 'Open in Default Application';

  function retire(action: Action) {
    action.active = false; action.button?.remove(); action.status?.remove(); actions.delete(action.view);
  }
  function clearActions() { for (const action of [...actions.values()]) retire(action); }
  function notice(action: Action, value: string) {
    if (!valid(action)) return;
    action.status ??= document.createElement('span');
    action.status.setAttribute('role', 'status');
    action.status.style.fontSize = '12px';
    action.status.style.color = 'var(--muted, currentColor)';
    action.status.textContent = value;
    action.status.style.display = 'block';
    action.status.style.padding = '4px 12px';
    action.view.append(action.status);
  }

  async function open(action: Action) {
    if (!valid(action) || !current.host.connection.canAdmin || action.busy || !action.binding) return;
    const binding = action.binding;
    action.busy = true;
    if (action.button) action.button.disabled = true;
    try {
      const latest = await current.host.request('dashboardExtras.capabilities', scope());
      if (!valid(action) || !current.host.connection.canAdmin) return;
      if (!record(latest) || latest.nativeOpen !== true || latest.sessionId !== binding.sessionId || latest.root !== binding.root) {
        action.binding = undefined; notice(action, 'Session changed. Preview the file again.'); return;
      }
      const result = await current.host.request('dashboardExtras.openLocalFile', {
        ...scope(), path: binding.path, expectedSessionId: binding.sessionId, expectedRoot: binding.root,
      });
      if (valid(action)) notice(action, record(result) && result.opened === true ? 'Opened in the default application.' : 'Could not open this file. Check file access and try again.');
    } catch { notice(action, 'Could not open this file. Check your connection and try again.'); }
    finally { action.busy = false; if (action.button) action.button.disabled = !valid(action) || !action.binding || !current.host.connection.canAdmin; }
  }

  async function attachAction(action: Action) {
    try {
      const access = await current.host.request('dashboardExtras.capabilities', scope());
      if (!valid(action) || !current.host.connection.canAdmin || !record(access) || access.nativeOpen !== true || !text(access.sessionId) || !text(access.root)) return;
      const file = await current.host.request('sessions.files.get', { ...scope(), path: action.path });
      if (!valid(action) || !current.host.connection.canAdmin || !record(file) || file.sessionKey !== current.props.sessionKey || file.root !== access.root || !record(file.file) || !text(file.file.path) || file.file.missing === true) return;
      const toolbar = actionTarget(action.view);
      if (!toolbar) return;
      action.binding = { path: file.file.path, sessionId: access.sessionId, root: access.root };
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn--sm'; button.textContent = label;
      button.dataset.dashboardExtrasOpen = ''; button.title = label;
      button.addEventListener('click', () => { void open(action); });
      action.button = button;
      if (action.view.matches('.sidebar-file-view')) toolbar.prepend(button);
      else { button.style.margin = '8px 12px'; toolbar.append(button); }
    } catch { /* Optional feature unavailable; native preview and Gateway stay intact. */ }
  }

  function scan() {
    timer = undefined;
    if (!live()) { clearActions(); return; }
    observer.disconnect();
    try {
      for (const bubble of native.querySelectorAll<HTMLElement>('[data-message-text]')) {
        const signature = `${bubble.getAttribute('data-message-text')}\0${[...bubble.querySelectorAll('.chat-text')].map(node => node.innerHTML).join('\0')}`;
        if (mathSnapshots.get(bubble) === signature) continue;
        enhanceNativeMath(bubble);
        mathSnapshots.set(bubble, `${bubble.getAttribute('data-message-text')}\0${[...bubble.querySelectorAll('.chat-text')].map(node => node.innerHTML).join('\0')}`);
      }
      for (const action of [...actions.values()]) {
        if (!valid(action) || !current.host.connection.canAdmin || (action.button && !action.view.contains(action.button))) retire(action);
      }
      if (connected() && current.host.connection.canAdmin) {
        for (const view of pane.querySelectorAll<HTMLElement>('.sidebar-file-view,openclaw-chat-detail-panel')) {
          if (view.closest('openclaw-chat-pane') !== (pane.matches('openclaw-chat-pane') ? pane : null)) continue;
          if (view.matches('openclaw-chat-detail-panel') && view.querySelector('.sidebar-file-view')) continue;
          const path = pathOf(view);
          if (!text(path) || path.length > 8_192 || actions.has(view) || !actionTarget(view)) continue;
          const action: Action = { view, path, busy:false, active:true };
          actions.set(view, action); void attachAction(action);
        }
      }
    } finally { if (live()) observe(); }
  }
  function schedule() { if (live() && timer === undefined) timer = setTimeout(scan, 0); }
  const observer = new document.defaultView!.MutationObserver(schedule);
  function observe() { observer.observe(pane, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['data-message-text','title'] }); }
  let stopHost = current.host.subscribe(schedule);
  function stop() {
    if (disposed) return;
    disposed = true; observer.disconnect(); if (timer !== undefined) clearTimeout(timer);
    clearActions(); stopHost(); current.signal.removeEventListener('abort', stop);
  }
  current.signal.addEventListener('abort', stop, { once:true });
  observe(); schedule();
  return {
    update(next: Context) {
      if (disposed) return;
      if (next.props.sessionKey !== current.props.sessionKey || next.props.agentId !== current.props.agentId || next.host !== current.host || next.signal !== current.signal || next.presented === false) clearActions();
      if (next.signal !== current.signal) { current.signal.removeEventListener('abort', stop); next.signal.addEventListener('abort', stop, {once:true}); }
      if (next.host !== current.host) { stopHost(); stopHost = next.host.subscribe(schedule); }
      current = next;
      if (!live()) observer.disconnect(); else { observe(); schedule(); }
    },
    dispose() { stop(); unmount(); native.remove(); },
  };
}
