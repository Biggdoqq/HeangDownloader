const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// Auto-Updater Configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = {
  info: (...args) => console.log('[AutoUpdater]', ...args),
  warn: (...args) => console.warn('[AutoUpdater]', ...args),
  error: (...args) => console.error('[AutoUpdater]', ...args)
};

let mainWindow = null;
let downloadPath = path.join(app.getPath('videos'), 'Hongguo');
const activeDownloads = new Map();

function sendUpdateStatus(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', { status, ...data });
  }
}

autoUpdater.on('checking-for-update', () => {
  sendUpdateStatus('checking');
});

autoUpdater.on('update-available', (info) => {
  sendUpdateStatus('available', {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes || ''
  });
});

autoUpdater.on('update-not-available', (info) => {
  sendUpdateStatus('not-available', {
    version: info.version || app.getVersion()
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  sendUpdateStatus('downloading', {
    percent: Math.round(progressObj.percent || 0),
    bytesPerSecond: progressObj.bytesPerSecond || 0,
    transferred: progressObj.transferred || 0,
    total: progressObj.total || 0
  });
});

autoUpdater.on('update-downloaded', (info) => {
  sendUpdateStatus('downloaded', {
    version: info.version
  });
});

autoUpdater.on('error', (err) => {
  console.warn('[AutoUpdater] Error:', err?.message || err);
  sendUpdateStatus('error', {
    message: err?.message || 'Update check failed'
  });
});

// Helper to ensure local Hongguo decryption engine is alive on port 8000
async function isEngineAlive() {
  try {
    const res = await fetch('http://127.0.0.1:8000/', { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Helper to ensure Java unidbg signer is alive on port 9099
async function isSignerAlive() {
  try {
    const res = await fetch('http://127.0.0.1:9099/sign', { signal: AbortSignal.timeout(1500) });
    return res.status === 200;
  } catch (e) {
    return false;
  }
}

let engineProcess = null;
let signerProcess = null;
let engineStartPromise = null;
let signerStartPromise = null;

function resolveCandidateEngineDirs() {
  return [
    // 1. Packaged extraResources on target client laptop
    path.join(process.resourcesPath || '', 'engine'),
    // 2. Relative to app path (unpacked / dev)
    path.join(app.getAppPath(), '..', 'engine'),
    // 3. Local workspace engine directory (dev or portable unpacked)
    path.join(__dirname, 'engine'),
    // 4. Per-user LocalAppData Programs path
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Hongguo Downloader', 'resources', 'engine'),
    // 5. Program Files path
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Hongguo Downloader', 'resources', 'engine'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Hongguo Downloader', 'resources', 'engine')
  ];
}

function findEnginePaths() {
  const candidateDirs = resolveCandidateEngineDirs();
  for (const dir of candidateDirs) {
    if (!dir) continue;
    // CRITICAL: Always use python.exe (NEVER pythonw.exe).
    // pythonw.exe fails on _ctypes DLL load when importing AES crypto.
    // python.exe with windowsHide: true runs in background without showing a window.
    const testPy = path.join(dir, 'python', 'python.exe');
    const testServer = path.join(dir, 'app', 'server.pyc');
    const fallbackServer = path.join(dir, 'app.pyc');

    if (fs.existsSync(testPy)) {
      const script = fs.existsSync(testServer) ? testServer : (fs.existsSync(fallbackServer) ? fallbackServer : null);
      if (script) {
        return {
          appDir: dir,
          pythonExe: testPy,
          serverScript: script
        };
      }
    }
  }
  return null;
}

async function ensureSignerRunning(appDir) {
  if (await isSignerAlive()) return true;
  if (signerStartPromise) return await signerStartPromise;

  signerStartPromise = (async () => {
    try {
      if (await isSignerAlive()) return true;

      const javawExe = path.join(appDir, 'jre', 'bin', 'javaw.exe');
      const javaExe = path.join(appDir, 'jre', 'bin', 'java.exe');
      const exe = fs.existsSync(javawExe) ? javawExe : (fs.existsSync(javaExe) ? javaExe : null);
      const unidbgJar = path.join(appDir, 'app', 'sign', 'unidbg-sign.jar');
      const signWorkingDir = path.join(appDir, 'app', 'sign');
      const jreBinDir = path.join(appDir, 'jre', 'bin');

      if (!exe || !fs.existsSync(unidbgJar)) {
        console.warn('[Signer] Files missing at:', appDir);
        return false;
      }

      let userDataDir = appDir;
      try {
        userDataDir = app.getPath('userData');
      } catch (e) {}

      let signerLogStream = null;
      try {
        const signerLogPath = path.join(userDataDir, 'signer.log');
        signerLogStream = fs.openSync(signerLogPath, 'a');
      } catch (e) {}

      const args = [
        '-Xmx1024m',
        '-XX:+ExitOnOutOfMemoryError',
        '--add-opens',
        'java.base/java.lang=ALL-UNNAMED',
        '-cp',
        'unidbg-sign.jar',
        'com.hongguo.sign.FqTrace',
        'serve',
        '9099'
      ];

      const envPath = `${jreBinDir};${process.env.PATH || ''}`;
      signerProcess = spawn(exe, args, {
        cwd: signWorkingDir,
        detached: true,
        windowsHide: true,
        stdio: signerLogStream ? ['ignore', signerLogStream, signerLogStream] : 'ignore',
        env: {
          ...process.env,
          PATH: envPath
        }
      });
      if (signerProcess.unref) signerProcess.unref();

      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 350));
        if (await isSignerAlive()) {
          console.log(`[Signer] Java unidbg RPC ready on port 9099 (attempt ${i + 1})`);
          return true;
        }
      }

      console.warn('[Signer] Timed out waiting for Java unidbg RPC signer on port 9099');
      return await isSignerAlive();
    } catch (e) {
      console.warn('[Signer] Startup error:', e.message);
      return false;
    } finally {
      signerStartPromise = null;
    }
  })();

  return await signerStartPromise;
}

async function ensureEngineRunning() {
  if (await isEngineAlive()) return true;
  if (engineStartPromise) return await engineStartPromise;

  engineStartPromise = (async () => {
    try {
      if (await isEngineAlive()) return true;

      const enginePaths = findEnginePaths();
      if (!enginePaths) {
        console.warn('Could not find bundled or installed Hongguo engine in candidate paths:', resolveCandidateEngineDirs());
        return false;
      }

      const { appDir, pythonExe, serverScript } = enginePaths;

      // 1. Ensure Java signer is alive first on port 9099
      await ensureSignerRunning(appDir);

      // Check again if engine was started while signer was spinning up
      if (await isEngineAlive()) return true;

      const appFolder = path.join(appDir, 'app');
      let userDataDir = appDir;
      try {
        userDataDir = app.getPath('userData');
      } catch (e) {}

      // Disable licensing gate & quota so all downloads run unlimited
      try {
        fs.writeFileSync(path.join(appDir, '.hg_dev'), '1');
        if (fs.existsSync(appFolder)) {
          fs.writeFileSync(path.join(appFolder, '.hg_dev'), '1');
          const supFile = path.join(appFolder, 'supabase.json');
          const supBak = path.join(appFolder, 'supabase.json.bak');
          if (fs.existsSync(supFile)) {
            fs.renameSync(supFile, supBak);
          }
        }
      } catch (e) {}

      // Log engine output to userData log for troubleshooting
      let logStream = null;
      try {
        const engineLogPath = path.join(userDataDir, 'engine.log');
        logStream = fs.openSync(engineLogPath, 'a');
      } catch (e) {}

      const cwdDir = path.dirname(serverScript);
      const pythonDir = path.join(appDir, 'python');
      const jreBinDir = path.join(appDir, 'jre', 'bin');
      const envPath = `${pythonDir};${jreBinDir};${process.env.PATH || ''}`;

      const spawnEnv = {
        ...process.env,
        PATH: envPath,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        SIGN_SERVER: 'http://127.0.0.1:9099',
        PORT: '8000',
        BIND_HOST: '127.0.0.1',
        HG_SIGN_CONCURRENCY: '1',
        HG_LICENSE_DISABLED: '1',
        HG_NO_WINDOW: '1',
        HG_USER_DATA_DIR: userDataDir
      };

      const spawnOpts = {
        cwd: cwdDir,
        detached: true,
        windowsHide: true,
        stdio: logStream ? ['ignore', logStream, logStream] : 'ignore',
        env: spawnEnv
      };

      engineProcess = spawn(pythonExe, [serverScript], spawnOpts);
      if (engineProcess.unref) engineProcess.unref();

      for (let i = 0; i < 35; i++) {
        await new Promise(r => setTimeout(r, 300));
        if (await isEngineAlive()) {
          console.log(`[Engine] Python FastAPI server ready on port 8000 (attempt ${i + 1})`);
          mainWindow?.webContents.send('engine:status', { ready: true });
          return true;
        }
      }

      console.warn('[Engine] Timed out waiting for Python engine on port 8000');
      const alive = await isEngineAlive();
      mainWindow?.webContents.send('engine:status', { ready: alive });
      return alive;
    } catch (err) {
      console.warn('[Engine] Startup error:', err.message);
      return false;
    } finally {
      engineStartPromise = null;
    }
  })();

  return await engineStartPromise;
}

// Ensure default download directory exists
if (!fs.existsSync(downloadPath)) {
  try {
    fs.mkdirSync(downloadPath, { recursive: true });
  } catch (err) {
    console.error('Failed to create default download directory:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    frame: false, // frameless window for macOS traffic lights & custom topbar
    titleBarStyle: 'hidden',
    backgroundColor: '#140f0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // allow loading local cover images and media
    },
    icon: process.platform === 'win32' 
      ? path.join(__dirname, 'icon.ico') 
      : path.join(__dirname, 'renderer', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:state-change', { maximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:state-change', { maximized: false });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();

  // Start local decryption engine immediately on app startup
  ensureEngineRunning().then((ready) => {
    console.log('[Startup] Engine readiness:', ready);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine:status', { ready });
    }
  }).catch(e => console.warn('Startup engine launch:', e.message));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Silent update check in background after 3.5s
  if (app.isPackaged) {
    setTimeout(() => {
      try {
        autoUpdater.checkForUpdates().catch(e => console.warn('[AutoUpdater] Silent check:', e.message));
      } catch (e) {}
    }, 3500);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (engineProcess && !engineProcess.killed) {
    try {
      engineProcess.kill();
    } catch (e) {}
  }
  if (signerProcess && !signerProcess.killed) {
    try {
      signerProcess.kill();
    } catch (e) {}
  }
});

// ----------------- Engine Health Status -----------------
ipcMain.handle('engine:status', async () => {
  const engine = await isEngineAlive();
  const signer = await isSignerAlive();
  return {
    engineAlive: engine,
    signerAlive: signer,
    ready: engine && signer
  };
});

// ----------------- Window Controls -----------------
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ----------------- File & Directory Controls -----------------
ipcMain.handle('dialog:get-default-directory', () => {
  return downloadPath;
});

ipcMain.handle('dialog:select-directory', async (event, currentPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Hongguo Downloads Folder',
    defaultPath: currentPath || downloadPath,
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    downloadPath = result.filePaths[0];
    try {
      await fetch('http://127.0.0.1:8000/dl/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_dir: downloadPath })
      });
    } catch (e) {}
    return downloadPath;
  }
  return currentPath || downloadPath;
});

