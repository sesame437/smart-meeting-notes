/* ===== API Helpers ===== */
const API = {
  async request(url, opts = {}) {
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...opts.headers },
        ...opts,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (res.status === 204) return null;
      return res.json();
    } catch (err) {
      Toast.error(err.message || "Network error");
      throw err;
    }
  },

  get(url)          { return this.request(url); },
  post(url, data)   { return this.request(url, { method: "POST", body: JSON.stringify(data) }); },
  put(url, data)    { return this.request(url, { method: "PUT", body: JSON.stringify(data) }); },
  del(url)          { return this.request(url, { method: "DELETE" }); },
};

/* ===== Toast ===== */
const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) {
      this._container = document.createElement("div");
      this._container.className = "toast-container";
      document.body.appendChild(this._container);
    }
    return this._container;
  },

  show(message, type = "info", duration = 3000) {
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    this._getContainer().appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s";
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, "success"); },
  error(msg)   { this.show(msg, "error", 5000); },
  info(msg)    { this.show(msg, "info"); },
};

/* ===== Auto-polling ===== */
let pollingTimer = null;

function hasActiveJobs(meetings) {
  const activeStatuses = ['pending', 'processing', 'transcribing', 'reporting'];
  return meetings.some(m => activeStatuses.includes(m.status));
}

function startPolling() {
  if (pollingTimer) return;
  showSyncIndicator(true);
  pollingTimer = setInterval(async () => {
    await fetchMeetings();
  }, 12000);
}

function stopPolling() {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  showSyncIndicator(false);
}

function showSyncIndicator(show) {
  let el = document.getElementById('sync-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-indicator';
    el.style.cssText = 'position:fixed;top:70px;right:20px;background:#232F3E;color:#FF9900;font-size:12px;padding:6px 12px;border-radius:4px;z-index:1000;display:none;';
    el.textContent = '🔄 同步中…';
    document.body.appendChild(el);
  }
  el.style.display = show ? 'block' : 'none';
}

/* ===== Meeting Filter State ===== */
let allMeetings = [];
let filterType = 'all';
let searchQuery = '';
let _searchDebounceTimer = null;

function initFilter() {
  const tabs = document.querySelectorAll('.filter-tab');
  const searchInput = document.getElementById('meeting-search');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterType = tab.dataset.filter;
      renderFilteredMeetings();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(_searchDebounceTimer);
      _searchDebounceTimer = setTimeout(() => {
        searchQuery = searchInput.value.trim().toLowerCase();
        renderFilteredMeetings();
      }, 300);
    });
  }
}

