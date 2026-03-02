/* ===== Utility: HTML escaping ===== */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function getParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

/* ===== Random Fun Messages ===== */
const FunMessages = {
  uploading: [
    "音频收到啦，稍等片刻～",
    "正在认真听录音，请喝杯茶 ☕",
    "AI 正在开小差……不对，在努力工作 🤖",
    "文件已就位，后台全力处理中 ⚡",
    "比你想的快，比你想的慢，正在处理 🎯",
    "已收到！正在施展魔法 ✨"
  ],
  processing: [
    "音频收到啦，稍等片刻～",
    "正在认真听录音，请喝杯茶 ☕",
    "AI 正在开小差……不对，在努力工作 🤖",
    "文件已就位，后台全力处理中 ⚡",
    "比你想的快，比你想的慢，正在处理 🎯",
    "已收到！正在施展魔法 ✨"
  ],
  error: [
    "这次遇到点小麻烦，稍后再试试？🔧"
  ],

  random(category) {
    const messages = this[category] || this.uploading;
    return messages[Math.floor(Math.random() * messages.length)];
  }
};

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
      Toast.error(err.message || "网络错误");
      throw err;
    }
  },

  get(url)          { return this.request(url); },
  post(url, data)   { return this.request(url, { method: "POST", body: JSON.stringify(data) }); },
  put(url, data)    { return this.request(url, { method: "PUT", body: JSON.stringify(data) }); },
  patch(url, data)  { return this.request(url, { method: "PATCH", body: JSON.stringify(data) }); },
  del(url)          { return this.request(url, { method: "DELETE" }); },
};

/* ===== Date Formatting ===== */
function formatDeadline(raw) {
  if (!raw || raw === "-") return "-";
  var d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d.getFullYear() + "/" + String(d.getMonth()+1).padStart(2,"0") + "/" + String(d.getDate()).padStart(2,"0");
  }
  return raw;
}

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
      const title = (m.title || "未命名会议").toLowerCase();
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
      list.innerHTML = '<div class="loading">加载中...</div>';
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="loading">加载中...</td></tr>';
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
      list.innerHTML = '<div class="empty-state">加载会议失败</div>';
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">加载会议失败</td></tr>';
    }
  }
}

