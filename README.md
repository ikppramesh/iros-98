# IROS 98.10 LTS — "Retro Raccoon"

A browser-based desktop operating system: the look and feel of a classic 90s desktop
with a Linux / Ubuntu heart. No build step and no dependencies.

**Run it:** open `index.html` in a browser. Click or press any key to skip the boot screen,
and log in with any user name and password.

## Features

**Classic desktop**
- BIOS → GRUB → systemd boot sequence, splash screen and log-on dialog
- Beveled windows you can drag, resize, minimize and maximize, plus a taskbar, Start menu (with submenus) and Run… dialog
- Desktop icons and right-click context menus
- Shut Down / Restart / Log Off, ending with "It is now safe to turn off your computer"

**Ubuntu-style features**
- **Terminal** with an aubergine background and a bash-like shell: pipes, `>`/`>>`/`<`, `&&`, `||`, `;`, variables,
  wildcards, aliases, Tab completion, history, and shell scripts (`bash file.sh`)
- **`sudo` and `apt`**: `sudo apt install neofetch cowsay fortune sl`, plus `apt list/search/show/remove/update`
- "Command not found, but can be installed with…" hints
- **Software Center** for installing and removing apps (Paint, Mines, System Monitor, Clock) and terminal tools
- **Activities overview** (Ctrl+Space, or tap Super): search apps, files and commands, and switch workspaces
- **4 workspaces** (tray buttons, Ctrl+Alt+←/→, or right-click a taskbar button to move a window)
- Notification toasts and a calendar popup

**Apps**: File Manager (with Trash and restore), Text Editor, Terminal, Calculator, Settings
(themes, wallpapers, user name, sound, factory reset), Software Center and Help. These can be installed:
IR Paint, Mines, System Monitor and Clock.

**Themes**: IROS Classic (98), Aubergine (Ubuntu-style) and Midnight (dark), with 7 wallpapers.

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+Space / Super | Activities overview |
| Ctrl+Alt+T | New terminal |
| Ctrl+Alt+← / → | Switch workspace |
| Alt+W | Close the active window |
| Esc | Close menus / overview |

## Storage

Files, settings, installed packages and terminal history are saved in the browser's `localStorage`.
Use **Settings → Reset** to restore factory defaults.

## Code layout

```
index.html        shell markup
css/iros.css      themes and all styling
js/core.js        helpers, settings, event bus, sounds, wallpapers
js/vfs.js         virtual file system
js/ui.js          menus, dialogs, notifications
js/wm.js          window manager and workspaces
js/apps.js        app registry, packages, and the GUI apps
js/terminal.js    the shell and its commands (including apt)
js/main.js        boot, login, desktop, taskbar, Start menu, Activities, power
```
