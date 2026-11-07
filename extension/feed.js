// MAIN-world integration: use X's already-bound actions, never tokens or raw APIs.
(() => {
  const installed = Symbol.for('healthy-twitter.feed');
  if (window[installed]) return;
  window[installed] = true;
  const config = window[Symbol.for('healthy-twitter.settings')];
  const enabled = kind => config?.value[{ 'not-interested': 'showNotInterested', 'less-account': 'showLessAccount', block: 'showBlock' }[kind]] !== false;
  const POST = 'article[data-testid="tweet"]';
  const OWNED = '[data-ht-feed-owned]';
  const rows = new WeakMap();
  const operations = new Set();
  let scheduled = false;
  let toastStack;

  function fibers(element, limit = 80) {
    const key = element && Object.keys(element).find(key => key.startsWith('__reactFiber$'));
    const result = [];
    for (let fiber = key && element[key]; fiber && result.length < limit; fiber = fiber.return) result.push(fiber);
    return result;
  }

  function identity(post) {
    const name = post.querySelector('[data-testid="User-Name"]');
    const href = name?.querySelector('a[href]')?.getAttribute('href');
    const handle = href?.match(/^\/([a-z0-9_]{1,50})\/?$/i)?.[1];
    if (!handle) return null;
    const status = [...post.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))
      .find(href => new RegExp(`^/${handle}/status/\\d+(?:[/?#]|$)`, 'i').test(href));
    const id = status?.match(/\/status\/(\d+)/)?.[1];
    return id ? { id, handle, name } : null;
  }

  function forYou() {
    if (location.pathname.replace(/\/$/, '') !== '/home') return false;
    // X's first home tab is For You; using its position avoids translated labels.
    const tabs = document.querySelector('main [role="tablist"]') || document.querySelector('[role="tablist"]');
    return tabs?.querySelector('[role="tab"]')?.getAttribute('aria-selected') === 'true';
  }

  function contextFor(post, expected) {
    const current = identity(post);
    if (!post.isConnected || !current || current.id !== expected.id || current.handle.toLowerCase() !== expected.handle.toLowerCase()) return null;
    let account, viewerId, feedback, store;
    for (const fiber of fibers(post.querySelector('[data-testid="caret"]'))) {
      const props = fiber.stateNode?.props || fiber.memoizedProps || {};
      if (props.tweet?.id_str === current.id && props.tweet.user?.screen_name?.toLowerCase() === current.handle.toLowerCase() &&
          typeof props.block === 'function' && typeof props.unblock === 'function') {
        account = props;
        viewerId = fiber.stateNode?.context?.viewerUserId;
        break;
      }
    }
    for (const fiber of fibers(post)) {
      const props = fiber.stateNode?.props || fiber.memoizedProps || {};
      viewerId ||= props.viewerUser?.id_str;
      if (String(props.entry?.content?.id) === current.id && Array.isArray(props.feedbackActions) &&
          typeof props.applyFeedbackAction === 'function' && typeof props.undoFeedbackAction === 'function') feedback = props;
      for (let dependency = fiber.dependencies?.firstContext; dependency; dependency = dependency.next) {
        if (typeof dependency.memoizedValue?.store?.getState === 'function') store ||= dependency.memoizedValue.store;
      }
    }
    if (!account || !/^\d+$/.test(account.tweet.user.id_str) || account.tweet.user.id_str === viewerId) return null;
    const user = account.tweet.user;
    let root, childKey;
    if (forYou() && feedback) {
      root = feedback.feedbackActions.find(action => action.feedbackType === 'DontLike' && action.hasUndoAction &&
        feedback.entry.itemMetadata?.feedbackInfo?.feedbackKeys?.includes(action.feedbackKey));
      if (root && store) {
        // Only inspect already-loaded feedback records for this exact entry.
        for (const timeline of Object.values(store.getState().urt || {})) {
          const records = timeline?.responseObjects?.feedbackActions;
          if (!records?.[root.feedbackKey]) continue;
          childKey = root.childKeys?.find(key => {
            const action = records[key];
            return action?.feedbackType === 'SeeFewer' && action.hasUndoAction &&
              action.prompt?.toLowerCase().includes(current.handle.toLowerCase());
          });
          if (childKey) break;
        }
      }
    }
    return { ...current, userId: user.id_str, blocked: !!user.blocking, account, feedback, root, childKey };
  }

  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', kind === 'not-interested'
      ? 'M10 4h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-5l-1 6h-2l-2-7V4ZM3 4h4v10H3Z'
      : kind === 'less-account'
        ? 'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 21v-2a7 7 0 0 1 11-5M20 14v7m-3-3 3 3 3-3'
        : 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM6 6l12 12');
    for (const [name, value] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(name, value);
    svg.append(path);
    return svg;
  }

  function message(text, error = false) {
    const toast = makeToast(text);
    if (error) { toast.node.classList.add('ht-feed-error'); toast.node.setAttribute('role', 'alert'); }
    toast.arm(7000);
  }

  function makeToast(text, undo) {
    if (!toastStack?.isConnected) {
      toastStack = document.createElement('div');
      toastStack.className = 'ht-feed-toasts';
      toastStack.dataset.htFeedOwned = '';
      document.body.append(toastStack);
    }
    const node = document.createElement('div');
    node.className = 'ht-feed-toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    const label = document.createElement('span');
    label.textContent = text;
    node.append(label);
    let button;
    if (undo) {
      button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Undo';
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (event.isTrusted) undo();
      });
      node.append(button);
    }
    toastStack.append(node);
    let timer, remaining = 15000, started, held = false;
    const clear = () => { clearTimeout(timer); if (started) remaining = Math.max(0, remaining - (Date.now() - started)); started = 0; };
    const arm = (duration = remaining) => {
      clear(); remaining = duration;
      if (held || node.contains(document.activeElement) || node.matches(':hover')) return;
      started = Date.now(); timer = setTimeout(() => node.remove(), remaining);
    };
    node.addEventListener('mouseenter', clear);
    node.addEventListener('mouseleave', () => arm());
    node.addEventListener('focusin', clear);
    node.addEventListener('focusout', () => queueMicrotask(() => arm()));
    return { node, label, button, arm, hold(value) { held = value; if (value) clear(); }, remove() { clearTimeout(timer); node.remove(); } };
  }

  function cellFor(post) {
    const cell = post.closest('[data-testid="cellInnerDiv"]');
    return cell && cell.querySelectorAll(POST).length === 1 ? cell : post;
  }

  function syncHidden() {
    for (const post of document.querySelectorAll(POST)) {
      const id = identity(post);
      if (!id) continue;
      const hidden = [...operations].some(op => op.active && (op.kind === 'block'
        ? op.handle.toLowerCase() === id.handle.toLowerCase() : op.postId === id.id));
      const cell = cellFor(post);
      cell.toggleAttribute('data-ht-feed-hidden', hidden);
    }
    // A dismissed native entry can become a leave-behind without an article.
    for (const op of operations) if (op.cell?.isConnected && !op.cell.querySelector(POST) && op.cell !== op.post) {
      op.cell.toggleAttribute('data-ht-feed-hidden', op.active);
    }
  }

  async function run(post, expected, kind, keyboard) {
    if (!enabled(kind)) return;
    const context = contextFor(post, expected);
    if (!context) { message('This post changed. Try its menu instead.', true); return; }
    if ([...operations].some(op => op.active && (op.postId === context.id || (op.kind === 'block' && op.userId === context.userId)))) return;
    if (kind !== 'block' && (!forYou() || !context.root || (kind === 'less-account' && !context.childKey))) {
      message('X does not offer this feedback action for this post.', true); return;
    }
    if (kind === 'block' && context.blocked) { message(`@${context.handle} is already blocked.`); return; }
    const op = { kind, handle: context.handle, userId: context.userId, postId: context.id, post, cell: cellFor(post), active: true, undoing: false };
    const options = { promotedContent: context.account.promotedContent };
    // X sends only feedbackKeys[0] to the server; the remaining keys represent
    // the previous feedback steps. Undo pops one step. Preserve that contract.
    const payload = keys => ({ entry: context.feedback.entry, feedbackKeys: keys, isDismissibleFeedback: true });
    const steps = kind === 'block' ? [] : [payload([context.root.feedbackKey]),
      ...(kind === 'less-account' ? [payload([context.childKey, context.root.feedbackKey])] : [])];
    const remainingUndo = [];
    const apply = kind === 'block' ? () => context.account.block(context.userId, options) : async () => {
      for (const step of steps) {
        remainingUndo.push(step);
        await context.feedback.applyFeedbackAction(step);
      }
    };
    const revert = kind === 'block' ? () => context.account.unblock(context.userId, options) : async () => {
      while (remainingUndo.length) {
        await context.feedback.undoFeedbackAction(remainingUndo.at(-1));
        remainingUndo.pop();
      }
    };
    const success = kind === 'block' ? `Blocked @${context.handle}.` : kind === 'less-account' ? `Showing less from @${context.handle}.` : 'Marked as not interested.';
    const pending = kind === 'block' ? `Blocking @${context.handle}…` : 'Updating recommendations…';
    let applyError;
    const toast = makeToast(pending, async () => {
      if (op.undoing || !op.active) return;
      op.undoing = true; toast.hold(true); toast.button.disabled = true; toast.label.textContent = 'Undoing…';
      await op.promise;
      if (applyError) return;
      try {
        await revert();
        op.active = false; op.cell.removeAttribute('data-ht-feed-hidden'); operations.delete(op); syncHidden();
        toast.label.textContent = kind === 'block' ? `Unblocked @${context.handle}.` : 'Feedback undone.';
        toast.button.remove(); toast.hold(false); toast.arm(4000); schedule();
      } catch {
        op.undoing = false; toast.button.disabled = false;
        toast.label.textContent = 'Couldn’t undo. Try again.';
        toast.node.classList.add('ht-feed-error'); toast.hold(false); toast.arm(30000);
      }
    });
    operations.add(op); syncHidden(); toast.hold(true);
    if (keyboard) toast.button.focus();
    op.promise = Promise.resolve().then(apply).then(() => {
      if (!op.undoing) { toast.label.textContent = success; toast.hold(false); toast.arm(15000); }
    }).catch(async error => {
      if (kind !== 'block') {
        try { await revert(); }
        catch {
          // Keep the remaining inverse operations available after a partial
          // network failure; retry never repeats an already-undone step.
          if (!op.undoing) {
            toast.label.textContent = 'Feedback update failed. Undo to restore it.';
            toast.node.classList.add('ht-feed-error'); toast.hold(false); toast.arm(30000);
          }
          return;
        }
      }
      applyError = error; op.active = false; op.cell.removeAttribute('data-ht-feed-hidden'); operations.delete(op); syncHidden();
      toast.label.textContent = kind === 'block' ? 'Couldn’t block this account. Try again.' : 'Couldn’t update recommendations. Try again.';
      toast.node.classList.add('ht-feed-error'); toast.node.setAttribute('role', 'alert');
      toast.button.remove(); toast.hold(false); toast.arm(10000); schedule();
    });
  }

  function install(post) {
    const id = identity(post), caret = post.querySelector('[data-testid="caret"]');
    if (!id || !caret) { rows.get(post)?.node.remove(); rows.delete(post); return; }
    const context = contextFor(post, id);
    if (!context) { rows.get(post)?.node.remove(); rows.delete(post); return; }
    const kinds = [...(forYou() && context.root ? ['not-interested', ...(context.childKey ? ['less-account'] : [])] : []), ...(!context.blocked ? ['block'] : [])].filter(enabled);
    const signature = `${id.id}/${id.handle}/${kinds.join(',')}`;
    const existing = rows.get(post);
    if (existing?.signature === signature && existing.node.isConnected) return;
    existing?.node.remove();
    if (!kinds.length) { rows.delete(post); return; }
    let slot = caret;
    while (slot.parentElement && slot.parentElement !== post && !slot.parentElement.contains(id.name)) slot = slot.parentElement;
    if (!slot.parentElement || slot.parentElement === post || !slot.parentElement.contains(id.name)) return;
    const group = document.createElement('div');
    group.className = 'ht-feed-actions'; group.dataset.htFeedOwned = '';
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', `Post controls for @${id.handle}`);
    for (const type of ['keydown', 'keyup']) group.addEventListener(type, event => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    const mutedText = id.name.querySelector('time')?.closest('a') || id.name.querySelector('a[tabindex="-1"]');
    group.style.color = getComputedStyle(mutedText || caret.querySelector('svg') || caret).color;
    for (const kind of kinds) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.htFeedAction = kind;
      const title = kind === 'block' ? `Block @${id.handle}` : kind === 'less-account' ? `Show less from @${id.handle}` : 'Not interested in this post';
      button.setAttribute('aria-label', title); button.title = title; button.append(icon(kind));
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (event.isTrusted) run(post, id, kind, event.detail === 0);
      });
      group.append(button);
    }
    const menuRow = [...slot.querySelectorAll('div')].find(element => element.contains(caret) &&
      getComputedStyle(element).display === 'flex' && getComputedStyle(element).flexDirection === 'row') || slot;
    menuRow.classList.add('ht-feed-native-row');
    menuRow.insertBefore(group, menuRow.firstChild);
    rows.set(post, { signature, node: group });
  }

  function scan() { scheduled = false; document.querySelectorAll(POST).forEach(install); syncHidden(); }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } }
  new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.(OWNED) && (record.type === 'attributes' ||
      [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !node.matches(OWNED)) ||
      [...record.removedNodes].some(node => node.nodeType === 1 && node.matches('.ht-feed-actions'))))) schedule();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'href'] });
  config?.subscribe(schedule);
  window.addEventListener('popstate', schedule);
  scan();
})();
