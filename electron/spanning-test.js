const { app, BrowserWindow } = require('electron');

// Hard-coded to this rig's current xrandr layout: DP-4/5/6 at x=1920..7680, y=0, 1920x1080 each.
const SPAN = { x: 1920, y: 0, width: 5760, height: 1080 };

app.whenReady().then(() => {
  const win = new BrowserWindow({
    x: SPAN.x,
    y: SPAN.y,
    width: SPAN.width,
    height: SPAN.height,
    frame: false,
    resizable: false,
    autoHideMenuBar: true,
  });
  win.setMenuBarVisibility(false);

  // Three equal thirds, each a distinct color + number, so a glance at the projectors confirms
  // whether the window actually landed across all three outputs at the right offsets.
  const html = `
    <!DOCTYPE html>
    <html>
      <body style="margin:0;display:flex;height:100vh;font-family:sans-serif;">
        <div style="flex:1;background:#e63946;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10vh;">1</div>
        <div style="flex:1;background:#2a9d8f;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10vh;">2</div>
        <div style="flex:1;background:#264653;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10vh;">3</div>
      </body>
    </html>`;
  win.loadURL(`data:text/html,${encodeURIComponent(html)}`);

  console.log(`Requested bounds: ${JSON.stringify(SPAN)}`);
  win.once('ready-to-show', () => {
    console.log(`Actual bounds: ${JSON.stringify(win.getBounds())}`);
  });
});

app.on('window-all-closed', () => app.quit());
