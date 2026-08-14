import { BrowserWindow, app, screen } from "electron";
import path from "node:path";
import Store from "electron-store";
import { getSettings } from "../services/settings";

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

const store = new Store<{ windowState: WindowState }>({ name: "window-state" });

function getSafeBounds(state: WindowState): WindowState {
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    if (state.x === undefined || state.y === undefined) return false;
    return (
      state.x >= d.bounds.x &&
      state.y >= d.bounds.y &&
      state.x < d.bounds.x + d.bounds.width &&
      state.y < d.bounds.y + d.bounds.height
    );
  });
  return visible ? state : { ...state, x: undefined, y: undefined };
}

export function createMainWindow(): BrowserWindow {
  const saved = store.get("windowState", { width: 1280, height: 800, isMaximized: false });
  const bounds = getSafeBounds(saved);

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 600,
    frame: false, // custom titlebar — spec section 4
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (bounds.isMaximized) win.maximize();

  const persist = () => {
    if (win.isDestroyed()) return;
    const isMaximized = win.isMaximized();
    const normalBounds = win.getNormalBounds();
    store.set("windowState", { ...normalBounds, isMaximized });
  };
  win.on("resize", persist);
  win.on("move", persist);
  win.on("close", persist);

  // Start minimized when the user asked for it (Settings → Launcher behavior). The
  // window is still created on the right monitor; it just never takes focus.
  const startMinimized = getSettings().startMinimized;
  win.once("ready-to-show", () => {
    if (startMinimized && !win.isDestroyed()) {
      win.minimize();
    }
    win.show();
  });

  if (!app.isPackaged) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }

  return win;
}
