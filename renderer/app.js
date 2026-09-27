/**
 * HongguoDL SHORT-DRAMA HARVESTER
 * Client Application Logic
 * Adheres to Modern Web Guidance: async/await, responsive states,
 * accessible keyboard & focus interactions, seamless IPC bridging.
 */

// Application State
const DEFAULT_POSTER = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='280' viewBox='0 0 200 280' fill='%23251b14'%3E%3Ctext x='50%25' y='50%25' fill='%23a6988c' font-size='14' text-anchor='middle' dominant-baseline='middle'%3EPoster%3C/text%3E%3C/svg%3E";

const state = {
  activeTab: 'all',
  items: [],
  selectedDrama: null,
  downloadDir: '',
  queue: [],
  activeDownloadId: null,
  libraryItems: [],
  currentPlaying: null,

  // Real-time catalog & pagination state
  page: 1,
  pageSize: 60,
  totalPages: 1,
  totalCount: 49509,
  genre: '',
  sort: 'hot',
  status: 'all',
  searchQuery: '',
  isLoading: false,
  isLoadingMore: false,
  hasMore: true
};

// DOM Elements
const elements = {
  // Window controls
  btnClose: document.getElementById('btnClose'),
  btnMin: document.getElementById('btnMin'),
  btnMax: document.getElementById('btnMax'),
  licenseBadge: document.getElementById('licenseBadge'),
  creatorBadge: document.getElementById('creatorBadge'),

  // Auto Updater
  btnCheckUpdate: document.getElementById('btnCheckUpdate'),
  appVersionLabel: document.getElementById('appVersionLabel'),
  updateIndicatorDot: document.getElementById('updateIndicatorDot'),
  updateBanner: document.getElementById('updateBanner'),
  updateBannerTitle: document.getElementById('updateBannerTitle'),
  updateBannerDesc: document.getElementById('updateBannerDesc'),
  updateProgressWrap: document.getElementById('updateProgressWrap'),
  updateProgressFill: document.getElementById('updateProgressFill'),
  updateProgressText: document.getElementById('updateProgressText'),
  btnUpdateAction: document.getElementById('btnUpdateAction'),
  btnUpdateDismiss: document.getElementById('btnUpdateDismiss'),

  // Search & Navigation
  searchInput: document.getElementById('searchInput'),
  btnGo: document.getElementById('btnGo'),
  btnToggleLibrary: document.getElementById('btnToggleLibrary'),
  btnToggleQueue: document.getElementById('btnToggleQueue'),
  queueCount: document.getElementById('queueCount'),

  // Catalog Toolbar & Sentinel
  catalogToolbar: document.getElementById('catalogToolbar'),
  catalogStatText: document.getElementById('catalogStatText'),
  sortSelect: document.getElementById('sortSelect'),
  genreChipsScroll: document.getElementById('genreChipsScroll'),
  scrollSentinel: document.getElementById('scrollSentinel'),
  dramaGridContainer: document.getElementById('dramaGridContainer'),

  // Grid
  dramaGrid: document.getElementById('dramaGrid'),
  gridLoading: document.getElementById('gridLoading'),
  gridEmpty: document.getElementById('gridEmpty'),

  // Bottom Floating Dock
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  btnPickFolder: document.getElementById('btnPickFolder'),
  folderPathDisplay: document.getElementById('folderPathDisplay'),
  qualitySelect: document.getElementById('qualitySelect'),
  episodesRangeInput: document.getElementById('episodesRangeInput'),
  btnStepDown: document.getElementById('btnStepDown'),
  btnStepUp: document.getElementById('btnStepUp'),
  btnCancelDownload: document.getElementById('btnCancelDownload'),
  btnStartDownload: document.getElementById('btnStartDownload'),

  // Detail Modal
  detailModal: document.getElementById('detailModal'),
  detailModalContent: document.getElementById('detailModalContent'),
  btnCloseDetail: document.getElementById('btnCloseDetail'),

  // Queue Drawer
  queueDrawer: document.getElementById('queueDrawer'),
  queueList: document.getElementById('queueList'),
  queueDrawerCount: document.getElementById('queueDrawerCount'),
  btnCloseQueue: document.getElementById('btnCloseQueue'),
  btnOpenDownloadsFolder: document.getElementById('btnOpenDownloadsFolder'),
  btnStartAllQueue: document.getElementById('btnStartAllQueue'),

  // Video Player Modal
  playerModal: document.getElementById('playerModal'),
  playerTitle: document.getElementById('playerTitle'),
  playerSourceTag: document.getElementById('playerSourceTag'),
  videoElement: document.getElementById('videoElement'),
  videoLoadingIndicator: document.getElementById('videoLoadingIndicator'),
  playerSpeedSelect: document.getElementById('playerSpeedSelect'),
  btnPlayerPrev: document.getElementById('btnPlayerPrev'),
  btnPlayerNext: document.getElementById('btnPlayerNext'),
  btnPlayerFullscreen: document.getElementById('btnPlayerFullscreen'),
  playerTotalEpisodesCount: document.getElementById('playerTotalEpisodesCount'),
  playerJumpInput: document.getElementById('playerJumpInput'),
  playerEpisodesList: document.getElementById('playerEpisodesList'),
  btnClosePlayer: document.getElementById('btnClosePlayer'),

  // Toast
  toastNotice: document.getElementById('toastNotice')
};

// -------------------------------------------------------------
// Toast Notifications
// -------------------------------------------------------------
let toastTimer = null;
function showToast(message, duration = 3000) {
  if (!elements.toastNotice) return;
  elements.toastNotice.textContent = message;
  elements.toastNotice.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toastNotice.classList.remove('show');
  }, duration);
}

// -------------------------------------------------------------
// Path Shortener Utility
// -------------------------------------------------------------
function formatDisplayPath(fullPath) {
  if (!fullPath) return '...Select Folder';
  const parts = fullPath.replace(/\\/g, '/').split('/');
  if (parts.length > 3) {
    return '...' + parts.slice(-3).join('\\');
  }
  return fullPath;
}