ipcMain.handle('shell:open-directory', async (event, targetFolder) => {
  const folder = targetFolder || downloadPath;
  if (fs.existsSync(folder)) {
    await shell.openPath(folder);
    return { success: true };
  }
  return { success: false, error: 'Directory does not exist' };
});

ipcMain.handle('shell:open-file', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    await shell.openPath(filePath);
    return { success: true };
  }
  return { success: false, error: 'File does not exist' };
});

ipcMain.handle('shell:open-external', async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});

// Helper: Download a file over HTTP/HTTPS with redirect handling
function downloadFile(fileUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let receivedBytes = 0;
    let totalBytes = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    function makeRequest(targetUrl) {
      const client = targetUrl.startsWith('https') ? https : http;
      client.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Referer': 'https://hongguoduanju.com/'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, targetUrl).href;
          return makeRequest(redirectUrl);
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`Server responded with ${res.statusCode}`));
        }

        totalBytes = parseInt(res.headers['content-length'] || '0', 10);

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          file.write(chunk);

          const now = Date.now();
          if (now - lastTime >= 400) {
            const timeDiff = (now - lastTime) / 1000;
            const bytesDiff = receivedBytes - lastBytes;
            const speedBps = timeDiff > 0 ? bytesDiff / timeDiff : 0;
            const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
            const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;

            if (onProgress) {
              onProgress({
                receivedBytes,
                totalBytes,
                percent,
                speed: `${speedMBps} MB/s`
              });
            }

            lastTime = now;
            lastBytes = receivedBytes;
          }
        });

        res.on('end', () => {
          file.end();
          resolve(destPath);
        });

        res.on('error', (err) => {
          file.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    makeRequest(fileUrl);
  });
}

