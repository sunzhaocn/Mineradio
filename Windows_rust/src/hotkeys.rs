use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::ptr;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN, RegisterHotKey, UnregisterHotKey,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{MSG, WM_HOTKEY};

#[derive(Default)]
pub struct Hotkeys {
    active: HashMap<i32, String>,
}

impl Hotkeys {
    pub fn clear(&mut self) {
        for id in self.active.drain().map(|(id, _)| id) {
            // A null window handle associates the shortcut with this UI thread.
            unsafe { UnregisterHotKey(ptr::null_mut(), id) };
        }
    }

    pub fn configure(&mut self, bindings: &Value) -> Value {
        self.clear();
        let mut seen = HashSet::new();
        let mut results = Vec::new();
        for (index, binding) in bindings
            .as_array()
            .into_iter()
            .flatten()
            .take(64)
            .enumerate()
        {
            let accelerator = binding["accelerator"].as_str().unwrap_or_default();
            let action = binding["action"].as_str().unwrap_or_default();
            if action.is_empty()
                || action.len() > 64
                || action == "toggleDesktopInteraction"
                || accelerator.is_empty()
                || accelerator.len() > 80
                || !seen.insert(accelerator)
            {
                continue;
            }
            let id = index as i32 + 1;
            let registered = parse(accelerator).is_some_and(|(modifiers, key)| {
                let repeat = if action.starts_with("volume") {
                    0
                } else {
                    MOD_NOREPEAT
                };
                // Called on the Tao UI thread, which handles WM_HOTKEY for this registration.
                unsafe { RegisterHotKey(ptr::null_mut(), id, modifiers | repeat, key) != 0 }
            });
            let conflict = (!registered).then(|| {
                json!({"sourceName":"系统 / 其他软件",
                "sourceIcon":"warning","reason":"该组合键无法注册或已被系统保留"})
            });
            if registered {
                self.active.insert(id, action.to_owned());
            }
            results.push(json!({"action":action,"accelerator":accelerator,"ok":registered,"conflict":conflict}));
        }
        json!({"ok":true,"results":results})
    }

    pub fn dispatched(&self, message: &MSG) -> Option<String> {
        if message.message != WM_HOTKEY || !message.hwnd.is_null() {
            return None;
        }
        let id = i32::try_from(message.wParam).ok()?;
        self.active.get(&id).cloned()
    }
}

impl Drop for Hotkeys {
    fn drop(&mut self) {
        self.clear();
    }
}

fn parse(accelerator: &str) -> Option<(u32, u32)> {
    let text = accelerator.to_ascii_lowercase();
    let mut parts = text.split('+').peekable();
    let mut modifiers = 0;
    let key = loop {
        let part = parts.next()?;
        if parts.peek().is_none() {
            break part;
        }
        modifiers |= match part {
            "commandorcontrol" | "cmdorctrl" | "control" | "ctrl" => MOD_CONTROL,
            "alt" => MOD_ALT,
            "shift" => MOD_SHIFT,
            "super" | "win" | "meta" => MOD_WIN,
            _ => return None,
        };
    };
    let virtual_key = match key {
        "space" => 0x20,
        "tab" => 0x09,
        "enter" | "return" => 0x0d,
        "escape" | "esc" => 0x1b,
        "backspace" => 0x08,
        "delete" => 0x2e,
        "insert" => 0x2d,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "mediaplaypause" => 0xb3,
        "medianexttrack" => 0xb0,
        "mediaprevioustrack" => 0xb1,
        "mediastop" => 0xb2,
        "volumeup" => 0xaf,
        "volumedown" => 0xae,
        "volumemute" => 0xad,
        "-" => 0xbd,
        "=" | "plus" => 0xbb,
        "[" => 0xdb,
        "]" => 0xdd,
        "\\" => 0xdc,
        ";" => 0xba,
        "'" => 0xde,
        "," => 0xbc,
        "." => 0xbe,
        "/" => 0xbf,
        "\x60" => 0xc0,
        _ if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() => {
            u32::from(key.as_bytes()[0].to_ascii_uppercase())
        }
        _ => {
            let number = key.strip_prefix('f')?.parse::<u32>().ok()?;
            if !(1..=24).contains(&number) {
                return None;
            }
            0x6f + number
        }
    };
    // Windows owns Win+D even when a profile contains an old custom binding for it.
    (modifiers != MOD_WIN || virtual_key != u32::from(b'D')).then_some((modifiers, virtual_key))
}
