'use strict';

/* 锚点小菜单：只管理展开、定位和输入方式，不依赖播放器/歌曲等项目全局变量。
 * 桌面和触屏都点击展开/收起，点选项直接执行；菜单挂在 body 中，避免被列表裁剪。
 * create({element,onClose}) 返回 open(anchor)、close(reason)、isOpen()、reposition()、
 * bind(anchor,{onOpen}) 和 destroy()。bind 的 onOpen(anchor,event) 在首次展开后调用。
 * 动态列表使用 bindDelegated(selector,resolve)，resolve 返回 {menu,onOpen}。
 */
(function () {
  'use strict';
  if (window.webAnchoredMenus) return;
  var doc = document, active = null, nextId = 0;
  var GAP = 8, EDGE = 12, LEAVE_DELAY = 180;
  var requestFrame = window.requestAnimationFrame ? function (fn) { return window.requestAnimationFrame(fn); }
    : function (fn) { return window.setTimeout(fn, 0); };
  var cancelFrame = window.cancelAnimationFrame ? function (id) { window.cancelAnimationFrame(id); }
    : function (id) { window.clearTimeout(id); };

  function inside(parent, node) { return !!(parent && node && (parent === node || parent.contains(node))); }
  function viewport() {
    var vv = window.visualViewport;
    return {left: vv ? vv.offsetLeft || 0 : 0, top: vv ? vv.offsetTop || 0 : 0,
      width: vv ? vv.width : window.innerWidth || doc.documentElement.clientWidth,
      height: vv ? vv.height : window.innerHeight || doc.documentElement.clientHeight};
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(value, Math.max(min, max))); }
  function closest(node, selector) {
    if (node && node.nodeType !== 1) node = node.parentElement;
    return node && node.closest ? node.closest(selector) : null;
  }
  function closeAll(reason) { if (active) active.close(reason || 'external'); }

  doc.addEventListener('pointerdown', function (event) {
    if (active && !active.contains(event.target)) active.close('outside');
  }, true);
  // click 也覆盖辅助技术和没有 PointerEvent 的浏览器触发的操作。
  doc.addEventListener('click', function (event) {
    if (active && !active.contains(event.target)) active.close('outside');
  });
  doc.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && active) {
      var menu = active, anchor = menu.anchor();
      menu.close('escape');
      if (anchor && anchor.focus) {
        anchor.focus({preventScroll: true});
      }
      event.preventDefault();
    }
  });

  function create(options) {
    options = options || {};
    var element = options.element;
    if (!element) throw new TypeError('Anchored menu requires an element');
    var anchor = null, opened = false, destroyed = false, closeTimer = null, frame = null;
    var keyboardOpen = false, bindings = [], boundAnchors = new Map(), observer = null, resizeObserver = null;
    var handle;
    if (!element.id) element.id = 'web-anchored-menu-' + (++nextId);
    element.classList.add('web-anchored-menu');
    if (!element.getAttribute('role')) element.setAttribute('role', 'menu');
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    // 不添加遮罩、dialog 或焦点陷阱；页面与菜单仍可各自滚动。
    element.style.position = 'fixed';
    element.style.overflowY = 'auto';
    element.style.overscrollBehavior = 'contain';
    element.style.touchAction = 'pan-y';
    // 与原音源菜单一致：内部操作不触发页面的“点击搜索区外收起结果”监听器。
    element.addEventListener('click', function (event) { event.stopPropagation(); });
    if (element.parentNode !== doc.body) doc.body.appendChild(element);

    function cancelClose() {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    function scheduleClose() {
      cancelClose();
      closeTimer = window.setTimeout(function () {
        closeTimer = null;
        if (keyboardOpen && handle.contains(doc.activeElement)) return;
        close('leave');
      }, LEAVE_DELAY);
    }
    function observe() {
      if (window.MutationObserver) {
        observer = new window.MutationObserver(function () {
          if (anchor && anchor.isConnected === false) close('anchor-removed');
        });
        observer.observe(doc.documentElement, {childList: true, subtree: true});
      }
      if (window.ResizeObserver) {
        resizeObserver = new window.ResizeObserver(queuePosition);
        resizeObserver.observe(element);
        resizeObserver.observe(anchor);
      }
      window.addEventListener('resize', queuePosition);
      doc.addEventListener('scroll', queuePosition, true);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', queuePosition);
        window.visualViewport.addEventListener('scroll', queuePosition);
      }
    }
    function unobserve() {
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      observer = resizeObserver = null;
      window.removeEventListener('resize', queuePosition);
      doc.removeEventListener('scroll', queuePosition, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', queuePosition);
        window.visualViewport.removeEventListener('scroll', queuePosition);
      }
      if (frame !== null) cancelFrame(frame);
      frame = null;
    }
    function position() {
      if (!opened || !anchor) return;
      if (anchor.isConnected === false) { close('anchor-removed'); return; }
      var a = anchor.getBoundingClientRect(), v = viewport();
      if ((!a.width && !a.height) || a.bottom <= v.top || a.top >= v.top + v.height ||
          a.right <= v.left || a.left >= v.left + v.width) {
        close('anchor-hidden'); return;
      }
      var maxWidth = Math.max(0, v.width - EDGE * 2);
      element.style.maxWidth = maxWidth + 'px';
      element.style.maxHeight = Math.max(0, v.height - EDGE * 2) + 'px';
      var box = element.getBoundingClientRect();
      var width = Math.min(element.offsetWidth || box.width || 276, maxWidth);
      var naturalHeight = element.scrollHeight || element.offsetHeight || box.height || 0;
      var below = Math.max(0, v.top + v.height - EDGE - a.bottom - GAP);
      var above = Math.max(0, a.top - GAP - v.top - EDGE);
      var up = below < Math.min(naturalHeight, 200) && above > below;
      var available = up ? above : below;
      // 极矮视口允许菜单挪离锚点，但仍保留边距与内部滚动能力。
      if (available < 80) available = Math.max(0, v.height - EDGE * 2);
      var height = Math.min(naturalHeight, available);
      element.style.maxHeight = available + 'px';
      element.style.left = Math.round(clamp(a.left, v.left + EDGE, v.left + v.width - EDGE - width)) + 'px';
      var top = up ? a.top - GAP - height : a.bottom + GAP;
      element.style.top = Math.round(clamp(top, v.top + EDGE, v.top + v.height - EDGE - height)) + 'px';
      element.style.bottom = 'auto';
      element.style.right = 'auto';
      element.dataset.placement = up ? 'top' : 'bottom';
    }
    function queuePosition() {
      if (!opened || frame !== null) return;
      frame = requestFrame(function () { frame = null; position(); });
    }
    function open(nextAnchor) {
      if (destroyed || !nextAnchor || nextAnchor.isConnected === false) return handle;
      cancelClose();
      if (opened && anchor === nextAnchor) { position(); return handle; }
      if (active && active !== handle) active.close('replaced');
      if (opened) {
        if (anchor) anchor.setAttribute('aria-expanded', 'false');
        unobserve();
      }
      anchor = nextAnchor;
      opened = true;
      active = handle;
      anchor.setAttribute('aria-haspopup', 'menu');
      anchor.setAttribute('aria-controls', element.id);
      anchor.setAttribute('aria-expanded', 'true');
      element.hidden = false;
      element.setAttribute('aria-hidden', 'false');
      position();
      if (!opened) return handle;
      // 先应用可见盒子的初始样式，随后 open 类触发 CSS 滑入动画。
      void element.offsetWidth;
      element.classList.add('open');
      observe();
      return handle;
    }
    function close(reason) {
      cancelClose();
      if (!opened) return handle;
      var oldAnchor = anchor;
      opened = false;
      keyboardOpen = false;
      anchor = null;
      unobserve();
      if (active === handle) active = null;
      if (oldAnchor) oldAnchor.setAttribute('aria-expanded', 'false');
      element.classList.remove('open');
      element.hidden = true;
      element.setAttribute('aria-hidden', 'true');
      if (typeof options.onClose === 'function') options.onClose(reason || 'programmatic', oldAnchor);
      return handle;
    }
    function show(nextAnchor, event, onOpen) {
      cancelClose();
      if (opened && anchor === nextAnchor) return;
      open(nextAnchor);
      if (opened && typeof onOpen === 'function' && onOpen(nextAnchor, event) === false) close('cancelled');
    }
    function focus(nextAnchor) {
      // Tab 只聚焦入口；已展开时取消焦点移动期间的延迟关闭。
      if (opened && anchor===nextAnchor) cancelClose();
    }
    function blur(nextAnchor, event) {
      if (!opened || anchor !== nextAnchor || handle.contains(event.relatedTarget)) return;
      scheduleClose();
    }
    function click(nextAnchor, event, onOpen) {
      if (event && event.preventDefault) event.preventDefault();
      if (event && event.stopPropagation) event.stopPropagation();
      if (opened && anchor === nextAnchor) {
        close('toggle');
      } else show(nextAnchor, event, onOpen);
    }
    function key(nextAnchor, event, onOpen) {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      event.stopPropagation();
      keyboardOpen = true;
      show(nextAnchor, event, onOpen);
      var first = element.querySelector('button:not(:disabled),[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemradio"]:not([aria-disabled="true"])');
      if (first && first.focus) first.focus({preventScroll: true});
    }
    function bind(nextAnchor, binding) {
      binding = binding || {};
      // 初始化入口可能因页面重建重复执行，替换旧绑定，避免触屏一次点击被切换两次。
      if (boundAnchors.has(nextAnchor)) boundAnchors.get(nextAnchor)();
      var onOpen = binding.onOpen, listeners = {
        focusin: function (event) { focus(nextAnchor, event, onOpen); },
        focusout: function (event) { blur(nextAnchor, event); },
        click: function (event) { click(nextAnchor, event, onOpen); },
        keydown: function (event) { key(nextAnchor, event, onOpen); }
      };
      Object.keys(listeners).forEach(function (name) { nextAnchor.addEventListener(name, listeners[name]); });
      nextAnchor.setAttribute('aria-haspopup', 'menu');
      nextAnchor.setAttribute('aria-controls', element.id);
      nextAnchor.setAttribute('aria-expanded', opened && anchor === nextAnchor ? 'true' : 'false');
      var unbind = function () {
        Object.keys(listeners).forEach(function (name) { nextAnchor.removeEventListener(name, listeners[name]); });
        if (boundAnchors.get(nextAnchor) === unbind) boundAnchors.delete(nextAnchor);
      };
      bindings.push(unbind);
      boundAnchors.set(nextAnchor, unbind);
      return unbind;
    }
    element.addEventListener('focusin', function () { cancelClose(); });
    element.addEventListener('focusout', function (event) {
      if (!handle.contains(event.relatedTarget)) scheduleClose();
    });
    handle = {open: open, close: close, isOpen: function () { return opened; },
      anchor: function () { return anchor; }, contains: function (node) { return inside(anchor, node) || inside(element, node); },
      reposition: position, bind: bind,
      destroy: function () { close('destroy'); destroyed = true; bindings.forEach(function (unbind) { unbind(); }); bindings = []; },
      // 动态搜索按钮和播放器固定按钮共用同一点击/键盘契约。
      _input: {focus: focus, blur: blur, click: click, key: key}};
    return handle;
  }

  function bindDelegated(selector, resolve) {
    function dispatch(kind, event) {
      var anchor = closest(event.target, selector);
      if (!anchor) return;
      var result = resolve(anchor, event);
      if (!result) return;
      var menu = result.menu || result;
      if (menu._input) menu._input[kind](anchor, event, result.onOpen);
    }
    var events = {focusin: 'focus', focusout: 'blur', click: 'click', keydown: 'key'};
    var listeners = {};
    Object.keys(events).forEach(function (name) {
      listeners[name] = function (event) { dispatch(events[name], event); };
      doc.addEventListener(name, listeners[name]);
    });
    return function () { Object.keys(listeners).forEach(function (name) { doc.removeEventListener(name, listeners[name]); }); };
  }
  window.webAnchoredMenus = {create: create, bindDelegated: bindDelegated, closeAll: closeAll,
    activeAnchor: function () { return active ? active.anchor() : null; }};
})();