// Sanitize directory / file name
function sanitizeFilename(name) {
  return String(name || 'Hongguo_Drama')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

// ----------------- Drama Detail & Resolution -----------------
ipcMain.handle('drama:detail', async (event, seriesId) => {
  try {
    // 1. Try local engine first for instant & precise episode list
    try {
      const epRes = await fetch(`http://127.0.0.1:8000/dl/episodes?series_id=${seriesId}`, {
        signal: AbortSignal.timeout(2000)
      });
      if (epRes.ok) {
        const epData = await epRes.json();
        if (epData && epData.title && epData.total > 0) {
          return {
            success: true,
            seriesDetail: {
              series_id: epData.series_id || seriesId,
              series_name: epData.title,
              series_cover: epData.cover,
              episode_cnt: epData.total,
              tags: ['短剧']
            },
            videoList: epData.episodes || []
          };
        }
      }
    } catch (e) {}

    const detailUrl = `https://hongguoduanju.com/detail?series_id=${seriesId}`;
    const response = await fetch(detailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    const html = await response.text();
    const match = html.match(/_ROUTER_DATA\s*=\s*(\{.*?\});\n/s) || html.match(/_ROUTER_DATA\s*=\s*(\{.*?\});/s);
    if (match) {
      const data = JSON.parse(match[1]);
      const dp = data.loaderData?.detail_page;
      if (dp && dp.seriesDetail) {
        return {
          success: true,
          seriesDetail: dp.seriesDetail,
          videoList: dp.videoList || []
        };
      }
    }

    // Fallback: Query explorer API
    const expRes = await fetch(`https://explorer.hongguodownloader.com/explorer?q=${seriesId}`);
    const expData = await expRes.json();
    if (expData && expData.items && expData.items.length > 0) {
      const item = expData.items[0];
      return {
        success: true,
        seriesDetail: {
          series_id: item.series_id,
          series_name: item.title,
          series_cover: item.cover,
          episode_cnt: item.episode_cnt || 80,
          tags: ['短剧']
        }
      };
    }

    return { success: false, error: 'Could not load series details' };
  } catch (err) {
    console.error('Error in drama:detail:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drama:resolve', async (event, input) => {
  const str = String(input || '').trim();
  if (!str) return { success: false, error: 'Empty input' };

  // 1. Direct series_id check
  const idMatch = str.match(/series_id=(\d+)/) || str.match(/\/drama\/(\d+)/) || str.match(/^(\d{15,22})$/);
  if (idMatch) {
    const seriesId = idMatch[1];
    return { success: true, type: 'id', seriesId };
  }

  // 2. Title wrapped in Chinese brackets 《...》
  const bracketMatch = str.match(/《([^》]+)》/);
  const searchTitle = bracketMatch ? bracketMatch[1] : str;

  return { success: true, type: 'query', query: searchTitle };
});

// ----------------- Download Orchestration -----------------
ipcMain.handle('drama:start-download', async (event, req) => {
  const { seriesId, title, cover, quality = '1080p', episodeRange = 'all', totalEpisodes = 80, intro = '', tags = [] } = req;
  const safeTitle = sanitizeFilename(title);
  const dramaDir = path.join(downloadPath, safeTitle);

  try {
    if (!fs.existsSync(dramaDir)) {
      fs.mkdirSync(dramaDir, { recursive: true });
    }

    // Clean up any 0-byte .mp4 files left over from earlier failed attempts
    try {
      if (fs.existsSync(dramaDir)) {
        const existingFiles = fs.readdirSync(dramaDir);
        for (const f of existingFiles) {
          if (f.endsWith('.mp4')) {
            const fp = path.join(dramaDir, f);
            if (fs.statSync(fp).size === 0) {
              fs.unlinkSync(fp);
            }
          }
        }
      }
    } catch (e) {}

    // 1. Download full uncompressed Cover Image (cover.jpg)
    if (cover) {
      const highResCover = cover.includes('~tplv-shrink')
        ? cover.replace(/~tplv-shrink:[^~]+/, '~tplv-noop.image')
        : cover;
      const coverPath = path.join(dramaDir, 'cover.jpg');

      downloadFile(highResCover, coverPath).then(() => {
        mainWindow?.webContents.send('download:progress', {
          seriesId: String(seriesId),
          type: 'cover',
          message: 'Cover image saved (cover.jpg)'
        });
      }).catch(err => {
        console.warn('Cover download fallback:', err.message);
        downloadFile(cover, coverPath).catch(() => {});
      });
    }

    // 2. Save info.json metadata
    const infoData = {
      seriesId: String(seriesId),
      title,
      intro,
      tags,
      totalEpisodes: Number(totalEpisodes) || 80,
      quality,
      cover: 'cover.jpg',
      downloadDate: new Date().toISOString()
    };
    fs.writeFileSync(path.join(dramaDir, 'info.json'), JSON.stringify(infoData, null, 2), 'utf-8');

    // 3. Ensure local decryption engine is running
    const engineReady = await ensureEngineRunning();
    if (!engineReady) {
      const errMsg = 'Hongguo engine failed to start on this machine. Please check engine.log in AppData.';
      mainWindow?.webContents.send('download:error', {
        seriesId: String(seriesId),
        error: errMsg
      });
      return { success: false, error: errMsg };
    }

    try {
      await fetch('http://127.0.0.1:8000/dl/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_dir: downloadPath }),
        signal: AbortSignal.timeout(4000)
      });
    } catch (e) {}

    // 4. Submit real download task to Hongguo decryption engine
    // Use concurrency 2 to avoid exhausting single-threaded unidbg ARM64 RPC signer
    const submitPayload = {
      series_ids: [String(seriesId)],
      concurrency: 2,
      series_at_once: 2,
      quality: quality || '1080p',
      ranges: { [String(seriesId)]: episodeRange || 'all' }
    };

    const submitRes = await fetch('http://127.0.0.1:8000/dl/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitPayload),
      signal: AbortSignal.timeout(6000)
    }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));

    if (!submitRes || !submitRes.ok) {
      const errReason = submitRes?.error || submitRes?.reason || 'Failed to submit download task to engine';
      const isBusy = submitRes?.reason === '已有任务在运行' || String(errReason).includes('已有任务');
      if (!isBusy) {
        mainWindow?.webContents.send('download:error', {
          seriesId: String(seriesId),
          error: errReason
        });
      }
      return { success: false, busy: isBusy, error: errReason };
    }

    const downloadState = {
      seriesId: String(seriesId),
      title,
      safeTitle,
      dramaDir,
      totalEpisodes: Number(totalEpisodes) || 80,
      downloadedCount: 0,
      status: 'downloading',
      cancelled: false
    };
    activeDownloads.set(String(seriesId), downloadState);

    // 5. Poll engine status and report real-time progress to UI
    let pollCount = 0;
    let seenStarted = false;
    let consecutiveErrors = 0;

    const pollInterval = setInterval(async () => {
      pollCount++;
      if (downloadState.cancelled) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const statusRes = await fetch('http://127.0.0.1:8000/dl/status', {
          signal: AbortSignal.timeout(3500)
        }).then(r => r.json());

        consecutiveErrors = 0;
        const curSeries = statusRes.series && statusRes.series.find(s => String(s.sid) === String(seriesId));

        // Check for fatal engine log errors when stopped
        if (!statusRes.running && statusRes.log && Array.isArray(statusRes.log)) {
          const fatalErr = statusRes.log.find(l => typeof l === 'string' && (
            l.includes('接口返回异常') ||
            l.includes('nothing to download') ||
            l.includes('所有签名服务失败')
          ));
          if (fatalErr && !curSeries) {
            clearInterval(pollInterval);
            activeDownloads.delete(String(seriesId));
            mainWindow?.webContents.send('download:error', {
              seriesId: String(seriesId),
              error: 'Download failed: ' + fatalErr
            });
            return;
          }
        }

        if (curSeries) {
          seenStarted = true;
          const done = curSeries.done || 0;
          const total = curSeries.total || Number(totalEpisodes) || 80;
          const percent = total > 0 ? Math.round((done / total) * 100) : 0;
          downloadState.downloadedCount = done;
          downloadState.totalEpisodes = total;

          mainWindow?.webContents.send('download:progress', {
            seriesId: String(seriesId),
            currentEpisode: done,
            totalEpisodes: total,
            downloadedCount: done,
            percent,
            speed: curSeries.status === 'done' ? 'Done' : (curSeries.speed || 'Downloading...'),
            filename: `第${String(done).padStart(2, '0')}集.mp4`,
            status: curSeries.status === 'done' ? 'completed' : 'downloading'
          });

          if (curSeries.status === 'done' || (!statusRes.running && seenStarted && pollCount > 3)) {
            clearInterval(pollInterval);
            activeDownloads.delete(String(seriesId));
            if (done > 0) {
              mainWindow?.webContents.send('download:complete', {
                seriesId: String(seriesId),
                dramaDir,
                title,
                totalEpisodes: total
              });
            } else {
              mainWindow?.webContents.send('download:error', {
                seriesId: String(seriesId),
                error: 'Download ended with 0 episodes downloaded'
              });
            }
          }
        } else if (!statusRes.running && pollCount > 4) {
          clearInterval(pollInterval);
          activeDownloads.delete(String(seriesId));
          if (seenStarted) {
            mainWindow?.webContents.send('download:complete', {
              seriesId: String(seriesId),
              dramaDir,
              title,
              totalEpisodes: Number(totalEpisodes) || 80
            });
          } else {
            const lastLog = (statusRes.log && statusRes.log.length > 0)
              ? statusRes.log[statusRes.log.length - 1]
              : 'Task could not be started by engine';
            mainWindow?.webContents.send('download:error', {
              seriesId: String(seriesId),
              error: lastLog
            });
          }
        } else if (statusRes.running && !seenStarted) {
          mainWindow?.webContents.send('download:progress', {
            seriesId: String(seriesId),
            currentEpisode: 0,
            totalEpisodes: Number(totalEpisodes) || 80,
            downloadedCount: 0,
            percent: 0,
            speed: 'Preparing...',
            status: 'downloading'
          });
        }
      } catch (err) {
        consecutiveErrors++;
        console.warn('Poll error:', err.message);
        if (consecutiveErrors >= 6) {
          clearInterval(pollInterval);
          activeDownloads.delete(String(seriesId));
          mainWindow?.webContents.send('download:error', {
            seriesId: String(seriesId),
            error: 'Lost connection to decryption engine: ' + err.message
          });
        }
      }
    }, 1000);

    return { success: true, dramaDir };
  } catch (err) {
    console.error('Download start error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drama:cancel-download', async (event, seriesId) => {
  if (activeDownloads.has(String(seriesId))) {
    const dl = activeDownloads.get(String(seriesId));
    dl.cancelled = true;
    activeDownloads.delete(String(seriesId));
  }
  try {
    await fetch('http://127.0.0.1:8000/dl/cancel', { method: 'POST' });
  } catch (e) {}
  return { success: true };
});

ipcMain.handle('drama:get-status', () => {
  const list = [];
  for (const [id, s] of activeDownloads.entries()) {
    list.push({
      seriesId: id,
      title: s.title,
      downloadedCount: s.downloadedCount,
      totalEpisodes: s.totalEpisodes,
      status: s.status
    });
  }
  return list;
});

// ----------------- Video Player Stream & Local Resolver -----------------
function findLocalEpisodePath(title, epNumber) {
  if (!downloadPath || !fs.existsSync(downloadPath)) return null;
  const safeTitle = sanitizeFilename(title);
  const possibleDirs = [
    path.join(downloadPath, title || ''),
    path.join(downloadPath, safeTitle)
  ];
  const epPad3 = String(epNumber).padStart(3, '0');
  const epPad2 = String(epNumber).padStart(2, '0');
  const epStr = String(epNumber);

  for (const dir of possibleDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.mp4')) continue;
        const fullPath = path.join(dir, f);
        if (fs.statSync(fullPath).size <= 1000) continue;

        if (
          f.includes(`第${epPad3}集`) ||
          f.includes(`第${epPad2}集`) ||
          f.includes(`第${epStr}集`) ||
          f.includes(`_${epPad3}.`) ||
          f.includes(`_${epStr}.`) ||
          f.startsWith(`ep_${epPad3}`) ||
          f.startsWith(`ep_${epStr}`) ||
          f.startsWith(`${epPad3}.`) ||
          f.startsWith(`${epStr}.`) ||
          f.match(new RegExp(`(?:ep|episode|第|#)[_\\s]*0*${epStr}(?:[._\\s集]|$)`, 'i'))
        ) {
          return fullPath;
        }
      }
    } catch (e) {}
  }
  return null;
}

ipcMain.handle('drama:get-episode-stream', async (event, { seriesId, title, epNumber }) => {
  const ep = Number(epNumber) || 1;
  const localFile = findLocalEpisodePath(title, ep);
  if (localFile) {
    return {
      success: true,
      url: `file://${localFile.replace(/\\/g, '/')}`,
      isLocal: true,
      episode: ep
    };
  }

  // Ensure decryption engine is alive
  await ensureEngineRunning();

  const streamUrl = `http://127.0.0.1:8000/stream?series_id=${seriesId}&ep=${ep}&api_key=hg_ab6b4191835fc5778ab0dca914e0a6cc`;
  return {
    success: true,
    url: streamUrl,
    isLocal: false,
    episode: ep
  };
});

// ----------------- Library Scanner -----------------
ipcMain.handle('drama:scan-library', async (event, customFolder) => {
  const targetDir = customFolder || downloadPath;
  if (!fs.existsSync(targetDir)) return [];

  try {
    const items = fs.readdirSync(targetDir, { withFileTypes: true });
    const library = [];

    for (const item of items) {
      if (item.isDirectory()) {
        const itemPath = path.join(targetDir, item.name);
        const coverPath = path.join(itemPath, 'cover.jpg');
        const posterPath = path.join(itemPath, 'poster.jpg');
        const infoPath = path.join(itemPath, 'info.json');

        let metadata = {
          title: item.name,
          totalEpisodes: 0,
          downloadDate: null
        };

        if (fs.existsSync(infoPath)) {
          try {
            const raw = fs.readFileSync(infoPath, 'utf-8');
            metadata = { ...metadata, ...JSON.parse(raw) };
          } catch (e) {}
        }

        // Count only valid mp4 files (size > 0)
        const files = fs.readdirSync(itemPath);
        const epFiles = files
          .filter(f => f.endsWith('.mp4') && fs.statSync(path.join(itemPath, f)).size > 0)
          .sort();

        let coverFile = null;
        if (fs.existsSync(coverPath)) {
          coverFile = `file://${coverPath.replace(/\\/g, '/')}`;
        } else if (fs.existsSync(posterPath)) {
          coverFile = `file://${posterPath.replace(/\\/g, '/')}`;
        }

        library.push({
          title: metadata.title || item.name,
          folderName: item.name,
          path: itemPath,
          coverFile,
          episodeCount: epFiles.length,
          totalEpisodes: metadata.totalEpisodes || epFiles.length,
          episodes: epFiles.map(f => ({
            name: f,
            path: path.join(itemPath, f),
            fileUrl: `file://${path.join(itemPath, f).replace(/\\/g, '/')}`
          })),
          metadata
        });
      }
    }

    return library;
  } catch (err) {
    console.error('Scan library error:', err);
    return [];
  }
});

// ----------------- Auto-Updater IPC Handlers -----------------
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) {
    console.log('[AutoUpdater] In development mode - skipping live check');
    return { dev: true, version: app.getVersion() };
  }
  try {
    const res = await autoUpdater.checkForUpdates();
    return { success: true, version: res?.updateInfo?.version };
  } catch (err) {
    console.warn('[AutoUpdater] Manual check error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('updater:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    console.warn('[AutoUpdater] Download error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('updater:install', () => {
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    console.error('[AutoUpdater] Quit and install error:', err);
  }
});

