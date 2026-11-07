(() => {
  const config = window[Symbol.for('healthy-twitter.settings')];
  const enabled = key => config?.value[key] !== false;
  const PLAYER = '[data-testid="videoComponent"]';
  const OWNED = '[data-xvs-owned]';
  const ACTION = '[data-xvs-action="download"]';
  const controllers = new WeakMap();
  const menuPlayers = new WeakMap();
  const wiredMenus = new WeakSet();
  const gifMenus = new WeakSet();
  let scheduled = false;
  let context = null;
  let toastTimer;

  function isGif(player) {
    const video = player?.querySelector('video');
    if (!video) return false;
    try {
      const src = new URL(video.currentSrc || video.src);
      if (src.hostname === 'video.twimg.com' && src.pathname.startsWith('/tweet_video/')) return true;
    } catch { /* The source may not be loaded yet. */ }
    try {
      const poster = new URL(video.poster);
      if (poster.hostname === 'pbs.twimg.com' && poster.pathname.startsWith('/tweet_video_thumb/')) return true;
    } catch { /* A poster is optional. */ }
    return [...player.querySelectorAll('span')].some(span => !span.closest(OWNED) && span.textContent.trim() === 'GIF');
  }

  function actionLabel(player) { return isGif(player) ? 'Download GIF' : 'Download video'; }
  function actionTitle(player) { return isGif(player) ? 'Download GIF as original MP4' : 'Download video (best quality)'; }

  function icon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }

  function notify(text, error = false) {
    let toast = document.querySelector('.xvs-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'xvs-toast';
      toast.dataset.xvsOwned = '';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('aria-atomic', 'true');
    }
    // Keep feedback visible when the player is fullscreen.
    const root = document.fullscreenElement || document.body;
    if (toast.parentElement !== root) root.append(toast);
    toast.textContent = text;
    toast.classList.toggle('xvs-error', error);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), error ? 7000 : 4000);
  }

  function stateFor(player) {
    let state = controllers.get(player);
    if (!state) {
      state = { token: crypto.randomUUID(), busy: false };
      controllers.set(player, state);
    }
    player.setAttribute('data-xvs-player', state.token);
    return state;
  }

  async function download(player, button) {
    if (!player?.isConnected) { notify('This video is no longer on the page. Open the post and try again.', true); return; }
    const state = stateFor(player);
    if (state.busy) return;
    state.busy = true;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-disabled', 'true');
    notify('Preparing video…');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'download-player', playerToken: state.token });
      if (response?.error || !Number.isInteger(response?.id)) throw new Error(response?.error || 'Download could not start.');
      const quality = response.width && response.height ? ` (${response.width} × ${response.height})` : '';
      notify(`Download started${quality}. Check Chrome’s downloads for progress.`);
    } catch (error) {
      const text = /context invalidated|receiving end/i.test(error.message)
        ? 'The extension was updated. Reload this X tab to reconnect.'
        : error.message || 'Download failed. Please try again.';
      notify(text, true);
    } finally {
      state.busy = false;
      button.removeAttribute('aria-busy');
      button.removeAttribute('aria-disabled');
    }
  }

  function controlsFor(player) {
    if (isGif(player)) {
      const badge = [...player.querySelectorAll('span')].find(span => !span.closest(OWNED) && span.textContent.trim() === 'GIF');
      for (let slot = badge, row = badge?.parentElement; row && row !== player; slot = row, row = row.parentElement) {
        if (row.querySelector('button') && getComputedStyle(row).display === 'flex' && getComputedStyle(row).flexDirection === 'row') {
          return { row, slot, compact: true };
        }
      }
      return null;
    }
    // The volume slider is in the right-hand control row; the seek slider is
    // above it. Inserting before the volume slot puts us immediately after CC,
    // without depending on localized labels or X's generated CSS class names.
    for (const slider of player.querySelectorAll('[role="slider"]')) {
      let slot = slider;
      for (let row = slot.parentElement; row && row !== player; slot = row, row = row.parentElement) {
        const buttons = [...row.querySelectorAll('button')].filter(button => !button.closest(OWNED));
        if (buttons.length >= 3 && row.querySelectorAll('[role="slider"]').length === 1 &&
          getComputedStyle(row).display === 'flex' && getComputedStyle(row).flexDirection === 'row') {
          return { row, slot };
        }
      }
    }
    return null;
  }

  function installButton(player) {
    if (!enabled('playerDownload')) { player.querySelectorAll('.xvs-control-slot').forEach(node => node.remove()); return; }
    const controls = controlsFor(player);
    const gif = isGif(player);
    const existing = player.querySelector(ACTION);
    if (existing) {
      existing.setAttribute('aria-label', actionLabel(player));
      existing.title = actionTitle(player);
      if (controls && existing.parentElement.classList.contains('xvs-gif-fallback')) {
        existing.parentElement.classList.remove('xvs-gif-fallback');
        controls.row.insertBefore(existing.parentElement, controls.slot);
      }
      return;
    }
    if (!controls && !gif) return;
    const holder = document.createElement('div');
    holder.className = 'xvs-control-slot';
    holder.classList.toggle('xvs-gif-control', gif);
    holder.classList.toggle('xvs-gif-fallback', gif && !controls);
    holder.dataset.xvsOwned = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'xvs-download-button';
    button.dataset.xvsAction = 'download';
    button.setAttribute('aria-label', actionLabel(player));
    button.title = actionTitle(player);
    button.append(icon());
    // Do not let the click reach the player overlay and toggle playback.
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (event.isTrusted && enabled('playerDownload')) download(player, button);
    });
    holder.append(button);
    if (controls) controls.row.insertBefore(holder, controls.slot);
    else player.append(holder);
  }

  function installMenuItem() {
    if (!enabled('menuDownload')) { document.querySelectorAll('.xvs-menu-item').forEach(node => node.remove()); return; }
    const videoMenuMarker = '[data-testid="copyVideoLinkAtCurrentTimeContextMenuItem"], [data-testid="postVideoContextMenuItem"]';
    for (const item of document.querySelectorAll('.xvs-menu-item')) {
      const menu = item.closest('[role="menu"]');
      const nativeItems = menu?.querySelectorAll('[role="menuitem"]:not([data-xvs-owned])');
      const isCurrentGifMenu = gifMenus.has(menu) && context?.gif && context.player === menuPlayers.get(menu) && nativeItems?.length === 1;
      if (!menu?.querySelector(videoMenuMarker) && !isCurrentGifMenu) item.remove();
    }
    if (!context?.player.isConnected) return;
    // These test IDs identify X's video menu in every UI language. Never add
    // our item to the post, account, settings, or another player's menu.
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (Date.now() - context.openedAt > 2000) continue;
      const marker = menu.querySelector(videoMenuMarker);
      const dropdown = menu.querySelector('[data-testid="Dropdown"]');
      const nativeItems = menu.querySelectorAll('[role="menuitem"]:not([data-xvs-owned])');
      // The GIF menu has only "Copy Gif Address" and no stable item test ID.
      // Associate it with the trusted right-click and a newly opened dropdown,
      // rather than guessing from a translated label or an unrelated menu.
      const gifMenu = context.gif && dropdown && nativeItems.length === 1 &&
        (!context.existingMenus.has(menu) || gifMenus.has(menu));
      if (!marker && !gifMenu) continue;
      if (gifMenu) gifMenus.add(menu);
      // Some versions of X reuse the menu DOM for another player.
      menuPlayers.set(menu, context.player);
      const existing = menu.querySelector(ACTION);
      if (existing) {
        (existing.querySelector('span') || existing).textContent = actionLabel(context.player);
        existing.title = actionTitle(context.player);
        continue;
      }
      const list = dropdown || marker.parentElement;
      const template = list.querySelector('[role="menuitem"]') || marker;
      if (!template) continue;
      const item = template.cloneNode(true);
      for (const element of [item, ...item.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          if (attribute.name === 'id' || attribute.name.startsWith('data-') || attribute.name.startsWith('aria-')) element.removeAttribute(attribute.name);
        }
      }
      // Preserve the native menu's typography and spacing, but none of its actions.
      const text = item.querySelector('span') || item;
      text.textContent = actionLabel(context.player);
      item.classList.add('xvs-menu-item');
      item.dataset.xvsOwned = '';
      item.dataset.xvsAction = 'download';
      item.setAttribute('role', 'menuitem');
      item.tabIndex = 0;
      item.title = actionTitle(context.player);
      const activate = event => {
        event.preventDefault();
        event.stopPropagation();
        if (!event.isTrusted || !enabled('menuDownload')) return;
        const player = menuPlayers.get(menu);
        // Ask X's own menu to dismiss, preserving its focus and React state.
        item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        // X closes this menu on keyup, not keydown.
        item.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        download(player, item);
      };
      item.addEventListener('click', activate);
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      });
      // X's own keyboard navigation may use a fixed list of React children.
      // Include the new item in the actual DOM order for this video menu.
      if (!wiredMenus.has(menu)) menu.addEventListener('keydown', event => {
        if (!menu.querySelector('.xvs-menu-item')) return;
        if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const items = [...menu.querySelectorAll('[role="menuitem"]')];
          const index = items.indexOf(document.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
            (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next]?.focus();
        }
      }, true);
      wiredMenus.add(menu);
      list.append(item);
    }
  }

  function scan() {
    scheduled = false;
    document.querySelectorAll(PLAYER).forEach(installButton);
    installMenuItem();
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(scan); }
  }
  document.addEventListener('contextmenu', event => {
    if (!event.isTrusted) return;
    const player = event.target instanceof Element ? event.target.closest(PLAYER) : null;
    context = player ? { player, gif: isGif(player), openedAt: Date.now(), existingMenus: new Set(document.querySelectorAll('[role="menu"]')) } : null;
    if (context) schedule();
  }, true);
  document.addEventListener('pointerdown', event => {
    if (event.isTrusted && event.button !== 2 && event.target instanceof Element && !event.target.closest('[role="menu"]')) context = null;
  }, true);
  // GIF sources and posters may arrive after the player shell is mounted.
  config?.subscribe(schedule);
  document.addEventListener('loadedmetadata', schedule, true);
  new MutationObserver(records => {
    // Ignore the player's timer text and our own insertions to avoid continuous
    // work while a video is playing. React remounts are handled automatically.
    if (records.some(record => !record.target.closest?.(OWNED) && (
      [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && !node.matches(OWNED)) ||
      [...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && node.matches('.xvs-control-slot'))
    ))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
