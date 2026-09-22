# vd-grid — how it works, what it touches, how to undo it

General reference. Nothing here is specific to one machine: paths are written as
`<repo>` for wherever you cloned this, and desktops are named generically.

---

## 1. The constraint that shapes everything

KWin's virtual desktops are **one ordered list**, not a grid. The grid you see in the pager
and in Overview is that list wrapped into a rectangle, row-major:

```
row = position / columns
column = position % columns
```

The rectangle is described by two numbers only: how many desktops exist, and how many rows
the grid has. **Columns are never stored** — KWin derives them as `desktops ÷ rows`.

The consequence: a row holding two desktops while its neighbours hold one **cannot be
represented**. There is no ragged grid. Adding one desktop to one row necessarily adds a
column to *every* row.

vd-grid accepts this instead of fighting it:

- When a row needs to grow, a whole column is added — one real desktop in the current row,
  and a **placeholder** named `·` in every other row.
- Landing on a placeholder triggers a **bounce**: the script slides you left to the nearest
  real desktop in that row. Column 0 is always real, so the bounce always terminates.
- When the entire last column is placeholders, it is **compacted** away.

The placeholders are genuinely there. They appear in the pager, in Overview and in the
desktop switcher. The script only makes sure you never come to rest on one.

The script also never writes the row count. It changes only how many desktops exist, keeping
that a multiple of the row count, and lets KWin work out the columns. This is deliberate:
setting the row count is the one thing the KWin scripting API cannot do.

---

## 2. Why a KWin script and not a shell script

The obvious implementation is a shell script driving D-Bus, bound to a key through a
`.desktop` entry in `kglobalshortcutsrc`. It does not work well, for one reason:

**`org.kde.kglobalaccel` is owned by the KWin process itself.** There is no separate
shortcut daemon to restart. So a newly added `.desktop` shortcut does not register until
KWin restarts — which on a Wayland session means logging out.

A KWin script calls `registerShortcut()` from inside KWin, so the binding exists the
instant the script loads.

| | KWin script | Shell script + `.desktop` |
| --- | --- | --- |
| Shortcut binds without a logout | yes | no |
| Rebindable in System Settings | yes | yes |
| API access | native objects | parsing `gdbus` output |
| Live reload while developing | yes | n/a |

---

## 3. The files in this repository

### `metadata.json`

The KPackage manifest. KWin reads it to discover the script's id, name and API version.

The field that matters operationally is `KPlugin.Id`, here `vd-grid`. It is not cosmetic —
it is the key everything else is derived from:

- the config key that enables the script is `[Plugins] <Id>Enabled`
- `isScriptLoaded <Id>` and `unloadScript <Id>` take it
- the directory name under KWin's script path should match it

Change the id and you must change all three together.

### `contents/code/main.js`

The whole implementation, in one file. By role rather than line by line:

