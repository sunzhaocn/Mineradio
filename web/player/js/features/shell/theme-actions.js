'use strict';

// App actions stay inside the player and inherit its live appearance settings.
// Every caller awaits a result; native synchronous confirm/prompt are never replaced.
(function () {
  var active = null;
  var sequence = 0;

  function open(kind, options) {
    options = options || {};
    if (active) active.cancel();
    var previousFocus = document.activeElement;
    var token = ++sequence;
    return new Promise(function (resolve) {
      var prefix = options.idPrefix || 'mineradio-action';
      var layer = document.createElement('div');
      layer.id = prefix + '-mask';
      layer.className = 'modal-mask show mineradio-action-layer';
      var panel = document.createElement('form');
      panel.className = 'mineradio-action-card';
      panel.setAttribute('role', kind === 'confirm' ? 'alertdialog' : 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', prefix + '-title');
      var heading = document.createElement('div');
      heading.className = 'mineradio-action-heading';
      var mark = document.createElement('span');
      mark.className = 'mineradio-action-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = kind === 'confirm' ? '−' : kind === 'prompt' ? '+' : '·';
      var title = document.createElement('h2');
      title.id = prefix + '-title';
      title.textContent = options.title || (kind === 'confirm' ? '确认操作' : '提示');
      heading.append(mark, title);
      panel.append(heading);
      if (options.description) {
        var description = document.createElement('p');
        description.id = prefix + '-description';
        description.className = 'mineradio-action-description';
        description.textContent = options.description;
        panel.setAttribute('aria-describedby', description.id);
        panel.append(description);
      }
      var input = null;
      var error = null;
      if (kind === 'prompt' || kind === 'reveal') {
        var label = document.createElement('label');
        label.className = 'mineradio-action-label';
        label.htmlFor = prefix + '-input';
        label.textContent = options.label || (kind === 'prompt' ? '名称' : '完整内容');
        input = document.createElement(kind === 'reveal' ? 'textarea' : 'input');
        input.id = prefix + '-input';
        input.className = 'mineradio-action-input';
        input.value = String(options.value == null ? '' : options.value);
        input.setAttribute('aria-label', label.textContent);
        input.autocomplete = 'off';
        input.spellcheck = false;
        if (kind === 'prompt') {
          input.type = 'text';
          input.maxLength = options.maxLength || 80;
        } else {
          input.readOnly = true;
          input.rows = 6;
        }
        panel.append(label, input);
        error = document.createElement('p');
        error.className = 'mineradio-action-error';
        error.id = prefix + '-error';
        error.setAttribute('role', 'alert');
        error.hidden = true;
        error.textContent = options.emptyMessage || '请输入名称';
        panel.append(error);
        input.addEventListener('input', function () {
          error.hidden = true;
          input.removeAttribute('aria-invalid');
          input.removeAttribute('aria-errormessage');
        });
      }
      var actions = document.createElement('div');
      actions.className = 'mineradio-action-buttons';
      var cancel = null;
      if (kind === 'prompt' || kind === 'confirm') {
        cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'mineradio-action-button';
        cancel.textContent = options.cancelText || '取消';
        actions.append(cancel);
      }
      var accept = document.createElement('button');
      accept.type = 'submit';
      accept.className = 'mineradio-action-button is-primary';
      if (options.destructive) accept.setAttribute('data-destructive', 'true');
      accept.textContent = options.confirmText || (kind === 'prompt' ? '保存' : kind === 'confirm' ? '确认' : '完成');
      actions.append(accept);
      panel.append(actions);
      layer.append(panel);
      var settled = false;
      var task = { cancel: function () { finish(kind === 'confirm' ? false : null); } };
      function focusables() { return [input, cancel, accept].filter(Boolean); }
      function keepFocus(event) {
        if (!panel.contains(event.target)) (input || cancel || accept).focus({ preventScroll: true });
      }
      function finish(value) {
        if (settled) return;
        settled = true;
        if (active === task) active = null;
        document.removeEventListener('focusin', keepFocus);
        layer.remove();
        resolve(value);
        Promise.resolve().then(function () {
          if (active || token !== sequence) return;
          var target = previousFocus && previousFocus.isConnected ? previousFocus :
            options.returnFocusSelector && document.querySelector(options.returnFocusSelector);
          if (target && target.focus) target.focus({ preventScroll: true });
        });
      }
      if (cancel) cancel.addEventListener('click', task.cancel);
      layer.addEventListener('click', function (event) {
        if (event.target === layer) task.cancel();
      });
      layer.addEventListener('keydown', function (event) {
        // Space/arrows/Escape inside this card must not operate the music player.
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          task.cancel();
        } else if (event.key === 'Tab') {
          var items = focusables();
          var index = items.indexOf(document.activeElement);
          if (event.shiftKey && index <= 0) {
            event.preventDefault(); items[items.length - 1].focus();
          } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
            event.preventDefault(); items[0].focus();
          }
        }
      });
      panel.addEventListener('submit', function (event) {
        event.preventDefault();
        if (kind === 'prompt') {
          var value = input.value.trim();
          if (!value) {
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-errormessage', error.id);
            input.focus();
            return;
          }
          finish(value);
        } else finish(kind === 'confirm' ? true : null);
      });
      active = task;
      document.body.append(layer);
      document.addEventListener('focusin', keepFocus);
      (input || cancel || accept).focus({ preventScroll: true });
      if (input) input.select();
    });
  }

  window.mineradioDialogs = Object.freeze({
    prompt: function (options) { return open('prompt', options); },
    confirm: function (options) { return open('confirm', options); },
    alert: function (options) { return open('alert', options); },
    reveal: function (options) { return open('reveal', options); }
  });
})();
