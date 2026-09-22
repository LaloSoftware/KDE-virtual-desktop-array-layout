// vd-grid — per-row virtual desktops for KWin (Plasma 6).
// The KWin grid is a rectangle filled row-major, so short rows are padded
// with PLACEHOLDER desktops and the user is bounced off them on arrival.

const PLACEHOLDER = "·";

function log(msg) { print("vd-grid: " + msg); }

function rowCount() { return workspace.desktopGridHeight; }

function colCount() {
    const r = rowCount();
    return r > 0 ? Math.ceil(workspace.desktops.length / r) : 1;
}

function indexOfDesktop(d) {
    const list = workspace.desktops;
    for (let i = 0; i < list.length; ++i) {
        if (list[i].id === d.id) return i;      // compare by id, not identity
    }
    return -1;
}

function at(row, col) {
    const list = workspace.desktops;
    const i = row * colCount() + col;
    return (i >= 0 && i < list.length) ? list[i] : null;
}

function isPlaceholder(d) { return !!d && d.name === PLACEHOLDER; }

// Property write first; fall back to the D-Bus setter (plain (s,s), no variants).
function setName(d, name) {
    try {
        d.name = name;
        if (d.name === name) return;
    } catch (e) { /* fall through */ }
    callDBus("org.kde.KWin", "/VirtualDesktopManager",
             "org.kde.KWin.VirtualDesktopManager", "setDesktopName", d.id, name);
}

// Guarantee the flat list is an exact rows x columns rectangle.
function normalize() {
    const r = rowCount();
    if (r <= 0) return;
    if (workspace.desktops.length % r === 0) return;
    const cols = colCount();
    while (workspace.desktops.length < r * cols) {
        workspace.createDesktop(workspace.desktops.length, PLACEHOLDER);
    }
    log("normalized to " + r + "x" + colCount());
}

function uniqueNameForRow(row, base, col) {
    const cols = colCount();
    const used = {};
    for (let c = 0; c < cols; ++c) {
        const d = at(row, c);
        if (d) used[d.name] = true;
    }
    let n = col + 1;
    let candidate = base + " " + n;
    while (used[candidate]) { n += 1; candidate = base + " " + n; }
    return candidate;
}

function addInRow() {
    normalize();
    const cur = workspace.currentDesktop;
    const cols = colCount();
    const i = indexOfDesktop(cur);
    if (i < 0) { log("current desktop not found"); return; }
    const row = Math.floor(i / cols);
    const base = at(row, 0).name;

    // 1. Reclaim a hole left by an earlier removal.
    for (let c = 1; c < cols; ++c) {
        const d = at(row, c);
        if (isPlaceholder(d)) {
            setName(d, uniqueNameForRow(row, base, c));
            workspace.currentDesktop = d;
            log("reclaimed hole at row " + row + " col " + c);
            return;
        }
    }

    // 2. Grow a column. Insert at each row's end, LAST ROW FIRST: a lower
    //    insertion index only shifts positions after it, already handled.
    const rows = rowCount();
    const newName = uniqueNameForRow(row, base, cols);
    for (let r = rows - 1; r >= 0; --r) {
        workspace.createDesktop((r + 1) * cols, r === row ? newName : PLACEHOLDER);
    }
    const created = at(row, cols);      // colCount() is cols+1 now
    if (created) workspace.currentDesktop = created;
    log("grew to " + colCount() + " columns, created " + newName);
}

function removeInRow() {
    normalize();
    const cur = workspace.currentDesktop;
    let cols = colCount();
    const i = indexOfDesktop(cur);
    if (i < 0) return;
    const row = Math.floor(i / cols);
    const col = i % cols;
    if (col === 0) { log("refusing to remove base desktop " + cur.name); return; }

    const target = at(row, col - 1);

    // Relocate windows instead of letting them be closed or stranded.
    const wins = workspace.windowList();
    for (let k = 0; k < wins.length; ++k) {
        const w = wins[k];
        if (w.onAllDesktops) continue;
        const ds = w.desktops;
        for (let j = 0; j < ds.length; ++j) {
            if (ds[j].id === cur.id) { w.desktops = [target]; break; }
        }
    }

    workspace.currentDesktop = target;
    setName(cur, PLACEHOLDER);

    // Compact: drop the last column when it is entirely placeholders.
    cols = colCount();
    if (cols <= 1) return;
    const rows = rowCount();
    const victims = [];
    for (let r = 0; r < rows; ++r) {
        const d = at(r, cols - 1);
        if (!isPlaceholder(d)) return;          // a real desktop lives there
        victims.push(d);
    }
    for (let v = victims.length - 1; v >= 0; --v) {
        workspace.removeDesktop(victims[v]);    // highest position first
    }
    log("compacted to " + colCount() + " columns");
}

// Land on a placeholder -> slide left to the nearest real desktop in the row.
// Column 0 is always real, so this terminates.
let bouncing = false;
function bounce() {
    if (bouncing) return;
    const cur = workspace.currentDesktop;
    if (!isPlaceholder(cur)) return;
    const cols = colCount();
    const i = indexOfDesktop(cur);
    if (i < 0) return;
    const row = Math.floor(i / cols);
    const col = i % cols;
    for (let c = col - 1; c >= 0; --c) {
        const d = at(row, c);
        if (!isPlaceholder(d)) {
            bouncing = true;
            workspace.currentDesktop = d;
            bouncing = false;
            log("bounced off placeholder at row " + row + " col " + col + " -> " + d.name);
            return;
        }
    }
}

workspace.currentDesktopChanged.connect(bounce);
registerShortcut("VDGridNewInRow",    "New Desktop in Current Row",    "Meta+Ctrl+N",       addInRow);
registerShortcut("VDGridRemoveInRow", "Remove Desktop in Current Row", "Meta+Ctrl+Shift+N", removeInRow);
normalize();
log("loaded, grid " + rowCount() + "x" + colCount());