function statusBadge(status) {
  const labels = {
    pending: "等待中", created: "已创建",
    transcribed: "已转录", transcribing: "转录中",
    reported: "已生成", processing: "处理中",
    completed: "已完成", failed: "失败"
  };
  const label = labels[status] || status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

/* Card view for meeting list */
function meetingCard(m) {
  const title  = escapeHtml(m.title || "未命名会议");
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
  const errorMsg = (status === "failed")
    ? `<div style="font-size:12px;color:#d32f2f;margin-top:4px;">处理遇到问题，请稍后重试 🔧</div>`
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
    <div class="row-actions">
      <button class="btn btn-outline btn-sm" data-action="start-card-edit" data-id="${escapeAttr(id)}" data-title="${escapeAttr(m.title || "未命名会议")}" data-type="${escapeAttr(mType)}" title="编辑"><i class="fa fa-pencil"></i></button>
      
      ${retryBtn}
      <button class="btn btn-danger btn-sm" data-action="delete-meeting" data-id="${escapeAttr(id)}" title="删除"><i class="fa fa-trash"></i></button>
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
      <button class="btn action-primary-btn btn-sm" data-action="save-card-edit" data-id="${escapeAttr(id)}">确认</button>
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
  const title = escapeHtml(m.title || "未命名会议");
  const time = m.createdAt ? new Date(m.createdAt).toLocaleString("zh-CN") : "-";
  const status = m.status || "pending";

  return `<tr>
    <td><a href="meeting.html?id=${encodeURIComponent(m.meetingId)}">${title}</a></td>
    <td>${time}</td>
    <td>${statusBadge(status)}</td>
    <td>
      <div class="row-actions" style="opacity:1;">
        
        <button class="btn btn-danger btn-sm" data-action="delete-meeting" data-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
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

/* ===== Custom Confirm Dialog ===== */
function showConfirm({ title = "确认删除", body = "确认要删除这条记录吗？", onOk }) {
  const overlay = document.getElementById("confirm-modal");
  if (!overlay) { if (window.confirm(body)) onOk(); return; }
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-body").innerHTML = body;
  overlay.style.display = "flex";

  const okBtn = document.getElementById("confirm-ok-btn");
  const cancelBtn = document.getElementById("confirm-cancel-btn");

  function close() {
    overlay.style.display = "none";
    okBtn.replaceWith(okBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  }
  document.getElementById("confirm-ok-btn").addEventListener("click", function() { close(); onOk(); }, { once: true });
  document.getElementById("confirm-cancel-btn").addEventListener("click", close, { once: true });
  overlay.addEventListener("click", function(e) { if (e.target === overlay) close(); }, { once: true });
}

async function deleteMeeting(id) {
  // find meeting title from rendered card
  const card = document.querySelector(`[data-id="${id}"]`);
  const titleEl = card && card.closest(".meeting-card, tr")
    && (card.closest(".meeting-card, tr").querySelector("h3, .meeting-title, td:first-child") || card);
  const name = titleEl ? titleEl.textContent.trim().split("\n")[0].trim() : id;

  showConfirm({
    title: "确认删除会议",
    body: `确认要删除会议 <strong>「${name}」</strong> 吗？<br><span style="font-size:12px;opacity:0.5;">此操作不可撤销</span>`,
    onOk: async () => {
      try {
        await API.del(`/api/meetings/${id}`);
        Toast.success("会议已删除");
        fetchMeetings();
      } catch (_) { /* error already shown by API */ }
    }
  });
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
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      uploadMultipleFiles(files);
    }
  });

  input.addEventListener("change", () => {
    const files = Array.from(input.files);
    if (files.length > 0) {
      uploadMultipleFiles(files);
    }
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
    Toast.error("请上传 MP4、MP3 或 OGG 格式文件");
    return;
  }

  const progress = document.getElementById("upload-progress");
  const bar      = document.getElementById("progress-bar");
  const text     = document.getElementById("progress-text");

  progress.classList.add("show");
  bar.style.width = "0%";
  const uploadingMsg = FunMessages.random("uploading");
  text.textContent = uploadingMsg;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", file.name.replace(/\.[^.]+$/, ""));

  // Support both pill radio and legacy select for meeting type
  const radioChecked = document.querySelector('input[name="meetingType"]:checked');
  const selectEl     = document.getElementById("meetingType");
  const meetingType  = radioChecked ? radioChecked.value : (selectEl ? selectEl.value : "general");
  formData.append("meetingType", meetingType);

  // Recipient emails - 统一发到默认收件人，不从前端传入

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/meetings/upload");

    xhr.upload.addEventListener("progress", e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + "%";
        text.textContent = `${uploadingMsg} ${pct}%`;
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
    text.textContent = "上传完成！";
    setTimeout(() => {
      progress.classList.remove("show");
    }, 500);

    // 弹出确认弹窗
    showUploadConfirmDialog(result.meetingId, result.title, result.meetingType);
  } catch (err) {
    const processingMsg = FunMessages.random("processing");
    text.textContent = processingMsg;
    Toast.success(processingMsg + "，请等待几分钟后刷新页面查看结果");
    setTimeout(() => progress.classList.remove("show"), 3000);
  }
}

async function uploadMultipleFiles(files) {
  // 1 个文件：走单文件路由
  if (files.length === 1) {
    await uploadFile(files[0]);
    return;
  }

  // 多个文件：走批量上传路由
  const validTypes = [
    "video/mp4", "audio/mpeg", "audio/mp3", "audio/mp4", "video/quicktime",
    "audio/ogg", "application/ogg", "audio/x-ogg", "video/ogg", "application/x-ogg", "audio/vorbis"
  ];

  // 验证所有文件
  for (const file of files) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!validTypes.includes(file.type) && !["mp4", "mp3", "m4a", "ogg", "oga", "ogv"].includes(ext)) {
      Toast.error(`文件 ${file.name} 格式不支持`);
      return;
    }
  }

  if (files.length > 10) {
    Toast.error("最多支持 10 个文件");
    return;
  }

  const progress = document.getElementById("upload-progress");
  const bar      = document.getElementById("progress-bar");
  const text     = document.getElementById("progress-text");

  progress.classList.add("show");
  bar.style.width = "0%";
  const uploadingMsg = FunMessages.random("uploading");
  text.textContent = uploadingMsg;

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  // 获取会议类型
  const radioChecked = document.querySelector('input[name="meetingType"]:checked');
  const selectEl     = document.getElementById("meetingType");
  const meetingType  = radioChecked ? radioChecked.value : (selectEl ? selectEl.value : "general");
  formData.append("meetingType", meetingType);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/meetings/upload-multiple");

    xhr.upload.addEventListener("progress", e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + "%";
        text.textContent = `${uploadingMsg} ${pct}%`;
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
    const mergingMsg = FunMessages.random("processing");
    text.textContent = mergingMsg;

    // 等待几秒显示合并状态
    await new Promise(resolve => setTimeout(resolve, 1000));

    text.textContent = "上传完成！";
    setTimeout(() => {
      progress.classList.remove("show");
    }, 500);

    // 弹出确认弹窗
    showUploadConfirmDialog(result.meetingId, result.title, result.meetingType);
  } catch (err) {
    const processingMsg = FunMessages.random("processing");
    text.textContent = processingMsg;
    Toast.success(processingMsg + "，请等待几分钟后刷新页面查看结果");
    setTimeout(() => progress.classList.remove("show"), 3000);
  }
}

/* ===== Upload Confirm Dialog ===== */
function showUploadConfirmDialog(meetingId, title, meetingType) {
  const modal = document.getElementById("upload-confirm-modal");
  const titleInput = document.getElementById("upload-confirm-title");
  const okBtn = document.getElementById("upload-confirm-ok-btn");
  const cancelBtn = document.getElementById("upload-confirm-cancel-btn");

  // 预填信息
  titleInput.value = title || "";
  const typeRadio = document.getElementById(`uc-mt-${meetingType || "general"}`);
  if (typeRadio) typeRadio.checked = true;

  modal.style.display = "flex";

  // 移除旧的事件监听器（避免重复绑定）
  const newOkBtn = okBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  // 确认：更新信息并开始转录
  newOkBtn.addEventListener("click", async () => {
    const newTitle = titleInput.value.trim();
    const newType = document.querySelector('input[name="uploadConfirmMeetingType"]:checked')?.value || "general";

    modal.style.display = "none";

    try {
      // 更新会议信息
      await API.put(`/api/meetings/${meetingId}`, { title: newTitle, meetingType: newType });

      // 开始转录
      await API.post(`/api/meetings/${meetingId}/start-transcription`);

      Toast.success("转录已开始");
      fetchMeetings();
    } catch (err) {
      const processingMsg = FunMessages.random("processing");
      Toast.success(processingMsg + "，请等待几分钟后刷新页面查看结果");
    }
  });

  // 取消：删除记录
  newCancelBtn.addEventListener("click", async () => {
    modal.style.display = "none";

    try {
      await API.delete(`/api/meetings/${meetingId}`);
      Toast.success("已取消上传");
      fetchMeetings();
    } catch (err) {
      Toast.error("删除记录失败: " + err.message);
    }
  });
}

/* ===== Meeting Detail ===== */
async function fetchMeeting(id) {
  const content = document.getElementById("meeting-content");
  if (!content) return;
  // Only show loading spinner on first load
  if (!content.dataset.loaded) {
    content.innerHTML = '<div class="loading">加载中...</div>';
  }
  try {
    const m = await API.get(`/api/meetings/${id}`);
    renderMeetingDetail(m);
    content.dataset.loaded = "1";
  } catch (err) {
    console.error("fetchMeeting error:", err);
    content.innerHTML = '<div class="empty-state">加载会议详情失败，请刷新页面重试</div>';
  }
}

function renderListItem(item) {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    return item.point || item.content || item.description
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
  const decisions   = report.decisions   || []; // key_decisions is legacy, report-worker normalizes on ingest
  const risks       = report.risks       || report.issues || [];
  const participants= report.participants || [];
  const topics      = report.topics      || [];
  const summary     = report.summary     || "暂无摘要";
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
        <div style="font-size:13px;color:#d32f2f;margin-bottom:12px;">处理遇到问题，请稍后重试或联系管理员</div>
        <button class="btn" style="border:1px solid #FF9900;color:#FF9900;background:transparent;font-size:13px;padding:6px 16px;border-radius:4px;cursor:pointer;" data-action="retry-detail" data-id="${escapeAttr(m.meetingId)}">🔄 重试</button>
      </div>`;
    }
  }

  // ---- Header (Cloudscape style) ----
  const meetingTypeLabel = { weekly: "周会", general: "通用", tech: "技术", customer: "客户", merged: "合并" };
  const currentType = m.meetingType || "general";
  let html = `
    <div class="meeting-detail-header">
      <div class="detail-header-top">
        <div class="brand">&#9670; 会议纪要</div>
        <div class="detail-header-actions">
          <button class="btn action-primary-btn btn-sm" data-action="regenerate-report" data-id="${escapeAttr(m.meetingId)}">
            <i class="fa fa-refresh"></i> 重新生成
          </button>
          <button class="btn action-primary-btn btn-sm" data-action="send-email" data-id="${escapeAttr(m.meetingId)}">
            <i class="fa fa-envelope"></i> 发送邮件
          </button>
        </div>
      </div>
      <div class="detail-title-row" style="display:flex;align-items:center;gap:10px;">
        <h1 id="detail-title-display">${title}</h1>
        <span class="badge" style="background:rgba(255,153,0,0.2);color:#FF9900;font-size:11px;" id="detail-type-display">${escapeHtml(meetingTypeLabel[currentType] || currentType)}</span>
        <button class="btn btn-sm" style="background:transparent;border:1px solid rgba(255,255,255,0.3);color:#fff;cursor:pointer;" data-action="start-detail-edit" data-id="${escapeAttr(m.meetingId)}" data-title="${escapeAttr(m.title || m.meetingId)}" data-type="${escapeAttr(currentType)}" title="编辑">&#9999;&#65039;</button>
        <button class="btn btn-sm auto-name-btn" data-action="auto-name" data-id="${escapeAttr(m.meetingId)}" data-title="${escapeAttr(m.title || m.meetingId)}" data-type="${escapeAttr(currentType)}" title="自动生成会议名称">&#10024;</button>
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
          <button class="btn action-primary-btn btn-sm" data-action="save-detail-edit" data-id="${escapeAttr(m.meetingId)}">保存</button>
          <button class="btn btn-outline btn-sm" style="color:#fff;border-color:rgba(255,255,255,0.3);" data-action="cancel-detail-edit">取消</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        ${statusBadge(status)}
      </div>
      ${stageHtml}
    </div>

    <div class="meeting-meta-bar">
      <div class="meta-item"><strong>日期</strong>${time}</div>
      <div class="meta-item"><strong>时长</strong>${escapeHtml(String(duration))}</div>
      <div class="meta-item"><strong>参会人数</strong>${participants.length || "-"}</div>
      <div class="meta-item"><strong>会议 ID</strong>${escapeHtml(m.meetingId || "-")}</div>
    </div>

    <div class="detail-header-actions" style="display:none"></div>
  `;

  // ---- Summary ----
  html += `
    <div class="card summary-card" id="section-summary">
      <div class="card-title">
        <span><i class="fa fa-file-text-o"></i> 会议摘要</span>
        <div class="card-title-actions">
          <button class="btn btn-sm section-edit-btn" data-action="edit-section" data-section="summary" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑">&#9999;&#65039;</button>
        </div>
      </div>
      <div class="summary-text" id="summary-display">${escapeHtml(summary)}</div>
      <div id="summary-editor" style="display:none;">
        <textarea class="form-control" id="summary-textarea" rows="6" style="width:100%;box-sizing:border-box;border:2px solid #FF9900;border-radius:4px;padding:10px;font-size:14px;">${escapeHtml(summary)}</textarea>
        <div style="text-align:right;margin-top:8px;">
          <button class="btn btn-outline btn-sm" data-action="cancel-section-edit" data-section="summary">取消</button>
          <button class="btn action-primary-btn btn-sm" data-action="save-section" data-section="summary" data-meeting-id="${escapeAttr(m.meetingId)}">保存</button>
        </div>
      </div>
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
                <td>${formatDeadline(c.deadline || "-")}</td>
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
                <td>${formatDeadline(ns.deadline || "-")}</td>
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
      <h3 class="section-title">📢 公司公告</h3>
      <div id="announcements-container"></div>
    </div>`;
    html += annHtml;
  }

  // projectReviews（weekly 专属）
  if (report.projectReviews && report.projectReviews.length) {
    for (const pr of report.projectReviews) {
      const prIndex = report.projectReviews.indexOf(pr);
      let prHtml = `<div class="report-section">
        <h3 class="section-title" id="pr-project-${prIndex}" style="display:flex;align-items:center;gap:8px;">
          <span>🗂 ${esc(pr.project)}</span>
          <button class="btn btn-outline btn-sm" data-action="edit-project" data-pr-index="${prIndex}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑项目名称"><i class="fa fa-pencil"></i></button>
        </h3>`;
      if (pr.progress) {
        prHtml += `<div id="pr-progress-${prIndex}" style="position:relative;">
          <p class="section-text" style="background:#f8f9fa;padding:10px 14px;border-radius:6px;">${esc(pr.progress)}</p>
          <button class="btn btn-outline btn-sm" data-action="edit-progress" data-pr-index="${prIndex}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑进展" style="position:absolute;top:8px;right:8px;"><i class="fa fa-pencil"></i></button>
        </div>`;
      }
      // highlights & lowlights
      prHtml += `<div id="pr-highlights-container-${prIndex}"></div>`;
      prHtml += `<div id="pr-lowlights-container-${prIndex}"></div>`;

      // risks
      prHtml += `<div id="pr-risks-container-${prIndex}"></div>`;

      // followUps
      prHtml += `<div id="pr-followups-container-${prIndex}"></div>`;
      prHtml += `</div>`;
      html += prHtml;
    }
  }

  // ---- Topics / Agenda ----
  if (topics.length) {
    html += `
      <div class="card">
        <div class="card-title"><i class="fa fa-comments"></i> 讨论议题</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th style="color:var(--aws-orange)">议题</th>
              <th style="color:var(--aws-orange)">讨论内容</th>
              <th style="color:var(--aws-orange)">结论</th>
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
  html += `<div class="section-grid">`;

  html += `
    <div class="card" id="section-highlights">
      <div class="card-title"><i class="fa fa-thumb-tack"></i> 亮点</div>
      <div id="highlights-container"></div>
    </div>
  `;

  html += `
    <div class="card" id="section-lowlights">
      <div class="card-title"><i class="fa fa-exclamation-triangle"></i> 待改进</div>
      <div id="lowlights-container"></div>
    </div>
  `;

  html += `</div>`;

  // ---- Action Items ----
  html += `
    <div class="card" id="section-actions">
      <div class="card-title">
        <span><i class="fa fa-check-square-o"></i> 待办事项</span>
      </div>
      <div id="actions-container"></div>
    </div>
  `;

  // ---- Key Decisions ----
  html += `
    <div class="card decisions-card" id="section-decisions">
      <div class="card-title">
        <span><i class="fa fa-gavel"></i> 关键决策</span>
      </div>
      <div id="decisions-container"></div>
    </div>
  `;

  // ---- Risks / Issues ----
  if (risks.length) {
    html += `
      <div class="card risks-card">
        <div class="card-title"><i class="fa fa-warning"></i> 风险与问题</div>
        <ul>${risks.map(r => `<li>${escapeHtml(renderListItem(r))}</li>`).join("")}</ul>
      </div>
    `;
  }

  // ---- Participants ----
  {
    const speakerMap = m.speakerMap || {};

    html += `
      <div class="card">
        <div class="card-title"><i class="fa fa-users"></i> 参会人员</div>`;

    if (participants.length > 0) {
      html += `
        <div class="participant-list">`;

      participants.forEach((p, idx) => {
        const rawLabel = typeof p === "string" ? p : (p.name || JSON.stringify(p));
        // Clean up label: remove noise phrases like "角色未明确", "角色不明", "未知"
        const noisePatterns = ["角色未明确", "角色不明", "角色未知", "身份未知", "未知角色", "角色不详"];
        let label = rawLabel;
        // If label contains noise in parentheses, strip that part: "成员A（角色未明确）" → "成员A"
        noisePatterns.forEach(noise => {
          label = label.replace(new RegExp(`（[^）]*${noise}[^）]*）`, "g"), "");
          label = label.replace(new RegExp(`\\([^)]*${noise}[^)]*\\)`, "g"), "");
        });
        label = label.trim().replace(/[，,。.、]+$/, "").trim();
        if (!label) label = rawLabel; // fallback to original if fully stripped

        // existing real name if already saved (keyed by label or by index)
        const savedName = speakerMap[rawLabel] || speakerMap[label] || speakerMap[String(idx)] || "";

        html += `<div class="participant-row">
          <div class="participant-label">${escapeHtml(label)}</div>
          <div class="participant-search-wrap">
            <input type="text"
              class="form-control participant-name-input participant-search-input"
              data-participant-label="${escapeAttr(rawLabel)}"
              value="${escapeAttr(savedName)}"
              placeholder="输入真实姓名（可从词汇表选择）" />
            <div class="name-suggestions" style="display:none;"></div>
          </div>
          <div class="row-actions">
            <button class="btn btn-outline btn-sm" data-action="el-edit" data-section="participants" data-index="${idx}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
            <button class="btn btn-danger btn-sm" data-action="el-delete" data-section="participants" data-index="${idx}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
          </div>
        </div>`;
      });

      html += `</div>
        <div style="text-align:right;margin-top:12px;">
          <button class="btn action-primary-btn btn-sm" data-action="save-speaker-map" data-id="${escapeAttr(m.meetingId)}">
            <i class="fa fa-save"></i> 保存名字
          </button>
        </div>`;
    } else {
      html += `<p style="color:#888;font-size:13px;">暂无参会人信息</p>`;
    }

    html += `</div>`;
  }

  content.innerHTML = html;

  // Store report data for inline editing
  storeReportData(m.meetingId, report);

  // Render editable lists using unified framework
  renderEditableList(
    'highlights-container',
    highlights.map(h => renderListItem(h)),
    {
      fields: [{ key: 'text', label: '内容', type: 'text', required: true }],
      addLabel: '添加亮点',
      emptyText: '暂无亮点'
    },
    m.meetingId,
    'highlights'
  );

  renderEditableList(
    'lowlights-container',
    lowlights.map(l => renderListItem(l)),
    {
      fields: [{ key: 'text', label: '内容', type: 'text', required: true }],
      addLabel: '添加待改进',
      emptyText: '暂无待改进项'
    },
    m.meetingId,
    'lowlights'
  );

  // Render actions
  renderEditableList(
    'actions-container',
    actions,
    {
      fields: [
        { key: 'task', label: '任务', type: 'text', required: true },
        { key: 'owner', label: '负责人', type: 'text' },
        { key: 'deadline', label: '截止日期', type: 'text' },
        { key: 'priority', label: '优先级', type: 'text' }
      ],
      addLabel: '添加待办事项',
      emptyText: '暂无待办事项'
    },
    m.meetingId,
    'actions'
  );

  // Render decisions
  renderEditableList(
    'decisions-container',
    decisions.map(d => renderListItem(d)),
    {
      fields: [{ key: 'decision', label: '决策内容', type: 'text', required: true }],
      addLabel: '添加决策',
      emptyText: '暂无关键决策'
    },
    m.meetingId,
    'decisions'
  );

  // Render announcements (weekly only)
  if (report.announcements && report.announcements.length) {
    renderEditableList(
      'announcements-container',
      report.announcements,
      {
        fields: [
          { key: 'title', label: '标题', type: 'text', required: true },
          { key: 'detail', label: '详情', type: 'textarea' },
          { key: 'owner', label: '发布人', type: 'text' }
        ],
        addLabel: '添加公告',
        emptyText: '暂无公告'
      },
      m.meetingId,
      'announcements'
    );
  }

  // Render projectReviews nested fields (weekly only)
  if (report.projectReviews && report.projectReviews.length) {
    report.projectReviews.forEach((pr, prIndex) => {
      // Highlights
      if (document.getElementById(`pr-highlights-container-${prIndex}`)) {
        renderEditableList(
          `pr-highlights-container-${prIndex}`,
          pr.highlights || [],
          {
            fields: [{ key: 'point', label: '亮点', type: 'text', required: true }, { key: 'detail', label: '详情', type: 'textarea' }],
            addLabel: '添加亮点',
            emptyText: '暂无亮点'
          },
          m.meetingId,
          'highlights',
          prIndex
        );
      }

      // Lowlights
      if (document.getElementById(`pr-lowlights-container-${prIndex}`)) {
        renderEditableList(
          `pr-lowlights-container-${prIndex}`,
          pr.lowlights || [],
          {
            fields: [{ key: 'point', label: '待改进', type: 'text', required: true }, { key: 'detail', label: '详情', type: 'textarea' }],
            addLabel: '添加待改进',
            emptyText: '暂无待改进项'
          },
          m.meetingId,
          'lowlights',
          prIndex
        );
      }

      // Risks
      if (document.getElementById(`pr-risks-container-${prIndex}`)) {
        renderEditableList(
          `pr-risks-container-${prIndex}`,
          pr.risks || [],
          {
            fields: [
              { key: 'risk', label: '风险', type: 'text', required: true },
              { key: 'mitigation', label: '应对措施', type: 'textarea' }
            ],
            addLabel: '添加风险',
            emptyText: '暂无风险'
          },
          m.meetingId,
          'risks',
          prIndex
        );
      }

      // FollowUps
      if (document.getElementById(`pr-followups-container-${prIndex}`)) {
        renderEditableList(
          `pr-followups-container-${prIndex}`,
          pr.followUps || [],
          {
            fields: [
              { key: 'task', label: '跟进事项', type: 'text', required: true },
              { key: 'owner', label: '负责人', type: 'text' },
              { key: 'deadline', label: '截止', type: 'text' }
            ],
            addLabel: '添加跟进',
            emptyText: '暂无跟进事项'
          },
          m.meetingId,
          'followUps',
          prIndex
        );
      }
    });
  }

  // Bind custom name search dropdown for participant inputs
  initParticipantNameSearch();

  // Bottom bar - 只保留返回按钮
  const bottomBar = document.getElementById("bottom-bar");
  if (bottomBar) {
    bottomBar.innerHTML = `
      <a href="index.html" class="btn btn-outline"><i class="fa fa-arrow-left"></i> 返回</a>
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