// -------------------------------------------------------------
// 1. Window Controls & Titlebar
// -------------------------------------------------------------
function initWindowControls() {
  elements.btnClose?.addEventListener('click', () => {
    window.electronAPI?.close();
  });

  elements.btnMin?.addEventListener('click', () => {
    window.electronAPI?.minimize();
  });

  elements.btnMax?.addEventListener('click', () => {
    window.electronAPI?.maximize();
  });

  // Simulated live countdown timer for license badge
  let remainingSeconds = 1087 * 86400 + 14 * 3600 + 14 * 60 + 31;
  setInterval(() => {
    if (remainingSeconds > 0) remainingSeconds--;
    const days = Math.floor(remainingSeconds / 86400);
    const hours = String(Math.floor((remainingSeconds % 86400) / 3600)).padStart(2, '0');
    const mins = String(Math.floor((remainingSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(remainingSeconds % 60).padStart(2, '0');
    const textEl = elements.licenseBadge?.querySelector('.license-text');
    if (textEl) {
      textEl.textContent = `LICENSE · ${days}D ${hours}:${mins}:${secs}`;
    }
  }, 1000);
}

// -------------------------------------------------------------
// 2. Real-time Live Catalogue & Infinite Scroll
// -------------------------------------------------------------
const EXPLORER_BASE = 'https://explorer.hongguodownloader.com';

async function fetchLiveHeroStats() {
  try {
    const [explorerRes, genresRes] = await Promise.all([
      fetch(`${EXPLORER_BASE}/explorer?size=1`).then(r => r.json()).catch(() => null),
      fetch(`${EXPLORER_BASE}/genres?limit=60`).then(r => r.json()).catch(() => null)
    ]);

    const total = explorerRes?.count || 49509;
    let ai = 0;
    let an = 0;
    (genresRes?.genres || []).forEach(x => {
      if (x.value === 'AI') ai = x.count;
      if (x.value === 'Animated') an = x.count;
    });

    if (elements.catalogStatText) {
      elements.catalogStatText.textContent = `⚡ ${total.toLocaleString()} Dramas · ${ai.toLocaleString()} AI · ${an.toLocaleString()} Animated · Live from 红果`;
    }
  } catch (e) {
    console.warn('Hero stats error:', e);
  }
}

async function fetchGenres() {
  try {
    const res = await fetch(`${EXPLORER_BASE}/genres?limit=60`);
    if (!res.ok) return;
    const data = await res.json();
    const genres = data.genres || [];

    const chips = [
      `<button class="genre-chip active" data-genre="">All Genres</button>`,
      ...genres.map(g => {
        const val = g.value || g.genre;
        const name = g.genre;
        const count = g.count ? ` (${g.count.toLocaleString()})` : '';
        return `<button class="genre-chip" data-genre="${val}">${name}${count}</button>`;
      })
    ].join('');

    if (elements.genreChipsScroll) {
      elements.genreChipsScroll.innerHTML = chips;

      elements.genreChipsScroll.querySelectorAll('.genre-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          elements.genreChipsScroll.querySelectorAll('.genre-chip').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.genre = btn.dataset.genre || '';
          if (state.activeTab === 'library') {
            state.activeTab = 'all';
            elements.btnToggleLibrary?.classList.remove('active');
            if (elements.catalogToolbar) elements.catalogToolbar.style.display = 'flex';
          }
          fetchCatalogPage({ reset: true });
        });
      });
    }
  } catch (e) {
    console.warn('Failed to load genres:', e);
  }
}

async function fetchCatalogPage({ reset = false, page = 1 } = {}) {
  if (state.isLoading || (state.isLoadingMore && !reset)) return;

  if (reset) {
    state.page = 1;
    state.hasMore = true;
    state.isLoading = true;
    setLoading(true);
    if (elements.scrollSentinel) elements.scrollSentinel.style.display = 'none';
  } else {
    state.isLoadingMore = true;
    if (elements.scrollSentinel) elements.scrollSentinel.style.display = 'flex';
  }

  try {
    // 1. Leaderboard Modes (Top 100 with Ranks)
    if (state.activeTab !== 'all' && state.activeTab !== 'library') {
      if (elements.catalogToolbar) elements.catalogToolbar.style.display = 'none';
      if (elements.scrollSentinel) elements.scrollSentinel.style.display = 'none';
      state.hasMore = false;

      const url = `${EXPLORER_BASE}/leaderboard?board=hot&category=${state.activeTab}&size=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      state.items = data.items || [];
      renderDramaCards(state.items, false);
      return;
    }

    // 2. Full 49,500+ Catalog Mode with Live Filter & Search
    if (elements.catalogToolbar) elements.catalogToolbar.style.display = 'flex';

    let url = `${EXPLORER_BASE}/explorer?page=${page}&size=${state.pageSize}&sort=${state.sort}`;
    if (state.genre) {
      url += `&genre=${encodeURIComponent(state.genre)}`;
    }
    if (state.status && state.status !== 'all') {
      url += `&status=${encodeURIComponent(state.status)}`;
    }
    if (state.searchQuery) {
      url += `&q=${encodeURIComponent(state.searchQuery)}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();

    const newItems = data.items || [];
    state.totalPages = data.pages || Math.ceil((data.count || 0) / state.pageSize) || 1;
    state.totalCount = data.count || state.totalCount;
    state.hasMore = state.page < state.totalPages && newItems.length > 0;

    if (reset) {
      state.items = newItems;
      renderDramaCards(newItems, false);
    } else {
      state.items = state.items.concat(newItems);
      renderDramaCards(newItems, true);
    }

    if (elements.scrollSentinel) {
      elements.scrollSentinel.style.display = state.hasMore ? 'flex' : 'none';
    }

    if (state.items.length === 0) {
      if (elements.gridEmpty) elements.gridEmpty.style.display = 'block';
    } else {
      if (elements.gridEmpty) elements.gridEmpty.style.display = 'none';
    }
  } catch (err) {
    console.error('Catalog fetch error:', err);
    if (reset) {
      elements.dramaGrid.innerHTML = `
        <div class="grid-empty" style="grid-column: 1 / -1;">
          <p>⚠️ Unable to connect to Hongguo catalog (${err.message}).</p>
          <p style="margin-top: 8px; font-size: 13px;">Check connection or paste a link/title in the search bar above.</p>
        </div>
      `;
    }
  } finally {
    state.isLoading = false;
    state.isLoadingMore = false;
    setLoading(false);
  }
}

// Infinite Scroll Observer
let sentinelObserver = null;
function initInfiniteScroll() {
  if (sentinelObserver) sentinelObserver.disconnect();

  sentinelObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && !state.isLoading && !state.isLoadingMore && state.hasMore && state.activeTab === 'all') {
      state.page++;
      fetchCatalogPage({ reset: false, page: state.page });
    }
  }, {
    root: elements.dramaGridContainer,
    rootMargin: '350px', // Preload before reaching bottom
    threshold: 0.05
  });

  if (elements.scrollSentinel) {
    sentinelObserver.observe(elements.scrollSentinel);
  }
}