| Function | What it is for |
| --- | --- |
| `rowCount()` / `colCount()` | The grid's dimensions. Rows come from KWin; columns are computed as `ceil(desktops / rows)`, mirroring KWin's own arithmetic. |
| `at(row, col)` | Translates a grid coordinate into a position in the flat list. Everything else is written in grid terms and goes through this. |
| `normalize()` | Guarantees the list is an exact rectangle before any operation, padding with placeholders if something outside the script left it ragged. Cheap, and runs first in every action. |
| `addInRow()` | The create action. Reclaims a placeholder hole in the current row if there is one; otherwise grows a whole new column, inserting **last row first** so that each insertion only shifts positions after it. |
| `removeInRow()` | The remove action. Refuses on column 0 (the row's anchor), relocates the desktop's windows one column left, renames the desktop to a placeholder, then compacts the last column away if it has become entirely placeholders. |
| `bounce()` | Connected to the desktop-changed signal. If you arrive on a placeholder, slides left to the nearest real desktop in the row. Guarded by a re-entry flag so the switch it performs cannot retrigger it. |
| `setName()` | Renames a desktop. Tries the property first and falls back to the D-Bus setter, because whether the property is writable from a script binding is version-dependent. |
| `uniqueNameForRow()` | Derives the new desktop's name from the row's first desktop (`Games` → `Games 2`) and avoids collisions with names already in that row. |

Placeholders are identified **by name** — any desktop named `·` is one. That is the
mechanism's one soft spot: name a desktop `·` yourself and the script will treat it as
disposable. The character is a single constant at the top of the file if you want a
different one.

Logging goes through `print()`, which lands in KWin's journal (see §6).

### `install.sh`

Idempotent installer, safe to re-run. It symlinks this repository into KWin's script path,
enables the plugin, unloads any copy already running so edits are picked up, reloads KWin,
and prints whether the script actually loaded.

It symlinks rather than copies deliberately: the installed script *is* the working tree, so
there is no reinstall step while developing.

---

## 4. The files KDE owns, and what lands in them

### `~/.config/kwinrc`

KWin's configuration, in KConfig's INI dialect. Three properties of the format are worth
knowing before you open it:

- **Groups** are `[Name]` and run until the next `[`. Keys are bare `key=value`, with no
  quoting and no escaping. Comments are not preserved.
- **Nesting is stacked brackets on one line.** `[Tiling][<desktop-id>][<screen-id>]` is the
  group `Tiling`, subgroup `<desktop-id>`, subgroup `<screen-id>`.
- **KWin owns the ordering.** Every time it rewrites the file it re-sorts groups and keys
  alphabetically. Your layout will not survive; your content will.

The governing caveat, which catches everyone once:

> **kwinrc is a dump of KWin's in-memory state, not a control panel.**

KWin rewrites the file whenever anything changes. A hand edit made while KWin is running is
overwritten the next time it flushes. Use `kwriteconfig6` (which notifies KWin), or the
System Settings UI, or D-Bus — or edit the file and restart KWin before it writes over you.

Groups relevant to this script:

**`[Desktops]`** — the desktop list itself.

```ini
Id_1=<uuid>     Name_1=Main
Id_2=<uuid>     Name_2=Games
Number=2
Rows=2
```

`Id_N` and `Name_N` are indexed by **position in the flat row-major list**; the `N` carries
the ordering, the UUID carries the identity. `Number` is the count, `Rows` the grid height,
and columns are absent because they are derived. This is the group vd-grid indirectly grows
and shrinks — indirectly, because the script calls the API and KWin writes the file.

**`[Plugins]`** — the on/off switches for effects and scripts, as `<Id>Enabled=true`. This
is where `vd-gridEnabled` lives, and it is the only key this project adds to kwinrc
directly.

**`[Windows] RollOverDesktops`** — the config key behind the D-Bus property
`navigationWrappingAround`. Worth knowing which is which when you are reading one and
setting the other. With it on, switching past the edge of the grid wraps around.

**`[Tiling][<desktop-id>][<screen-id>]`** — a custom tile layout, one group per desktop per
screen. KWin creates these on its own and **does not remove them when a desktop is
deleted**, so orphan groups accumulate over time, keyed by UUIDs that no longer exist. They
are inert. Creating and deleting desktops — which this script does by design — produces
them faster than normal use would.

### `~/.local/share/kwin/scripts/`

Where KWin looks for user scripts. This project installs a symlink named after the plugin
id pointing at the repository. Extra files in a package directory (`.git`, `README.md`, and
so on) are ignored — KWin reads only `metadata.json` and `contents/`.

### `~/.config/kglobalshortcutsrc`

Global shortcut bindings, group `[kwin]`. `registerShortcut()` writes its two actions here
on first load, as `ActionName=Binding,Default,Human readable description`. They persist in
the file after the script is removed, inactive, and are reclaimed if it is installed again.

This project never edits that file by hand, so pre-existing bindings are never at risk.

---

## 5. Install and verify

Each step is **check → act → check**. Do not advance past a failing gate.

**Step 0 — baseline.** Record what the desktops look like before anything changes, and back
up the config:

```sh
gdbus call --session --dest org.kde.KWin --object-path /VirtualDesktopManager \
  --method org.freedesktop.DBus.Properties.GetAll org.kde.KWin.VirtualDesktopManager
cp ~/.config/kwinrc ~/kwinrc.backup
```

*Gate:* you can see the desktop count, the row count and the current names, and the backup
exists.

**Step 1 — sanity-check the files.**

```sh
python3 -c "import json;json.load(open('metadata.json'));print('OK')"
node --check contents/code/main.js      # if node is available
```

*Gate:* both parse. KWin is still untouched.

**Step 2 — install and enable.** Run `./install.sh`, or the manual equivalent in the README.

*Gate:* `isScriptLoaded vd-grid` returns `(true,)`. If it returns `(false,)`, the journal
(§6) will have the JavaScript error; fix it and reload.

Keep a second terminal open on the journal for the rest of the run:

```sh
journalctl --user -u plasma-kwin_wayland -f | grep -i vd-grid
```

It should already show `vd-grid: loaded, grid <rows>x<cols>`.

**Step 3 — shortcuts.** System Settings → Shortcuts → KWin should list *New Desktop in
Current Row* and *Remove Desktop in Current Row*.

*Gate:* both present. Rebind here if the defaults clash with something.

**Step 4 — first create.** Press `Ctrl+Super+N` on a desktop that is not in the first row.

*Gate:* the desktop count has gone up by exactly the number of rows; the new desktop sits
immediately right of where you were, named after the row's first desktop; every other row
gained a `·`; the row count is unchanged; you are now on the new desktop.

Press the key. Do not invoke the action over D-Bus — that tests the script but not the
binding, which is half of what you are verifying.

**Step 5 — navigation and bounce.** With the grid two columns wide:

- on a row's first desktop, switching right lands on its new second desktop
- on a single-desktop row, switching right leaves you where you were (bounced)
- switching vertically from a second column lands on a real desktop, never on a `·`

*Gate:* you never come to rest on a `·`.

**Step 6 — removal keeps windows.** Open a window on a second-column desktop and press
`Ctrl+Super+Shift+N`.

*Gate:* the window reappears one column left rather than closing; you land there too; the
grid compacts back to one column and the original desktop count.

**Step 7 — the anchor guard.** Press `Ctrl+Super+Shift+N` on a row's first desktop.

*Gate:* nothing changes, and the journal logs `refusing to remove base desktop <name>`.

**Step 8 — several rows and columns.** Create in two different rows, then a third column,
then remove them one at a time.

*Gate:* the grid shrinks back to its starting size, the row count never moved, and no `·`
desktops are left behind.

**Step 9 — persistence.** Log out and back in.

*Gate:* the script is still loaded, the shortcuts still work, and the desktop list survived.

---

## 6. Developing on it

Because the installed script is a symlink to the working tree, the whole edit loop is: edit
`contents/code/main.js`, then

```sh
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.unloadScript vd-grid
qdbus6 org.kde.KWin /KWin reconfigure
```

or just re-run `./install.sh`, which does both. No logout, ever.

`print()` output goes to the KWin journal:

```sh
journalctl --user -u plasma-kwin_wayland -f | grep -i vd-grid
```

A script that fails to parse simply does not load — `isScriptLoaded` returns `(false,)` and
the error is in the journal. Check there first, always.

---

## 7. Manual rollback

**Order matters.** Disabling the plugin *after* reloading KWin just loads the script again.
Work down the list.

### 1. Turn the switch off

```sh
kwriteconfig6 --file kwinrc --group Plugins --key vd-gridEnabled --delete
```

`--delete` removes the key outright. Writing `false` instead works just as well and leaves a
visible record that the script was once installed.

### 2. Break the link

```sh
rm ~/.local/share/kwin/scripts/vd-grid
```

Now even an enabled key finds nothing to load.

### 3. Evict the running copy

Steps 1 and 2 change files on disk. The script is still loaded in KWin's memory, with its
shortcuts still bound, until you say otherwise:

```sh
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.unloadScript vd-grid
qdbus6 org.kde.KWin /KWin reconfigure
```

*Check:* `isScriptLoaded vd-grid` now returns `(false,)`.

### 4. Reclaim the desktops

This is the part a file edit cannot do, because of the caveat in §4. Three ways, best
first:

- **System Settings → Virtual Desktops.** Delete the `·` desktops until the grid is back to
  the size you started with. No terminal, no restart.
- **D-Bus**, one call per desktop, by UUID:

  ```sh
  gdbus call --session --dest org.kde.KWin --object-path /VirtualDesktopManager \
    --method org.kde.KWin.VirtualDesktopManager.removeDesktop <desktop-uuid>
  ```

  List the UUIDs first with the `GetAll` call from §5, Step 0.
- **Edit the file, then log out.** Rewrite `[Desktops]` by hand — fix `Id_N`/`Name_N`, set
  `Number` and `Rows`, delete the surplus entries — and log out immediately, before KWin
  writes over you. Restoring a whole backup with `cp` and logging out is the same
  manoeuvre.

### 5. Leftovers you can ignore

Two things survive a clean rollback:

- The two action entries in `kglobalshortcutsrc`, inactive once the script is unloaded, and
  reclaimed if it is ever reinstalled.
- Orphan `[Tiling]` groups in kwinrc for the deleted placeholder desktops. Any desktop
  deleted by any means leaves these, so a long-lived config already has them. They are
  inert. If you want one gone, delete its keys and KConfig drops the now-empty group:

  ```sh
  kwriteconfig6 --file kwinrc --group Tiling --group <desktop-id> --group <screen-id> \
    --key padding --delete
  kwriteconfig6 --file kwinrc --group Tiling --group <desktop-id> --group <screen-id> \
    --key tiles --delete
  ```

---

## 8. Known risks and fallbacks

| Risk | Fallback |
| --- | --- |
| **The desktop-change OSD flashes the placeholder** during a bounce, if that OSD is enabled. | Shorten the OSD's hide delay (`[Script-desktopchangeosd] PopupHideDelay`), or register four grid-aware navigation actions that skip placeholders outright and unbind KWin's built-in directional switches. |
| **`desktop.name` may not be writable** from the scripting binding, depending on the Plasma version. | Already handled: `setName()` falls back to the D-Bus setter. |
| **Placeholders are visible** in pager, Overview and switcher. | Structural, not fixable from a script. Change the placeholder character if `·` reads badly. |
| **The row count changes** in System Settings while the script is installed. | Handled: the column count is read from KWin every time, and `normalize()` re-rectangularises the list on the next action. Do not hand-edit `Number` in kwinrc. |
| **A hole mid-row** after removing a middle desktop. | Harmless. `bounce()` skips it and the next create reclaims it before growing a new column. |
| **Another KWin script also reacts to desktop or window changes** — a tiling script, for example. | Windows relocated by `removeInRow()` will be re-handled by it on arrival. If removal behaves oddly, suspect that interaction before suspecting this script. |
| **A desktop you named `·` yourself** is treated as a disposable placeholder. | Do not name desktops `·`, or change the constant at the top of `main.js`. |