async function autoNameMeeting(id, btn) {
  btn.disabled = true;
  btn.style.animation = "spin 1s linear infinite";
  try {
    const data = await API.post(`/api/meetings/${id}/auto-name`);
    if (data && data.suggestedName) {
      startDetailEdit(id, btn.dataset.title, btn.dataset.type);
      document.getElementById('detail-title-input').value = data.suggestedName;
      Toast.success("已生成建议名称，确认后请点击保存");
    }
  } catch (_) { /* error shown by API */ }
  btn.disabled = false;
  btn.style.animation = "";
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

  // From participant name inputs (label → real name)
  document.querySelectorAll('.participant-name-input').forEach(input => {
    const val = input.value.trim();
    if (val) speakerMap[input.dataset.participantLabel] = val;
  });

  // Fallback: plain speaker inputs
  document.querySelectorAll('.speaker-name-input').forEach(input => {
    const val = input.value.trim();
    if (val) speakerMap[input.dataset.speaker] = val;
  });

  if (Object.keys(speakerMap).length === 0) {
    Toast.error("请先填写至少一个真实姓名");
    return;
  }

  var btn = document.querySelector('[data-action="save-speaker-map"]');
  if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }

  try {
    await API.put(`/api/meetings/${meetingId}/speaker-names`, { speakerMap });
    Toast.success("名字已保存");
    applyNameMapping(speakerMap);
  } catch (_) {
    /* error shown by API */
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-save"></i> 保存名字'; }
  }
}

