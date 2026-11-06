const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'show-settings.json');
// assignments: [{ displayId, role }], role is 'unused' | 'monitor' | 'proj-N'. Stale displayIds
// (from a display that's no longer connected) are simply ignored when rows are rebuilt.
const DEFAULT_SETTINGS = { projectorSlots: 3, assignments: [] };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Run `npm run dev` in another terminal first; override with ELECTRON_START_URL to point at a
// different dev server port or a built dist/ server if one is ever added.
function appURL() {
  return process.env.ELECTRON_START_URL || 'http://localhost:3000';
}

let settingsWindow;
const showWindows = [];

function openSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 340,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings-window', 'settings.html'));
}

function getDisplaysInfo() {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label,
    bounds: d.bounds,
    size: d.size,
  }));
}

// Transient full-screen windows, one per display, each showing the index it'll appear as in the
// settings window's list - lets you match physical outputs to rows before assigning roles.
function openIdentifyWindows() {
  const windows = screen.getAllDisplays().map((display, i) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
    });
    const html = `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-size:30vh;font-family:sans-serif;">${i + 1}</body>`;
    win.loadURL(`data:text/html,${encodeURIComponent(html)}`);
    return win;
  });
  setTimeout(() => windows.forEach((w) => !w.isDestroyed() && w.close()), 3000);
}

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('get-displays', () => getDisplaysInfo());
ipcMain.handle('identify-displays', () => openIdentifyWindows());

ipcMain.handle('launch', (_event, settings) => {
  saveSettings(settings);
  settingsWindow?.close();
  settingsWindow = null;
  launchShow(settings);
});

function createWindow(display, showContext, { kiosk }) {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: !kiosk,
    resizable: !kiosk,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--show-context=${JSON.stringify(showContext)}`],
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(appURL());
  showWindows.push(win);
  return win;
}

function launchShow(settings) {
  const byId = new Map(screen.getAllDisplays().map((d) => [d.id, d]));

  // Monitor may be assigned to any number of displays; each proj-n slot must be unique, since two
  // windows rendering the same projector camera is the "one projector gets two windows" bug.
  const projCounts = new Map();
  for (const { role } of settings.assignments) {
    if (role === 'unused' || role === 'monitor') continue;
    projCounts.set(role, (projCounts.get(role) || 0) + 1);
  }
  const duplicates = [...projCounts.entries()].filter(([, n]) => n > 1).map(([role]) => role);
  if (duplicates.length) {
    console.error(`Duplicate projector assignment(s), fix before launching: ${duplicates.join(', ')}`);
    openSettingsWindow();
    return;
  }

  const projectorAssignments = settings.assignments
    .filter((a) => a.role !== 'unused' && a.role !== 'monitor')
    .map((a) => ({ display: byId.get(a.displayId), id: a.role }))
    .filter((a) => a.display);

  if (projectorAssignments.length) {
    createProjectorSpanWindow(projectorAssignments);
  }

  for (const { displayId, role } of settings.assignments) {
    if (role !== 'monitor') continue;
    const display = byId.get(displayId);
    if (display) createWindow(display, { mode: 'dev' }, { kiosk: false });
  }
}

// One window spanning the bounding box of every assigned projector display, all driven by a
// single simulation/render loop - avoids running the sim once per display (see index.js
// animateShow). Each projector gets a viewport region at its real position within that box.
function createProjectorSpanWindow(projectorAssignments) {
  const left = Math.min(...projectorAssignments.map((a) => a.display.bounds.x));
  const top = Math.min(...projectorAssignments.map((a) => a.display.bounds.y));
  const right = Math.max(...projectorAssignments.map((a) => a.display.bounds.x + a.display.bounds.width));
  const bottom = Math.max(...projectorAssignments.map((a) => a.display.bounds.y + a.display.bounds.height));

  const regions = projectorAssignments.map(({ display, id }) => ({
    id,
    rect: {
      x: display.bounds.x - left,
      y: display.bounds.y - top,
      width: display.bounds.width,
      height: display.bounds.height,
    },
  }));

  const win = new BrowserWindow({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    frame: false,
    resizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--show-context=${JSON.stringify({ mode: 'show', regions })}`],
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(appURL());
  showWindows.push(win);
  return win;
}

app.whenReady().then(() => {
  openSettingsWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
