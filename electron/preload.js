const { contextBridge } = require('electron');

// additionalArguments (set in main.js's createWindow) land in process.argv here; parse the one
// we added and expose it to the page before any of its scripts run.
function parseShowContext() {
  const arg = process.argv.find((a) => a.startsWith('--show-context='));
  if (!arg) return undefined;
  try {
    return JSON.parse(arg.slice('--show-context='.length));
  } catch {
    return undefined;
  }
}

contextBridge.exposeInMainWorld('showContext', parseShowContext());
