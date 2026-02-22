/* ===== IndexedDB Wrapper ===== */
class DB {
  constructor(name = 'SpanischAppDB', version = 1) {
    this.name = name;
    this.version = version;
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('topics')) {
          const topicStore = db.createObjectStore('topics', { keyPath: 'id', autoIncrement: true });
          topicStore.createIndex('by-order', 'order', { unique: false });
        }
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
          fileStore.createIndex('by-topic', 'topicId', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  _tx(storeName, mode = 'readonly') {
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  _request(store, method, ...args) {
    return new Promise((resolve, reject) => {
      const req = store[method](...args);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async addTopic(topic) {
    const store = this._tx('topics', 'readwrite');
    return this._request(store, 'add', topic);
  }

  async getTopics() {
    const store = this._tx('topics', 'readonly');
    return this._request(store, 'getAll');
  }

  async updateTopic(topic) {
    const store = this._tx('topics', 'readwrite');
    return this._request(store, 'put', topic);
  }

  async deleteTopic(id) {
    const store = this._tx('topics', 'readwrite');
    return this._request(store, 'delete', id);
  }

  async addFile(file) {
    const store = this._tx('files', 'readwrite');
    return this._request(store, 'add', file);
  }

  async getFilesByTopic(topicId) {
    return new Promise((resolve, reject) => {
      const store = this._tx('files', 'readonly');
      const index = store.index('by-topic');
      const req = index.getAll(topicId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getFile(id) {
    const store = this._tx('files', 'readonly');
    return this._request(store, 'get', id);
  }

  async deleteFile(id) {
    const store = this._tx('files', 'readwrite');
    return this._request(store, 'delete', id);
  }

  async deleteFilesByTopic(topicId) {
    const files = await this.getFilesByTopic(topicId);
    const store = this._tx('files', 'readwrite');
    for (const file of files) {
      store.delete(file.id);
    }
  }

  async getFileCountByTopic(topicId) {
    const files = await this.getFilesByTopic(topicId);
    return files.length;
  }
}

/* ===== State Store ===== */
class Store {
  constructor() {
    this.state = {
      topics: [],
      currentTopicId: null,
      searchQuery: '',
      theme: 'light',
      previewFileId: null,
    };
    this._listeners = [];
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    this._notify();
  }

  subscribe(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn);
    };
  }

  _notify() {
    this._listeners.forEach(fn => fn(this.state));
  }
}

/* ===== UI Renderer ===== */
class UI {
  constructor() {
    this.mainContent = document.getElementById('mainContent');
    this.sidebarTopics = document.getElementById('sidebarTopics');
    this.toastContainer = document.getElementById('toastContainer');
    this._blobUrls = [];
  }

  /* -- Sidebar -- */
  renderSidebar(topics, currentTopicId, fileCounts) {
    if (!topics.length) {
      this.sidebarTopics.innerHTML = `
        <div class="empty-state" style="padding:1rem 0.5rem">
          <span style="font-size:1.5rem;opacity:0.5">📂</span>
          <p style="font-size:0.8rem;margin-top:0.3rem">Noch keine Themen</p>
        </div>`;
      return;
    }

    this.sidebarTopics.innerHTML = topics.map(t => `
      <button class="sidebar-topic ${t.id === currentTopicId ? 'active' : ''}" data-topic-id="${t.id}">
        <span class="sidebar-topic-dot" style="background:${t.color}"></span>
        <span class="sidebar-topic-name">${this._esc(t.name)}</span>
        <span class="sidebar-topic-count">${fileCounts[t.id] || 0}</span>
      </button>
    `).join('');
  }

  /* -- Dashboard -- */
  renderDashboard(topics, fileCounts) {
    const cards = topics.map(t => `
      <div class="topic-card" data-topic-id="${t.id}" style="--card-color:${t.color}">
        <div class="topic-card-header">
          <div class="topic-card-name">${this._esc(t.name)}</div>
          <div class="topic-card-actions">
            <button class="topic-card-btn edit-topic-btn" data-topic-id="${t.id}" title="Bearbeiten">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="topic-card-btn danger delete-topic-btn" data-topic-id="${t.id}" title="Löschen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="topic-card-meta">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            ${fileCounts[t.id] || 0} Dateien
          </span>
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${this._formatDate(t.createdAt)}
          </span>
        </div>
      </div>
    `).join('');

    this.mainContent.innerHTML = `
      <div class="dashboard-header">
        <h2 class="dashboard-title">Übersicht</h2>
        <p class="dashboard-subtitle">${topics.length} Thema${topics.length !== 1 ? 'en' : ''} insgesamt</p>
      </div>
      <div class="dashboard-grid">
        ${cards}
        <div class="add-topic-card" id="addTopicCard">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span class="add-topic-label">Neues Thema</span>
        </div>
      </div>`;
  }

  /* -- Topic Detail -- */
  renderTopicDetail(topic, files, previewFileId) {
    const fileListHTML = files.length ? files.map(f => {
      const isPdf = f.type === 'application/pdf';
      const ext = isPdf ? 'PDF' : 'DOC';
      const iconClass = isPdf ? 'pdf' : 'word';
      return `
        <div class="file-item" data-file-id="${f.id}">
          <div class="file-icon ${iconClass}">${ext}</div>
          <div class="file-info">
            <div class="file-name">${this._esc(f.name)}</div>
            <div class="file-meta">${this._formatSize(f.size)} · ${this._formatDate(f.uploadedAt)}</div>
          </div>
          <div class="file-actions">
            ${isPdf ? `<button class="file-action-btn preview-file-btn" data-file-id="${f.id}" title="Vorschau">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>` : ''}
            <button class="file-action-btn download-file-btn" data-file-id="${f.id}" title="Herunterladen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="file-action-btn danger delete-file-btn" data-file-id="${f.id}" title="Löschen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </div>`;
    }).join('') : `
      <div class="empty-state">
        <span class="empty-state-icon">📄</span>
        <div class="empty-state-title">Keine Dateien vorhanden</div>
        <p class="empty-state-text">Ziehen Sie PDF- oder Word-Dateien hierher oder klicken Sie auf die Fläche oben.</p>
      </div>`;

    let previewHTML = '';
    if (previewFileId) {
      const f = files.find(file => file.id === previewFileId);
      if (f && f.type === 'application/pdf') {
        this._revokeBlobUrls();
        const url = URL.createObjectURL(f.blob);
        this._blobUrls.push(url);
        previewHTML = `
          <div class="file-preview">
            <div class="file-preview-header">
              <span class="file-preview-title">${this._esc(f.name)}</span>
              <button class="file-preview-close" id="closePreview" title="Vorschau schließen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="file-preview-body">
              <iframe src="${url}"></iframe>
            </div>
          </div>`;
      }
    }

    this.mainContent.innerHTML = `
      <div class="topic-detail-header">
        <div class="topic-detail-left">
          <button class="topic-detail-back" id="backToDashboard" title="Zurück zur Übersicht">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span class="topic-detail-color" style="background:${topic.color}"></span>
          <h2 class="topic-detail-title">${this._esc(topic.name)}</h2>
        </div>
        <div class="topic-detail-right">
          <button class="btn btn-secondary btn-sm edit-topic-btn" data-topic-id="${topic.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Bearbeiten
          </button>
          <button class="btn btn-danger btn-sm delete-topic-btn" data-topic-id="${topic.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            Löschen
          </button>
        </div>
      </div>

      <div class="drop-zone" id="dropZone">
        <span class="drop-zone-icon">📁</span>
        <div class="drop-zone-text">Dateien hierher ziehen oder <strong>klicken</strong></div>
        <div class="drop-zone-hint">PDF, DOC und DOCX werden unterstützt</div>
        <input type="file" class="drop-zone-input" id="fileInput" accept=".pdf,.doc,.docx" multiple>
      </div>

      <div class="file-list" id="fileList">
        ${fileListHTML}
      </div>

      ${previewHTML}`;
  }

  /* -- Search Results -- */
  renderSearchResults(query, matchedTopics, matchedFiles, fileCounts) {
    const topicCards = matchedTopics.map(t => `
      <div class="topic-card" data-topic-id="${t.id}" style="--card-color:${t.color}">
        <div class="topic-card-header">
          <div class="topic-card-name">${this._esc(t.name)}</div>
        </div>
        <div class="topic-card-meta">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            ${fileCounts[t.id] || 0} Dateien
          </span>
        </div>
      </div>`).join('');

    const fileItems = matchedFiles.map(f => {
      const isPdf = f.type === 'application/pdf';
      return `
        <div class="file-item" data-file-id="${f.id}" data-topic-id="${f.topicId}">
          <div class="file-icon ${isPdf ? 'pdf' : 'word'}">${isPdf ? 'PDF' : 'DOC'}</div>
          <div class="file-info">
            <div class="file-name">${this._esc(f.name)}</div>
            <div class="file-meta">${this._formatSize(f.size)} · ${this._formatDate(f.uploadedAt)}</div>
          </div>
        </div>`;
    }).join('');

    const noResults = !matchedTopics.length && !matchedFiles.length;

    this.mainContent.innerHTML = `
      <div class="dashboard-header">
        <h2 class="dashboard-title">Suchergebnisse für „${this._esc(query)}"</h2>
        <p class="dashboard-subtitle">${matchedTopics.length} Themen, ${matchedFiles.length} Dateien gefunden</p>
      </div>
      ${noResults ? `
        <div class="empty-state">
          <span class="empty-state-icon">🔍</span>
          <div class="empty-state-title">Keine Ergebnisse</div>
          <p class="empty-state-text">Versuchen Sie es mit einem anderen Suchbegriff.</p>
        </div>` : ''}
      ${matchedTopics.length ? `<h3 style="margin-bottom:0.75rem;font-size:1rem">Themen</h3><div class="dashboard-grid" style="margin-bottom:1.5rem">${topicCards}</div>` : ''}
      ${matchedFiles.length ? `<h3 style="margin-bottom:0.75rem;font-size:1rem">Dateien</h3><div class="file-list">${fileItems}</div>` : ''}
    `;
  }

  /* -- Toast -- */
  showToast(message, type = 'success') {
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 2500);
  }

  /* -- Helpers -- */
  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  _formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  _revokeBlobUrls() {
    this._blobUrls.forEach(url => URL.revokeObjectURL(url));
    this._blobUrls = [];
  }
}

/* ===== App Controller ===== */
class App {
  constructor() {
    this.db = new DB();
    this.store = new Store();
    this.ui = new UI();
    this._editingTopicId = null;
    this._confirmCallback = null;
    this._fileCounts = {};
    this._allFiles = [];
  }

  async init() {
    await this.db.open();
    this._initTheme();
    await this._loadTopics();
    this.store.subscribe(() => this._render());
    this._bindEvents();
    this._render();
  }

  /* -- Theme -- */
  _initTheme() {
    const saved = localStorage.getItem('spanischapp-theme');
    if (saved) {
      this.store.state.theme = saved;
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.store.state.theme = prefersDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', this.store.get('theme'));
  }

  _toggleTheme() {
    const next = this.store.get('theme') === 'light' ? 'dark' : 'light';
    this.store.set('theme', next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('spanischapp-theme', next);
  }

  /* -- Data Loading -- */
  async _loadTopics() {
    const topics = await this.db.getTopics();
    topics.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    this.store.state.topics = topics;

    this._fileCounts = {};
    this._allFiles = [];
    for (const t of topics) {
      const files = await this.db.getFilesByTopic(t.id);
      this._fileCounts[t.id] = files.length;
      this._allFiles.push(...files);
    }
  }

  /* -- Rendering -- */
  _render() {
    const { topics, currentTopicId, searchQuery, previewFileId } = this.store.state;

    this.ui.renderSidebar(topics, currentTopicId, this._fileCounts);
    this._updateNavActive(currentTopicId);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchedTopics = topics.filter(t => t.name.toLowerCase().includes(q));
      const matchedFiles = this._allFiles.filter(f => f.name.toLowerCase().includes(q));
      this.ui.renderSearchResults(searchQuery, matchedTopics, matchedFiles, this._fileCounts);
    } else if (currentTopicId) {
      const topic = topics.find(t => t.id === currentTopicId);
      if (topic) {
        const files = this._allFiles.filter(f => f.topicId === currentTopicId);
        files.sort((a, b) => b.uploadedAt - a.uploadedAt);
        this.ui.renderTopicDetail(topic, files, previewFileId);
        this._bindDropZone();
      } else {
        this.store.state.currentTopicId = null;
        this.ui.renderDashboard(topics, this._fileCounts);
      }
    } else {
      this.ui.renderDashboard(topics, this._fileCounts);
    }

    this._bindDynamicEvents();
  }

  _updateNavActive(currentTopicId) {
    const navDash = document.getElementById('navDashboard');
    if (navDash) {
      navDash.classList.toggle('active', !currentTopicId && !this.store.get('searchQuery'));
    }
  }

  /* -- Events -- */
  _bindEvents() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => this._toggleTheme());

    // Sidebar toggle
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    // Dashboard nav
    document.getElementById('navDashboard').addEventListener('click', () => {
      this.store.state.searchQuery = '';
      document.getElementById('searchInput').value = '';
      document.getElementById('searchClear').classList.add('hidden');
      this.store.set('currentTopicId', null);
      this.store.set('previewFileId', null);
    });

    // Add topic buttons
    document.getElementById('addTopicBtnSidebar').addEventListener('click', () => this._openTopicModal());

    // Topic modal events
    document.getElementById('topicModalClose').addEventListener('click', () => this._closeTopicModal());
    document.getElementById('topicModalCancel').addEventListener('click', () => this._closeTopicModal());
    document.getElementById('topicModalSave').addEventListener('click', () => this._saveTopic());
    document.getElementById('topicNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveTopic();
    });

    // Color picker
    document.getElementById('colorPicker').addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });

    // Confirm modal
    document.getElementById('confirmModalClose').addEventListener('click', () => this._closeConfirmModal());
    document.getElementById('confirmModalCancel').addEventListener('click', () => this._closeConfirmModal());
    document.getElementById('confirmModalConfirm').addEventListener('click', () => {
      if (this._confirmCallback) this._confirmCallback();
      this._closeConfirmModal();
    });

    // Search
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const val = searchInput.value.trim();
      searchClear.classList.toggle('hidden', !val);
      searchTimer = setTimeout(() => {
        this.store.state.currentTopicId = null;
        this.store.state.previewFileId = null;
        this.store.set('searchQuery', val);
      }, 250);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.classList.add('hidden');
      this.store.state.searchQuery = '';
      this.store.set('currentTopicId', null);
    });

    // Close modals on overlay click
    document.getElementById('topicModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this._closeTopicModal();
    });
    document.getElementById('confirmModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this._closeConfirmModal();
    });

    // Keyboard: Escape closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._closeTopicModal();
        this._closeConfirmModal();
      }
    });
  }

  _bindDynamicEvents() {
    // Add topic card on dashboard
    const addCard = document.getElementById('addTopicCard');
    if (addCard) addCard.addEventListener('click', () => this._openTopicModal());

    // Topic cards click -> open topic
    this.mainContent.querySelectorAll('.topic-card[data-topic-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.topic-card-btn')) return;
        const id = Number(card.dataset.topicId);
        this.store.state.searchQuery = '';
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').classList.add('hidden');
        this.store.state.previewFileId = null;
        this.store.set('currentTopicId', id);
      });
    });

    // Sidebar topic clicks
    this.ui.sidebarTopics.querySelectorAll('.sidebar-topic').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.topicId);
        this.store.state.searchQuery = '';
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').classList.add('hidden');
        this.store.state.previewFileId = null;
        this.store.set('currentTopicId', id);
      });
    });

    // Edit topic buttons
    this.mainContent.querySelectorAll('.edit-topic-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.topicId);
        this._openTopicModal(id);
      });
    });

    // Delete topic buttons
    this.mainContent.querySelectorAll('.delete-topic-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.topicId);
        const topic = this.store.get('topics').find(t => t.id === id);
        this._openConfirmModal(
          'Thema löschen',
          `Möchten Sie „${topic?.name}" und alle zugehörigen Dateien wirklich löschen?`,
          async () => {
            await this.db.deleteFilesByTopic(id);
            await this.db.deleteTopic(id);
            await this._loadTopics();
            if (this.store.get('currentTopicId') === id) {
              this.store.state.currentTopicId = null;
            }
            this.store.set('previewFileId', null);
            this.ui.showToast('Thema gelöscht', 'success');
          }
        );
      });
    });

    // Back to dashboard
    const backBtn = document.getElementById('backToDashboard');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.store.state.previewFileId = null;
        this.store.set('currentTopicId', null);
      });
    }

    // File actions
    this.mainContent.querySelectorAll('.preview-file-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.fileId);
        this.store.set('previewFileId', id);
      });
    });

    this.mainContent.querySelectorAll('.download-file-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.fileId);
        const file = await this.db.getFile(id);
        if (!file) return;
        const url = URL.createObjectURL(file.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    });

    this.mainContent.querySelectorAll('.delete-file-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.fileId);
        const file = this._allFiles.find(f => f.id === id);
        this._openConfirmModal(
          'Datei löschen',
          `Möchten Sie „${file?.name}" wirklich löschen?`,
          async () => {
            await this.db.deleteFile(id);
            if (this.store.get('previewFileId') === id) {
              this.store.state.previewFileId = null;
            }
            await this._loadTopics();
            this.store._notify();
            this.ui.showToast('Datei gelöscht', 'success');
          }
        );
      });
    });

    // File items click -> preview (PDF) or download (Word)
    this.mainContent.querySelectorAll('.file-item[data-file-id]').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.file-action-btn')) return;
        const id = Number(item.dataset.fileId);
        const file = this._allFiles.find(f => f.id === id) || await this.db.getFile(id);
        if (!file) return;

        if (item.dataset.topicId && !this.store.get('currentTopicId')) {
          // From search results - navigate to topic
          this.store.state.searchQuery = '';
          document.getElementById('searchInput').value = '';
          document.getElementById('searchClear').classList.add('hidden');
          this.store.state.previewFileId = file.type === 'application/pdf' ? id : null;
          this.store.set('currentTopicId', file.topicId);
          return;
        }

        if (file.type === 'application/pdf') {
          this.store.set('previewFileId', id);
        } else {
          // Download Word files
          const url = URL.createObjectURL(file.blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      });
    });

    // Close preview
    const closePreview = document.getElementById('closePreview');
    if (closePreview) {
      closePreview.addEventListener('click', () => {
        this.store.set('previewFileId', null);
      });
    }
  }

  /* -- Drop Zone -- */
  _bindDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      this._handleFiles(files);
    });

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      this._handleFiles(files);
      fileInput.value = '';
    });
  }

  async _handleFiles(files) {
    const allowed = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const topicId = this.store.get('currentTopicId');
    if (!topicId) return;

    let uploaded = 0;
    for (const file of files) {
      if (!allowed.includes(file.type)) {
        this.ui.showToast(`„${file.name}" wird nicht unterstützt`, 'error');
        continue;
      }
      const blob = await this._readFileAsBlob(file);
      await this.db.addFile({
        topicId,
        name: file.name,
        type: file.type,
        size: file.size,
        blob,
        uploadedAt: Date.now(),
      });
      uploaded++;
    }

    if (uploaded > 0) {
      await this._loadTopics();
      this.store._notify();
      this.ui.showToast(`${uploaded} Datei${uploaded > 1 ? 'en' : ''} hochgeladen`, 'success');
    }
  }

  _readFileAsBlob(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Blob([reader.result], { type: file.type }));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /* -- Topic Modal -- */
  _openTopicModal(editId = null) {
    this._editingTopicId = editId;
    const modal = document.getElementById('topicModal');
    const title = document.getElementById('topicModalTitle');
    const input = document.getElementById('topicNameInput');

    if (editId) {
      const topic = this.store.get('topics').find(t => t.id === editId);
      title.textContent = 'Thema bearbeiten';
      input.value = topic?.name || '';
      // Select matching color
      document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === topic?.color);
      });
    } else {
      title.textContent = 'Neues Thema erstellen';
      input.value = '';
      document.querySelectorAll('.color-swatch').forEach((s, i) => {
        s.classList.toggle('selected', i === 0);
      });
    }

    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
  }

  _closeTopicModal() {
    document.getElementById('topicModal').classList.add('hidden');
    this._editingTopicId = null;
  }

  async _saveTopic() {
    const name = document.getElementById('topicNameInput').value.trim();
    if (!name) {
      this.ui.showToast('Bitte einen Namen eingeben', 'error');
      return;
    }

    const color = document.querySelector('.color-swatch.selected')?.dataset.color || '#e63946';

    if (this._editingTopicId) {
      const topic = this.store.get('topics').find(t => t.id === this._editingTopicId);
      if (topic) {
        topic.name = name;
        topic.color = color;
        await this.db.updateTopic(topic);
        this.ui.showToast('Thema aktualisiert', 'success');
      }
    } else {
      const topics = this.store.get('topics');
      await this.db.addTopic({
        name,
        color,
        createdAt: Date.now(),
        order: topics.length,
      });
      this.ui.showToast('Thema erstellt', 'success');
    }

    this._closeTopicModal();
    await this._loadTopics();
    this.store._notify();
  }

  /* -- Confirm Modal -- */
  _openConfirmModal(title, message, callback) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    this._confirmCallback = callback;
    document.getElementById('confirmModal').classList.remove('hidden');
  }

  _closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
    this._confirmCallback = null;
  }
}

/* ===== Bootstrap ===== */
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(err => console.error('App init failed:', err));
});
