import type { ControlUiSurfaceProps, ControlUiViewContext } from 'openclaw/plugin-sdk/control-ui';
import { enhanceNativeMath } from './native-math.ts';
import { localFileFromAnchor } from './local-file-link.ts';
import { downloadSessionFile } from './download-file.ts';

type Context = ControlUiViewContext<ControlUiSurfaceProps['transcript']>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value) && !/[\x00-\x1f\x7f]/u.test(value);

/** Compose the real host transcript. No alternate messages, preview or composer. */
export function mountNativeTranscript(container: HTMLElement, initial: Context) {
  const document = container.ownerDocument;
  const native = document.createElement('div');
  native.style.display = 'contents'; native.dataset.dashboardExtrasNative = '';
  container.append(native);
  const unmount = initial.mountDefault(native);
  let current = initial, disposed = false, generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mathSnapshots = new WeakMap<HTMLElement, string>();
  const pending = new Set<HTMLAnchorElement>();
  const notices = new Set<HTMLElement>();
  const live = () => !disposed && !current.signal.aborted && current.presented !== false;
  const authorized = () => live() && current.host.connection.connected && current.host.connection.canAdmin;
  function retireActions() {
    generation++;
    for (const anchor of pending) anchor.removeAttribute('aria-busy');
    pending.clear(); for (const node of notices) node.remove(); notices.clear();
  }
  function failure(anchor: HTMLAnchorElement, message: string) {
    if (!live() || !native.contains(anchor)) return;
    const node = document.createElement('span'); node.setAttribute('role', 'status');
    node.dataset.dashboardExtrasNotice = ''; node.style.display = 'block';
    node.style.fontSize = '12px'; node.style.color = 'var(--danger, currentColor)';
    node.textContent = message; anchor.after(node); notices.add(node);
  }
  async function open(anchor: HTMLAnchorElement, path: string) {
    if (pending.has(anchor)) return;
    if (!authorized()) { failure(anchor, 'Opening local files requires a connected Gateway administrator.'); return; }
    const epoch = generation;
    const scope = { sessionKey: current.props.sessionKey, agentId: current.props.agentId };
    const host = current.host;
    const valid = () => epoch === generation && authorized() && native.contains(anchor);
    pending.add(anchor); anchor.setAttribute('aria-busy', 'true');
    for (const notice of notices) notice.remove(); notices.clear();
    try {
      const access = await host.request('dashboardExtras.capabilities', scope);
      if (!valid()) return;
      if (!record(access) || !text(access.sessionId) || !text(access.root)) {
        failure(anchor, 'The Gateway cannot access files in this session.'); return;
      }
      // No preview preflight or extension classification: open or download the actual file.
      // The backend resolves and validates the actual regular file itself.
      const request = {
        ...scope, path, expectedSessionId: access.sessionId, expectedRoot: access.root,
      };
      if (access.nativeOpen === true && access.localClient === true) {
        const result = await host.request('dashboardExtras.openLocalFile', request);
        if (!valid() || (record(result) && result.opened === true)) return;
      }
      if (!valid()) return;
      if (access.download !== true) { failure(anchor, 'File download is unavailable. Reload the updated plugin and try again.'); return; }
      await downloadSessionFile(host, request, document, valid);
    } catch { if (valid()) failure(anchor, 'Could not open or download this file. Check its path, session file permissions and Gateway connection.'); }
    finally { pending.delete(anchor); anchor.removeAttribute('aria-busy'); }
  }
  function onClick(event: MouseEvent) {
    // Modified clicks retain the native navigation/preview path. In particular,
    // Alt-click offers the original sidebar without another UI mode or button.
    if (!live() || event.button !== 0 || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof document.defaultView!.Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a');
    if (!anchor || !native.contains(anchor) || !anchor.closest('.chat-text')) return;
    const path = localFileFromAnchor(anchor);
    if (path === null) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void open(anchor, path);
  }
  function scan() {
    timer = undefined;
    if (!live()) return;
    observer.disconnect();
    try {
      for (const bubble of native.querySelectorAll<HTMLElement>('[data-message-text]')) {
        const signature = `${bubble.getAttribute('data-message-text')}\0${[...bubble.querySelectorAll('.chat-text')].map(node => node.innerHTML).join('\0')}`;
        if (mathSnapshots.get(bubble) === signature) continue;
        enhanceNativeMath(bubble);
        mathSnapshots.set(bubble, `${bubble.getAttribute('data-message-text')}\0${[...bubble.querySelectorAll('.chat-text')].map(node => node.innerHTML).join('\0')}`);
      }
    } finally { if (live()) observe(); }
  }
  function schedule() { if (live() && timer === undefined) timer = setTimeout(scan, 0); }
  const observer = new document.defaultView!.MutationObserver(schedule);
  function observe() { observer.observe(native, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['data-message-text'] }); }
  let connection = `${initial.host.connection.connected}:${initial.host.connection.canAdmin}`;
  const hostChanged = () => {
    const next = `${current.host.connection.connected}:${current.host.connection.canAdmin}`;
    if (next !== connection) retireActions();
    connection = next; schedule();
  };
  let stopHost = current.host.subscribe(hostChanged);
  function stop() {
    if (disposed) return;
    disposed = true; observer.disconnect(); if (timer !== undefined) clearTimeout(timer);
    retireActions(); stopHost(); native.removeEventListener('click', onClick, true); current.signal.removeEventListener('abort', stop);
  }
  native.addEventListener('click', onClick, true);
  current.signal.addEventListener('abort', stop, {once:true});observe();schedule();
  return {
    update(next: Context) {
      if (disposed) return;
      if (next.props.sessionKey !== current.props.sessionKey || next.props.agentId !== current.props.agentId || next.host !== current.host || next.signal !== current.signal || next.presented === false) retireActions();
      if (next.signal !== current.signal) { current.signal.removeEventListener('abort', stop); next.signal.addEventListener('abort', stop, {once:true}); }
      if (next.host !== current.host) { stopHost(); stopHost = next.host.subscribe(hostChanged); }
      current = next;
      if (!live()) observer.disconnect(); else { observe();schedule(); }
    },
    dispose() { stop();unmount();native.remove(); },
  };
}
