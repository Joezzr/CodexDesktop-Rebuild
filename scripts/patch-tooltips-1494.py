import io, re, sys

path = r'D:\CodexCode\codex-rust-v0.149.0-alpha.4\codex-rs\tui\src\tooltips.rs'
orig = open(path, encoding='utf-8').read()

# 1. Remove promo constants block (APP_TOOLTIP .. FREE_GO_TOOLTIP + trailing blank)
s = orig
m = re.search(
    r'\nconst APP_TOOLTIP:.*?\nconst FREE_GO_TOOLTIP:[^\n]*\n(?:\s*"[^\n]*\n)*\n',
    s, re.S)
assert m, 'promo consts block not found'
s = s[:m.start()] + '\n' + s[m.end():]

# 2. Remove .chain(...) app-tooltip injection in TOOLTIPS lazy_static
old_chain = """        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .chain(if IS_MACOS {
            Some(MACOS_APP_TOOLTIP)
        } else {
            linux_app_tooltip(LinuxDesktopSession::current())
        })
        .collect();"""
new_chain = """        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();"""
assert old_chain in s, 'chain block not found'
s = s.replace(old_chain, new_chain, 1)

# 3. Neutralize get_tooltip
old_get_tooltip_start = s.index('pub(crate) fn get_tooltip')
old_get_tooltip_end = s.index('struct LinuxDesktopSession {') if 'struct LinuxDesktopSession {' in s else s.index('fn pick_tooltip')
new_get_tooltip = """pub(crate) fn get_tooltip(_plan: Option<PlanType>, _fast_mode_enabled: bool) -> Option<String> {
    let mut rng = rand::rng();

    if let Some(announcement) = announcement::fetch_announcement_tip(/*plan*/ None) {
        return Some(announcement);
    }

    pick_tooltip(&mut rng).map(str::to_string)
}

"""
s = s[:old_get_tooltip_start] + new_get_tooltip + s[old_get_tooltip_end:]

# 4. Remove LinuxDesktopSession + linux_app_tooltip + paid_app_tooltip + pick_paid_tooltip
m = re.search(r'\nstruct LinuxDesktopSession \{.*?\nfn pick_tooltip', s, re.S)
assert m, 'session/helper block not found'
s = s[:m.start()] + '\nfn pick_tooltip' + s[m.end():]

# 5. Remove the dependent tests
def remove_test(src, name):
    pat = re.compile(r'\n    #\[test\]\n    fn ' + name + r'\(.*?(?=\n    #\[test\]|\n\})', re.S)
    m = pat.search(src)
    assert m, f'test {name} not found'
    return src[:m.start()] + src[m.end():]

for tname in ['desktop_app_tooltip_uses_supported_platform_launcher',
              'linux_desktop_app_tooltip_requires_graphical_native_session',
              'paid_tooltip_pool_rotates_between_promos',
              'paid_tooltip_pool_skips_fast_when_fast_mode_is_enabled']:
    s = remove_test(s, tname)

open(path, 'w', encoding='utf-8', newline='\n').write(s)
print('tooltips.rs 已编辑')
