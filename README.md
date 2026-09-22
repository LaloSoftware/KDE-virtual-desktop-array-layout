# vd-grid

A KWin script for Plasma 6 that creates virtual desktops **inside the row you are already
on**, rather than only at the end of the list.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Super+N` | Create a desktop to the right of the current one, in the same row |
| `Ctrl+Super+Shift+N` | Remove the current desktop, moving its windows one column left |

KDE ships shortcuts to *switch* virtual desktops, but none to *create* one. If you keep a
vertical strip of named desktops and navigate it with `Ctrl+Super+Up/Down`, this lets any
row grow sideways on demand:

```
row 1: [ Main ]
row 2: [ Games, Games 2 ]   ← Ctrl+Super+N pressed while on Games
row 3: [ Media ]
row 4: [ Spare ]
```

## Read this before you install

KWin's desktop grid is a **rectangle** filled row-major from a single ordered list, where
`row = position / columns`. A row holding two desktops while its neighbours hold one is not
representable. There is no way around this from a script.

So vd-grid pads the short rows with placeholder desktops named `·`, and bounces you off any
placeholder you land on, sliding left to the nearest real desktop in that row. In daily use
you never sit on one.

What that costs you:

- **Desktop count becomes `rows × columns`.** A 4-row grid at two columns is 8 desktops,
  not 5.
- **The placeholders are visible** in the pager, in Overview, and in the desktop switcher.
  They look like empty desktops, because that is what they are.
- Removing a desktop leaves a hole in its row until the next create reclaims it, or until
  the whole last column is empty and gets compacted away.

If that trade is not worth it to you, stop here — the limitation is structural, not a bug
waiting to be fixed.

## Requirements

- Plasma 6 / KWin 6
- `gdbus`, `qdbus6`, `kwriteconfig6` — all standard on a Plasma install
- `bash`, for `install.sh`

Developed and tested on a Wayland session. It should work on X11, but that is untested.

## Install

```sh
git clone <this-repo> ~/src/kwin-vd-grid
cd ~/src/kwin-vd-grid
./install.sh
```

`install.sh` is idempotent — run it again any time. It symlinks this directory into KWin's
script path, enables the plugin, and reloads KWin, then prints whether the script actually
loaded. Because it symlinks rather than copies, editing `contents/code/main.js` and
re-running it is the whole development loop. No logout is needed at any point.

The manual equivalent, if you would rather not run a script:

```sh
mkdir -p ~/.local/share/kwin/scripts
ln -sfn "$PWD" ~/.local/share/kwin/scripts/vd-grid
kwriteconfig6 --file kwinrc --group Plugins --key vd-gridEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```

Confirm it took:

```sh
gdbus call --session --dest org.kde.KWin --object-path /Scripting \
  --method org.kde.kwin.Scripting.isScriptLoaded vd-grid     # expect (true,)
```

## Usage

Press `Ctrl+Super+N` on any desktop. The new desktop appears immediately to its right and
you are switched onto it, named after the row's first desktop (`Games` → `Games 2`).

`Ctrl+Super+Shift+N` removes the current desktop. Its windows are moved to the desktop on
its left rather than being closed or stranded. The first desktop in a row is treated as the
row's anchor and refuses to be removed.

Both shortcuts are registered by the script itself, so they bind the moment it loads, and
both are rebindable in **System Settings → Shortcuts → KWin** under *New Desktop in Current
Row* and *Remove Desktop in Current Row*.

The script never writes the grid's row count. It only ever changes the number of desktops,
and lets KWin derive the column count from `desktops ÷ rows`. Set your row count once in
**System Settings → Virtual Desktops** and leave it alone.

## Uninstall

See the **Manual rollback** section of [`doc.md`](doc.md). It matters that the steps are
done in the right order — disabling the plugin *after* reloading KWin just loads it again.

## Documentation

[`doc.md`](doc.md) covers the design constraint in full, what each file in this repository
does, which KDE configuration files are touched and how they are structured, the install
gates, the live-reload development loop, and the known risks.

## License

MIT.
