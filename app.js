/* ===== IndexedDB Wrapper (v2 — 4 Stores) ===== */
class DB {
  constructor(name = 'SpanischAppDB', version = 2) {
    this.name = name;
    this.version = version;
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Folders
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
        }

        // Topics (with folderId index)
        if (!db.objectStoreNames.contains('topics')) {
          const ts = db.createObjectStore('topics', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('by-folder', 'folderId', { unique: false });
        } else {
          const tx = e.target.transaction;
          const ts = tx.objectStore('topics');
          if (!ts.indexNames.contains('by-folder')) {
            ts.createIndex('by-folder', 'folderId', { unique: false });
          }
        }

        // Lessons
        if (!db.objectStoreNames.contains('lessons')) {
          const ls = db.createObjectStore('lessons', { keyPath: 'id', autoIncrement: true });
          ls.createIndex('by-topic', 'topicId', { unique: false });
        }

        // Files (with lessonId index)
        if (!db.objectStoreNames.contains('files')) {
          const fs = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
          fs.createIndex('by-lesson', 'lessonId', { unique: false });
        } else {
          const tx = e.target.transaction;
          const fs = tx.objectStore('files');
          // Migrate: if old by-topic index exists, remove it
          if (fs.indexNames.contains('by-topic') && !fs.indexNames.contains('by-lesson')) {
            fs.deleteIndex('by-topic');
            fs.createIndex('by-lesson', 'lessonId', { unique: false });
          } else if (!fs.indexNames.contains('by-lesson')) {
            fs.createIndex('by-lesson', 'lessonId', { unique: false });
          }
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  _tx(storeName, mode = 'readonly') {
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  _req(store, method, ...args) {
    return new Promise((resolve, reject) => {
      const r = store[method](...args);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  _getByIndex(storeName, indexName, key) {
    return new Promise((resolve, reject) => {
      const idx = this._tx(storeName).index(indexName);
      const r = idx.getAll(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  /* -- Folders -- */
  addFolder(f) { return this._req(this._tx('folders', 'readwrite'), 'add', f); }
  getFolders() { return this._req(this._tx('folders'), 'getAll'); }
  getFolder(id) { return this._req(this._tx('folders'), 'get', id); }
  updateFolder(f) { return this._req(this._tx('folders', 'readwrite'), 'put', f); }
  deleteFolder(id) { return this._req(this._tx('folders', 'readwrite'), 'delete', id); }

  /* -- Topics -- */
  addTopic(t) { return this._req(this._tx('topics', 'readwrite'), 'add', t); }
  getTopics() { return this._req(this._tx('topics'), 'getAll'); }
  getTopic(id) { return this._req(this._tx('topics'), 'get', id); }
  getTopicsByFolder(folderId) { return this._getByIndex('topics', 'by-folder', folderId); }
  updateTopic(t) { return this._req(this._tx('topics', 'readwrite'), 'put', t); }
  deleteTopic(id) { return this._req(this._tx('topics', 'readwrite'), 'delete', id); }

  /* -- Lessons -- */
  addLesson(l) { return this._req(this._tx('lessons', 'readwrite'), 'add', l); }
  getLessons() { return this._req(this._tx('lessons'), 'getAll'); }
  getLesson(id) { return this._req(this._tx('lessons'), 'get', id); }
  getLessonsByTopic(topicId) { return this._getByIndex('lessons', 'by-topic', topicId); }
  updateLesson(l) { return this._req(this._tx('lessons', 'readwrite'), 'put', l); }
  deleteLesson(id) { return this._req(this._tx('lessons', 'readwrite'), 'delete', id); }

  /* -- Files -- */
  addFile(f) { return this._req(this._tx('files', 'readwrite'), 'add', f); }
  getFiles() { return this._req(this._tx('files'), 'getAll'); }
  getFile(id) { return this._req(this._tx('files'), 'get', id); }
  getFilesByLesson(lessonId) { return this._getByIndex('files', 'by-lesson', lessonId); }
  deleteFile(id) { return this._req(this._tx('files', 'readwrite'), 'delete', id); }

  /* -- Cascading deletes -- */
  async deleteFilesByLesson(lessonId) {
    const files = await this.getFilesByLesson(lessonId);
    const store = this._tx('files', 'readwrite');
    for (const f of files) store.delete(f.id);
  }

  async deleteLessonsByTopic(topicId) {
    const lessons = await this.getLessonsByTopic(topicId);
    for (const l of lessons) {
      await this.deleteFilesByLesson(l.id);
      await this.deleteLesson(l.id);
    }
  }

  async deleteTopicsByFolder(folderId) {
    const topics = await this.getTopicsByFolder(folderId);
    for (const t of topics) {
      await this.deleteLessonsByTopic(t.id);
      await this.deleteTopic(t.id);
    }
  }
}

/* ===== State Store ===== */
class Store {
  constructor() {
    this.state = {
      folders: [],
      topics: [],
      lessons: [],
      currentFolderId: null,
      currentTopicId: null,
      currentLessonId: null,
      searchQuery: '',
      theme: 'light',
      previewFileId: null,
    };
    this._listeners = [];
  }

  get(key) { return this.state[key]; }

  set(key, value) {
    this.state[key] = value;
    this._notify();
  }

  subscribe(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  _notify() {
    this._listeners.forEach(fn => fn(this.state));
  }
}

/* ===== UI Renderer ===== */
class UI {
  constructor() {
    this.mainContent = document.getElementById('mainContent');
    this.sidebarFolders = document.getElementById('sidebarFolders');
    this.toastContainer = document.getElementById('toastContainer');
    this._blobUrls = [];
  }

  /* ---- Sidebar ---- */
  renderSidebar(folders, topics, lessonCounts, state) {
    if (!folders.length) {
      this.sidebarFolders.innerHTML = `
        <div class="empty-state" style="padding:1rem 0.5rem">
          <span style="font-size:1.5rem;opacity:0.5">📂</span>
          <p style="font-size:0.8rem;margin-top:0.3rem">Noch keine Ordner</p>
        </div>`;
      return;
    }

    this.sidebarFolders.innerHTML = folders.map(f => {
      const folderTopics = topics.filter(t => t.folderId === f.id);
      const isActive = f.id === state.currentFolderId && !state.currentTopicId && !state.currentLessonId;
      const isOpen = state.currentFolderId === f.id;
      const topicCount = folderTopics.length;

      const topicItems = folderTopics.map(t => {
        const lCount = lessonCounts[t.id] || 0;
        const tActive = t.id === state.currentTopicId && !state.currentLessonId;
        return `<button class="sidebar-topic ${tActive ? 'active' : ''}" data-topic-id="${t.id}">
          <span class="sidebar-topic-dot"></span>
          <span class="sidebar-topic-name">${this._esc(t.name)}</span>
          <span class="sidebar-topic-count">${lCount}</span>
        </button>`;
      }).join('');

      return `<div class="sidebar-folder">
        <button class="sidebar-folder-btn ${isActive ? 'active' : ''}" data-folder-id="${f.id}">
          <svg class="sidebar-folder-chevron ${isOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <span class="sidebar-folder-dot" style="background:${f.color}"></span>
          <span class="sidebar-folder-name">${this._esc(f.name)}</span>
          <span class="sidebar-folder-count">${topicCount}</span>
        </button>
        <div class="sidebar-folder-topics ${isOpen ? 'open' : ''}">${topicItems}</div>
      </div>`;
    }).join('');
  }

  /* ---- Breadcrumb ---- */
  renderBreadcrumb(parts) {
    if (!parts.length) return '';
    const items = parts.map((p, i) => {
      const isLast = i === parts.length - 1;
      const sep = i > 0 ? '<span class="breadcrumb-sep">›</span>' : '';
      if (isLast) {
        return `${sep}<span class="breadcrumb-item current">${this._esc(p.label)}</span>`;
      }
      return `${sep}<button class="breadcrumb-item" data-nav="${p.nav}" data-id="${p.id || ''}">${this._esc(p.label)}</button>`;
    }).join('');
    return `<nav class="breadcrumb">${items}</nav>`;
  }

  /* ---- Dashboard (Folders) ---- */
  renderDashboard(folders, topicCounts) {
    const cards = folders.map(f => `
      <div class="topic-card" data-folder-id="${f.id}" style="--card-color:${f.color}">
        <div class="topic-card-header">
          <div class="topic-card-name">${this._esc(f.name)}</div>
          <div class="topic-card-actions">
            <button class="topic-card-btn edit-folder-btn" data-folder-id="${f.id}" title="Bearbeiten">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="topic-card-btn danger delete-folder-btn" data-folder-id="${f.id}" title="Löschen">
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
            ${topicCounts[f.id] || 0} Themen
          </span>
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${this._formatDate(f.createdAt)}
          </span>
        </div>
      </div>
    `).join('');

    this.mainContent.innerHTML = `
      <div class="dashboard-header">
        <h2 class="dashboard-title">Übersicht</h2>
        <p class="dashboard-subtitle">${folders.length} Ordner insgesamt</p>
      </div>
      <div class="dashboard-grid">
        ${cards}
        <div class="add-topic-card" id="addFolderCard">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span class="add-topic-label">Neuer Ordner</span>
        </div>
      </div>`;
  }

  /* ---- Folder Detail (Topics) ---- */
  renderFolderDetail(folder, topics, lessonCounts) {
    const bc = this.renderBreadcrumb([
      { label: 'Übersicht', nav: 'dashboard' },
      { label: folder.name, nav: 'folder', id: folder.id },
    ]);

    const cards = topics.map(t => `
      <div class="topic-card" data-topic-id="${t.id}" style="--card-color:${folder.color}">
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
            ${lessonCounts[t.id] || 0} Stunden
          </span>
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${this._formatDate(t.createdAt)}
          </span>
        </div>
      </div>
    `).join('');

    this.mainContent.innerHTML = `
      ${bc}
      <div class="topic-detail-header">
        <div class="topic-detail-left">
          <span class="topic-detail-color" style="background:${folder.color}"></span>
          <h2 class="topic-detail-title">${this._esc(folder.name)}</h2>
        </div>
        <div class="topic-detail-right">
          <button class="btn btn-primary btn-sm" id="addTopicBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Neues Thema
          </button>
        </div>
      </div>
      <div class="dashboard-grid">
        ${cards}
        ${!topics.length ? `
          <div class="empty-state" style="grid-column:1/-1">
            <span class="empty-state-icon">📚</span>
            <div class="empty-state-title">Keine Themen vorhanden</div>
            <p class="empty-state-text">Erstellen Sie ein neues Thema für diesen Ordner.</p>
          </div>` : ''}
      </div>`;
  }

  /* ---- Topic Detail (Stundenplan-Tabelle) ---- */
  renderTopicDetail(folder, topic, lessons, fileCounts) {
    const bc = this.renderBreadcrumb([
      { label: 'Übersicht', nav: 'dashboard' },
      { label: folder.name, nav: 'folder', id: folder.id },
      { label: topic.name, nav: 'topic', id: topic.id },
    ]);

    let tableBody = '';
    if (lessons.length) {
      tableBody = lessons.map((l, i) => `
        <tr data-lesson-id="${l.id}">
          <td class="col-num">${i + 1}</td>
          <td class="col-title">${this._esc(l.title)}</td>
          <td class="col-date">${l.date ? this._formatDateISO(l.date) : '—'}</td>
          <td class="col-files">${fileCounts[l.id] || 0} Dateien</td>
          <td class="col-actions">
            <button class="table-action-btn edit-lesson-btn" data-lesson-id="${l.id}" title="Bearbeiten">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="table-action-btn danger delete-lesson-btn" data-lesson-id="${l.id}" title="Löschen">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </td>
        </tr>`).join('');
    }

    this.mainContent.innerHTML = `
      ${bc}
      <div class="topic-detail-header">
        <div class="topic-detail-left">
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
          <button class="btn btn-primary btn-sm" id="addLessonBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Neue Stunde
          </button>
        </div>
      </div>

      ${lessons.length ? `
        <div class="sequence-table-wrap">
          <table class="sequence-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Titel</th>
                <th>Datum</th>
                <th>Dateien</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${tableBody}</tbody>
          </table>
        </div>` : `
        <div class="empty-state">
          <span class="empty-state-icon">📝</span>
          <div class="empty-state-title">Keine Unterrichtsstunden</div>
          <p class="empty-state-text">Erstellen Sie eine neue Stunde für dieses Thema.</p>
        </div>`}`;
  }

  /* ---- Lesson Detail (Files + Links + Preview) ---- */
  renderLessonDetail(folder, topic, lesson, files, previewFileId) {
    const bc = this.renderBreadcrumb([
      { label: 'Übersicht', nav: 'dashboard' },
      { label: folder.name, nav: 'folder', id: folder.id },
      { label: topic.name, nav: 'topic', id: topic.id },
      { label: lesson.title, nav: 'lesson', id: lesson.id },
    ]);

    // Lesson info card
    const infoHTML = `
      <div class="lesson-info">
        <div class="lesson-info-row">
          <span class="lesson-info-label">Titel:</span>
          <span class="lesson-info-value">${this._esc(lesson.title)}</span>
        </div>
        ${lesson.date ? `<div class="lesson-info-row">
          <span class="lesson-info-label">Datum:</span>
          <span class="lesson-info-value">${this._formatDateISO(lesson.date)}</span>
        </div>` : ''}
        ${lesson.description ? `<div class="lesson-info-row">
          <span class="lesson-info-label">Beschreibung:</span>
          <span class="lesson-info-value">${this._esc(lesson.description)}</span>
        </div>` : ''}
      </div>`;

    // File list
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

    // Preview
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
      ${bc}
      <div class="topic-detail-header">
        <div class="topic-detail-left">
          <h2 class="topic-detail-title">${this._esc(lesson.title)}</h2>
        </div>
        <div class="topic-detail-right">
          <button class="btn btn-secondary btn-sm edit-lesson-btn" data-lesson-id="${lesson.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Bearbeiten
          </button>
          <button class="btn btn-danger btn-sm delete-lesson-btn" data-lesson-id="${lesson.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            Löschen
          </button>
        </div>
      </div>

      ${infoHTML}

      <div class="drop-zone" id="dropZone">
        <span class="drop-zone-icon">📁</span>
        <div class="drop-zone-text">Dateien hierher ziehen oder <strong>klicken</strong></div>
        <div class="drop-zone-hint">PDF, DOC und DOCX werden unterstützt</div>
        <input type="file" class="drop-zone-input" id="fileInput" accept=".pdf,.doc,.docx" multiple>
      </div>

      <div class="file-list" id="fileList">${fileListHTML}</div>

      <div class="links-section">
        <div class="links-section-header">
          <span class="links-section-title">Links</span>
          <button class="btn btn-secondary btn-sm" id="addLinkBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Link hinzufügen
          </button>
        </div>
        <div class="link-list">${this._renderLinks(lesson.links || [])}</div>
      </div>

      ${previewHTML}`;
  }

  /* ---- Search Results ---- */
  renderSearchResults(query, folders, topics, lessons, files, allFolders, allTopics) {
    const noResults = !folders.length && !topics.length && !lessons.length && !files.length;

    const folderCards = folders.map(f => `
      <div class="topic-card" data-folder-id="${f.id}" style="--card-color:${f.color}">
        <div class="topic-card-header"><div class="topic-card-name">${this._esc(f.name)}</div></div>
        <div class="topic-card-meta"><span style="font-size:0.8rem;color:var(--text-muted)">Ordner</span></div>
      </div>`).join('');

    const topicCards = topics.map(t => {
      const folder = allFolders.find(f => f.id === t.folderId);
      return `<div class="topic-card search-topic-card" data-topic-id="${t.id}" data-folder-id="${t.folderId}" style="--card-color:${folder?.color || '#868e96'}">
        <div class="topic-card-header"><div class="topic-card-name">${this._esc(t.name)}</div></div>
        <div class="topic-card-meta"><span style="font-size:0.8rem;color:var(--text-muted)">${folder ? this._esc(folder.name) : ''} › Thema</span></div>
      </div>`;
    }).join('');

    const lessonItems = lessons.map(l => {
      const topic = allTopics.find(t => t.id === l.topicId);
      const folder = topic ? allFolders.find(f => f.id === topic.folderId) : null;
      return `<div class="file-item search-lesson-item" data-lesson-id="${l.id}" data-topic-id="${l.topicId}" data-folder-id="${folder?.id || ''}">
        <div class="file-icon" style="background:var(--gold-light);color:var(--gold);font-size:0.9rem">📝</div>
        <div class="file-info">
          <div class="file-name">${this._esc(l.title)}</div>
          <div class="file-meta">${folder ? this._esc(folder.name) + ' › ' : ''}${topic ? this._esc(topic.name) : ''} · ${l.date ? this._formatDateISO(l.date) : '—'}</div>
        </div>
      </div>`;
    }).join('');

    const fileItems = files.map(f => {
      const isPdf = f.type === 'application/pdf';
      return `<div class="file-item search-file-item" data-file-id="${f.id}" data-lesson-id="${f.lessonId}">
        <div class="file-icon ${isPdf ? 'pdf' : 'word'}">${isPdf ? 'PDF' : 'DOC'}</div>
        <div class="file-info">
          <div class="file-name">${this._esc(f.name)}</div>
          <div class="file-meta">${this._formatSize(f.size)} · ${this._formatDate(f.uploadedAt)}</div>
        </div>
      </div>`;
    }).join('');

    this.mainContent.innerHTML = `
      <div class="dashboard-header">
        <h2 class="dashboard-title">Suchergebnisse für „${this._esc(query)}"</h2>
        <p class="dashboard-subtitle">${folders.length + topics.length + lessons.length + files.length} Treffer</p>
      </div>
      ${noResults ? `<div class="empty-state">
        <span class="empty-state-icon">🔍</span>
        <div class="empty-state-title">Keine Ergebnisse</div>
        <p class="empty-state-text">Versuchen Sie es mit einem anderen Suchbegriff.</p>
      </div>` : ''}
      ${folders.length ? `<h3 style="margin-bottom:0.75rem;font-size:1rem">Ordner</h3><div class="dashboard-grid" style="margin-bottom:1.5rem">${folderCards}</div>` : ''}
      ${topics.length ? `<h3 style="margin-bottom:0.75rem;font-size:1rem">Themen</h3><div class="dashboard-grid" style="margin-bottom:1.5rem">${topicCards}</div>` : ''}
      ${lessons.length ? `<h3 style="margin-bottom:0.75rem;font-size:1rem">Stunden</h3><div class="file-list" style="margin-bottom:1.5rem">${lessonItems}</div>` : ''}
      ${files.length ? `<h3 style="margin-bottom:0.75rem;font-size:1rem">Dateien</h3><div class="file-list">${fileItems}</div>` : ''}
    `;
  }

  /* ---- Links ---- */
  _renderLinks(links) {
    if (!links.length) {
      return `<div class="empty-state" style="padding:1.25rem 1rem">
        <span style="font-size:1.5rem;opacity:0.5">🔗</span>
        <p style="font-size:0.85rem;margin-top:0.3rem;color:var(--text-muted)">Noch keine Links hinzugefügt</p>
      </div>`;
    }
    return links.map(l => `
      <div class="link-item">
        <div class="link-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </div>
        <div class="link-info">
          <div class="link-title">${this._esc(l.title || l.url)}</div>
          <div class="link-url">${this._esc(l.url)}</div>
        </div>
        <div class="link-actions">
          <a class="link-action-btn" href="${this._esc(l.url)}" target="_blank" rel="noopener noreferrer" title="Öffnen" onclick="event.stopPropagation()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
          <button class="link-action-btn danger delete-link-btn" data-link-id="${l.id}" title="Löschen">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>`).join('');
  }

  /* ---- Toast ---- */
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

  /* ---- Helpers ---- */
  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  _formatDateISO(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
  }

  _formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, size = bytes;
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
    this._editingFolderId = null;
    this._editingTopicId = null;
    this._editingLessonId = null;
    this._confirmCallback = null;
    this._linkLessonId = null;
    // Caches
    this._topicCounts = {};   // folderId -> topic count
    this._lessonCounts = {};  // topicId -> lesson count
    this._fileCounts = {};    // lessonId -> file count
    this._allFolders = [];
    this._allTopics = [];
    this._allLessons = [];
    this._allFiles = [];
  }

  async init() {
    await this.db.open();
    this._initTheme();
    await this._loadAll();
    this.store.subscribe(() => this._render());
    this._bindEvents();
    this._render();
  }

  /* ===== Theme ===== */
  _initTheme() {
    const saved = localStorage.getItem('spanischapp-theme');
    if (saved) {
      this.store.state.theme = saved;
    } else {
      this.store.state.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', this.store.get('theme'));
  }

  _toggleTheme() {
    const next = this.store.get('theme') === 'light' ? 'dark' : 'light';
    this.store.set('theme', next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('spanischapp-theme', next);
  }

  /* ===== Data Loading ===== */
  async _loadAll() {
    const [folders, topics, lessons, files] = await Promise.all([
      this.db.getFolders(),
      this.db.getTopics(),
      this.db.getLessons(),
      this.db.getFiles(),
    ]);

    folders.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    topics.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    lessons.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));

    this._allFolders = folders;
    this._allTopics = topics;
    this._allLessons = lessons;
    this._allFiles = files;

    this.store.state.folders = folders;
    this.store.state.topics = topics;
    this.store.state.lessons = lessons;

    // Counts
    this._topicCounts = {};
    for (const t of topics) {
      this._topicCounts[t.folderId] = (this._topicCounts[t.folderId] || 0) + 1;
    }

    this._lessonCounts = {};
    for (const l of lessons) {
      this._lessonCounts[l.topicId] = (this._lessonCounts[l.topicId] || 0) + 1;
    }

    this._fileCounts = {};
    for (const f of files) {
      this._fileCounts[f.lessonId] = (this._fileCounts[f.lessonId] || 0) + 1;
    }
  }

  /* ===== Rendering ===== */
  _render() {
    const s = this.store.state;

    // Sidebar
    this.ui.renderSidebar(this._allFolders, this._allTopics, this._lessonCounts, s);
    this._updateNavActive();

    // Main content
    if (s.searchQuery) {
      this._renderSearch(s.searchQuery);
    } else if (s.currentLessonId) {
      this._renderLessonView();
    } else if (s.currentTopicId) {
      this._renderTopicView();
    } else if (s.currentFolderId) {
      this._renderFolderView();
    } else {
      this.ui.renderDashboard(this._allFolders, this._topicCounts);
    }

    this._bindDynamicEvents();
  }

  _renderFolderView() {
    const folder = this._allFolders.find(f => f.id === this.store.get('currentFolderId'));
    if (!folder) { this._navigateDashboard(); return; }
    const topics = this._allTopics.filter(t => t.folderId === folder.id);
    this.ui.renderFolderDetail(folder, topics, this._lessonCounts);
  }

  _renderTopicView() {
    const topic = this._allTopics.find(t => t.id === this.store.get('currentTopicId'));
    if (!topic) { this._navigateDashboard(); return; }
    const folder = this._allFolders.find(f => f.id === topic.folderId);
    if (!folder) { this._navigateDashboard(); return; }
    const lessons = this._allLessons.filter(l => l.topicId === topic.id);
    this.ui.renderTopicDetail(folder, topic, lessons, this._fileCounts);
  }

  _renderLessonView() {
    const lesson = this._allLessons.find(l => l.id === this.store.get('currentLessonId'));
    if (!lesson) { this._navigateDashboard(); return; }
    const topic = this._allTopics.find(t => t.id === lesson.topicId);
    if (!topic) { this._navigateDashboard(); return; }
    const folder = this._allFolders.find(f => f.id === topic.folderId);
    if (!folder) { this._navigateDashboard(); return; }
    const files = this._allFiles.filter(f => f.lessonId === lesson.id);
    files.sort((a, b) => b.uploadedAt - a.uploadedAt);
    this.ui.renderLessonDetail(folder, topic, lesson, files, this.store.get('previewFileId'));
    this._bindDropZone();
  }

  _renderSearch(query) {
    const q = query.toLowerCase();
    const folders = this._allFolders.filter(f => f.name.toLowerCase().includes(q));
    const topics = this._allTopics.filter(t => t.name.toLowerCase().includes(q));
    const lessons = this._allLessons.filter(l =>
      l.title.toLowerCase().includes(q) || (l.description && l.description.toLowerCase().includes(q))
    );
    const files = this._allFiles.filter(f => f.name.toLowerCase().includes(q));
    this.ui.renderSearchResults(query, folders, topics, lessons, files, this._allFolders, this._allTopics);
  }

  _updateNavActive() {
    const nav = document.getElementById('navDashboard');
    if (nav) {
      const s = this.store.state;
      nav.classList.toggle('active', !s.currentFolderId && !s.currentTopicId && !s.currentLessonId && !s.searchQuery);
    }
  }

  /* ===== Navigation Helpers ===== */
  _navigateDashboard() {
    this.store.state.currentFolderId = null;
    this.store.state.currentTopicId = null;
    this.store.state.currentLessonId = null;
    this.store.state.previewFileId = null;
    this.store.state.searchQuery = '';
    this._clearSearch();
    this.store._notify();
  }

  _navigateFolder(folderId) {
    this.store.state.currentFolderId = folderId;
    this.store.state.currentTopicId = null;
    this.store.state.currentLessonId = null;
    this.store.state.previewFileId = null;
    this.store.state.searchQuery = '';
    this._clearSearch();
    this.store._notify();
  }

  _navigateTopic(topicId) {
    const topic = this._allTopics.find(t => t.id === topicId);
    if (!topic) return;
    this.store.state.currentFolderId = topic.folderId;
    this.store.state.currentTopicId = topicId;
    this.store.state.currentLessonId = null;
    this.store.state.previewFileId = null;
    this.store.state.searchQuery = '';
    this._clearSearch();
    this.store._notify();
  }

  _navigateLesson(lessonId) {
    const lesson = this._allLessons.find(l => l.id === lessonId);
    if (!lesson) return;
    const topic = this._allTopics.find(t => t.id === lesson.topicId);
    if (!topic) return;
    this.store.state.currentFolderId = topic.folderId;
    this.store.state.currentTopicId = topic.id;
    this.store.state.currentLessonId = lessonId;
    this.store.state.previewFileId = null;
    this.store.state.searchQuery = '';
    this._clearSearch();
    this.store._notify();
  }

  _clearSearch() {
    const input = document.getElementById('searchInput');
    const clear = document.getElementById('searchClear');
    if (input) input.value = '';
    if (clear) clear.classList.add('hidden');
  }

  /* ===== Static Event Bindings ===== */
  _bindEvents() {
    // Theme
    document.getElementById('themeToggle').addEventListener('click', () => this._toggleTheme());

    // Sidebar toggle
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    // Dashboard nav
    document.getElementById('navDashboard').addEventListener('click', () => this._navigateDashboard());

    // Sidebar add folder
    document.getElementById('addFolderBtnSidebar').addEventListener('click', () => this._openFolderModal());

    // Folder modal
    document.getElementById('folderModalClose').addEventListener('click', () => this._closeFolderModal());
    document.getElementById('folderModalCancel').addEventListener('click', () => this._closeFolderModal());
    document.getElementById('folderModalSave').addEventListener('click', () => this._saveFolder());
    document.getElementById('folderNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveFolder();
    });

    // Folder color picker
    document.getElementById('folderColorPicker').addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      document.querySelectorAll('#folderColorPicker .color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });

    // Topic modal
    document.getElementById('topicModalClose').addEventListener('click', () => this._closeTopicModal());
    document.getElementById('topicModalCancel').addEventListener('click', () => this._closeTopicModal());
    document.getElementById('topicModalSave').addEventListener('click', () => this._saveTopic());
    document.getElementById('topicNameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveTopic();
    });

    // Lesson modal
    document.getElementById('lessonModalClose').addEventListener('click', () => this._closeLessonModal());
    document.getElementById('lessonModalCancel').addEventListener('click', () => this._closeLessonModal());
    document.getElementById('lessonModalSave').addEventListener('click', () => this._saveLesson());
    document.getElementById('lessonTitleInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveLesson();
    });

    // Link modal
    document.getElementById('linkModalClose').addEventListener('click', () => this._closeLinkModal());
    document.getElementById('linkModalCancel').addEventListener('click', () => this._closeLinkModal());
    document.getElementById('linkModalSave').addEventListener('click', () => this._saveLink());
    document.getElementById('linkUrlInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveLink();
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
        this.store.state.currentFolderId = null;
        this.store.state.currentTopicId = null;
        this.store.state.currentLessonId = null;
        this.store.state.previewFileId = null;
        this.store.set('searchQuery', val);
      }, 250);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.classList.add('hidden');
      this._navigateDashboard();
    });

    // Close modals on overlay
    ['folderModal', 'topicModal', 'lessonModal', 'linkModal', 'confirmModal'].forEach(id => {
      document.getElementById(id).addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
          if (id === 'folderModal') this._closeFolderModal();
          else if (id === 'topicModal') this._closeTopicModal();
          else if (id === 'lessonModal') this._closeLessonModal();
          else if (id === 'linkModal') this._closeLinkModal();
          else this._closeConfirmModal();
        }
      });
    });

    // Escape closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._closeFolderModal();
        this._closeTopicModal();
        this._closeLessonModal();
        this._closeLinkModal();
        this._closeConfirmModal();
      }
    });
  }

  /* ===== Dynamic Event Bindings ===== */
  _bindDynamicEvents() {
    const main = this.ui.mainContent;

    // Breadcrumb navigation
    main.querySelectorAll('.breadcrumb-item[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nav = btn.dataset.nav;
        const id = btn.dataset.id ? Number(btn.dataset.id) : null;
        if (nav === 'dashboard') this._navigateDashboard();
        else if (nav === 'folder' && id) this._navigateFolder(id);
        else if (nav === 'topic' && id) this._navigateTopic(id);
      });
    });

    // Dashboard: folder card click
    main.querySelectorAll('.topic-card[data-folder-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.topic-card-btn')) return;
        this._navigateFolder(Number(card.dataset.folderId));
      });
    });

    // Dashboard: add folder card
    const addFolderCard = document.getElementById('addFolderCard');
    if (addFolderCard) addFolderCard.addEventListener('click', () => this._openFolderModal());

    // Edit/delete folder buttons
    main.querySelectorAll('.edit-folder-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openFolderModal(Number(btn.dataset.folderId));
      });
    });
    main.querySelectorAll('.delete-folder-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.folderId);
        const folder = this._allFolders.find(f => f.id === id);
        this._openConfirmModal(
          'Ordner löschen',
          `Möchten Sie „${folder?.name}" und alle zugehörigen Themen, Stunden und Dateien wirklich löschen?`,
          async () => {
            await this.db.deleteTopicsByFolder(id);
            await this.db.deleteFolder(id);
            await this._loadAll();
            if (this.store.get('currentFolderId') === id) this._navigateDashboard();
            else this.store._notify();
            this.ui.showToast('Ordner gelöscht', 'success');
          }
        );
      });
    });

    // Folder detail: topic cards
    main.querySelectorAll('.topic-card[data-topic-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.topic-card-btn')) return;
        this._navigateTopic(Number(card.dataset.topicId));
      });
    });

    // Add topic button (in folder detail)
    const addTopicBtn = document.getElementById('addTopicBtn');
    if (addTopicBtn) addTopicBtn.addEventListener('click', () => this._openTopicModal());

    // Edit/delete topic buttons
    main.querySelectorAll('.edit-topic-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openTopicModal(Number(btn.dataset.topicId));
      });
    });
    main.querySelectorAll('.delete-topic-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.topicId);
        const topic = this._allTopics.find(t => t.id === id);
        this._openConfirmModal(
          'Thema löschen',
          `Möchten Sie „${topic?.name}" und alle zugehörigen Stunden und Dateien wirklich löschen?`,
          async () => {
            await this.db.deleteLessonsByTopic(id);
            await this.db.deleteTopic(id);
            await this._loadAll();
            if (this.store.get('currentTopicId') === id) {
              this.store.state.currentTopicId = null;
              this.store.state.currentLessonId = null;
            }
            this.store._notify();
            this.ui.showToast('Thema gelöscht', 'success');
          }
        );
      });
    });

    // Stundenplan table: row click -> lesson detail
    main.querySelectorAll('.sequence-table tbody tr[data-lesson-id]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.table-action-btn')) return;
        this._navigateLesson(Number(row.dataset.lessonId));
      });
    });

    // Add lesson button
    const addLessonBtn = document.getElementById('addLessonBtn');
    if (addLessonBtn) addLessonBtn.addEventListener('click', () => this._openLessonModal());

    // Edit/delete lesson buttons (table and detail view)
    main.querySelectorAll('.edit-lesson-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openLessonModal(Number(btn.dataset.lessonId));
      });
    });
    main.querySelectorAll('.delete-lesson-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.lessonId);
        const lesson = this._allLessons.find(l => l.id === id);
        this._openConfirmModal(
          'Stunde löschen',
          `Möchten Sie „${lesson?.title}" und alle zugehörigen Dateien wirklich löschen?`,
          async () => {
            await this.db.deleteFilesByLesson(id);
            await this.db.deleteLesson(id);
            await this._loadAll();
            if (this.store.get('currentLessonId') === id) {
              this.store.state.currentLessonId = null;
            }
            this.store._notify();
            this.ui.showToast('Stunde gelöscht', 'success');
          }
        );
      });
    });

    // File actions
    main.querySelectorAll('.preview-file-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.set('previewFileId', Number(btn.dataset.fileId));
      });
    });

    main.querySelectorAll('.download-file-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const file = await this.db.getFile(Number(btn.dataset.fileId));
        if (!file) return;
        const url = URL.createObjectURL(file.blob);
        const a = document.createElement('a');
        a.href = url; a.download = file.name;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    });

    main.querySelectorAll('.delete-file-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.fileId);
        const file = this._allFiles.find(f => f.id === id);
        this._openConfirmModal(
          'Datei löschen',
          `Möchten Sie „${file?.name}" wirklich löschen?`,
          async () => {
            await this.db.deleteFile(id);
            if (this.store.get('previewFileId') === id) this.store.state.previewFileId = null;
            await this._loadAll();
            this.store._notify();
            this.ui.showToast('Datei gelöscht', 'success');
          }
        );
      });
    });

    // File item click (preview PDF or download Word)
    main.querySelectorAll('.file-item[data-file-id]').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.file-action-btn')) return;
        const id = Number(item.dataset.fileId);
        const file = this._allFiles.find(f => f.id === id) || await this.db.getFile(id);
        if (!file) return;

        if (file.type === 'application/pdf') {
          this.store.set('previewFileId', id);
        } else {
          const url = URL.createObjectURL(file.blob);
          const a = document.createElement('a');
          a.href = url; a.download = file.name;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      });
    });

    // Close preview
    const closePreview = document.getElementById('closePreview');
    if (closePreview) closePreview.addEventListener('click', () => this.store.set('previewFileId', null));

    // Add link button
    const addLinkBtn = document.getElementById('addLinkBtn');
    if (addLinkBtn) addLinkBtn.addEventListener('click', () => this._openLinkModal());

    // Delete link buttons
    main.querySelectorAll('.delete-link-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteLink(Number(btn.dataset.linkId));
      });
    });

    // Sidebar folder clicks
    this.ui.sidebarFolders.querySelectorAll('.sidebar-folder-btn').forEach(btn => {
      btn.addEventListener('click', () => this._navigateFolder(Number(btn.dataset.folderId)));
    });

    // Sidebar topic clicks
    this.ui.sidebarFolders.querySelectorAll('.sidebar-topic').forEach(btn => {
      btn.addEventListener('click', () => this._navigateTopic(Number(btn.dataset.topicId)));
    });

    // Search result navigation
    main.querySelectorAll('.search-topic-card[data-topic-id]').forEach(card => {
      card.addEventListener('click', () => this._navigateTopic(Number(card.dataset.topicId)));
    });
    main.querySelectorAll('.search-lesson-item[data-lesson-id]').forEach(item => {
      item.addEventListener('click', () => this._navigateLesson(Number(item.dataset.lessonId)));
    });
    main.querySelectorAll('.search-file-item[data-lesson-id]').forEach(item => {
      item.addEventListener('click', () => {
        const lessonId = Number(item.dataset.lessonId);
        const fileId = Number(item.dataset.fileId);
        const file = this._allFiles.find(f => f.id === fileId);
        this.store.state.previewFileId = file?.type === 'application/pdf' ? fileId : null;
        this._navigateLesson(lessonId);
      });
    });
  }

  /* ===== Drop Zone ===== */
  _bindDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      this._handleFiles(Array.from(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', () => {
      this._handleFiles(Array.from(fileInput.files));
      fileInput.value = '';
    });
  }

  async _handleFiles(files) {
    const allowed = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const lessonId = this.store.get('currentLessonId');
    if (!lessonId) return;

    let uploaded = 0;
    for (const file of files) {
      if (!allowed.includes(file.type)) {
        this.ui.showToast(`„${file.name}" wird nicht unterstützt`, 'error');
        continue;
      }
      const blob = await this._readFileAsBlob(file);
      await this.db.addFile({
        lessonId,
        name: file.name,
        type: file.type,
        size: file.size,
        blob,
        uploadedAt: Date.now(),
      });
      uploaded++;
    }

    if (uploaded > 0) {
      await this._loadAll();
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

  /* ===== Folder Modal ===== */
  _openFolderModal(editId = null) {
    this._editingFolderId = editId;
    const modal = document.getElementById('folderModal');
    const title = document.getElementById('folderModalTitle');
    const input = document.getElementById('folderNameInput');

    if (editId) {
      const folder = this._allFolders.find(f => f.id === editId);
      title.textContent = 'Ordner bearbeiten';
      input.value = folder?.name || '';
      document.querySelectorAll('#folderColorPicker .color-swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === folder?.color);
      });
    } else {
      title.textContent = 'Neuen Ordner erstellen';
      input.value = '';
      document.querySelectorAll('#folderColorPicker .color-swatch').forEach((s, i) => {
        s.classList.toggle('selected', i === 0);
      });
    }

    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
  }

  _closeFolderModal() {
    document.getElementById('folderModal').classList.add('hidden');
    this._editingFolderId = null;
  }

  async _saveFolder() {
    const name = document.getElementById('folderNameInput').value.trim();
    if (!name) { this.ui.showToast('Bitte einen Namen eingeben', 'error'); return; }
    const color = document.querySelector('#folderColorPicker .color-swatch.selected')?.dataset.color || '#e63946';

    if (this._editingFolderId) {
      const folder = this._allFolders.find(f => f.id === this._editingFolderId);
      if (folder) {
        folder.name = name;
        folder.color = color;
        await this.db.updateFolder(folder);
        this.ui.showToast('Ordner aktualisiert', 'success');
      }
    } else {
      await this.db.addFolder({
        name, color,
        createdAt: Date.now(),
        order: this._allFolders.length,
      });
      this.ui.showToast('Ordner erstellt', 'success');
    }

    this._closeFolderModal();
    await this._loadAll();
    this.store._notify();
  }

  /* ===== Topic Modal ===== */
  _openTopicModal(editId = null) {
    this._editingTopicId = editId;
    const modal = document.getElementById('topicModal');
    const title = document.getElementById('topicModalTitle');
    const input = document.getElementById('topicNameInput');

    if (editId) {
      const topic = this._allTopics.find(t => t.id === editId);
      title.textContent = 'Thema bearbeiten';
      input.value = topic?.name || '';
    } else {
      title.textContent = 'Neues Thema erstellen';
      input.value = '';
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
    if (!name) { this.ui.showToast('Bitte einen Namen eingeben', 'error'); return; }

    if (this._editingTopicId) {
      const topic = this._allTopics.find(t => t.id === this._editingTopicId);
      if (topic) {
        topic.name = name;
        await this.db.updateTopic(topic);
        this.ui.showToast('Thema aktualisiert', 'success');
      }
    } else {
      const folderId = this.store.get('currentFolderId');
      if (!folderId) { this.ui.showToast('Kein Ordner ausgewählt', 'error'); return; }
      const topicsInFolder = this._allTopics.filter(t => t.folderId === folderId);
      await this.db.addTopic({
        folderId,
        name,
        createdAt: Date.now(),
        order: topicsInFolder.length,
      });
      this.ui.showToast('Thema erstellt', 'success');
    }

    this._closeTopicModal();
    await this._loadAll();
    this.store._notify();
  }

  /* ===== Lesson Modal ===== */
  _openLessonModal(editId = null) {
    this._editingLessonId = editId;
    const modal = document.getElementById('lessonModal');
    const title = document.getElementById('lessonModalTitle');
    const titleInput = document.getElementById('lessonTitleInput');
    const dateInput = document.getElementById('lessonDateInput');
    const descInput = document.getElementById('lessonDescInput');

    if (editId) {
      const lesson = this._allLessons.find(l => l.id === editId);
      title.textContent = 'Stunde bearbeiten';
      titleInput.value = lesson?.title || '';
      dateInput.value = lesson?.date || '';
      descInput.value = lesson?.description || '';
    } else {
      title.textContent = 'Neue Stunde erstellen';
      titleInput.value = '';
      dateInput.value = '';
      descInput.value = '';
    }

    modal.classList.remove('hidden');
    setTimeout(() => titleInput.focus(), 100);
  }

  _closeLessonModal() {
    document.getElementById('lessonModal').classList.add('hidden');
    this._editingLessonId = null;
  }

  async _saveLesson() {
    const titleVal = document.getElementById('lessonTitleInput').value.trim();
    if (!titleVal) { this.ui.showToast('Bitte einen Titel eingeben', 'error'); return; }
    const dateVal = document.getElementById('lessonDateInput').value;
    const descVal = document.getElementById('lessonDescInput').value.trim();

    if (this._editingLessonId) {
      const lesson = this._allLessons.find(l => l.id === this._editingLessonId);
      if (lesson) {
        lesson.title = titleVal;
        lesson.date = dateVal || null;
        lesson.description = descVal || null;
        await this.db.updateLesson(lesson);
        this.ui.showToast('Stunde aktualisiert', 'success');
      }
    } else {
      const topicId = this.store.get('currentTopicId');
      if (!topicId) { this.ui.showToast('Kein Thema ausgewählt', 'error'); return; }
      const lessonsInTopic = this._allLessons.filter(l => l.topicId === topicId);
      await this.db.addLesson({
        topicId,
        title: titleVal,
        date: dateVal || null,
        description: descVal || null,
        order: lessonsInTopic.length,
        createdAt: Date.now(),
      });
      this.ui.showToast('Stunde erstellt', 'success');
    }

    this._closeLessonModal();
    await this._loadAll();
    this.store._notify();
  }

  /* ===== Link Modal ===== */
  _openLinkModal() {
    this._linkLessonId = this.store.get('currentLessonId');
    document.getElementById('linkTitleInput').value = '';
    document.getElementById('linkUrlInput').value = '';
    document.getElementById('linkModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('linkUrlInput').focus(), 100);
  }

  _closeLinkModal() {
    document.getElementById('linkModal').classList.add('hidden');
    this._linkLessonId = null;
  }

  async _saveLink() {
    const titleVal = document.getElementById('linkTitleInput').value.trim();
    const urlVal = document.getElementById('linkUrlInput').value.trim();
    if (!urlVal) { this.ui.showToast('Bitte eine URL eingeben', 'error'); return; }
    try { new URL(urlVal); } catch { this.ui.showToast('Ungültige URL', 'error'); return; }

    const lesson = this._allLessons.find(l => l.id === this._linkLessonId);
    if (!lesson) return;
    if (!lesson.links) lesson.links = [];
    lesson.links.push({ id: Date.now(), title: titleVal || urlVal, url: urlVal, addedAt: Date.now() });

    await this.db.updateLesson(lesson);
    this._closeLinkModal();
    await this._loadAll();
    this.store._notify();
    this.ui.showToast('Link hinzugefügt', 'success');
  }

  async _deleteLink(linkId) {
    const lessonId = this.store.get('currentLessonId');
    const lesson = this._allLessons.find(l => l.id === lessonId);
    if (!lesson || !lesson.links) return;
    lesson.links = lesson.links.filter(l => l.id !== linkId);
    await this.db.updateLesson(lesson);
    await this._loadAll();
    this.store._notify();
    this.ui.showToast('Link gelöscht', 'success');
  }

  /* ===== Confirm Modal ===== */
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