function applyNameMapping(speakerMap) {
  // Build a lookup: extract the prefix before "（" from each key
  // e.g. "成员A（佳园，...）" → prefix "成员A", value "家园"
  var mappings = [];
  Object.keys(speakerMap).forEach(function(key) {
    var value = speakerMap[key];
    if (!value) return;
    var prefix = key.split("（")[0].split("(")[0].trim();
    mappings.push({ key: key, prefix: prefix, value: value });
  });

  // Replace participant labels
  document.querySelectorAll('.participant-label').forEach(function(el) {
    var text = el.textContent;
    mappings.forEach(function(m) {
      if (text === m.key || text.indexOf(m.prefix) === 0) {
        el.textContent = m.value;
      }
    });
  });

  // Replace action items owner cells (2nd column in action items table)
  document.querySelectorAll('.card').forEach(function(card) {
    var title = card.querySelector('.card-title');
    if (!title) return;
    var titleText = title.textContent;

    // Action Items table
    if (titleText.indexOf('Action Items') !== -1) {
      card.querySelectorAll('tbody td:nth-child(2)').forEach(function(td) {
        var ownerText = td.textContent;
        mappings.forEach(function(m) {
          if (ownerText.indexOf(m.prefix) !== -1) {
            td.textContent = ownerText.replace(m.prefix, m.value);
          }
        });
      });
    }

    // Key Decisions list items — replace owner references
    if (titleText.indexOf('Decisions') !== -1 || titleText.indexOf('Risks') !== -1) {
      card.querySelectorAll('li').forEach(function(li) {
        var text = li.textContent;
        mappings.forEach(function(m) {
          if (text.indexOf(m.prefix) !== -1) {
            // Preserve the ::before pseudo element by only replacing inner text
            li.textContent = text.split(m.prefix).join(m.value);
          }
        });
      });
    }
  });

  // Replace in summary text
  var summaryEl = document.querySelector('.summary-text');
  if (summaryEl) {
    var summaryText = summaryEl.textContent;
    mappings.forEach(function(m) {
      if (summaryText.indexOf(m.prefix) !== -1) {
        summaryText = summaryText.split(m.prefix).join(m.value);
      }
    });
    summaryEl.textContent = summaryText;
  }
}

async function regenerateReport(meetingId) {
  var btn = document.querySelector('[data-action="regenerate-report"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-refresh fa-spin"></i> 生成中…'; }

  try {
    await API.post(`/api/meetings/${meetingId}/regenerate`);
    Toast.success("纪要已重新生成");
    fetchMeeting(meetingId);
  } catch (_) {
    /* error shown by API */
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-refresh"></i> 重新生成纪要'; }
  }
}

async function sendEmail(id) {
  if (_sendingEmailMeetingIds.has(id)) return;
  _sendingEmailMeetingIds.add(id);
  setSendEmailButtonsLoading(id, true);
  try {
    await API.post(`/api/meetings/${id}/send-email`);
    Toast.success("邮件发送已触发");
  } catch (_) { /* error already shown by API */ }
  finally {
    _sendingEmailMeetingIds.delete(id);
    setSendEmailButtonsLoading(id, false);
  }
}

/* ===== Glossary ===== */
let glossaryData = [];
let _glossaryCache = null;
let _glossaryCacheTime = 0;
const GLOSSARY_CACHE_TTL = 5 * 60 * 1000;
const _sendingEmailMeetingIds = new Set();

function setFormSubmitting(form, isSubmitting, loadingText) {
  if (!form) return;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (!submitBtn) return;
  if (isSubmitting) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.innerHTML;
    submitBtn.textContent = loadingText;
    return;
  }
  submitBtn.disabled = false;
  if (submitBtn.dataset.originalText) {
    submitBtn.innerHTML = submitBtn.dataset.originalText;
    delete submitBtn.dataset.originalText;
  }
}