function renderFilteredMeetings() {
  const list = document.getElementById("meetings-list");
  const tbody = document.getElementById("meetings-tbody");
  const target = list || tbody;
  if (!target) return;

  let filtered = allMeetings;
  if (filterType !== 'all') {
    filtered = filtered.filter(m => m.meetingType === filterType);
  }
  if (searchQuery) {
    filtered = filtered.filter(m => {
      const title = (m.title || m.meetingId || '').toLowerCase();
      return title.includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    if (list) {
      list.innerHTML = '<div class="empty-state">没有找到匹配的会议</div>';
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">没有找到匹配的会议</td></tr>';
    }
    return;
  }

  if (list) {
    list.innerHTML = filtered.map(m => meetingCard(m)).join("");
  } else {
    tbody.innerHTML = filtered.map(m => meetingRow(m)).join("");
  }
}

/* ===== Meetings List ===== */
async function fetchMeetings() {
  const list = document.getElementById("meetings-list");
  // fallback to old tbody
  const tbody = document.getElementById("meetings-tbody");
  const target = list || tbody;
  if (!target) return;

  // Only show loading on first load (when allMeetings is empty)
  if (allMeetings.length === 0) {
    if (list) {
      list.innerHTML = '<div class="loading">Loading...</div>';
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="loading">Loading...</td></tr>';
    }
  }

  try {
    const meetings = await API.get("/api/meetings");
    const meetingList = meetings || [];
    meetingList.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    allMeetings = meetingList;
    renderFilteredMeetings();
    // Auto-polling: keep polling while any job is active
    if (hasActiveJobs(meetingList)) {
      startPolling();
    } else {
      stopPolling();
    }
  } catch (_) {
    if (list) {
      list.innerHTML = '<div class="empty-state">Failed to load meetings</div>';
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Failed to load meetings</td></tr>';
    }
  }
}

function statusBadge(status) {
  const labels = {
    pending: "Pending", created: "Created",
    transcribed: "Transcribed", transcribing: "Transcribing",
    reported: "Reported", processing: "Processing",
    completed: "Completed", failed: "Failed"
  };
  const label = labels[status] || status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

/* Card view for meeting list */
function meetingCard(m) {
  const title  = escapeHtml(m.title || m.meetingId);
  const time   = m.createdAt ? new Date(m.createdAt).toLocaleString("zh-CN") : "-";
  const status = m.status || "pending";
  const id     = m.meetingId;
  const mType  = m.meetingType || "general";

  // Stage description for active jobs
  const stage = m.stage || "";
  const stageLabels = { transcribing: "转录中…", generating: "生成报告中…", sending: "发送邮件中…" };
  const stageText = (status === "processing" || status === "pending" || status === "transcribed" || status === "reported")
    ? (stageLabels[stage] || "")
    : "";

  // Failed state: show error message and retry button
  const errorMsg = (status === "failed" && m.errorMessage)
    ? `<div style="font-size:12px;color:#d32f2f;margin-top:4px;">${escapeHtml(m.errorMessage.length > 50 ? m.errorMessage.slice(0, 50) + '…' : m.errorMessage)}</div>`
    : "";
  const retryBtn = status === "failed"
    ? `<button class="btn btn-sm" style="border:1px solid #FF9900;color:#FF9900;background:transparent;margin-left:8px;" data-action="retry-meeting" data-id="${escapeAttr(id)}">🔄 重试</button>`
    : "";

  // Merge checkbox: only for completed, non-merged meetings
  const showCheckbox = status === "completed" && mType !== "merged";
  const checkboxHtml = showCheckbox
    ? `<input type="checkbox" class="merge-checkbox" data-id="${id}" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;" />`
    : `<div style="width:16px;flex-shrink:0;"></div>`;

  return `
  <div class="meeting-card-item" id="card-${id}">
    ${checkboxHtml}
    <div class="item-title" id="card-title-${id}">
      <a href="meeting.html?id=${encodeURIComponent(id)}">${title}</a>
    </div>
    <div class="item-time">${time}</div>
    <div>${statusBadge(status)}${stageText ? `<div style="font-size:12px;color:#879596;margin-top:4px;">${stageText}</div>` : ""}${errorMsg}</div>
    <div class="item-actions">
      <button class="btn btn-outline btn-sm" data-action="start-card-edit" data-id="${escapeAttr(id)}" data-title="${escapeAttr(m.title || m.meetingId)}" data-type="${escapeAttr(mType)}" title="编辑"><i class="fa fa-pencil"></i></button>
      <a href="meeting.html?id=${encodeURIComponent(id)}" class="btn btn-outline btn-sm"><i class="fa fa-eye"></i> View</a>
      ${retryBtn}
      <button class="btn btn-danger btn-sm" data-action="delete-meeting" data-id="${escapeAttr(id)}"><i class="fa fa-trash"></i></button>
    </div>
  </div>`;
}

function startCardEdit(id, currentTitle, currentType) {
  // Cancel any other active card edit
  cancelCardEdit();
  const titleEl = document.getElementById('card-title-' + id);
  if (!titleEl) return;
  titleEl.dataset.original = titleEl.innerHTML;
  titleEl.innerHTML = `
    <div class="card-edit-row" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <input type="text" class="form-control" id="card-edit-title-${id}" value="${escapeHtml(currentTitle)}" style="max-width:240px;padding:4px 8px;font-size:13px;" />
      <select class="form-control" id="card-edit-type-${id}" style="max-width:100px;padding:4px 8px;font-size:13px;">
        <option value="weekly" ${currentType==='weekly'?'selected':''}>周会</option>
        <option value="general" ${currentType==='general'?'selected':''}>通用</option>
        <option value="tech" ${currentType==='tech'?'selected':''}>技术</option>
        <option value="customer" ${currentType==='customer'?'selected':''}>客户</option>
      </select>
      <button class="btn btn-primary btn-sm" data-action="save-card-edit" data-id="${escapeAttr(id)}">确认</button>
      <button class="btn btn-outline btn-sm" data-action="cancel-card-edit">取消</button>
    </div>
  `;
  document.getElementById('card-edit-title-' + id).focus();
  window._activeCardEditId = id;
}

function cancelCardEdit() {
  if (!window._activeCardEditId) return;
  const id = window._activeCardEditId;
  const titleEl = document.getElementById('card-title-' + id);
  if (titleEl && titleEl.dataset.original) {
    titleEl.innerHTML = titleEl.dataset.original;
    delete titleEl.dataset.original;
  }
  window._activeCardEditId = null;
}

async function saveCardEdit(id) {
  const titleInput = document.getElementById('card-edit-title-' + id);
  const typeSelect = document.getElementById('card-edit-type-' + id);
  if (!titleInput || !typeSelect) return;
  const title = titleInput.value.trim();
  const meetingType = typeSelect.value;
  if (!title) { Toast.error("标题不能为空"); return; }
  try {
    await API.put(`/api/meetings/${id}`, { title, meetingType });
    Toast.success("已保存");
    window._activeCardEditId = null;
    fetchMeetings();
  } catch (_) { /* error shown by API */ }
}

/* Table row fallback */
function meetingRow(m) {
  const title = escapeHtml(m.title || m.meetingId);
  const time = m.createdAt ? new Date(m.createdAt).toLocaleString("zh-CN") : "-";
  const status = m.status || "pending";

  return `<tr>
    <td><a href="meeting.html?id=${encodeURIComponent(m.meetingId)}">${title}</a></td>
    <td>${time}</td>
    <td>${statusBadge(status)}</td>
    <td>
      <div class="btn-group">
        <a href="meeting.html?id=${encodeURIComponent(m.meetingId)}" class="btn btn-outline btn-sm"><i class="fa fa-eye"></i> View</a>
        <button class="btn btn-danger btn-sm" data-action="delete-meeting" data-id="${escapeAttr(m.meetingId)}"><i class="fa fa-trash"></i></button>
      </div>
    </td>
  </tr>`;
}

async function retryMeeting(id) {
  try {
    await API.post(`/api/meetings/${id}/retry`);
    Toast.success("已重新提交处理");
    fetchMeetings();
    startPolling();
  } catch (_) { /* error already shown by API */ }
}

async function deleteMeeting(id) {
  if (!confirm("Are you sure you want to delete this meeting?")) return;
  try {
    await API.del(`/api/meetings/${id}`);
    Toast.success("Meeting deleted");
    fetchMeetings();
  } catch (_) { /* error already shown by API */ }
}

/* ===== File Upload ===== */
function initUpload() {
  const area  = document.getElementById("upload-area");
  const input = document.getElementById("upload-input");
  if (!area) return;

  area.addEventListener("dragover", e => {
    e.preventDefault();
    area.classList.add("dragover");
  });

  area.addEventListener("dragleave", () => {
    area.classList.remove("dragover");
  });

  area.addEventListener("drop", e => {
    e.preventDefault();
    area.classList.remove("dragover");
    let file = e.dataTransfer.files[0];
    if (!file && e.dataTransfer.items) {
      const item = e.dataTransfer.items[0];
      if (item && item.kind === "file") file = item.getAsFile();
    }
    if (file) uploadFile(file);
  });

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (file) uploadFile(file);
    input.value = "";
  });
}

async function uploadFile(file) {
  const validTypes = [
    "video/mp4", "audio/mpeg", "audio/mp3", "audio/mp4", "video/quicktime",
    "audio/ogg", "application/ogg", "audio/x-ogg", "video/ogg", "application/x-ogg", "audio/vorbis"
  ];
  const ext = file.name.split(".").pop().toLowerCase();
  console.log("[upload] file:", file.name, "type:", file.type, "ext:", file.name.split(".").pop());
  if (!validTypes.includes(file.type) && !["mp4", "mp3", "m4a", "ogg", "oga", "ogv"].includes(ext)) {
    Toast.error("Please upload MP4, MP3 or OGG files only.");
    return;
  }

  const progress = document.getElementById("upload-progress");
  const bar      = document.getElementById("progress-bar");
  const text     = document.getElementById("progress-text");

  progress.classList.add("show");
  bar.style.width = "0%";
  text.textContent = "Uploading...";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", file.name.replace(/\.[^.]+$/, ""));

  // Support both pill radio and legacy select for meeting type
  const radioChecked = document.querySelector('input[name="meetingType"]:checked');
  const selectEl     = document.getElementById("meetingType");
  const meetingType  = radioChecked ? radioChecked.value : (selectEl ? selectEl.value : "general");
  formData.append("meetingType", meetingType);

  // Recipient emails
  const recipientInput = document.getElementById("recipientEmails");
  if (recipientInput && recipientInput.value.trim()) {
    formData.append("recipientEmails", recipientInput.value.trim());
  }

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/meetings/upload");

    xhr.upload.addEventListener("progress", e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + "%";
        text.textContent = `Uploading... ${pct}%`;
      }
    });

    const result = await new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          const body = JSON.parse(xhr.responseText || "{}");
          reject(new Error(body.error || `Upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(formData);
    });

    bar.style.width = "100%";
    text.textContent = "Upload complete!";
    Toast.success("File uploaded. Transcription has started.");
    setTimeout(() => {
      progress.classList.remove("show");
      fetchMeetings();
    }, 1500);
  } catch (err) {
    text.textContent = "Upload failed";
    Toast.error(err.message);
    setTimeout(() => progress.classList.remove("show"), 3000);
  }
}

/* ===== Meeting Detail ===== */
async function fetchMeeting(id) {
  const content = document.getElementById("meeting-content");
  if (!content) return;
  // Only show loading spinner on first load
  if (!content.dataset.loaded) {
    content.innerHTML = '<div class="loading">Loading...</div>';
  }
  try {
    const m = await API.get(`/api/meetings/${id}`);
    content.dataset.loaded = "1";
    renderMeetingDetail(m);
  } catch (_) {
    if (!content.dataset.loaded) {
      content.innerHTML = '<div class="empty-state">Failed to load meeting details.</div>';
    }
  }
}

function renderListItem(item) {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    return item.point || item.text || item.content || item.description
      || item.action || item.decision || item.risk || item.issue
      || item.item || item.name || JSON.stringify(item);
  }
  return String(item);
}

function renderMeetingDetail(m) {
  const content = document.getElementById("meeting-content");
  const report  = m.content || {};
  const title   = escapeHtml(m.title || m.meetingId);
  const time    = m.createdAt ? new Date(m.createdAt).toLocaleString("zh-CN") : "-";
  const status  = m.status || "pending";

  const highlights  = report.highlights  || [];
  const lowlights   = report.lowlights   || [];
  const actions     = report.actions     || [];
  const decisions   = report.decisions   || report.key_decisions || [];
  const risks       = report.risks       || report.issues || [];
  const participants= report.participants|| report.attendees || [];
  const topics      = report.topics      || report.agenda_items || [];
  const summary     = report.summary     || report.executive_summary || "No summary available yet.";
  const duration    = report.duration    || m.duration || "-";

  // ---- Pipeline Stage Indicator ----
  const stage = m.stage || "";
  let stageHtml = "";
  if (status !== "completed" && status !== "created") {
    const steps = [
      { key: "transcribing", label: "转录中" },
      { key: "generating",   label: "生成报告" },
      { key: "sending",      label: "发送邮件" },
    ];
    const stageOrder = { transcribing: 0, reporting: 0, generating: 1, exporting: 1, sending: 2, done: 3, failed: -1 };
    const currentIdx = stageOrder[stage] !== undefined ? stageOrder[stage] : -1;
    const isFailed = status === "failed";

    // For failed state, determine which step failed based on stage
    const failedIdx = isFailed ? (stageOrder[m.stage] !== undefined && m.stage !== "failed" ? stageOrder[m.stage] : 0) : -1;

    stageHtml = `<div style="display:flex;align-items:center;gap:0;margin:16px 0 8px;padding:16px 20px;background:#f8f9fa;border-radius:8px;">`;
    steps.forEach((step, i) => {
      const isActive = isFailed ? (i === failedIdx) : (i === currentIdx);
      const isDone = !isFailed && (i < currentIdx || stage === "done");
      let color = "#879596"; // pending grey
      let icon = "○";
      let weight = "400";
      if (isDone) { color = "#2e7d32"; icon = "✓"; weight = "600"; }
      else if (isActive && isFailed) { color = "#d32f2f"; icon = "✗"; weight = "700"; }
      else if (isActive) { color = "#FF9900"; icon = "●"; weight = "700"; }
      stageHtml += `<div style="display:flex;align-items:center;gap:6px;">
        <span style="color:${color};font-size:16px;font-weight:${weight};">${icon}</span>
        <span style="color:${color};font-size:13px;font-weight:${weight};">${step.label}</span>
      </div>`;
      if (i < steps.length - 1) {
        const lineColor = isDone ? "#2e7d32" : "#ddd";
        stageHtml += `<div style="flex:1;height:2px;background:${lineColor};margin:0 12px;"></div>`;
      }
    });
    stageHtml += `</div>`;

    // Failed error card
    if (isFailed) {
      stageHtml += `<div style="background:#ffebee;border:1px solid #ffcdd2;border-radius:8px;padding:16px 20px;margin:8px 0 16px;">
        <div style="font-size:15px;font-weight:700;color:#c62828;margin-bottom:8px;">❌ 处理失败</div>
        <div style="font-size:13px;color:#d32f2f;margin-bottom:12px;">错误信息：${escapeHtml(m.errorMessage || "未知错误")}</div>
        <button class="btn" style="border:1px solid #FF9900;color:#FF9900;background:transparent;font-size:13px;padding:6px 16px;border-radius:4px;cursor:pointer;" data-action="retry-detail" data-id="${escapeAttr(m.meetingId)}">🔄 重试</button>
      </div>`;
    }
  }

  // ---- Header (Cloudscape style) ----
  const meetingTypeLabel = { weekly: "周会", general: "通用", tech: "技术", customer: "客户", merged: "合并" };
  const currentType = m.meetingType || "general";
  let html = `
    <div class="meeting-detail-header">
      <div class="brand">&#9670; Meeting Minutes</div>
      <div class="detail-title-row" style="display:flex;align-items:center;gap:10px;">
        <h1 id="detail-title-display">${title}</h1>
        <span class="badge" style="background:rgba(255,153,0,0.2);color:#FF9900;font-size:11px;" id="detail-type-display">${escapeHtml(meetingTypeLabel[currentType] || currentType)}</span>
        <button class="btn btn-sm" style="background:transparent;border:1px solid rgba(255,255,255,0.3);color:#fff;cursor:pointer;" data-action="start-detail-edit" data-id="${escapeAttr(m.meetingId)}" data-title="${escapeAttr(m.title || m.meetingId)}" data-type="${escapeAttr(currentType)}" title="编辑">&#9999;&#65039;</button>
      </div>
      <div id="detail-edit-form" style="display:none;margin:8px 0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input type="text" id="detail-title-input" class="form-control" style="max-width:400px;font-size:16px;" />
          <select id="detail-type-select" class="form-control" style="max-width:160px;font-size:14px;">
            <option value="weekly">周会</option>
            <option value="general">通用</option>
            <option value="tech">技术</option>
            <option value="customer">客户</option>
          </select>
          <button class="btn btn-primary btn-sm" data-action="save-detail-edit" data-id="${escapeAttr(m.meetingId)}">保存</button>
          <button class="btn btn-outline btn-sm" style="color:#fff;border-color:rgba(255,255,255,0.3);" data-action="cancel-detail-edit">取消</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        ${statusBadge(status)}
      </div>
      ${stageHtml}
    </div>

    <div class="meeting-meta-bar">
      <div class="meta-item"><strong>Date</strong>${time}</div>
      <div class="meta-item"><strong>Duration</strong>${escapeHtml(String(duration))}</div>
      <div class="meta-item"><strong>Participants</strong>${participants.length || "-"}</div>
      <div class="meta-item"><strong>Meeting ID</strong>${escapeHtml(m.meetingId || "-")}</div>
    </div>
  `;

  // ---- Summary ----
  html += `
    <div class="card summary-card">
      <div class="card-title"><i class="fa fa-file-text-o"></i> Executive Summary</div>
      <div class="summary-text">${escapeHtml(summary)}</div>
    </div>
  `;

  // ---- Customer 专属字段 ----
  if (report.customerInfo || report.awsAttendees) {
    const ci = report.customerInfo || {};
    const awsAtt = report.awsAttendees || [];
    html += `<div class="section-grid">
      <div class="card">
        <div class="card-title"><i class="fa fa-building"></i> 客户信息</div>
        ${ci.company ? `<p style="font-size:15px;font-weight:600;margin:0 0 8px;">${esc(ci.company)}</p>` : ""}
        ${ci.attendees && ci.attendees.length ? `<ul>${ci.attendees.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : '<p style="color:#879596;">未提及</p>'}
      </div>
      <div class="card">
        <div class="card-title"><i class="fa fa-amazon"></i> AWS 出席人</div>
        ${awsAtt.length ? `<ul>${awsAtt.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : '<p style="color:#879596;">未提及</p>'}
      </div>
    </div>`;
  }

  if (report.customerNeeds && report.customerNeeds.length) {
    html += `<div class="card">
      <div class="card-title"><i class="fa fa-bullseye"></i> 客户需求</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="color:var(--aws-orange)">需求</th>
            <th style="color:var(--aws-orange)">优先级</th>
            <th style="color:var(--aws-orange)">背景</th>
          </tr></thead>
          <tbody>
            ${report.customerNeeds.map(n => {
              const prio = (n.priority || "medium").toLowerCase();
              return `<tr>
                <td>${esc(n.need)}</td>
                <td><span class="priority-badge priority-${prio}">${esc(n.priority || "-")}</span></td>
                <td>${esc(n.background || "-")}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  if (report.painPoints && report.painPoints.length) {
    html += `<div class="card">
      <div class="card-title"><i class="fa fa-exclamation-triangle"></i> 客户痛点</div>
      ${report.painPoints.map(p => `
        <div style="border-left:4px solid #FF9900;padding:10px 14px;margin-bottom:8px;background:#fff8e1;border-radius:0 6px 6px 0;">
          <strong>${esc(p.point)}</strong>
          ${p.detail ? `<br><span style="color:#666;font-size:13px;">${esc(p.detail)}</span>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  if (report.solutionsDiscussed && report.solutionsDiscussed.length) {
    html += `<div class="card">
      <div class="card-title"><i class="fa fa-lightbulb-o"></i> 讨论方案</div>
      ${report.solutionsDiscussed.map(s => `
        <div class="decision-card" style="margin-bottom:10px;">
          <strong>${esc(s.solution)}</strong>
          ${s.awsServices && s.awsServices.length ? `<div style="margin-top:6px;">${s.awsServices.map(svc => `<span style="display:inline-block;background:#232F3E;color:#FF9900;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-right:4px;margin-bottom:4px;">${esc(svc)}</span>`).join("")}</div>` : ""}
          ${s.customerFeedback ? `<p style="margin:6px 0 0;font-size:13px;color:#555;"><em>客户反馈：${esc(s.customerFeedback)}</em></p>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  if (report.commitments && report.commitments.length) {
    html += `<div class="card">
      <div class="card-title"><i class="fa fa-handshake-o"></i> 承诺事项</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="color:var(--aws-orange)">方</th>
            <th style="color:var(--aws-orange)">承诺内容</th>
            <th style="color:var(--aws-orange)">负责人</th>
            <th style="color:var(--aws-orange)">截止</th>
          </tr></thead>
          <tbody>
            ${report.commitments.map(c => {
              const party = (c.party || "").toLowerCase();
              const borderColor = party.includes("aws") ? "#FF9900" : "#1565c0";
              return `<tr style="border-left:4px solid ${borderColor};">
                <td><strong>${esc(c.party || "-")}</strong></td>
                <td>${esc(c.commitment)}</td>
                <td>${esc(c.owner || "-")}</td>
                <td>${esc(c.deadline || "-")}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  if (report.nextSteps && report.nextSteps.length) {
    html += `<div class="card">
      <div class="card-title"><i class="fa fa-arrow-circle-right"></i> 下一步行动</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="color:var(--aws-orange)">任务</th>
            <th style="color:var(--aws-orange)">负责人</th>
            <th style="color:var(--aws-orange)">截止日期</th>
            <th style="color:var(--aws-orange)">优先级</th>
          </tr></thead>
          <tbody>
            ${report.nextSteps.map(ns => {
              const prio = (ns.priority || "").toLowerCase();
              return `<tr>
                <td>${esc(ns.task)}</td>
                <td>${esc(ns.owner || "-")}</td>
                <td>${esc(ns.deadline || "-")}</td>
                <td><span class="priority-badge priority-${prio}">${esc(ns.priority || "-")}</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // ---- Weekly 专属字段 ----
  const esc = escapeHtml;

  // teamKPI（weekly 专属）
  if (report.teamKPI) {
    const kpi = report.teamKPI;
    let kpiHtml = `<div class="report-section">
      <h3 class="section-title">📊 团队 KPI</h3>`;
    if (kpi.overview) {
      kpiHtml += `<p class="section-text">${esc(kpi.overview)}</p>`;
    }
    if (kpi.individuals && kpi.individuals.length) {
      const statusColor = (s) => s==='completed'?'#2e7d32':s==='at-risk'?'#c62828':'#1565c0';
      const statusLabel = (s) => s==='completed'?'已完成':s==='at-risk'?'有风险':'正常';
      kpiHtml += `<table class="report-table">
        <thead><tr>
          <th>成员</th><th>KPI</th><th>状态</th>
        </tr></thead><tbody>`;
      for (const ind of kpi.individuals) {
        kpiHtml += `<tr>
          <td><strong>${esc(ind.name)}</strong></td>
          <td>${esc(ind.kpi)}</td>
          <td><span style="color:${statusColor(ind.status)};font-weight:600;">${statusLabel(ind.status)}</span></td>
        </tr>`;
      }
      kpiHtml += `</tbody></table>`;
    }
    kpiHtml += `</div>`;
    html += kpiHtml;
  }

  // announcements（weekly 专属）
  if (report.announcements && report.announcements.length) {
    let annHtml = `<div class="report-section">
      <h3 class="section-title">📢 公司公告</h3>`;
    for (const a of report.announcements) {
      annHtml += `<div class="decision-card" style="margin-bottom:8px;">
        <strong>${esc(a.title)}</strong>
        ${a.detail ? `<br><span style="color:#555;font-size:13px;">${esc(a.detail)}</span>` : ''}
        ${a.owner ? `<br><span style="color:#879596;font-size:12px;">发布：${esc(a.owner)}</span>` : ''}
      </div>`;
    }
    annHtml += `</div>`;
    html += annHtml;
  }

  // projectReviews（weekly 专属）
  if (report.projectReviews && report.projectReviews.length) {
    for (const pr of report.projectReviews) {
      let prHtml = `<div class="report-section">
        <h3 class="section-title">🗂 ${esc(pr.project)}</h3>`;
      if (pr.progress) {
        prHtml += `<p class="section-text" style="background:#f8f9fa;padding:10px 14px;border-radius:6px;">${esc(pr.progress)}</p>`;
      }
      // highlights + lowlights
      if ((pr.highlights&&pr.highlights.length)||(pr.lowlights&&pr.lowlights.length)) {
        if (pr.highlights) for (const h of pr.highlights) {
          prHtml += `<p style="margin:4px 0;font-size:13px;"><span style="color:#2e7d32;margin-right:6px;">▲</span><strong>${esc(h.point)}</strong>${h.detail?` — <span style="color:#666;">${esc(h.detail)}</span>`:''}</p>`;
        }
        if (pr.lowlights) for (const l of pr.lowlights) {
          prHtml += `<p style="margin:4px 0;font-size:13px;"><span style="color:#e65100;margin-right:6px;">▼</span><strong>${esc(l.point)}</strong>${l.detail?` — <span style="color:#666;">${esc(l.detail)}</span>`:''}</p>`;
        }
      }
      // risks
      if (pr.risks && pr.risks.length) {
        for (const r of pr.risks) {
          prHtml += `<div class="risk-card" style="margin-top:8px;">⚠️ <strong>${esc(r.risk)}</strong>${r.mitigation?`<br><span style="font-size:12px;color:#666;">${esc(r.mitigation)}</span>`:''}</div>`;
        }
      }
      // followUps
      if (pr.followUps && pr.followUps.length) {
        prHtml += `<table class="report-table" style="margin-top:10px;">
          <thead><tr><th>跟进事项</th><th>负责人</th><th>截止</th></tr></thead><tbody>`;
        for (const f of pr.followUps) {
          prHtml += `<tr><td>${esc(f.task)}</td><td>${esc(f.owner||'-')}</td><td>${esc(f.deadline||'-')}</td></tr>`;
        }
        prHtml += `</tbody></table>`;
      }
      prHtml += `</div>`;
      html += prHtml;
    }
  }

  // ---- Topics / Agenda ----
  if (topics.length) {
    html += `
      <div class="card">
        <div class="card-title"><i class="fa fa-comments"></i> Topics Discussed</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th style="color:var(--aws-orange)">Topic</th>
              <th style="color:var(--aws-orange)">Details</th>
              <th style="color:var(--aws-orange)">Outcome</th>
            </tr></thead>
            <tbody>
              ${topics.map(t => {
                if (typeof t === "string") {
                  return `<tr><td colspan="3">${escapeHtml(t)}</td></tr>`;
                }
                return `<tr>
                  <td>${escapeHtml(t.topic || t.title || "")}</td>
                  <td>${escapeHtml(t.details || t.discussion || "")}</td>
                  <td>${escapeHtml(t.outcome || t.conclusion || "")}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ---- Highlights / Lowlights grid ----
  if (highlights.length || lowlights.length) {
    html += `<div class="section-grid">`;

    if (highlights.length) {
      html += `
        <div class="card">
          <div class="card-title"><i class="fa fa-thumb-tack"></i> Highlights</div>
          <ul>${highlights.map(h => `<li class="highlight-item">${escapeHtml(renderListItem(h))}</li>`).join("")}</ul>
        </div>
      `;
    }

    if (lowlights.length) {
      html += `
        <div class="card">
          <div class="card-title"><i class="fa fa-exclamation-triangle"></i> Lowlights</div>
          <ul>${lowlights.map(l => `<li class="lowlight-item">${escapeHtml(renderListItem(l))}</li>`).join("")}</ul>
        </div>
      `;
    }

    html += `</div>`;
  }

  // ---- Action Items ----
  html += `
    <div class="card">
      <div class="card-title"><i class="fa fa-check-square-o"></i> Action Items</div>
      ${actions.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="color:var(--aws-orange)">Task</th>
            <th style="color:var(--aws-orange)">Owner</th>
            <th style="color:var(--aws-orange)">Deadline</th>
            <th style="color:var(--aws-orange)">Priority</th>
          </tr></thead>
          <tbody>
            ${actions.map(a => {
              const prio = (a.priority || "").toLowerCase();
              const prioLabel = a.priority || "-";
              return `<tr>
                <td>${escapeHtml(a.task || a.action || "")}</td>
                <td>${escapeHtml(a.owner || a.assignee || "-")}</td>
                <td>${escapeHtml(a.deadline || a.dueDate || "-")}</td>
                <td><span class="priority-badge priority-${prio}">${escapeHtml(prioLabel)}</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : '<div class="empty-state">No action items</div>'}
    </div>
  `;

  // ---- Key Decisions ----
  if (decisions.length) {
    html += `
      <div class="card decisions-card">
        <div class="card-title"><i class="fa fa-gavel"></i> Key Decisions</div>
        <ul>${decisions.map(d => `<li>${escapeHtml(renderListItem(d))}</li>`).join("")}</ul>
      </div>
    `;
  }

  // ---- Risks / Issues ----
  if (risks.length) {
    html += `
      <div class="card risks-card">
        <div class="card-title"><i class="fa fa-warning"></i> Risks &amp; Issues</div>
        <ul>${risks.map(r => `<li>${escapeHtml(renderListItem(r))}</li>`).join("")}</ul>
      </div>
    `;
  }

  // ---- Participants ----
  {
    const speakerMap = m.speakerMap || {};
    const speakers = (m.speakers || []).map(s => String(s));
    const hasSpkMap = speakers.length > 0;

    html += `
      <div class="card">
        <div class="card-title"><i class="fa fa-users"></i> Participants</div>`;

    if (participants.length > 0) {
      // Show each participant from report, with optional speaker binding
      html += `<div class="participant-list">`;
      participants.forEach((p, idx) => {
        const label = typeof p === "string" ? p : (p.name || JSON.stringify(p));
        // Find if this participant already has a speaker mapping (reverse lookup)
        const boundSpk = Object.entries(speakerMap).find(([,v]) => v === label)?.[0] || "";

        html += `<div class="participant-row">
          <div class="participant-label">${escapeHtml(label)}</div>`;

        if (hasSpkMap) {
          // Speaker binding dropdown
          html += `<select class="form-control speaker-bind-select" data-participant-idx="${idx}"
            data-participant-name="${escapeAttr(label)}" style="max-width:160px;font-size:13px;">
            <option value="">— 对应说话人 —</option>
            ${speakers.map(spk => `<option value="${escapeAttr(spk)}" ${boundSpk === spk ? "selected" : ""}>
              说话人 ${escapeHtml(spk)}${speakerMap[spk] ? " ("+escapeHtml(speakerMap[spk])+")" : ""}
            </option>`).join("")}
          </select>`;
        }
        html += `</div>`;
      });
      html += `</div>`;

      if (hasSpkMap) {
        html += `<div style="text-align:right;margin-top:12px;">
          <button class="btn btn-primary btn-sm" data-action="save-speaker-map" data-id="${escapeAttr(m.meetingId)}">
            <i class="fa fa-save"></i> 保存并重新生成纪要
          </button>
        </div>`;
      }
    } else if (hasSpkMap) {
      // No report participants — fallback to speaker rows
      html += `<div class="speaker-edit-list">
        ${speakers.map(spk => `
          <div class="speaker-edit-row">
            <span class="speaker-label">说话人 ${escapeHtml(spk)}</span>
            <input type="text" class="form-control speaker-name-input" data-speaker="${escapeAttr(spk)}"
              value="${escapeAttr(speakerMap[spk] || '')}" placeholder="填写真实姓名" />
          </div>`).join("")}
      </div>
      <div style="text-align:right;margin-top:12px;">
        <button class="btn btn-primary btn-sm" data-action="save-speaker-map" data-id="${escapeAttr(m.meetingId)}">
          <i class="fa fa-save"></i> 保存并重新生成纪要
        </button>
      </div>`;
    } else {
      html += `<p style="color:rgba(255,255,255,0.4);font-size:13px;">暂无参会人信息</p>`;
    }

    html += `</div>`;
  }

  content.innerHTML = html;

  // Bottom bar
  const bottomBar = document.getElementById("bottom-bar");
  if (bottomBar) {
    bottomBar.innerHTML = `
      <a href="index.html" class="btn btn-outline"><i class="fa fa-arrow-left"></i> Back</a>
      <div class="btn-group">
        <button class="btn btn-outline" data-action="send-email" data-id="${escapeAttr(m.meetingId)}"><i class="fa fa-envelope"></i> Send Email</button>
      </div>
    `;
  }

  // Stop polling when meeting is in a terminal state
  if (["completed", "failed"].includes(status) && window._detailPollingTimer) {
    clearInterval(window._detailPollingTimer);
    window._detailPollingTimer = null;
  }
}

function startDetailEdit(meetingId, currentTitle, currentType) {
  document.getElementById('detail-title-display').style.display = 'none';
  document.getElementById('detail-type-display').style.display = 'none';
  const form = document.getElementById('detail-edit-form');
  form.style.display = 'block';
  const titleInput = document.getElementById('detail-title-input');
  titleInput.value = currentTitle;
  document.getElementById('detail-type-select').value = currentType;
  titleInput.focus();
}

function cancelDetailEdit() {
  document.getElementById('detail-title-display').style.display = '';
  document.getElementById('detail-type-display').style.display = '';
  document.getElementById('detail-edit-form').style.display = 'none';
}

async function saveDetailEdit(meetingId) {
  const title = document.getElementById('detail-title-input').value.trim();
  const meetingType = document.getElementById('detail-type-select').value;
  if (!title) { Toast.error("标题不能为空"); return; }
  try {
    await API.put(`/api/meetings/${meetingId}`, { title, meetingType });
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) { /* error shown by API */ }
}

async function retryMeetingDetail(id) {
  try {
    await API.post(`/api/meetings/${id}/retry`);
    Toast.success("已重新提交处理");
    fetchMeeting(id);
    startPolling();
    // Poll meeting detail
    if (!window._detailPollingTimer) {
      window._detailPollingTimer = setInterval(() => fetchMeeting(id), 12000);
    }
  } catch (_) { /* error already shown by API */ }
}

async function saveSpeakerMap(meetingId) {
  const speakerMap = {};

  // From participant binding dropdowns (participant name → speaker ID mapping)
  document.querySelectorAll('.speaker-bind-select').forEach(sel => {
    const spk = sel.value.trim();
    const name = sel.dataset.participantName;
    if (spk && name) speakerMap[spk] = name;
  });

  // From plain text inputs (fallback mode)
  document.querySelectorAll('.speaker-name-input').forEach(input => {
    const val = input.value.trim();
    if (val) speakerMap[input.dataset.speaker] = val;
  });

  if (Object.keys(speakerMap).length === 0) {
    Toast.error("请先选择说话人对应关系");
    return;
  }

  const btn = document.querySelector('[data-action="save-speaker-map"]');
  if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }

  try {
    await API.put(`/api/meetings/${meetingId}/speaker-map`, { speakerMap });
    Toast.success("已保存并重新生成纪要");
    fetchMeeting(meetingId);
  } catch (_) {
    /* error shown by API */
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "保存并重新生成纪要"; }
  }
}

async function sendEmail(id) {
  try {
    await API.post(`/api/meetings/${id}/send-email`);
    Toast.success("邮件发送已触发");
  } catch (_) { /* error already shown by API */ }
}

/* ===== Glossary ===== */
let glossaryData = [];

async function fetchGlossary() {
  const tbody = document.getElementById("glossary-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="loading">Loading...</td></tr>';

  try {
    glossaryData = await API.get("/api/glossary") || [];
    renderGlossary(glossaryData);
  } catch (_) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Failed to load glossary</td></tr>';
  }
}

function renderGlossary(terms) {
  const tbody = document.getElementById("glossary-tbody");
  if (!terms || terms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fa fa-book"></i>&nbsp;No terms yet</td></tr>';
    return;
  }
  tbody.innerHTML = terms.map(t => {
    const term       = escapeHtml(t.term       || "");
    const aliases    = escapeHtml(t.aliases    || "");
    const definition = escapeHtml(t.definition || "");
    return `<tr>
      <td><strong>${term}</strong></td>
      <td>${aliases}</td>
      <td>${definition}</td>
      <td>
        <div class="btn-group">
          <button class="btn btn-outline btn-sm" data-action="edit-term" data-id="${escapeAttr(t.termId)}"><i class="fa fa-pencil"></i></button>
          <button class="btn btn-danger btn-sm" data-action="delete-term" data-id="${escapeAttr(t.termId)}"><i class="fa fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function filterGlossary(query) {
  const q = query.toLowerCase();
  const filtered = glossaryData.filter(t =>
    (t.term       || "").toLowerCase().includes(q) ||
    (t.aliases    || "").toLowerCase().includes(q) ||
    (t.definition || "").toLowerCase().includes(q)
  );
  renderGlossary(filtered);
}

async function addTerm(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    term:       form.term.value.trim(),
    aliases:    form.aliases.value.trim(),
    definition: form.definition.value.trim(),
  };
  if (!data.term) { Toast.error("Term name is required"); return; }

  try {
    await API.post("/api/glossary", data);
    Toast.success("Term added");
    form.reset();
    fetchGlossary();
  } catch (_) { /* error shown */ }
}

async function deleteTerm(id) {
  if (!confirm("Delete this term?")) return;
  try {
    await API.del(`/api/glossary/${id}`);
    Toast.success("Term deleted");
    fetchGlossary();
  } catch (_) {}
}

function editTerm(id) {
  const term = glossaryData.find(t => t.termId === id);
  if (!term) return;

  const overlay = document.getElementById("edit-modal");
  if (!overlay) return;

  document.getElementById("edit-term").value       = term.term       || "";
  document.getElementById("edit-aliases").value    = term.aliases    || "";
  document.getElementById("edit-definition").value = term.definition || "";
  overlay.dataset.termId = id;
  overlay.classList.add("show");
}

async function saveEditTerm(e) {
  e.preventDefault();
  const overlay = document.getElementById("edit-modal");
  const id = overlay.dataset.termId;

  const data = {
    term:       document.getElementById("edit-term").value.trim(),
    aliases:    document.getElementById("edit-aliases").value.trim(),
    definition: document.getElementById("edit-definition").value.trim(),
  };

  try {
    await API.put(`/api/glossary/${id}`, data);
    Toast.success("Term updated");
    overlay.classList.remove("show");
    fetchGlossary();
  } catch (_) {}
}

function closeModal() {
  const overlay = document.getElementById("edit-modal");
  if (overlay) overlay.classList.remove("show");
}

/* ===== Merge Selection ===== */
function getSelectedMeetingIds() {
  return Array.from(document.querySelectorAll('.merge-checkbox:checked')).map(cb => cb.dataset.id);
}

function updateMergeSelection() {
  const ids = getSelectedMeetingIds();
  let bar = document.getElementById('merge-action-bar');
  if (ids.length >= 2) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'merge-action-bar';
      bar.className = 'merge-action-bar';
      document.body.appendChild(bar);
    }
    bar.innerHTML = `
      <span>已选 <strong>${ids.length}</strong> 个会议</span>
      <button class="btn btn-primary" data-action="open-merge-modal">合并生成报告</button>
    `;
    bar.style.display = 'flex';
  } else {
    if (bar) bar.style.display = 'none';
  }
}

function openMergeModal() {
  const ids = getSelectedMeetingIds();
  if (ids.length < 2) { Toast.error("请至少选择 2 个会议"); return; }

  // Build meeting list for display
  const selectedMeetings = ids.map(id => {
    const m = allMeetings.find(mt => mt.meetingId === id);
    return m ? escapeHtml(m.title || m.meetingId) : id;
  });

  let overlay = document.getElementById('merge-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'merge-modal';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal" style="max-width:560px;">
      <h3><i class="fa fa-object-group"></i> 合并生成报告</h3>
      <div style="margin-bottom:16px;">
        <div style="font-size:13px;font-weight:600;color:#232F3E;margin-bottom:8px;">已选会议（${ids.length}）</div>
        <ul style="list-style:none;padding:0;max-height:150px;overflow-y:auto;">
          ${selectedMeetings.map(t => `<li style="padding:4px 0;font-size:13px;border-bottom:1px solid #e8edf2;">${t}</li>`).join('')}
        </ul>
      </div>
      <div class="form-group">
        <label for="merge-custom-prompt">自定义提示词（可选）</label>
        <textarea id="merge-custom-prompt" class="form-control" rows="3" placeholder="例：总结本周项目进展，重点关注风险和 action items"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-merge-modal">取消</button>
        <button class="btn btn-primary" id="merge-submit-btn" data-action="submit-merge"><i class="fa fa-magic"></i> 生成报告</button>
      </div>
    </div>
  `;
  overlay.classList.add('show');
}

function closeMergeModal() {
  const overlay = document.getElementById('merge-modal');
  if (overlay) overlay.classList.remove('show');
}

async function submitMerge() {
  const ids = getSelectedMeetingIds();
  const customPrompt = (document.getElementById('merge-custom-prompt') || {}).value || '';
  const btn = document.getElementById('merge-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }

  try {
    await API.post('/api/meetings/merge', { meetingIds: ids, customPrompt: customPrompt.trim() || undefined });
    Toast.success('合并报告生成中');
    closeMergeModal();
    // Uncheck all checkboxes
    document.querySelectorAll('.merge-checkbox:checked').forEach(cb => { cb.checked = false; });
    updateMergeSelection();
    fetchMeetings();
  } catch (_) {
    /* error shown by API */
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-magic"></i> 生成报告'; }
  }
}

/* ===== Utils ===== */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(String(str))
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ===== Event Delegation (replaces inline onclick for CSP compliance) ===== */
document.addEventListener("click", function(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case "delete-meeting":     deleteMeeting(id); break;
    case "retry-meeting":      retryMeeting(id); break;
    case "start-card-edit":    startCardEdit(id, el.dataset.title, el.dataset.type); break;
    case "save-card-edit":     saveCardEdit(id); break;
    case "cancel-card-edit":   cancelCardEdit(); break;
    case "retry-detail":       retryMeetingDetail(id); break;
    case "start-detail-edit":  startDetailEdit(id, el.dataset.title, el.dataset.type); break;
    case "save-detail-edit":   saveDetailEdit(id); break;
    case "cancel-detail-edit": cancelDetailEdit(); break;
    case "save-speaker-map":   saveSpeakerMap(id); break;
    case "send-email":         sendEmail(id); break;
    case "edit-term":          editTerm(id); break;
    case "delete-term":        deleteTerm(id); break;
    case "open-merge-modal":   openMergeModal(); break;
    case "close-merge-modal":  closeMergeModal(); break;
    case "submit-merge":       submitMerge(); break;
    case "close-modal":        closeModal(); break;
  }
});

/* checkbox change → merge selection */
document.addEventListener("change", function(e) {
  if (e.target.classList.contains("merge-checkbox")) {
    updateMergeSelection();
  }
});

/* ===== Init (moved from inline script to avoid CSP violation) ===== */
document.addEventListener("DOMContentLoaded", function() {
  const meetingId = getParam("id");
  if (meetingId) {
    // meeting.html — detail page
    fetchMeeting(meetingId);
    window._detailPollingTimer = setInterval(() => fetchMeeting(meetingId), 12000);
  } else if (document.getElementById("upload-area")) {
    // index.html — list page
    initUpload();
    initFilter();
    fetchMeetings();
  } else if (document.getElementById("glossary-tbody")) {
    // glossary.html
    loadGlossary();
  }
});