function setLoading(isLoading) {
  if (elements.gridLoading) {
    elements.gridLoading.style.display = isLoading ? 'block' : 'none';
  }
  if (elements.gridEmpty && isLoading) {
    elements.gridEmpty.style.display = 'none';
  }
}

// -------------------------------------------------------------
// 3. Render Cards in Grid (Supports Infinite Scroll Append)
// -------------------------------------------------------------
function renderDramaCards(items, append = false) {
  if (!elements.dramaGrid) return;
  if (!append) {
    elements.dramaGrid.innerHTML = '';
  }

  if (!items || items.length === 0) {
    if (!append && elements.gridEmpty) elements.gridEmpty.style.display = 'block';
    return;
  }
  if (elements.gridEmpty) elements.gridEmpty.style.display = 'none';

  const startIndex = append ? elements.dramaGrid.children.length : 0;

  items.forEach((item, idx) => {
    const overallIndex = startIndex + idx;
    const card = document.createElement('article');
    card.className = 'drama-card';
    card.dataset.id = item.series_id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${item.title}, rating ${item.score || '9.0'}`);

    if (state.selectedDrama && String(state.selectedDrama.series_id) === String(item.series_id)) {
      card.classList.add('selected');
    }

    // Rank badge for top 3 in leaderboard or top page 1
    let rankBadgeHtml = '';
    if (overallIndex === 0 && (state.activeTab !== 'all' || (!state.genre && !state.searchQuery))) rankBadgeHtml = '<span class="rank-badge top-1">1</span>';
    else if (overallIndex === 1 && (state.activeTab !== 'all' || (!state.genre && !state.searchQuery))) rankBadgeHtml = '<span class="rank-badge top-2">2</span>';
    else if (overallIndex === 2 && (state.activeTab !== 'all' || (!state.genre && !state.searchQuery))) rankBadgeHtml = '<span class="rank-badge top-3">3</span>';

    // Rating badge
    const scoreVal = item.score ? Number(item.score).toFixed(1) : '9.0';
    const ratingHtml = `<span class="rating-badge">★ ${scoreVal}</span>`;

    // Episodes count badge
    const epsCount = item.episode_cnt && item.episode_cnt > 0 ? item.episode_cnt : 80;
    const epsHtml = `<span class="eps-badge">${epsCount} eps</span>`;

    // Image URL with high-res enhancement
    let coverUrl = item.cover || `${EXPLORER_BASE}/cover/${item.series_id}`;
    if (coverUrl.includes('~tplv-shrink:240')) {
      coverUrl = coverUrl.replace(/~tplv-shrink:240:[^~]+/, '~tplv-shrink:480:0.image');
    }

    card.innerHTML = `
      <div class="poster-box">
        ${ratingHtml}
        ${rankBadgeHtml}
        <img 
          class="poster-img" 
          src="${coverUrl}" 
          alt="${item.title}" 
          loading="lazy"
          onerror="this.onerror=null; this.src='${DEFAULT_POSTER}';"
        >
        <div class="poster-scrim"></div>
        <button class="card-quick-play-btn" title="ទស្សនារឿងនេះភ្លាមៗ (Watch Drama)">▶</button>
        ${epsHtml}
      </div>
      <div class="card-title" title="${item.title}">${item.title}</div>
    `;

    // Quick Play Button
    card.querySelector('.card-quick-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playDramaEpisode(item, 1);
    });

    // Interactions
    card.addEventListener('click', () => {
      selectDrama(item);
    });

    card.addEventListener('dblclick', () => {
      openDetailModal(item);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectDrama(item);
      }
    });

    elements.dramaGrid.appendChild(card);
  });
}

// -------------------------------------------------------------
// 4. Select Drama & Update Dock
// -------------------------------------------------------------
function selectDrama(item) {
  state.selectedDrama = item;

  // Highlight selected card
  document.querySelectorAll('.drama-card').forEach(c => {
    if (c.dataset.id === String(item.series_id)) {
      c.classList.add('selected');
    } else {
      c.classList.remove('selected');
    }
  });

  // If episode count is 0 or missing, resolve in background
  if (!item.episode_cnt || item.episode_cnt === 0) {
    window.electronAPI.fetchDramaDetail(item.series_id).then(res => {
      if (res && res.seriesDetail && res.seriesDetail.episode_cnt) {
        item.episode_cnt = res.seriesDetail.episode_cnt;
        if (state.selectedDrama && state.selectedDrama.series_id === item.series_id) {
          state.selectedDrama.episode_cnt = res.seriesDetail.episode_cnt;
        }
      }
    }).catch(() => {});
  }

  // Update status dock
  if (state.activeDownloadId === null) {
    elements.statusText.textContent = `Selected: ${item.title}`;
    elements.statusDot.className = 'status-indicator-dot ready';
  }

  showToast(`Selected "${item.title}". Click Download or double-click to view details.`);
}

// -------------------------------------------------------------
// 5. Detail & Episode Selection Modal
// -------------------------------------------------------------
async function openDetailModal(item) {
  state.selectedDrama = item;
  elements.detailModalContent.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <div class="spinner"></div>
      <p style="color: var(--text-muted); margin-top: 12px;">Loading drama details...</p>
    </div>
  `;
  elements.detailModal.classList.add('active');

  let detail = null;
  try {
    const res = await window.electronAPI.fetchDramaDetail(item.series_id);
    if (res && res.success && res.seriesDetail) {
      detail = res.seriesDetail;
    }
  } catch (e) {
    console.warn('Detail fetch error:', e);
  }

  const title = detail?.series_name || item.title;
  let cover = detail?.series_cover || item.cover || `${EXPLORER_BASE}/cover/${item.series_id}`;
  if (cover.includes('~tplv-shrink:')) {
    cover = cover.replace(/~tplv-shrink:[^~]+/, '~tplv-noop.image');
  }
  const eps = detail?.episode_cnt || item.episode_cnt || 80;
  const intro = detail?.series_intro || 'Hongguo exclusive short-drama. High-definition short series with fast pacing, intense drama, and cliffhangers.';
  const score = item.score ? Number(item.score).toFixed(1) : '9.0';
  const heat = item.heat ? ` · 🔥 ${item.heat}` : '';

  elements.detailModalContent.innerHTML = `
    <div class="detail-layout">
      <div>
        <img class="detail-cover" src="${cover}" alt="${title}">
      </div>
      <div class="detail-info">
        <h2 class="detail-title">${title}</h2>
        <div class="detail-meta">
          <span style="color: var(--star-gold); font-weight: 700;">★ ${score}</span>
          <span>${eps} Episodes</span>
          <span>${heat}</span>
        </div>
        <div class="detail-synopsis">
          ${intro}
        </div>
        <div class="detail-actions">
          <button class="btn primary" id="btnModalPlayNow">
            <svg style="width: 15px; height: 15px;" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            ▶ មើលភាគទី ១ (Watch Ep 1)
          </button>
          <button class="btn secondary" id="btnModalDownloadNow">
            <svg style="width: 15px; height: 15px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download All (1080p)
          </button>
          <button class="btn ghost" id="btnModalAddToQueue">+ Add to Queue</button>
        </div>

        <div class="detail-episodes-section">
          <div class="detail-episodes-header">
            <span>🎬 បញ្ជីភាគទាំងអស់ (${eps} ភាគ):</span>
            <span style="font-size: 11px; color: var(--text-muted);">ចុចលើភាគណាមួយដើម្បីទស្សនាភ្លាមៗ</span>
          </div>
          <div class="detail-episodes-grid" id="detailEpisodesGrid">
            ${Array.from({ length: eps }, (_, i) => `<button class="detail-ep-btn" data-ep="${i + 1}">ភាគ ${i + 1}</button>`).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach modal action listeners
  document.getElementById('btnModalPlayNow')?.addEventListener('click', () => {
    closeDetailModal();
    playDramaEpisode({
      series_id: item.series_id,
      title,
      cover,
      episode_cnt: eps,
      intro
    }, 1);
  });

  // Click any episode button in grid
  document.querySelectorAll('#detailEpisodesGrid .detail-ep-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const epNum = parseInt(btn.dataset.ep, 10);
      closeDetailModal();
      playDramaEpisode({
        series_id: item.series_id,
        title,
        cover,
        episode_cnt: eps,
        intro
      }, epNum);
    });
  });

  document.getElementById('btnModalDownloadNow')?.addEventListener('click', () => {
    closeDetailModal();
    startDownloadDrama({
      series_id: item.series_id,
      title,
      cover,
      episode_cnt: eps,
      intro
    });
  });

  document.getElementById('btnModalAddToQueue')?.addEventListener('click', () => {
    addToQueue({
      series_id: item.series_id,
      title,
      cover,
      episode_cnt: eps,
      intro
    });
    closeDetailModal();
  });
}

function closeDetailModal() {
  elements.detailModal?.classList.remove('active');
}

// -------------------------------------------------------------
// 6. Download Execution & Orchestration
// -------------------------------------------------------------
async function processNextQueueItem() {
  if (state.activeDownloadId) return; // already busy
  const nextItem = state.queue.find(q => q.status === 'queued');
  if (!nextItem) return;
  await startDownloadDrama(nextItem);
}

async function startDownloadDrama(drama) {
  const target = drama || state.selectedDrama;
  if (!target) {
    showToast('Please select a drama card first or paste a link/title!');
    return;
  }

  const sid = String(target.series_id || target.seriesId);

  // If another download is currently running, just add to queue and let runner pick it up
  if (state.activeDownloadId && String(state.activeDownloadId) !== sid) {
    addToQueue(target, false);
    showToast(`Added "${target.title}" to download queue (#${state.queue.length})`);
    return;
  }

  const quality = elements.qualitySelect?.value || '1080p';
  const episodeRange = elements.episodesRangeInput?.value || 'all';

  elements.statusDot.className = 'status-indicator-dot downloading';
  elements.statusText.textContent = `Downloading ${target.title}...`;
  state.activeDownloadId = sid;

  // Add or update in Queue drawer
  addToQueue(target, true);

  showToast(`Starting download for "${target.title}" in ${quality}...`);

  try {
    const res = await window.electronAPI.startDownload({
      seriesId: sid,
      title: target.title,
      cover: target.cover,
      quality,
      episodeRange,
      totalEpisodes: target.episode_cnt || target.totalEpisodes || 80,
      intro: target.intro || ''
    });

    if (!res.success) {
      if (res.busy) {
        // Engine is currently busy, re-queue so the queue runner picks it up next
        const qItem = state.queue.find(q => String(q.series_id) === sid);
        if (qItem) {
          qItem.speed = 'Queued';
          qItem.status = 'queued';
          updateQueueUI();
        }
        resetDownloadStatus();
      } else {
        showToast(`Download failed: ${res.error}`);
        const qItem = state.queue.find(q => String(q.series_id) === sid);
        if (qItem) {
          qItem.speed = 'Failed';
          qItem.status = 'failed';
          updateQueueUI();
        }
        resetDownloadStatus();
        setTimeout(processNextQueueItem, 1500);
      }
    }
  } catch (err) {
    console.error('Download launch error:', err);
    showToast(`Error: ${err.message}`);
    const qItem = state.queue.find(q => String(q.series_id) === sid);
    if (qItem) {
      qItem.speed = 'Failed';
      qItem.status = 'failed';
      updateQueueUI();
    }
    resetDownloadStatus();
    setTimeout(processNextQueueItem, 1500);
  }
}

function cancelCurrentDownload() {
  if (!state.activeDownloadId) {
    showToast('No active download to stop.');
    return;
  }

  const cancelledId = state.activeDownloadId;
  window.electronAPI.cancelDownload(cancelledId);
  const qItem = state.queue.find(q => String(q.series_id) === String(cancelledId));
  if (qItem) {
    qItem.status = 'failed';
    qItem.speed = 'Cancelled';
    updateQueueUI();
  }
  showToast('Download cancelled.');
  resetDownloadStatus();
  setTimeout(processNextQueueItem, 1500);
}

function resetDownloadStatus() {
  state.activeDownloadId = null;
  elements.statusDot.className = 'status-indicator-dot ready';
  elements.statusText.textContent = 'Ready ✓';
}

// -------------------------------------------------------------
// 7. Queue Management
// -------------------------------------------------------------
function addToQueue(drama, isDownloading = false) {
  const sid = String(drama.series_id || drama.seriesId);
  const existing = state.queue.find(q => String(q.series_id) === sid);
  if (!existing) {
    state.queue.push({
      series_id: sid,
      title: drama.title,
      cover: drama.cover,
      totalEpisodes: drama.episode_cnt || drama.totalEpisodes || 80,
      currentEpisode: 0,
      percent: 0,
      speed: isDownloading ? 'Connecting...' : 'Queued',
      status: isDownloading ? 'downloading' : 'queued'
    });
  } else {
    if (isDownloading) {
      existing.status = 'downloading';
      existing.speed = 'Connecting...';
    } else if (existing.status === 'failed') {
      existing.status = 'queued';
      existing.speed = 'Queued';
      existing.percent = 0;
    }
  }

  updateQueueUI();
  if (!isDownloading && !state.activeDownloadId) {
    setTimeout(processNextQueueItem, 300);
  }
}

function retryQueueItem(seriesId) {
  const item = state.queue.find(q => String(q.series_id) === String(seriesId));
  if (item) {
    item.status = 'queued';
    item.speed = 'Queued';
    item.percent = 0;
    updateQueueUI();
    showToast(`Re-queued "${item.title}"`);
    if (!state.activeDownloadId) {
      processNextQueueItem();
    }
  }
}

function updateQueueUI() {
  const count = state.queue.length;
  elements.queueCount.textContent = count;
  elements.queueDrawerCount.textContent = count;

  if (count === 0) {
    elements.queueList.innerHTML = `<div class="queue-empty">No dramas in queue. Click any drama card to add or download.</div>`;
    return;
  }

  elements.queueList.innerHTML = '';
  state.queue.forEach((item) => {
    const card = document.createElement('div');
    card.className = `queue-card ${item.status || ''}`;
    if (item.status === 'failed') {
      card.style.cursor = 'pointer';
      card.title = 'Click to retry download';
      card.onclick = () => retryQueueItem(item.series_id);
    }
    card.innerHTML = `
      <div class="queue-title" title="${item.title}">${item.title}</div>
      <div class="queue-progress-bar">
        <div class="queue-progress-fill" style="width: ${item.percent}%;"></div>
      </div>
      <div class="queue-meta">
        <span>${item.status === 'completed' ? '✓ Completed' : item.status === 'failed' ? '❌ Failed (Click to retry)' : `${item.currentEpisode}/${item.totalEpisodes} eps (${item.percent}%)`}</span>
        <span>${item.speed || ''}</span>
      </div>
    `;
    elements.queueList.appendChild(card);
  });
}

function toggleQueueDrawer() {
  elements.queueDrawer?.classList.toggle('open');
}

// -------------------------------------------------------------
// 8. Library Tab Scanner & Player
// -------------------------------------------------------------
async function loadLibrary() {
  setLoading(true);
  elements.dramaGrid.innerHTML = '';

  try {
    const library = await window.electronAPI.scanLibrary(state.downloadDir);
    state.libraryItems = library;

    if (!library || library.length === 0) {
      elements.dramaGrid.innerHTML = `
        <div class="grid-empty" style="grid-column: 1 / -1;">
          <p>📚 Your local Hongguo library is currently empty.</p>
          <p style="margin-top: 8px; font-size: 13px; color: var(--accent);">Browse dramas or download any series to see them saved here with full cover images and videos!</p>
          <button class="btn secondary" style="margin-top: 16px;" id="btnOpenFolderFromLibrary">📂 Open Library Folder</button>
        </div>
      `;
      document.getElementById('btnOpenFolderFromLibrary')?.addEventListener('click', () => {
        window.electronAPI.openDirectory(state.downloadDir);
      });
      return;
    }

    library.forEach((drama) => {
      const card = document.createElement('article');
      card.className = 'drama-card';
      card.innerHTML = `
        <div class="poster-box">
          <span class="rating-badge">★ LOCAL</span>
          <img 
            class="poster-img" 
            src="${drama.coverFile || DEFAULT_POSTER}" 
            alt="${drama.title}"
            onerror="this.onerror=null; this.src='${DEFAULT_POSTER}';"
          >
          <div class="poster-scrim"></div>
          <span class="eps-badge">${drama.episodeCount} eps</span>
        </div>
        <div class="card-title" title="${drama.title}">${drama.title}</div>
      `;

      card.addEventListener('click', () => {
        // Open local playback or folder
        if (drama.episodes && drama.episodes.length > 0) {
          openLocalPlayer(drama);
        } else {
          window.electronAPI.openDirectory(drama.path);
        }
      });

      elements.dramaGrid.appendChild(card);
    });
  } catch (err) {
    console.error('Scan library failed:', err);
    showToast(`Library scan error: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

function filterLibrary(query) {
  if (!query) {
    loadLibrary();
    return;
  }
  const q = query.toLowerCase();
  const filtered = state.libraryItems.filter(item => item.title.toLowerCase().includes(q));
  elements.dramaGrid.innerHTML = '';
  if (filtered.length === 0) {
    elements.gridEmpty.style.display = 'block';
    return;
  }
  elements.gridEmpty.style.display = 'none';

  filtered.forEach(drama => {
    const card = document.createElement('article');
    card.className = 'drama-card';
    card.innerHTML = `
      <div class="poster-box">
        <span class="rating-badge">★ LOCAL</span>
        <img 
          class="poster-img" 
          src="${drama.coverFile || DEFAULT_POSTER}" 
          alt="${drama.title}"
          onerror="this.onerror=null; this.src='${DEFAULT_POSTER}';"
        >
        <div class="poster-scrim"></div>
        <span class="eps-badge">${drama.episodeCount} eps</span>
      </div>
      <div class="card-title" title="${drama.title}">${drama.title}</div>
    `;
    card.addEventListener('click', () => {
      if (drama.episodes && drama.episodes.length > 0) openLocalPlayer(drama);
      else window.electronAPI.openDirectory(drama.path);
    });
    elements.dramaGrid.appendChild(card);
  });
}

// -------------------------------------------------------------
// 8. Video Player Controller (Plays All Episodes - Online Stream or Local)
// -------------------------------------------------------------
let currentPlayingDrama = null;
let currentPlayingEpisode = 1;

async function playDramaEpisode(drama, epNumber = 1) {
  if (!drama) return;
  currentPlayingDrama = drama;
  currentPlayingEpisode = Number(epNumber) || 1;
  const totalEps = drama.episode_cnt || drama.totalEpisodes || drama.episodeCount || 80;

  // Show player modal
  elements.playerModal?.classList.add('active');
  if (elements.playerTitle) {
    elements.playerTitle.textContent = `${drama.title} - ភាគទី ${currentPlayingEpisode} / ${totalEps}`;
  }
  if (elements.playerTotalEpisodesCount) {
    elements.playerTotalEpisodesCount.textContent = totalEps;
  }
  if (elements.playerJumpInput) {
    elements.playerJumpInput.max = totalEps;
    elements.playerJumpInput.value = currentPlayingEpisode;
  }

  // Show loading indicator
  elements.videoLoadingIndicator?.classList.remove('hidden');

  // Render episode buttons in player footer
  renderPlayerEpisodeButtons(totalEps, currentPlayingEpisode);

  try {
    const res = await window.electronAPI?.getEpisodeStream({
      seriesId: drama.series_id || drama.folderName || drama.title,
      title: drama.title,
      epNumber: currentPlayingEpisode
    });

    if (res && res.success && res.url) {
      if (elements.playerSourceTag) {
        if (res.isLocal) {
          elements.playerSourceTag.className = 'player-source-tag local';
          elements.playerSourceTag.textContent = '💾 ក្នុងម៉ាស៊ីន (LOCAL)';
        } else {
          elements.playerSourceTag.className = 'player-source-tag stream';
          elements.playerSourceTag.textContent = '🟢 ផ្សាយបន្តផ្ទាល់ (STREAM)';
        }
      }

      elements.videoElement.src = res.url;
      elements.videoElement.playbackRate = parseFloat(elements.playerSpeedSelect?.value || '1.0');
      elements.videoElement.play().catch(e => console.warn('Autoplay prevented:', e.message));
    } else {
      showToast('❌ មិនអាចទាញយកតំណភ្ជាប់វីដេអូបានទេ');
    }
  } catch (err) {
    console.error('Play episode error:', err);
    showToast(`❌ បរាជ័យក្នុងការចាក់វីដេអូ: ${err.message}`);
  } finally {
    elements.videoLoadingIndicator?.classList.add('hidden');
  }
}

function renderPlayerEpisodeButtons(totalEps, activeEp) {
  if (!elements.playerEpisodesList) return;
  elements.playerEpisodesList.innerHTML = '';

  for (let i = 1; i <= totalEps; i++) {
    const btn = document.createElement('button');
    btn.className = `player-ep-btn ${i === activeEp ? 'active' : ''}`;
    btn.textContent = `EP ${i}`;
    btn.dataset.ep = i;
    btn.addEventListener('click', () => {
      playDramaEpisode(currentPlayingDrama, i);
    });
    elements.playerEpisodesList.appendChild(btn);
  }

  // Smooth scroll active button into view
  setTimeout(() => {
    const activeBtn = elements.playerEpisodesList.querySelector('.player-ep-btn.active');
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, 100);
}

function playNextEpisode() {
  if (!currentPlayingDrama) return;
  const totalEps = currentPlayingDrama.episode_cnt || currentPlayingDrama.totalEpisodes || currentPlayingDrama.episodeCount || 80;
  if (currentPlayingEpisode < totalEps) {
    playDramaEpisode(currentPlayingDrama, currentPlayingEpisode + 1);
  } else {
    showToast('🎉 បានទស្សនាដល់ភាគបញ្ចប់ហើយ!');
  }
}

function playPrevEpisode() {
  if (!currentPlayingDrama) return;
  if (currentPlayingEpisode > 1) {
    playDramaEpisode(currentPlayingDrama, currentPlayingEpisode - 1);
  }
}

function openLocalPlayer(drama) {
  playDramaEpisode({
    series_id: drama.folderName || drama.title,
    title: drama.title,
    cover: drama.coverFile,
    episode_cnt: drama.episodes?.length || drama.totalEpisodes || 80,
    episodes: drama.episodes
  }, 1);
}

function closeVideoPlayer() {
  if (elements.videoElement) {
    elements.videoElement.pause();
    elements.videoElement.removeAttribute('src');
    elements.videoElement.load();
  }
  elements.playerModal?.classList.remove('active');
}

// -------------------------------------------------------------
// 9. Event Listeners & Bootstrapping
// -------------------------------------------------------------
async function initApp() {
  initWindowControls();

  // Creator Badge click -> Open GitHub
  elements.creatorBadge?.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI?.openExternal('https://github.com/Biggdoqq');
  });

  // Load default download directory
  try {
    const dir = await window.electronAPI.getDefaultDirectory();
    state.downloadDir = dir;
    elements.folderPathDisplay.textContent = formatDisplayPath(dir);
  } catch (e) {
    console.error('Failed to get download directory:', e);
  }

  // Folder selection button
  elements.btnPickFolder?.addEventListener('click', async () => {
    try {
      const selected = await window.electronAPI.selectDirectory(state.downloadDir);
      if (selected) {
        state.downloadDir = selected;
        elements.folderPathDisplay.textContent = formatDisplayPath(selected);
        showToast(`Download location set to: ${selected}`);
      }
    } catch (err) {
      console.error('Select folder error:', err);
    }
  });

  // Library View Toggle Button
  const showCatalogView = () => {
    state.activeTab = 'all';
    elements.btnToggleLibrary?.classList.remove('active');
    if (elements.catalogToolbar) elements.catalogToolbar.style.display = 'flex';
    if (elements.scrollSentinel) elements.scrollSentinel.style.display = 'flex';
    state.page = 1;
    fetchCatalogPage({ reset: true, page: 1 });
  };

  const showLibraryView = () => {
    state.activeTab = 'library';
    elements.btnToggleLibrary?.classList.add('active');
    if (elements.catalogToolbar) elements.catalogToolbar.style.display = 'none';
    if (elements.scrollSentinel) elements.scrollSentinel.style.display = 'none';
    loadLibrary();
  };

  elements.btnToggleLibrary?.addEventListener('click', () => {
    if (state.activeTab === 'library') {
      showCatalogView();
    } else {
      showLibraryView();
    }
  });

  // Sort dropdown change
  elements.sortSelect?.addEventListener('change', () => {
    state.sort = elements.sortSelect.value || 'hot';
    state.page = 1;
    fetchCatalogPage({ reset: true, page: 1 });
  });

  // Real-time live search with 280ms debouncing
  let searchDebounceTimer = null;
  elements.searchInput?.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const val = elements.searchInput.value.trim();
      state.searchQuery = val;
      state.page = 1;

      if (state.activeTab === 'library') {
        filterLibrary(val);
      } else {
        fetchCatalogPage({ reset: true, page: 1 });
      }
    }, 280);
  });

  // Omni-search Go button / Enter key for links and direct resolution
  const handleSearch = async () => {
    const val = elements.searchInput?.value.trim();
    if (!val) {
      state.searchQuery = '';
      fetchCatalogPage({ reset: true, page: 1 });
      return;
    }

    // Check if it's a URL or ID or 《...》
    const resolved = await window.electronAPI.resolveDrama(val);
    if (resolved && resolved.type === 'id') {
      openDetailModal({
        series_id: resolved.seriesId,
        title: 'Resolving Drama...',
        cover: `${EXPLORER_BASE}/cover/${resolved.seriesId}`
      });
    } else {
      state.searchQuery = resolved?.query || val;
      state.page = 1;
      fetchCatalogPage({ reset: true, page: 1 });
    }
  };

  elements.btnGo?.addEventListener('click', handleSearch);
  elements.searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  // Episodes Range Stepper
  elements.btnStepDown?.addEventListener('click', () => {
    const input = elements.episodesRangeInput;
    if (input.value === 'all') {
      input.value = '1-10';
    } else {
      const match = input.value.match(/^1-(\d+)$/);
      if (match) {
        const val = Math.max(5, parseInt(match[1], 10) - 10);
        input.value = `1-${val}`;
      } else {
        input.value = 'all';
      }
    }
  });

  elements.btnStepUp?.addEventListener('click', () => {
    const input = elements.episodesRangeInput;
    if (input.value === 'all') {
      input.value = '1-20';
    } else {
      const match = input.value.match(/^1-(\d+)$/);
      if (match) {
        const val = parseInt(match[1], 10) + 10;
        input.value = `1-${val}`;
      } else {
        input.value = 'all';
      }
    }
  });

  // Dock download button
  elements.btnStartDownload?.addEventListener('click', () => {
    startDownloadDrama();
  });

  // Dock cancel button
  elements.btnCancelDownload?.addEventListener('click', () => {
    cancelCurrentDownload();
  });

  // Queue Drawer toggle
  elements.btnToggleQueue?.addEventListener('click', toggleQueueDrawer);
  elements.btnCloseQueue?.addEventListener('click', toggleQueueDrawer);

  elements.btnOpenDownloadsFolder?.addEventListener('click', () => {
    window.electronAPI.openDirectory(state.downloadDir);
  });

  elements.btnStartAllQueue?.addEventListener('click', async () => {
    for (const item of state.queue) {
      if (item.status === 'queued') {
        await startDownloadDrama(item);
      }
    }
  });

  // Modal close buttons
  elements.btnCloseDetail?.addEventListener('click', closeDetailModal);
  elements.detailModal?.addEventListener('click', (e) => {
    if (e.target === elements.detailModal) closeDetailModal();
  });

  elements.btnClosePlayer?.addEventListener('click', closeVideoPlayer);
  elements.playerModal?.addEventListener('click', (e) => {
    if (e.target === elements.playerModal) closeVideoPlayer();
  });

  // Video Player Controls
  elements.btnPlayerNext?.addEventListener('click', playNextEpisode);
  elements.btnPlayerPrev?.addEventListener('click', playPrevEpisode);

  elements.playerSpeedSelect?.addEventListener('change', () => {
    if (elements.videoElement && elements.playerSpeedSelect) {
      elements.videoElement.playbackRate = parseFloat(elements.playerSpeedSelect.value) || 1.0;
    }
  });

  elements.btnPlayerFullscreen?.addEventListener('click', () => {
    if (elements.videoElement) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => console.error(err));
      } else if (elements.videoElement.requestFullscreen) {
        elements.videoElement.requestFullscreen().catch(err => console.error(err));
      }
    }
  });

  elements.playerJumpInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const ep = parseInt(elements.playerJumpInput.value, 10);
      if (currentPlayingDrama && !isNaN(ep) && ep >= 1) {
        const totalEps = currentPlayingDrama.episode_cnt || currentPlayingDrama.totalEpisodes || currentPlayingDrama.episodeCount || 80;
        if (ep <= totalEps) {
          playDramaEpisode(currentPlayingDrama, ep);
        } else {
          showToast(`រឿងនេះមានត្រឹមភាគ ${totalEps} ប៉ុណ្ណោះ`);
        }
      }
    }
  });

  elements.videoElement?.addEventListener('ended', playNextEpisode);

  // Keyboard navigation & ESC
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDetailModal();
      closeVideoPlayer();
      if (elements.queueDrawer?.classList.contains('open')) {
        toggleQueueDrawer();
      }
    }
  });

  // -----------------------------------------------------------
  // IPC Real-time Download Events
  // -----------------------------------------------------------
  window.electronAPI?.onDownloadProgress((data) => {
    if (data.type === 'cover') {
      showToast('✓ Saved high-definition cover (cover.jpg)');
      return;
    }

    if (data.percent !== undefined) {
      elements.statusDot.className = 'status-indicator-dot downloading';
      elements.statusText.textContent = `Downloading ep ${data.currentEpisode}/${data.totalEpisodes} (${data.percent}%)`;

      // Update item in queue
      const qItem = state.queue.find(q => String(q.series_id) === String(data.seriesId));
      if (qItem) {
        qItem.currentEpisode = data.currentEpisode;
        qItem.totalEpisodes = data.totalEpisodes;
        qItem.percent = data.percent;
        qItem.speed = data.speed;
        qItem.status = 'downloading';
        updateQueueUI();
      }
    }
  });

  window.electronAPI?.onDownloadComplete((data) => {
    resetDownloadStatus();
    showToast(`🎉 Finished downloading "${data.title}"! All episodes and cover saved.`);

    const qItem = state.queue.find(q => String(q.series_id) === String(data.seriesId));
    if (qItem) {
      qItem.percent = 100;
      qItem.speed = 'Done';
      qItem.status = 'completed';
      updateQueueUI();
    }

    if (state.activeTab === 'library') {
      loadLibrary();
    }

    // Automatically trigger next download in queue!
    setTimeout(processNextQueueItem, 1200);
  });

  window.electronAPI?.onDownloadError((data) => {
    resetDownloadStatus();
    showToast(`❌ Download error: ${data.error || 'Failed'}`);
    const qItem = state.queue.find(q => String(q.series_id) === String(data.seriesId));
    if (qItem) {
      qItem.speed = 'Failed';
      qItem.status = 'failed';
      updateQueueUI();
    }

    // Automatically trigger next download in queue!
    setTimeout(processNextQueueItem, 1500);
  });

  // Engine status monitoring
  window.electronAPI?.onEngineStatus?.((data) => {
    if (data && data.ready) {
      if (!state.activeDownloadId) {
        elements.statusDot.className = 'status-indicator-dot ready';
        elements.statusText.textContent = 'Engine Ready ✓';
      }
    }
  });

  window.electronAPI?.getEngineStatus?.().then((data) => {
    if (data && data.ready && !state.activeDownloadId) {
      elements.statusDot.className = 'status-indicator-dot ready';
      elements.statusText.textContent = 'Engine Ready ✓';
    }
  }).catch(() => {});

  // Initialize Infinite Scrolling
  initInfiniteScroll();

  // Load Real-time Hero Stats
  fetchLiveHeroStats();

  // Load 60+ Genres
  fetchGenres();

  // Initial catalog load (Page 1 of 49,500+)
  fetchCatalogPage({ reset: true, page: 1 });

  // Initialize Auto-Updater
  initAutoUpdater();
}

// -----------------------------------------------------------
// Auto-Updater Controller
// -----------------------------------------------------------
let updateState = {
  status: 'idle',
  version: null
};

async function initAutoUpdater() {
  // Load current app version
  try {
    const version = await window.electronAPI?.getAppVersion();
    if (version && elements.appVersionLabel) {
      elements.appVersionLabel.textContent = `v${version}`;
    }
  } catch (e) {}

  // Manual Check Button in Titlebar
  elements.btnCheckUpdate?.addEventListener('click', async () => {
    if (updateState.status === 'checking' || updateState.status === 'downloading') return;
    elements.btnCheckUpdate.classList.add('checking');
    showToast('🔄 កំពុងពិនិត្យមើលកំណែថ្មី...');

    try {
      const res = await window.electronAPI?.checkForUpdates();
      elements.btnCheckUpdate.classList.remove('checking');
      if (res?.dev) {
        showToast(`ℹ️ កំពុងដំណើរការក្នុង Dev mode (v${res.version})`);
      } else if (!res?.success && !res?.version) {
        showToast('✅ លោកអ្នកកំពុងប្រើប្រាស់កំណែចុងក្រោយបំផុតហើយ!');
      }
    } catch (err) {
      elements.btnCheckUpdate.classList.remove('checking');
      showToast('❌ មិនអាចភ្ជាប់ទៅកាន់ប្រព័ន្ធ Update បានទេ');
    }
  });

  // Action Button in Banner (Download or Restart)
  elements.btnUpdateAction?.addEventListener('click', async () => {
    if (updateState.status === 'available') {
      updateState.status = 'downloading';
      elements.btnUpdateAction.disabled = true;
      elements.btnUpdateAction.textContent = 'កំពុងទាញយក...';
      elements.updateProgressWrap?.classList.remove('hidden');
      await window.electronAPI?.startDownloadUpdate();
    } else if (updateState.status === 'downloaded') {
      window.electronAPI?.quitAndInstall();
    }
  });

  // Dismiss Banner Button
  elements.btnUpdateDismiss?.addEventListener('click', () => {
    elements.updateBanner?.classList.add('hidden');
  });

  // Listen to Update Status from Main Process
  window.electronAPI?.onUpdateStatus((data) => {
    console.log('[Updater Status]', data);
    updateState.status = data.status;

    if (data.status === 'checking') {
      elements.btnCheckUpdate?.classList.add('checking');
    } else {
      elements.btnCheckUpdate?.classList.remove('checking');
    }

    if (data.status === 'available') {
      updateState.version = data.version;
      elements.updateIndicatorDot?.classList.remove('hidden');
      if (elements.updateBannerTitle) {
        elements.updateBannerTitle.textContent = `🚀 មានកំណែថ្មី v${data.version} ត្រូវបានបញ្ចេញ!`;
      }
      if (elements.updateBannerDesc) {
        elements.updateBannerDesc.textContent = 'ចុច "ទាញយកឥឡូវនេះ" ដើម្បីធ្វើបច្ចុប្បន្នភាព និងទទួលបានមុខងារថ្មីៗ។';
      }
      if (elements.btnUpdateAction) {
        elements.btnUpdateAction.textContent = 'ទាញយកឥឡូវនេះ';
        elements.btnUpdateAction.disabled = false;
      }
      elements.updateProgressWrap?.classList.add('hidden');
      elements.updateBanner?.classList.remove('hidden');
      showToast(`🚀 រកឃើញកំណែថ្មី v${data.version}!`);
    } else if (data.status === 'not-available') {
      elements.updateIndicatorDot?.classList.add('hidden');
      elements.updateBanner?.classList.add('hidden');
    } else if (data.status === 'downloading') {
      elements.updateProgressWrap?.classList.remove('hidden');
      const pct = data.percent || 0;
      if (elements.updateProgressFill) elements.updateProgressFill.style.width = `${pct}%`;
      if (elements.updateProgressText) elements.updateProgressText.textContent = `${pct}%`;
      if (elements.btnUpdateAction) elements.btnUpdateAction.textContent = `កំពុងទាញយក (${pct}%)`;
    } else if (data.status === 'downloaded') {
      elements.updateProgressWrap?.classList.add('hidden');
      if (elements.updateBannerTitle) {
        elements.updateBannerTitle.textContent = `✅ កំណែថ្មី v${data.version || ''} បានទាញយករួចរាល់!`;
      }
      if (elements.updateBannerDesc) {
        elements.updateBannerDesc.textContent = 'សូមចុច "ដំឡើង & បើកឡើងវិញ" ដើម្បីបញ្ចប់ការ Update។';
      }
      if (elements.btnUpdateAction) {
        elements.btnUpdateAction.textContent = 'ដំឡើង & បើកឡើងវិញ (Restart)';
        elements.btnUpdateAction.disabled = false;
      }
      elements.updateBanner?.classList.remove('hidden');
      showToast('🎉 ទាញយកកំណែថ្មីជោគជ័យ! សូម Restart ដើម្បីដំឡើង');
    } else if (data.status === 'error') {
      elements.btnCheckUpdate?.classList.remove('checking');
      if (updateState.status === 'downloading') {
        if (elements.btnUpdateAction) {
          elements.btnUpdateAction.disabled = false;
          elements.btnUpdateAction.textContent = 'ព្យាយាមម្តងទៀត';
        }
        showToast('❌ ការទាញយក Update បរាជ័យ');
      }
    }
  });
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', initApp);