function setSendEmailButtonsLoading(meetingId, isLoading) {
  const buttons = Array.from(document.querySelectorAll('[data-action="send-email"]'))
    .filter((btn) => btn.dataset.id === meetingId);
  buttons.forEach((btn) => {
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 发送中…';
      return;
    }
    btn.disabled = false;
    if (btn.dataset.originalText) {
      btn.innerHTML = btn.dataset.originalText;
      delete btn.dataset.originalText;
    }
  });
}

function invalidateGlossaryCache() {
  _glossaryCache = null;
  _glossaryCacheTime = 0;
}

async function getCachedGlossaryTerms() {
  if (_glossaryCache && (Date.now() - _glossaryCacheTime) < GLOSSARY_CACHE_TTL) {
    return _glossaryCache;
  }
  const terms = await API.get("/api/glossary") || [];
  _glossaryCache = terms;
  _glossaryCacheTime = Date.now();
  return terms;
}

async function fetchGlossary() {
  const tbody = document.getElementById("glossary-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="loading">加载中...</td></tr>';

  try {
    glossaryData = await getCachedGlossaryTerms();
    renderGlossary(glossaryData);
  } catch (_) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">加载词汇表失败</td></tr>';
  }
}

function renderGlossary(terms) {
  const tbody = document.getElementById("glossary-tbody");
  if (!terms || terms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fa fa-book"></i>&nbsp;暂无术语</td></tr>';
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
          <div class="row-actions"><button class="btn btn-outline btn-sm" data-action="edit-term" data-id="${escapeAttr(t.termId)}"><i class="fa fa-pencil"></i></button>
          <button class="btn btn-danger btn-sm" data-action="delete-term" data-id="${escapeAttr(t.termId)}"><i class="fa fa-trash"></i></button></div>
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
  if (!data.term) { Toast.error("术语名不能为空"); return; }

  setFormSubmitting(form, true, "添加中…");
  try {
    await API.post("/api/glossary", data);
    Toast.success("术语已添加");
    form.reset();
    invalidateGlossaryCache();
    fetchGlossary();
  } catch (_) { /* error shown */ }
  finally {
    setFormSubmitting(form, false, "");
  }
}

async function deleteTerm(id) {
  if (!confirm("确认删除该术语？")) return;
  try {
    await API.del(`/api/glossary/${id}`);
    Toast.success("术语已删除");
    invalidateGlossaryCache();
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
  const form = e.target;
  const overlay = document.getElementById("edit-modal");
  const id = overlay.dataset.termId;

  const data = {
    term:       document.getElementById("edit-term").value.trim(),
    aliases:    document.getElementById("edit-aliases").value.trim(),
    definition: document.getElementById("edit-definition").value.trim(),
  };

  setFormSubmitting(form, true, "保存中…");
  try {
    await API.put(`/api/glossary/${id}`, data);
    Toast.success("术语已更新");
    overlay.classList.remove("show");
    invalidateGlossaryCache();
    fetchGlossary();
  } catch (_) {}
  finally {
    setFormSubmitting(form, false, "");
  }
}

function closeModal() {
  const overlay = document.getElementById("edit-modal");
  if (overlay) overlay.classList.remove("show");
}

/* ===== Inline Report Section Editing ===== */
let _currentReport = null;
let _currentMeetingId = null;

function storeReportData(meetingId, report) {
  _currentMeetingId = meetingId;
  _currentReport = JSON.parse(JSON.stringify(report)); // deep clone
}

function editSection(section) {
  if (section === "summary") {
    document.getElementById("summary-display").style.display = "none";
    document.getElementById("summary-editor").style.display = "block";
    document.getElementById("section-summary").style.border = "2px solid #FF9900";
  }
}

function cancelSectionEdit(section) {
  if (section === "summary") {
    document.getElementById("summary-display").style.display = "";
    document.getElementById("summary-editor").style.display = "none";
    document.getElementById("section-summary").style.border = "";
  }
}

async function saveSection(section, meetingId) {
  var data;
  if (section === "summary") {
    data = document.getElementById("summary-textarea").value.trim();
  }
  if (data === undefined || data === null) return;

  try {
    await API.patch("/api/meetings/" + meetingId + "/report", { section: section, data: data });
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

/* ===== Patch Report Section Helper ===== */
async function patchReportSection(meetingId, section, data) {
  const res = await fetch("/api/meetings/" + meetingId + "/report", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section: section, data: data })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ===== Unified Edit Framework ===== */

/**
 * Render editable list with unified UI
 * @param {string} containerId - DOM element ID to render into
 * @param {Array} items - Array of items (string or object)
 * @param {Object} config - { fields: [{key, label, type, required}], addLabel, emptyText }
 * @param {string} meetingId - Meeting ID
 * @param {string} section - Section name for API (e.g., "participants", "highlights")
 * @param {number} prIndex - Optional project review index for nested sections
 */
function renderEditableList(containerId, items, config, meetingId, section, prIndex) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = '';

  // Empty state
  if (!items || items.length === 0) {
    html = `<div class="empty-state">${config.emptyText || '暂无数据'}</div>`;
  } else {
    // Render items
    items.forEach((item, index) => {
      // Extract display text from item
      let displayText = '';
      if (typeof item === 'string') {
        displayText = item;
      } else if (config.fields.length === 1) {
        // Single field object
        const field = config.fields[0];
        displayText = item[field.key] || JSON.stringify(item);
      } else {
        // Multi-field object, show primary field
        const primaryField = config.fields.find(f => f.required) || config.fields[0];
        displayText = item[primaryField.key] || JSON.stringify(item);
      }

      html += `
        <div class="editable-row" data-index="${index}">
          <div class="editable-row-content">${escapeHtml(displayText)}</div>
          <div class="editable-row-actions">
            <button class="btn btn-outline btn-sm"
              data-action="el-edit"
              data-section="${escapeAttr(section)}"
              data-index="${index}"
              data-meeting-id="${escapeAttr(meetingId)}"
              ${prIndex !== undefined ? `data-pr-index="${prIndex}"` : ''}
              title="编辑">
              <i class="fa fa-pencil"></i>
            </button>
            <button class="btn btn-outline btn-sm"
              data-action="el-delete"
              data-section="${escapeAttr(section)}"
              data-index="${index}"
              data-meeting-id="${escapeAttr(meetingId)}"
              ${prIndex !== undefined ? `data-pr-index="${prIndex}"` : ''}
              title="删除">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </div>`;
    });
  }

  // Add button
  html += `
    <button class="add-item-btn"
      data-action="el-add"
      data-section="${escapeAttr(section)}"
      data-meeting-id="${escapeAttr(meetingId)}"
      ${prIndex !== undefined ? `data-pr-index="${prIndex}"` : ''}>
      <i class="fa fa-plus"></i> ${config.addLabel || '添加'}
    </button>`;

  container.innerHTML = html;
}

/**
 * Show confirm dialog for delete actions
 * @param {string} message - Confirmation message
 * @param {Function} onConfirm - Callback on confirm
 */
function showConfirmDialog(message, onConfirm) {
  // Remove existing dialogs
  const existing = document.querySelector('.confirm-dialog-overlay');
  if (existing) existing.remove();

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'confirm-dialog-overlay';

  // Create dialog
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-dialog-title">确认删除</div>
      <div class="confirm-dialog-message">${escapeHtml(message)}</div>
      <div class="confirm-dialog-actions">
        <button class="btn-cancel" data-action="cancel-dialog">取消</button>
        <button class="btn-confirm" data-action="confirm-dialog">确认删除</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Event handlers
  const cancelBtn = overlay.querySelector('[data-action="cancel-dialog"]');
  const confirmBtn = overlay.querySelector('[data-action="confirm-dialog"]');

  const close = () => overlay.remove();

  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    close();
    if (onConfirm) onConfirm();
  });

  // Click overlay to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

/**
 * Save section data to API
 * @param {string} meetingId - Meeting ID
 * @param {string} section - Section name
 * @param {*} data - Data to save
 * @param {number} prIndex - Optional project review index
 */
async function saveSectionData(meetingId, section, data, prIndex) {
  try {
    if (section === 'projectReviews' && prIndex !== undefined) {
      // For nested projectReviews sections, need to fetch full report and update specific PR
      const report = await API.get(`/api/meetings/${meetingId}/report`);
      if (!report.projectReviews) report.projectReviews = [];
      if (!report.projectReviews[prIndex]) {
        throw new Error(`Project review ${prIndex} not found`);
      }

      // Merge data into specific PR
      Object.assign(report.projectReviews[prIndex], data);

      // Save entire projectReviews array
      await API.patch(`/api/meetings/${meetingId}/report`, {
        section: 'projectReviews',
        data: report.projectReviews
      });
    } else {
      // Direct section save
      await API.patch(`/api/meetings/${meetingId}/report`, {
        section: section,
        data: data
      });
    }

    Toast.success('已保存');
    fetchMeeting(meetingId);
  } catch (err) {
    Toast.error('保存失败');
    throw err;
  }
}

/**
 * Handle unified edit action
 */
function handleUnifiedEdit(el) {
  const section = el.dataset.section;
  const index = parseInt(el.dataset.index);
  const meetingId = el.dataset.meetingId;
  const prIndex = el.dataset.prIndex !== undefined ? parseInt(el.dataset.prIndex) : undefined;

  if (!_currentReport) return;

  // Get current data and field config
  let items = [];
  let fieldConfig = null;

  if (section === 'highlights') {
    items = _currentReport.highlights || [];
    fieldConfig = [{key: 'point', label: '内容', type: 'text', required: true}];
  } else if (section === 'lowlights') {
    items = _currentReport.lowlights || [];
    fieldConfig = [{key: 'point', label: '内容', type: 'text', required: true}];
  } else if (section === 'participants') {
    items = _currentReport.participants || [];
    fieldConfig = [{key: 'name', label: '姓名', type: 'text', required: true}];
  } else if (section === 'actions') {
    items = _currentReport.actions || [];
    fieldConfig = [
      {key: 'task', label: '任务', type: 'text', required: true},
      {key: 'owner', label: '负责人', type: 'text'},
      {key: 'deadline', label: '截止日期', type: 'text'},
      {key: 'priority', label: '优先级', type: 'text'}
    ];
  } else if (section === 'decisions') {
    items = _currentReport.decisions || [];
    fieldConfig = [{key: 'decision', label: '决策内容', type: 'text', required: true}];
  } else if (section === 'announcements') {
    items = _currentReport.announcements || [];
    fieldConfig = [
      {key: 'title', label: '标题', type: 'text', required: true},
      {key: 'detail', label: '详情', type: 'textarea'},
      {key: 'owner', label: '发布人', type: 'text'}
    ];
  } else if (prIndex !== undefined && _currentReport.projectReviews && _currentReport.projectReviews[prIndex]) {
    const pr = _currentReport.projectReviews[prIndex];
    if (section === 'pr-highlights') {
      items = pr.highlights || [];
      fieldConfig = [
        {key: 'point', label: '亮点', type: 'text', required: true},
        {key: 'detail', label: '详情', type: 'textarea'}
      ];
    } else if (section === 'pr-lowlights') {
      items = pr.lowlights || [];
      fieldConfig = [
        {key: 'point', label: '待改进', type: 'text', required: true},
        {key: 'detail', label: '详情', type: 'textarea'}
      ];
    } else if (section === 'pr-risks') {
      items = pr.risks || [];
      fieldConfig = [
        {key: 'risk', label: '风险', type: 'text', required: true},
        {key: 'mitigation', label: '应对措施', type: 'textarea'}
      ];
    } else if (section === 'pr-followUps') {
      items = pr.followUps || [];
      fieldConfig = [
        {key: 'task', label: '跟进事项', type: 'text', required: true},
        {key: 'owner', label: '负责人', type: 'text'},
        {key: 'deadline', label: '截止日期', type: 'text'}
      ];
    }
  }

  if (!fieldConfig) return;
  const item = items[index];
  if (!item) return;

  // Find the editable-row
  const row = el.closest('.editable-row');
  if (!row) return;

  // Generate form fields
  let formFields = '';
  fieldConfig.forEach(field => {
    let value = '';
    if (typeof item === 'string') {
      value = item;
    } else {
      value = item[field.key] || item[field.key.replace('-', '_')] || '';
    }

    if (field.type === 'textarea') {
      formFields += `
        <textarea
          class="unified-edit-input"
          data-field="${escapeAttr(field.key)}"
          placeholder="${escapeAttr(field.label)}${field.required ? ' (必填)' : ''}"
          rows="2">${escapeAttr(value)}</textarea>`;
    } else {
      formFields += `
        <input type="text"
          class="unified-edit-input"
          data-field="${escapeAttr(field.key)}"
          value="${escapeAttr(value)}"
          placeholder="${escapeAttr(field.label)}${field.required ? ' (必填)' : ''}" />`;
    }
  });

  // Replace with edit form
  row.innerHTML = `
    <div class="edit-form-inline">
      ${formFields}
      <div class="edit-actions">
        <button class="btn-cancel"
          data-action="el-cancel"
          data-section="${escapeAttr(section)}"
          data-meeting-id="${escapeAttr(meetingId)}"
          ${prIndex !== undefined ? `data-pr-index="${prIndex}"` : ''}>
          取消
        </button>
        <button class="btn-save"
          data-action="el-save"
          data-section="${escapeAttr(section)}"
          data-index="${index}"
          data-meeting-id="${escapeAttr(meetingId)}"
          ${prIndex !== undefined ? `data-pr-index="${prIndex}"` : ''}>
          💾 保存
        </button>
      </div>
    </div>`;

  // Focus first input
  const firstInput = row.querySelector('.unified-edit-input');
  if (firstInput) {
    firstInput.focus();
    if (firstInput.tagName === 'INPUT') {
      firstInput.select();
    }
  }
}

/**
 * Handle unified save action
 */
async function handleUnifiedSave(el) {
  const section = el.dataset.section;
  const index = parseInt(el.dataset.index);
  const meetingId = el.dataset.meetingId;
  const prIndex = el.dataset.prIndex !== undefined ? parseInt(el.dataset.prIndex) : undefined;

  if (!_currentReport) return;

  // Get all input fields
  const row = el.closest('.editable-row');
  if (!row) return;

  const inputs = row.querySelectorAll('.unified-edit-input');
  if (!inputs || inputs.length === 0) return;

  // Collect field values
  const newItem = {};
  let hasRequiredFields = false;

  inputs.forEach(input => {
    const fieldKey = input.dataset.field;
    const value = input.value.trim();

    // Check if this is a required field (placeholder contains "必填")
    const isRequired = input.placeholder && input.placeholder.includes('必填');

    if (isRequired && value) {
      hasRequiredFields = true;
    } else if (isRequired && !value) {
      Toast.error(`${input.placeholder.replace(' (必填)', '')} 不能为空`);
      input.focus();
      throw new Error('Required field empty');
    }

    if (value) {
      newItem[fieldKey] = value;
    }
  });

  if (Object.keys(newItem).length === 0) {
    Toast.error('至少填写一个字段');
    inputs[0].focus();
    return;
  }

  // Get current data
  let items = [];
  let targetSection = section;

  if (section === 'highlights') {
    items = JSON.parse(JSON.stringify(_currentReport.highlights || []));
  } else if (section === 'lowlights') {
    items = JSON.parse(JSON.stringify(_currentReport.lowlights || []));
  } else if (section === 'participants') {
    items = JSON.parse(JSON.stringify(_currentReport.participants || []));
  } else if (section === 'actions') {
    items = JSON.parse(JSON.stringify(_currentReport.actions || []));
    targetSection = 'actions';
  } else if (section === 'decisions') {
    items = JSON.parse(JSON.stringify(_currentReport.decisions || []));
    targetSection = 'decisions';
  } else if (section === 'announcements') {
    items = JSON.parse(JSON.stringify(_currentReport.announcements || []));
  } else if (prIndex !== undefined && _currentReport.projectReviews && _currentReport.projectReviews[prIndex]) {
    const pr = _currentReport.projectReviews[prIndex];
    if (section === 'pr-highlights') {
      items = JSON.parse(JSON.stringify(pr.highlights || []));
    } else if (section === 'pr-lowlights') {
      items = JSON.parse(JSON.stringify(pr.lowlights || []));
    } else if (section === 'pr-risks') {
      items = JSON.parse(JSON.stringify(pr.risks || []));
    } else if (section === 'pr-followUps') {
      items = JSON.parse(JSON.stringify(pr.followUps || []));
    }
  }

  // Update item
  if (typeof items[index] === 'string' && inputs.length === 1) {
    items[index] = Object.values(newItem)[0];
  } else {
    items[index] = newItem;
  }

  // Save
  if (section.startsWith('pr-') && prIndex !== undefined) {
    // For projectReviews nested fields
    const fieldName = section.replace('pr-', '');
    const updateData = {};
    updateData[fieldName] = items;
    await saveSectionData(meetingId, 'projectReviews', updateData, prIndex);
  } else {
    await saveSectionData(meetingId, targetSection, items, prIndex);
  }
}

/**
 * Handle unified cancel action
 */
function handleUnifiedCancel(el) {
  const meetingId = el.dataset.meetingId;
  fetchMeeting(meetingId);
}

/**
 * Handle unified delete action
 */
function handleUnifiedDelete(el) {
  const section = el.dataset.section;
  const index = parseInt(el.dataset.index);
  const meetingId = el.dataset.meetingId;
  const prIndex = el.dataset.prIndex !== undefined ? parseInt(el.dataset.prIndex) : undefined;

  if (!_currentReport) return;

  const messages = {
    highlights: '确认要删除该亮点？',
    lowlights: '确认要删除该待改进项？',
    participants: '确认要删除该参会人员？',
    actions: '确认要删除该待办事项？',
    actions: '确认要删除该待办事项？',
    decisions: '确认要删除该决策？',
    decisions: '确认要删除该决策？',
    announcements: '确认要删除该公告？',
    'pr-highlights': '确认要删除该项目亮点？',
    'pr-lowlights': '确认要删除该项目待改进项？',
    'pr-risks': '确认要删除该风险？',
    'pr-followUps': '确认要删除该跟进事项？'
  };

  showConfirmDialog(messages[section] || '确认删除？', async () => {
    // Get current data
    let items = [];
    let targetSection = section;

    if (section === 'highlights') {
      items = JSON.parse(JSON.stringify(_currentReport.highlights || []));
    } else if (section === 'lowlights') {
      items = JSON.parse(JSON.stringify(_currentReport.lowlights || []));
    } else if (section === 'participants') {
      items = JSON.parse(JSON.stringify(_currentReport.participants || []));
    } else if (section === 'actions') {
      items = JSON.parse(JSON.stringify(_currentReport.actions || []));
      targetSection = 'actions';
    } else if (section === 'decisions') {
      items = JSON.parse(JSON.stringify(_currentReport.decisions || []));
      targetSection = 'decisions';
    } else if (section === 'announcements') {
      items = JSON.parse(JSON.stringify(_currentReport.announcements || []));
    } else if (prIndex !== undefined && _currentReport.projectReviews && _currentReport.projectReviews[prIndex]) {
      const pr = _currentReport.projectReviews[prIndex];
      if (section === 'pr-highlights') {
        items = JSON.parse(JSON.stringify(pr.highlights || []));
      } else if (section === 'pr-lowlights') {
        items = JSON.parse(JSON.stringify(pr.lowlights || []));
      } else if (section === 'pr-risks') {
        items = JSON.parse(JSON.stringify(pr.risks || []));
      } else if (section === 'pr-followUps') {
        items = JSON.parse(JSON.stringify(pr.followUps || []));
      }
    }

    // Remove item
    items.splice(index, 1);

    // Save
    if (section.startsWith('pr-') && prIndex !== undefined) {
      const fieldName = section.replace('pr-', '');
      const updateData = {};
      updateData[fieldName] = items;
      await saveSectionData(meetingId, 'projectReviews', updateData, prIndex);
    } else {
      await saveSectionData(meetingId, targetSection, items, prIndex);
    }
  });
}

/**
 * Handle unified add action
 */
function handleUnifiedAdd(el) {
  const section = el.dataset.section;
  const meetingId = el.dataset.meetingId;
  const prIndex = el.dataset.prIndex !== undefined ? parseInt(el.dataset.prIndex) : undefined;

  if (!_currentReport) return;

  // Create add form after the button
  const btn = el;
  const existingForm = btn.parentElement.querySelector('.add-form-inline');
  if (existingForm) {
    existingForm.remove();
    return;
  }

  // Get field config
  let fieldConfig = null;
  if (section === 'highlights') {
    fieldConfig = [{key: 'point', label: '内容', type: 'text', required: true}];
  } else if (section === 'lowlights') {
    fieldConfig = [{key: 'point', label: '内容', type: 'text', required: true}];
  } else if (section === 'participants') {
    fieldConfig = [{key: 'name', label: '姓名', type: 'text', required: true}];
  } else if (section === 'actions') {
    fieldConfig = [
      {key: 'task', label: '任务', type: 'text', required: true},
      {key: 'owner', label: '负责人', type: 'text'},
      {key: 'deadline', label: '截止日期', type: 'text'},
      {key: 'priority', label: '优先级', type: 'text'}
    ];
  } else if (section === 'decisions') {
    fieldConfig = [{key: 'decision', label: '决策内容', type: 'text', required: true}];
  } else if (section === 'announcements') {
    fieldConfig = [
      {key: 'title', label: '标题', type: 'text', required: true},
      {key: 'detail', label: '详情', type: 'textarea'},
      {key: 'owner', label: '发布人', type: 'text'}
    ];
  } else if (section === 'pr-highlights') {
    fieldConfig = [
      {key: 'point', label: '亮点', type: 'text', required: true},
      {key: 'detail', label: '详情', type: 'textarea'}
    ];
  } else if (section === 'pr-lowlights') {
    fieldConfig = [
      {key: 'point', label: '待改进', type: 'text', required: true},
      {key: 'detail', label: '详情', type: 'textarea'}
    ];
  } else if (section === 'pr-risks') {
    fieldConfig = [
      {key: 'risk', label: '风险', type: 'text', required: true},
      {key: 'mitigation', label: '应对措施', type: 'textarea'}
    ];
  } else if (section === 'pr-followUps') {
    fieldConfig = [
      {key: 'task', label: '跟进事项', type: 'text', required: true},
      {key: 'owner', label: '负责人', type: 'text'},
      {key: 'deadline', label: '截止日期', type: 'text'}
    ];
  }

  if (!fieldConfig) return;

  // Generate form fields
  let formFields = '';
  fieldConfig.forEach(field => {
    if (field.type === 'textarea') {
      formFields += `
        <textarea
          class="unified-add-input"
          data-field="${escapeAttr(field.key)}"
          placeholder="${escapeAttr(field.label)}${field.required ? ' (必填)' : ''}"
          rows="2"></textarea>`;
    } else {
      formFields += `
        <input type="text"
          class="unified-add-input"
          data-field="${escapeAttr(field.key)}"
          placeholder="${escapeAttr(field.label)}${field.required ? ' (必填)' : ''}" />`;
    }
  });

  const form = document.createElement('div');
  form.className = 'edit-form-inline add-form-inline';
  form.innerHTML = `
    ${formFields}
    <div class="edit-actions">
      <button class="btn-cancel"
        data-action="el-cancel-add">
        取消
      </button>
      <button class="btn-save"
        data-action="el-save-add"
        data-section="${escapeAttr(section)}"
        data-meeting-id="${escapeAttr(meetingId)}"
        ${prIndex !== undefined ? `data-pr-index="${prIndex}"` : ''}>
        💾 添加
      </button>
    </div>`;

  btn.parentElement.insertBefore(form, btn);

  // Focus first input
  const firstInput = form.querySelector('.unified-add-input');
  if (firstInput) {
    firstInput.focus();
  }

  // Cancel button
  form.querySelector('[data-action="el-cancel-add"]').addEventListener('click', () => {
    form.remove();
  });

  // Save button
  form.querySelector('[data-action="el-save-add"]').addEventListener('click', async () => {
    const inputs = form.querySelectorAll('.unified-add-input');
    const newItem = {};
    let hasRequiredField = false;

    inputs.forEach(input => {
      const fieldKey = input.dataset.field;
      const value = input.value.trim();
      const isRequired = input.placeholder && input.placeholder.includes('必填');

      if (isRequired && value) {
        hasRequiredField = true;
      } else if (isRequired && !value) {
        Toast.error(`${input.placeholder.replace(' (必填)', '')} 不能为空`);
        input.focus();
        throw new Error('Required field empty');
      }

      if (value) {
        newItem[fieldKey] = value;
      }
    });

    if (!hasRequiredField) {
      Toast.error('请至少填写必填字段');
      firstInput.focus();
      return;
    }

    // Get current data
    let items = [];
    let targetSection = section;

    if (section === 'highlights') {
      items = JSON.parse(JSON.stringify(_currentReport.highlights || []));
    } else if (section === 'lowlights') {
      items = JSON.parse(JSON.stringify(_currentReport.lowlights || []));
    } else if (section === 'participants') {
      items = JSON.parse(JSON.stringify(_currentReport.participants || []));
    } else if (section === 'actions') {
      items = JSON.parse(JSON.stringify(_currentReport.actions || []));
      targetSection = 'actions';
    } else if (section === 'decisions') {
      items = JSON.parse(JSON.stringify(_currentReport.decisions || []));
      targetSection = 'decisions';
    } else if (section === 'announcements') {
      items = JSON.parse(JSON.stringify(_currentReport.announcements || []));
    } else if (prIndex !== undefined && _currentReport.projectReviews && _currentReport.projectReviews[prIndex]) {
      const pr = _currentReport.projectReviews[prIndex];
      if (section === 'pr-highlights') {
        items = JSON.parse(JSON.stringify(pr.highlights || []));
      } else if (section === 'pr-lowlights') {
        items = JSON.parse(JSON.stringify(pr.lowlights || []));
      } else if (section === 'pr-risks') {
        items = JSON.parse(JSON.stringify(pr.risks || []));
      } else if (section === 'pr-followUps') {
        items = JSON.parse(JSON.stringify(pr.followUps || []));
      }
    }

    // Add new item (single field vs multi-field)
    if (fieldConfig.length === 1 && inputs.length === 1) {
      items.push(Object.values(newItem)[0]);
    } else {
      items.push(newItem);
    }

    // Save
    try {
      if (section.startsWith('pr-') && prIndex !== undefined) {
        const fieldName = section.replace('pr-', '');
        const updateData = {};
        updateData[fieldName] = items;
        await saveSectionData(meetingId, 'projectReviews', updateData, prIndex);
      } else {
        await saveSectionData(meetingId, targetSection, items, prIndex);
      }
      form.remove();
    } catch (err) {
      // Error already handled by saveSectionData
    }
  });
}


/* ===== Event Delegation (replaces inline onclick for CSP compliance) ===== */
/* ===== Participant Name Search Dropdown ===== */
let _participantSearchDelegated = false;
function initParticipantNameSearch() {
  if (_participantSearchDelegated) return;
  _participantSearchDelegated = true;

  document.addEventListener("input", function(e) {
    var input = e.target && e.target.closest ? e.target.closest(".participant-search-input") : null;
    if (!input) return;

    var val = input.value.trim().toLowerCase();
    var sugBox = input.parentElement.querySelector(".name-suggestions");
    if (!sugBox) return;
    if (!val) { sugBox.style.display = "none"; sugBox.innerHTML = ""; return; }

    getCachedGlossaryTerms().then(function(terms) {
      var matches = terms.filter(function(t) {
        var term = (t.term || "").toLowerCase();
        var aliases = (t.aliases || "").toLowerCase();
        return term.indexOf(val) !== -1 || aliases.indexOf(val) !== -1;
      }).slice(0, 8);

      if (matches.length === 0) { sugBox.style.display = "none"; sugBox.innerHTML = ""; return; }
      sugBox.innerHTML = matches.map(function(t) {
        return '<div class="suggestion-item" data-name="' + escapeAttr(t.term) + '">' + escapeHtml(t.term) + '</div>';
      }).join("");
      sugBox.style.display = "block";
    }).catch(function() { sugBox.style.display = "none"; });
  });
}

// Close all suggestion dropdowns when clicking outside
document.addEventListener("click", function(e) {
  if (!e.target.closest(".participant-search-wrap")) {
    document.querySelectorAll(".name-suggestions").forEach(function(el) {
      el.style.display = "none";
      el.innerHTML = "";
    });
  }
  // Handle suggestion item click via event delegation
  if (e.target.classList.contains("suggestion-item")) {
    var name = e.target.dataset.name;
    var wrap = e.target.closest(".participant-search-wrap");
    if (wrap) {
      var inp = wrap.querySelector(".participant-search-input");
      if (inp) inp.value = name;
    }
    var sugBox = e.target.closest(".name-suggestions");
    if (sugBox) { sugBox.style.display = "none"; sugBox.innerHTML = ""; }
    return;
  }
});

document.addEventListener("click", function(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    // Unified Edit Framework
    case "el-edit":            handleUnifiedEdit(el); break;
    case "el-delete":          handleUnifiedDelete(el); break;
    case "el-add":             handleUnifiedAdd(el); break;
    case "el-save":            handleUnifiedSave(el); break;
    case "el-cancel":          handleUnifiedCancel(el); break;

    case "delete-meeting":     deleteMeeting(id); break;
    case "retry-meeting":      retryMeeting(id); break;
    case "start-card-edit":    startCardEdit(id, el.dataset.title, el.dataset.type); break;
    case "save-card-edit":     saveCardEdit(id); break;
    case "cancel-card-edit":   cancelCardEdit(); break;
    case "retry-detail":       retryMeetingDetail(id); break;
    case "auto-name":          autoNameMeeting(id, el); break;
    case "start-detail-edit":  startDetailEdit(id, el.dataset.title, el.dataset.type); break;
    case "save-detail-edit":   saveDetailEdit(id); break;
    case "cancel-detail-edit": cancelDetailEdit(); break;
    case "save-speaker-map":   saveSpeakerMap(id); break;
    case "regenerate-report":  regenerateReport(id); break;
    case "send-email":         sendEmail(id); break;
    case "edit-term":          editTerm(id); break;
    case "delete-term":        deleteTerm(id); break;
    case "open-merge-modal":   openMergeModal(); break;
    case "close-merge-modal":  closeMergeModal(); break;
    case "submit-merge":       submitMerge(); break;
    case "close-modal":        closeModal(); break;
    case "edit-section":        editSection(el.dataset.section); break;
    case "cancel-section-edit": cancelSectionEdit(el.dataset.section); break;
    case "save-section":        saveSection(el.dataset.section, el.dataset.meetingId); break;
  }
});

/* checkbox change → merge selection */
document.addEventListener("change", function(e) {
  if (e.target.classList.contains("merge-checkbox")) {
    updateMergeSelection();
  }
});


/* ===== Merge Modal Functions ===== */
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
      <button class="btn action-primary-btn" data-action="open-merge-modal">合并生成报告</button>
    `;
    bar.style.display = 'flex';
  } else {
    if (bar) bar.style.display = 'none';
  }
}

function openMergeModal() {
  const ids = getSelectedMeetingIds();
  if (ids.length < 2) { Toast.error("请至少选择 2 个会议"); return; }
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
        <button class="btn action-primary-btn" id="merge-submit-btn" data-action="submit-merge"><i class="fa fa-magic"></i> 生成报告</button>
      </div>
    </div>
  `;
  overlay.classList.add('show');
}

function closeMergeModal() {
  const overlay = document.getElementById('merge-modal');
  if (overlay) overlay.classList.remove('show');
}

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
    fetchGlossary();
    var addForm = document.getElementById("add-term-form");
    if (addForm) addForm.addEventListener("submit", addTerm);
    var editForm = document.getElementById("edit-term-form");
    if (editForm) editForm.addEventListener("submit", saveEditTerm);
    var glossarySearch = document.getElementById("glossary-search");
    if (glossarySearch) glossarySearch.addEventListener("input", function() { filterGlossary(this.value); });
  }
});
