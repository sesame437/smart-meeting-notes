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
let currentPollingInterval = 12000;

function hasActiveJobs(meetings) {
  const activeStatuses = ['pending', 'processing', 'transcribing', 'reporting'];
  return meetings.some(m => activeStatuses.includes(m.status));
}

function getPollingInterval(meetings) {
  // Dynamic polling interval based on meeting states
  const hasWaitingGPU = meetings.some(m => m.status === 'pending' && m.stage === 'waiting-gpu');
  const hasProcessing = meetings.some(m => m.status === 'processing');

  if (hasWaitingGPU) return 30000; // 30 seconds for GPU cold start
  if (hasProcessing) return 8000;  // 8 seconds for active processing
  return 12000; // Default 12 seconds
}

function startPolling(interval = 12000) {
  if (pollingTimer && currentPollingInterval === interval) return; // Already polling at correct interval

  // Restart polling with new interval
  if (pollingTimer) {
    clearInterval(pollingTimer);
  }

  currentPollingInterval = interval;
  showSyncIndicator(true);
  pollingTimer = setInterval(async () => {
    await fetchMeetings();
  }, interval);
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
    // Auto-polling: keep polling while any job is active, with dynamic interval
    if (hasActiveJobs(meetingList)) {
      const interval = getPollingInterval(meetingList);
      startPolling(interval);
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
  let stageText = "";
  if (status === "pending" && stage === "waiting-gpu") {
    stageText = "GPU 启动中（约3-5分钟）";
  } else if (status === "processing") {
    stageText = "转录中...";
  } else if (status === "pending" || status === "transcribed" || status === "reported") {
    const stageLabels = { transcribing: "转录中…", generating: "生成报告中…", sending: "发送邮件中…", "waiting-retry": "等待重试..." };
    stageText = stageLabels[stage] || "";
  }

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
      await API.del(`/api/meetings/${meetingId}`);
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
    content.dataset.loaded = "1";
    var inputState = captureSpeakerInputState();
    renderMeetingDetail(m);
    restoreSpeakerInputState(inputState);
  } catch (_) {
    if (!content.dataset.loaded) {
      content.innerHTML = '<div class="empty-state">加载会议详情失败</div>';
    }
  }
}

function captureSpeakerInputState() {
  var state = {};
  document.querySelectorAll('.participant-name-input').forEach(function(input) {
    var key = input.dataset.speakerKey;
    if (key && document.activeElement === input) {
      state[key] = { value: input.value, hasFocus: true };
    }
  });
  return state;
}

function restoreSpeakerInputState(state) {
  if (!state || Object.keys(state).length === 0) return;
  document.querySelectorAll('.participant-name-input').forEach(function(input) {
    var key = input.dataset.speakerKey;
    if (state[key]) {
      input.value = state[key].value;
      if (state[key].hasFocus) input.focus();
    }
  });
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
  const esc = escapeHtml;
  const report  = m.content || {};
  const title   = escapeHtml(m.title || m.meetingId);
  const time    = m.createdAt ? new Date(m.createdAt).toLocaleString("zh-CN") : "-";
  const status  = m.status || "pending";

  const highlights  = report.highlights  || [];
  const lowlights   = report.lowlights   || [];
  const actions     = report.actions     || [];
  const decisions   = report.decisions   || [];
  const risks       = report.risks       || report.issues || [];
  const participants= report.participants|| [];
  const topics      = report.topics      || report.agenda_items || [];
  const summary     = report.summary     || report.executive_summary || "暂无摘要";
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
    report.announcements.forEach((a, i) => {
      annHtml += `<div class="decision-card" id="announcement-row-${i}" style="margin-bottom:8px;display:flex;align-items:flex-start;justify-content:space-between;">
        <span class="announcement-text">
          <strong>${esc(a.title)}</strong>
          ${a.detail ? `<br><span style="color:#555;font-size:13px;">${esc(a.detail)}</span>` : ''}
          ${a.owner ? `<br><span style="color:#879596;font-size:12px;">发布：${esc(a.owner)}</span>` : ''}
        </span>
        <div class="row-actions" style="flex-shrink:0;">
          <button class="btn btn-outline btn-sm" data-action="edit-announcement" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
          <button class="btn btn-danger btn-sm" data-action="delete-announcement" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
        </div>
      </div>`;
    });
    annHtml += `</div>`;
    html += annHtml;
  }

  // projectReviews（weekly 专属）
  if (report.projectReviews && report.projectReviews.length) {
    report.projectReviews.forEach((pr, pi) => {
      let prHtml = `<div class="report-section" id="pr-row-${pi}">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <h3 class="section-title" style="margin:0;">🗂 ${esc(pr.project)}</h3>
          <div class="row-actions" style="flex-shrink:0;">
            <button class="btn btn-outline btn-sm" data-action="edit-project-review" data-index="${pi}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑项目"><i class="fa fa-pencil"></i></button>
            <button class="btn btn-danger btn-sm" data-action="delete-project-review" data-index="${pi}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除项目"><i class="fa fa-trash"></i></button>
          </div>
        </div>`;
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
        pr.risks.forEach((r, ri) => {
          prHtml += `<div class="risk-card" id="pr-risk-row-${pi}-${ri}" style="margin-top:8px;display:flex;align-items:flex-start;justify-content:space-between;">
            <span>⚠️ <strong>${esc(r.risk)}</strong>${r.mitigation?`<br><span style="font-size:12px;color:#666;">${esc(r.mitigation)}</span>`:''}</span>
            <div class="row-actions" style="flex-shrink:0;">
              <button class="btn btn-outline btn-sm" data-action="edit-pr-risk" data-pr-index="${pi}" data-index="${ri}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
              <button class="btn btn-danger btn-sm" data-action="delete-pr-risk" data-pr-index="${pi}" data-index="${ri}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
            </div>
          </div>`;
        });
      }
      // followUps
      if (pr.followUps && pr.followUps.length) {
        prHtml += `<table class="report-table" style="margin-top:10px;">
          <thead><tr><th>跟进事项</th><th>负责人</th><th>截止</th><th></th></tr></thead><tbody>`;
        pr.followUps.forEach((f, fi) => {
          prHtml += `<tr id="pr-followup-row-${pi}-${fi}">
            <td>${esc(f.task)}</td><td>${esc(f.owner||'-')}</td><td>${formatDeadline(f.deadline||'-')}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-outline btn-sm" data-action="edit-pr-followup" data-pr-index="${pi}" data-index="${fi}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
                <button class="btn btn-danger btn-sm" data-action="delete-pr-followup" data-pr-index="${pi}" data-index="${fi}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
              </div>
            </td>
          </tr>`;
        });
        prHtml += `</tbody></table>`;
      }
      prHtml += `</div>`;
      html += prHtml;
    });
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
  if (highlights.length || lowlights.length) {
    html += `<div class="section-grid">`;

    if (highlights.length) {
      html += `
        <div class="card" id="section-highlights">
          <div class="card-title"><i class="fa fa-thumb-tack"></i> 亮点</div>
          <ul>${highlights.map((h, i) => `<li class="highlight-item" id="highlight-row-${i}" style="display:flex;align-items:center;justify-content:space-between;">
            <span class="hl-text">${escapeHtml(renderListItem(h))}</span>
            <div class="row-actions">
              <button class="btn btn-outline btn-sm" data-action="edit-highlight" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
              <button class="btn btn-danger btn-sm" data-action="delete-highlight" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
            </div>
          </li>`).join("")}</ul>
          <div style="text-align:right;margin-top:8px;">
            <button class="btn btn-outline btn-sm" data-action="add-highlight" data-meeting-id="${escapeAttr(m.meetingId)}"><i class="fa fa-plus"></i> 添加亮点</button>
          </div>
        </div>
      `;
    }

    if (lowlights.length) {
      html += `
        <div class="card" id="section-lowlights">
          <div class="card-title"><i class="fa fa-exclamation-triangle"></i> 待改进</div>
          <ul>${lowlights.map((l, i) => `<li class="lowlight-item" id="lowlight-row-${i}" style="display:flex;align-items:center;justify-content:space-between;">
            <span class="hl-text">${escapeHtml(renderListItem(l))}</span>
            <div class="row-actions">
              <button class="btn btn-outline btn-sm" data-action="edit-lowlight" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
              <button class="btn btn-danger btn-sm" data-action="delete-lowlight" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
            </div>
          </li>`).join("")}</ul>
          <div style="text-align:right;margin-top:8px;">
            <button class="btn btn-outline btn-sm" data-action="add-lowlight" data-meeting-id="${escapeAttr(m.meetingId)}"><i class="fa fa-plus"></i> 添加待改进</button>
          </div>
        </div>
      `;
    }

    html += `</div>`;
  }

  // ---- Action Items ----
  html += `
    <div class="card" id="section-actionItems">
      <div class="card-title">
        <span><i class="fa fa-check-square-o"></i> 待办事项</span>
        
      </div>
      <div id="actionItems-display">
      ${actions.length ? `
      <div class="table-wrap">
        <table class="actions-table">
          <thead><tr>
            <th style="color:var(--aws-orange)">任务</th>
            <th style="color:var(--aws-orange)">负责人</th>
            <th style="color:var(--aws-orange)">截止日期</th>
            <th style="color:var(--aws-orange)">优先级</th>
          </tr></thead>
          <tbody>
            ${actions.map((a, idx) => {
              const prio = (a.priority || "").toLowerCase();
              const prioLabel = a.priority || "-";
              return `<tr id="action-row-${idx}">
                <td>${escapeHtml(a.task || a.action || "")}</td>
                <td>${escapeHtml(a.owner || a.assignee || "-")}</td>
                <td>${formatDeadline(a.deadline || a.dueDate || "-")}</td>
                <td class="td-priority-actions">
                  <span class="priority-badge priority-${prio}">${escapeHtml(prioLabel)}</span>
                  <div class="row-actions"><button class="btn btn-outline btn-sm" data-action="edit-action-item" data-index="${idx}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
                  <button class="btn btn-danger btn-sm" data-action="delete-action-item" data-index="${idx}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button></div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : '<div class="empty-state">暂无待办事项</div>'}
      </div>
    </div>
  `;

  // ---- Key Decisions ----
  html += `
    <div class="card decisions-card" id="section-keyDecisions">
      <div class="card-title">
        <span><i class="fa fa-gavel"></i> 关键决策</span>
      </div>
      <div id="keyDecisions-display">
      ${decisions.length ? `<ul>${decisions.map((d, idx) => `<li id="decision-row-${idx}">
        <span class="decision-text">${escapeHtml(renderListItem(d))}</span>
        <div class="row-actions">
          <button class="btn btn-outline btn-sm" data-action="edit-decision-item" data-index="${idx}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
          <button class="btn btn-danger btn-sm" data-action="delete-decision-item" data-index="${idx}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
        </div>
      </li>`).join("")}</ul>` : '<div class="empty-state">暂无关键决策</div>'}
      </div>
    </div>
  `;

  // ---- Risks / Issues ----
  if (risks.length) {
    html += `
      <div class="card risks-card">
        <div class="card-title"><i class="fa fa-warning"></i> 风险与问题</div>
        <ul>${risks.map((r, i) => {
          const isObj = typeof r === "object" && r !== null;
          const riskText = isObj ? escapeHtml(r.risk || renderListItem(r)) : escapeHtml(renderListItem(r));
          const mitigationText = isObj && r.mitigation ? `<br><span style="font-size:12px;color:#666;">应对：${escapeHtml(r.mitigation)}</span>` : "";
          return `<li class="risk-item" id="risk-row-${i}" style="display:flex;align-items:center;justify-content:space-between;">
            <span class="risk-text">${riskText}${mitigationText}</span>
            <div class="row-actions">
              <button class="btn btn-outline btn-sm" data-action="edit-risk" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="编辑"><i class="fa fa-pencil"></i></button>
              <button class="btn btn-danger btn-sm" data-action="delete-risk" data-index="${i}" data-meeting-id="${escapeAttr(m.meetingId)}" title="删除"><i class="fa fa-trash"></i></button>
            </div>
          </li>`;
        }).join("")}</ul>
      </div>
    `;
  }

  // ---- Participants ----
  {
    const speakerMap = m.speakerMap || {};
    const speakerEntries = getSpeakerEntries(report, speakerMap);

    html += `
      <div class="card">
        <div class="card-title"><i class="fa fa-users"></i> 参会人员</div>`;

    if (speakerEntries.length > 0) {
      html += `
        <div class="participant-list">`;

      speakerEntries.forEach((entry) => {
        const hintText = entry.keypoints.length > 0
          ? truncateParticipantHint(entry.keypoints[0], 100)
          : "";
        const possibleNameText = entry.possibleName || "暂无候选姓名";

        html += `<div class="participant-row">
          <div class="participant-label">${escapeHtml(entry.displayLabel)}</div>
          <div class="participant-search-wrap">
            <input type="text"
              class="form-control participant-name-input participant-search-input"
              data-participant-label="${escapeAttr(entry.displayLabel)}"
              data-speaker-key="${escapeAttr(entry.speakerKey)}"
              data-possible-name="${escapeAttr(entry.possibleName)}"
              data-current-name="${escapeAttr(entry.currentName)}"
              value="${escapeAttr(entry.savedName)}"
              placeholder="输入真实姓名（可从词汇表选择）" />
            <div class="name-suggestions" style="display:none;"></div>
            <div class="speaker-hint">可能姓名：${escapeHtml(possibleNameText)}</div>
            ${hintText ? `<div class="speaker-hint">关键发言：${escapeHtml(hintText)}</div>` : ""}
          </div>
        </div>`;
      });

      html += `</div>
        <div style="text-align:right;margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn action-primary-btn btn-sm" data-action="save-speaker-map" data-id="${escapeAttr(m.meetingId)}">
            <i class="fa fa-save"></i> 保存并应用
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

  // Bind custom name search dropdown for participant inputs
  initParticipantNameSearch();

  // Bottom bar - 只保留返回按钮
  const bottomBar = document.getElementById("bottom-bar");
  if (bottomBar) {
    bottomBar.innerHTML = `
      <a href="index.html" class="btn btn-outline"><i class="fa fa-arrow-left"></i> 返回</a>
    `;
  }

  // Dynamic polling based on meeting state
  if (!["completed", "failed"].includes(status)) {
    const stage = m.stage || "";
    const interval = (status === "pending" && stage === "waiting-gpu") ? 30000
                   : (status === "processing") ? 8000
                   : 12000;

    // Restart polling if interval changed
    if (!window._detailPollingTimer || window._detailPollingInterval !== interval) {
      if (window._detailPollingTimer) clearInterval(window._detailPollingTimer);
      window._detailPollingInterval = interval;
      window._detailPollingTimer = setInterval(() => fetchMeeting(id), interval);
    }
  } else {
    // Stop polling for terminal states
    if (window._detailPollingTimer) {
      clearInterval(window._detailPollingTimer);
      window._detailPollingTimer = null;
      window._detailPollingInterval = null;
    }
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
    // Detail polling will be automatically set by fetchMeeting with dynamic interval
  } catch (_) { /* error already shown by API */ }
}

async function applySpokenNames(meetingId) {
  // 先保存名字
  const saved = await saveSpeakerMap(meetingId, { showSavedToast: false });
  if (!saved) return;

  if (!confirmDuplicateParticipantNames()) return;

  try {
    const result = await API.post(`/api/meetings/${meetingId}/apply-speaker-names`, {});
    let msg = "已应用人名到报告";
    if (result.aliasReplacements && result.aliasReplacements.length > 0) {
      const detail = result.aliasReplacements.map(r => `${r.from} → ${r.to}`).join("、");
      msg += `\n名字纠错：${detail}`;
    }
    Toast.success(msg);
    fetchMeeting(meetingId);
  } catch (_) {}
}

function confirmDuplicateParticipantNames() {
  const inputs = document.querySelectorAll('.participant-name-input');
  const nameToSpeakers = {};
  inputs.forEach(input => {
    const val = input.value.trim();
    if (!val) return;
    if (!nameToSpeakers[val]) nameToSpeakers[val] = [];
    nameToSpeakers[val].push(input.dataset.participantLabel);
  });

  const duplicates = Object.entries(nameToSpeakers).filter(([, speakers]) => speakers.length > 1);
  if (duplicates.length === 0) return true;

  const msg = duplicates.map(([name, speakers]) =>
    `「${name}」对应 ${speakers.length} 个参会人标签（${speakers.join("、")}），将合并相关内容`
  ).join("\n");
  return confirm(`发现以下重复人名，应用后将自动合并：\n\n${msg}\n\n确认继续？`);
}

async function saveSpeakerMap(meetingId, options = {}) {
  const { applyToReport = false, showSavedToast = true } = options;
  const speakerMap = {};
  const speakerAliases = {};

  // From participant name inputs (SPEAKER_idx → real name)
  document.querySelectorAll('.participant-name-input').forEach(input => {
    const val = input.value.trim();
    const key = input.dataset.speakerKey || input.dataset.participantLabel;
    speakerMap[key] = val;
    const aliases = [];
    const possibleName = (input.dataset.possibleName || "").trim();
    const currentName = (input.dataset.currentName || "").trim();
    const participantLabel = (input.dataset.participantLabel || "").trim();
    if (possibleName) aliases.push(possibleName);
    if (currentName) aliases.push(currentName);
    if (participantLabel) aliases.push(participantLabel);
    if (aliases.length > 0) speakerAliases[key] = Array.from(new Set(aliases));
  });

  // Fallback: plain speaker inputs
  document.querySelectorAll('.speaker-name-input').forEach(input => {
    const val = input.value.trim();
    speakerMap[input.dataset.speaker] = val;
  });

  const filledCount = Object.values(speakerMap).filter(v => v).length;
  if (filledCount === 0) {
    Toast.error("请先填写至少一个真实姓名");
    return false;
  }

  var btn = document.querySelector('[data-action="save-speaker-map"]');
  var originalHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = applyToReport ? "保存并应用中…" : "保存中…"; }

  try {
    await API.put(`/api/meetings/${meetingId}/speaker-names`, { speakerMap, speakerAliases });
    if (applyToReport) {
      if (!confirmDuplicateParticipantNames()) return true;
      const result = await API.post(`/api/meetings/${meetingId}/apply-speaker-names`, {});
      let msg = "名字已保存并应用到报告";
      if (result.aliasReplacements && result.aliasReplacements.length > 0) {
        const detail = result.aliasReplacements.map(r => `${r.from} → ${r.to}`).join("、");
        msg += `\n名字纠错：${detail}`;
      }
      Toast.success(msg);
      fetchMeeting(meetingId);
      return true;
    }
    if (showSavedToast) Toast.success("名字已保存");
    return true;
  } catch (_) {
    /* error shown by API */
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
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

function editActionItem(index, meetingId) {
  if (!_currentReport) return;
  var actions = _currentReport.actions || [];
  var item = actions[index];
  if (!item) return;
  var row = document.getElementById("action-row-" + index);
  if (!row) return;
  row.innerHTML = `
    <td><input type="text" class="form-control" id="edit-action-task-${index}" value="${escapeAttr(item.task || item.action || "")}" style="border:2px solid #FF9900;"></td>
    <td><input type="text" class="form-control" id="edit-action-owner-${index}" value="${escapeAttr(item.owner || item.assignee || "")}" style="border:2px solid #FF9900;"></td>
    <td><input type="text" class="form-control" id="edit-action-deadline-${index}" value="${escapeAttr(item.deadline || item.dueDate || "")}" style="border:2px solid #FF9900;"></td>
    <td><input type="text" class="form-control" id="edit-action-priority-${index}" value="${escapeAttr(item.priority || "")}" style="border:2px solid #FF9900;"></td>
    <td>
      <button class="btn action-primary-btn btn-sm" data-action="save-action-item" data-index="${index}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
      <button class="btn btn-outline btn-sm" data-action="cancel-action-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
    </td>`;
  row.style.border = "2px solid #FF9900";
}

async function saveActionItem(index, meetingId) {
  if (!_currentReport) return;
  var actions = JSON.parse(JSON.stringify(_currentReport.actions || []));
  actions[index] = {
    task: document.getElementById("edit-action-task-" + index).value.trim(),
    owner: document.getElementById("edit-action-owner-" + index).value.trim(),
    deadline: document.getElementById("edit-action-deadline-" + index).value.trim(),
    priority: document.getElementById("edit-action-priority-" + index).value.trim(),
  };
  try {
    await API.patch("/api/meetings/" + meetingId + "/report", { section: "actions", data: actions });
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deleteActionItem(index, meetingId) {
  if (!_currentReport) return;
  if (!confirm("确认删除该待办事项？")) return;
  var actions = JSON.parse(JSON.stringify(_currentReport.actions || []));
  actions.splice(index, 1);
  try {
    await API.patch("/api/meetings/" + meetingId + "/report", { section: "actions", data: actions });
    Toast.success("已删除");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("删除失败");
  }
}

function editDecisionItem(index, meetingId) {
  if (!_currentReport) return;
  var decisions = _currentReport.decisions || [];
  var item = decisions[index];
  if (!item) return;
  var li = document.getElementById("decision-row-" + index);
  if (!li) return;
  var text = renderListItem(item);
  li.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <input type="text" class="form-control" id="edit-decision-text-${index}" value="${escapeAttr(text)}" style="flex:1;border:2px solid #FF9900;">
      <button class="btn action-primary-btn btn-sm" data-action="save-decision-item" data-index="${index}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
      <button class="btn btn-outline btn-sm" data-action="cancel-decision-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
    </div>`;
  li.style.border = "2px solid #FF9900";
  li.style.borderRadius = "4px";
  li.style.padding = "6px";
}

async function saveDecisionItem(index, meetingId) {
  if (!_currentReport) return;
  var decisions = JSON.parse(JSON.stringify(_currentReport.decisions || []));
  var newText = document.getElementById("edit-decision-text-" + index).value.trim();
  // Preserve object structure if it was an object, otherwise store as string
  if (typeof decisions[index] === "object" && decisions[index] !== null) {
    var d = decisions[index];
    if (d.decision !== undefined) d.decision = newText;
    else if (d.point !== undefined) d.point = newText;
    else if (d.text !== undefined) d.text = newText;
    else if (d.content !== undefined) d.content = newText;
    else d.decision = newText;
  } else {
    decisions[index] = newText;
  }
  try {
    await API.patch("/api/meetings/" + meetingId + "/report", { section: "decisions", data: decisions });
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deleteDecisionItem(index, meetingId) {
  if (!_currentReport) return;
  if (!confirm("确认删除该决策？")) return;
  var decisions = JSON.parse(JSON.stringify(_currentReport.decisions || []));
  decisions.splice(index, 1);
  try {
    await API.patch("/api/meetings/" + meetingId + "/report", { section: "decisions", data: decisions });
    Toast.success("已删除");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("删除失败");
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

/* ===== Participant Edit/Delete ===== */
function editParticipant(index, meetingId) {
  if (!_currentReport) return;
  var participants = _currentReport.participants || [];
  var item = participants[index];
  if (!item) return;
  var text = typeof item === "string" ? item : (item.name || JSON.stringify(item));
  var rows = document.querySelectorAll(".participant-row");
  var row = rows[index];
  if (!row) return;
  var labelEl = row.querySelector(".participant-label");
  if (!labelEl) return;
  var origText = labelEl.textContent;
  labelEl.innerHTML = `<input type="text" class="form-control" id="edit-participant-input-${index}" value="${escapeAttr(text)}" style="border:2px solid #FF9900;width:100%;">`;
  var input = document.getElementById("edit-participant-input-" + index);
  input.focus();
  function save() {
    var newVal = input.value.trim();
    if (!newVal) { input.focus(); return; }
    var arr = JSON.parse(JSON.stringify(participants));
    if (typeof arr[index] === "object" && arr[index] !== null) {
      if (arr[index].name !== undefined) arr[index].name = newVal;
      else arr[index] = newVal;
    } else {
      arr[index] = newVal;
    }
    patchReportSection(meetingId, "participants", arr)
      .then(function() { Toast.success("已保存"); fetchMeeting(meetingId); })
      .catch(function() { Toast.error("保存失败"); labelEl.textContent = origText; });
  }
  input.addEventListener("keydown", function(e) { if (e.key === "Enter") { e.preventDefault(); save(); } });
  input.addEventListener("blur", save);
}

async function deleteParticipant(index, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该参会人员？",
    onOk: async function() {
      var participants = JSON.parse(JSON.stringify(_currentReport.participants || []));
      participants.splice(index, 1);
      try {
        await patchReportSection(meetingId, "participants", participants);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
}

/* ===== Highlight Edit/Delete/Add ===== */
function editHighlight(index, meetingId) {
  if (!_currentReport) return;
  var highlights = _currentReport.highlights || [];
  var item = highlights[index];
  if (!item) return;
  var text = renderListItem(item);
  var li = document.getElementById("highlight-row-" + index);
  if (!li) return;
  li.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;width:100%;">
      <input type="text" class="form-control" id="edit-highlight-text-${index}" value="${escapeAttr(text)}" style="flex:1;border:2px solid #FF9900;">
      <button class="btn action-primary-btn btn-sm" data-action="save-highlight" data-index="${index}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
      <button class="btn btn-outline btn-sm" data-action="cancel-highlight-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
    </div>`;
  li.style.border = "2px solid #FF9900";
  li.style.borderRadius = "4px";
  li.style.padding = "6px";
}

async function saveHighlight(index, meetingId) {
  if (!_currentReport) return;
  var highlights = JSON.parse(JSON.stringify(_currentReport.highlights || []));
  var newText = document.getElementById("edit-highlight-text-" + index).value.trim();
  if (typeof highlights[index] === "object" && highlights[index] !== null) {
    var h = highlights[index];
    if (h.point !== undefined) h.point = newText;
    else if (h.text !== undefined) h.text = newText;
    else if (h.content !== undefined) h.content = newText;
    else h.point = newText;
  } else {
    highlights[index] = newText;
  }
  try {
    await patchReportSection(meetingId, "highlights", highlights);
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deleteHighlight(index, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该亮点？",
    onOk: async function() {
      var highlights = JSON.parse(JSON.stringify(_currentReport.highlights || []));
      highlights.splice(index, 1);
      try {
        await patchReportSection(meetingId, "highlights", highlights);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
}

async function addHighlight(meetingId) {
  var text = prompt("请输入新亮点：");
  if (!text || !text.trim()) return;
  var highlights = JSON.parse(JSON.stringify((_currentReport && _currentReport.highlights) || []));
  highlights.push(text.trim());
  try {
    await patchReportSection(meetingId, "highlights", highlights);
    Toast.success("已添加");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("添加失败");
  }
}

/* ===== Lowlight Edit/Delete/Add ===== */
function editLowlight(index, meetingId) {
  if (!_currentReport) return;
  var lowlights = _currentReport.lowlights || [];
  var item = lowlights[index];
  if (!item) return;
  var text = renderListItem(item);
  var li = document.getElementById("lowlight-row-" + index);
  if (!li) return;
  li.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;width:100%;">
      <input type="text" class="form-control" id="edit-lowlight-text-${index}" value="${escapeAttr(text)}" style="flex:1;border:2px solid #FF9900;">
      <button class="btn action-primary-btn btn-sm" data-action="save-lowlight" data-index="${index}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
      <button class="btn btn-outline btn-sm" data-action="cancel-lowlight-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
    </div>`;
  li.style.border = "2px solid #FF9900";
  li.style.borderRadius = "4px";
  li.style.padding = "6px";
}

async function saveLowlight(index, meetingId) {
  if (!_currentReport) return;
  var lowlights = JSON.parse(JSON.stringify(_currentReport.lowlights || []));
  var newText = document.getElementById("edit-lowlight-text-" + index).value.trim();
  if (typeof lowlights[index] === "object" && lowlights[index] !== null) {
    var l = lowlights[index];
    if (l.point !== undefined) l.point = newText;
    else if (l.text !== undefined) l.text = newText;
    else if (l.content !== undefined) l.content = newText;
    else l.point = newText;
  } else {
    lowlights[index] = newText;
  }
  try {
    await patchReportSection(meetingId, "lowlights", lowlights);
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deleteLowlight(index, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该待改进项？",
    onOk: async function() {
      var lowlights = JSON.parse(JSON.stringify(_currentReport.lowlights || []));
      lowlights.splice(index, 1);
      try {
        await patchReportSection(meetingId, "lowlights", lowlights);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
}

async function addLowlight(meetingId) {
  var text = prompt("请输入新待改进项：");
  if (!text || !text.trim()) return;
  var lowlights = JSON.parse(JSON.stringify((_currentReport && _currentReport.lowlights) || []));
  lowlights.push(text.trim());
  try {
    await patchReportSection(meetingId, "lowlights", lowlights);
    Toast.success("已添加");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("添加失败");
  }
}

/* ===== Risk Edit/Delete ===== */
function editRisk(index, meetingId) {
  if (!_currentReport) return;
  var risks = _currentReport.risks || [];
  var item = risks[index];
  if (!item) return;
  var li = document.getElementById("risk-row-" + index);
  if (!li) return;
  var isObj = typeof item === "object" && item !== null;
  var riskVal = isObj ? (item.risk || renderListItem(item)) : renderListItem(item);
  var mitigationVal = isObj && item.mitigation ? item.mitigation : "";
  li.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
      <input type="text" class="form-control" id="edit-risk-text-${index}" value="${escapeAttr(riskVal)}" placeholder="风险" style="flex:1;border:2px solid #FF9900;">
      <input type="text" class="form-control" id="edit-risk-mitigation-${index}" value="${escapeAttr(mitigationVal)}" placeholder="应对措施" style="flex:1;border:2px solid #FF9900;">
      <div style="display:flex;gap:8px;">
        <button class="btn action-primary-btn btn-sm" data-action="save-risk" data-index="${index}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
        <button class="btn btn-outline btn-sm" data-action="cancel-risk-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
      </div>
    </div>`;
  li.style.border = "2px solid #FF9900";
  li.style.borderRadius = "4px";
  li.style.padding = "6px";
}

async function saveRisk(index, meetingId) {
  if (!_currentReport) return;
  var risks = JSON.parse(JSON.stringify(_currentReport.risks || []));
  var riskText = document.getElementById("edit-risk-text-" + index).value.trim();
  var mitigationText = document.getElementById("edit-risk-mitigation-" + index).value.trim();
  if (!riskText) { Toast.error("风险描述不能为空"); return; }
  if (typeof risks[index] === "object" && risks[index] !== null) {
    risks[index].risk = riskText;
    risks[index].mitigation = mitigationText;
  } else {
    risks[index] = mitigationText ? { risk: riskText, mitigation: mitigationText } : riskText;
  }
  try {
    await patchReportSection(meetingId, "risks", risks);
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deleteRisk(index, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该风险项？",
    onOk: async function() {
      var risks = JSON.parse(JSON.stringify(_currentReport.risks || []));
      risks.splice(index, 1);
      try {
        await patchReportSection(meetingId, "risks", risks);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
}

/* ===== Announcement Edit/Delete ===== */
function editAnnouncement(index, meetingId) {
  if (!_currentReport) return;
  var announcements = _currentReport.announcements || [];
  var item = announcements[index];
  if (!item) return;
  var el = document.getElementById("announcement-row-" + index);
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
      <input type="text" class="form-control" id="edit-ann-title-${index}" value="${escapeAttr(item.title || '')}" placeholder="标题" style="border:2px solid #FF9900;">
      <input type="text" class="form-control" id="edit-ann-detail-${index}" value="${escapeAttr(item.detail || '')}" placeholder="详情" style="border:2px solid #FF9900;">
      <input type="text" class="form-control" id="edit-ann-owner-${index}" value="${escapeAttr(item.owner || '')}" placeholder="发布人" style="border:2px solid #FF9900;">
      <div style="display:flex;gap:8px;">
        <button class="btn action-primary-btn btn-sm" data-action="save-announcement" data-index="${index}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
        <button class="btn btn-outline btn-sm" data-action="cancel-announcement-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
      </div>
    </div>`;
  el.style.border = "2px solid #FF9900";
  el.style.borderRadius = "4px";
  el.style.padding = "6px";
}

async function saveAnnouncement(index, meetingId) {
  if (!_currentReport) return;
  var announcements = JSON.parse(JSON.stringify(_currentReport.announcements || []));
  var title = document.getElementById("edit-ann-title-" + index).value.trim();
  var detail = document.getElementById("edit-ann-detail-" + index).value.trim();
  var owner = document.getElementById("edit-ann-owner-" + index).value.trim();
  if (!title) { Toast.error("标题不能为空"); return; }
  announcements[index] = { title: title, detail: detail, owner: owner };
  try {
    await patchReportSection(meetingId, "announcements", announcements);
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deleteAnnouncement(index, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该公告？",
    onOk: async function() {
      var announcements = JSON.parse(JSON.stringify(_currentReport.announcements || []));
      announcements.splice(index, 1);
      try {
        await patchReportSection(meetingId, "announcements", announcements);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
}

/* ===== ProjectReview Edit/Delete ===== */
function editProjectReview(index, meetingId) {
  if (!_currentReport) return;
  var reviews = _currentReport.projectReviews || [];
  var pr = reviews[index];
  if (!pr) return;
  var el = document.getElementById("pr-row-" + index);
  if (!el) return;
  var headerDiv = el.querySelector(".section-title").parentElement;
  headerDiv.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
      <input type="text" class="form-control" id="edit-pr-project-${index}" value="${escapeAttr(pr.project || '')}" placeholder="项目名称" style="border:2px solid #FF9900;">
      <input type="text" class="form-control" id="edit-pr-progress-${index}" value="${escapeAttr(pr.progress || '')}" placeholder="进展" style="border:2px solid #FF9900;">
      <div style="display:flex;gap:8px;">
        <button class="btn action-primary-btn btn-sm" data-action="save-project-review" data-index="${index}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
        <button class="btn btn-outline btn-sm" data-action="cancel-pr-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
      </div>
    </div>`;
}

async function saveProjectReview(index, meetingId) {
  if (!_currentReport) return;
  var reviews = JSON.parse(JSON.stringify(_currentReport.projectReviews || []));
  var project = document.getElementById("edit-pr-project-" + index).value.trim();
  var progress = document.getElementById("edit-pr-progress-" + index).value.trim();
  if (!project) { Toast.error("项目名称不能为空"); return; }
  reviews[index].project = project;
  reviews[index].progress = progress;
  try {
    await patchReportSection(meetingId, "projectReviews", reviews);
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deleteProjectReview(index, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该项目？",
    onOk: async function() {
      var reviews = JSON.parse(JSON.stringify(_currentReport.projectReviews || []));
      reviews.splice(index, 1);
      try {
        await patchReportSection(meetingId, "projectReviews", reviews);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
}

/* ===== ProjectReview FollowUp Edit/Delete ===== */
function editPrFollowUp(prIndex, fuIndex, meetingId) {
  if (!_currentReport) return;
  var reviews = _currentReport.projectReviews || [];
  var pr = reviews[prIndex];
  if (!pr) return;
  var followUps = pr.followUps || [];
  var item = followUps[fuIndex];
  if (!item) return;
  var tr = document.getElementById("pr-followup-row-" + prIndex + "-" + fuIndex);
  if (!tr) return;
  tr.innerHTML = `
    <td><input type="text" class="form-control" id="edit-prfu-task-${prIndex}-${fuIndex}" value="${escapeAttr(item.task || '')}" style="border:2px solid #FF9900;"></td>
    <td><input type="text" class="form-control" id="edit-prfu-owner-${prIndex}-${fuIndex}" value="${escapeAttr(item.owner || '')}" style="border:2px solid #FF9900;width:80px;"></td>
    <td><input type="text" class="form-control" id="edit-prfu-deadline-${prIndex}-${fuIndex}" value="${escapeAttr(item.deadline || '')}" style="border:2px solid #FF9900;width:100px;"></td>
    <td>
      <div style="display:flex;gap:4px;">
        <button class="btn action-primary-btn btn-sm" data-action="save-pr-followup" data-pr-index="${prIndex}" data-index="${fuIndex}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
        <button class="btn btn-outline btn-sm" data-action="cancel-prfu-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
      </div>
    </td>`;
  tr.style.border = "2px solid #FF9900";
}

async function savePrFollowUp(prIndex, fuIndex, meetingId) {
  if (!_currentReport) return;
  var reviews = JSON.parse(JSON.stringify(_currentReport.projectReviews || []));
  var task = document.getElementById("edit-prfu-task-" + prIndex + "-" + fuIndex).value.trim();
  var owner = document.getElementById("edit-prfu-owner-" + prIndex + "-" + fuIndex).value.trim();
  var deadline = document.getElementById("edit-prfu-deadline-" + prIndex + "-" + fuIndex).value.trim();
  if (!task) { Toast.error("跟进事项不能为空"); return; }
  reviews[prIndex].followUps[fuIndex] = { task: task, owner: owner, deadline: deadline };
  try {
    await patchReportSection(meetingId, "projectReviews", reviews);
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deletePrFollowUp(prIndex, fuIndex, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该跟进事项？",
    onOk: async function() {
      var reviews = JSON.parse(JSON.stringify(_currentReport.projectReviews || []));
      reviews[prIndex].followUps.splice(fuIndex, 1);
      try {
        await patchReportSection(meetingId, "projectReviews", reviews);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
}

/* ===== ProjectReview Risk Edit/Delete ===== */
function editPrRisk(prIndex, riskIndex, meetingId) {
  if (!_currentReport) return;
  var reviews = _currentReport.projectReviews || [];
  var pr = reviews[prIndex];
  if (!pr) return;
  var risks = pr.risks || [];
  var item = risks[riskIndex];
  if (!item) return;
  var el = document.getElementById("pr-risk-row-" + prIndex + "-" + riskIndex);
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
      <input type="text" class="form-control" id="edit-prrisk-risk-${prIndex}-${riskIndex}" value="${escapeAttr(item.risk || '')}" placeholder="风险" style="border:2px solid #FF9900;">
      <input type="text" class="form-control" id="edit-prrisk-mitigation-${prIndex}-${riskIndex}" value="${escapeAttr(item.mitigation || '')}" placeholder="应对措施" style="border:2px solid #FF9900;">
      <div style="display:flex;gap:8px;">
        <button class="btn action-primary-btn btn-sm" data-action="save-pr-risk" data-pr-index="${prIndex}" data-index="${riskIndex}" data-meeting-id="${escapeAttr(meetingId)}">保存</button>
        <button class="btn btn-outline btn-sm" data-action="cancel-prrisk-edit" data-meeting-id="${escapeAttr(meetingId)}">取消</button>
      </div>
    </div>`;
  el.style.border = "2px solid #FF9900";
  el.style.borderRadius = "4px";
  el.style.padding = "6px";
}

async function savePrRisk(prIndex, riskIndex, meetingId) {
  if (!_currentReport) return;
  var reviews = JSON.parse(JSON.stringify(_currentReport.projectReviews || []));
  var risk = document.getElementById("edit-prrisk-risk-" + prIndex + "-" + riskIndex).value.trim();
  var mitigation = document.getElementById("edit-prrisk-mitigation-" + prIndex + "-" + riskIndex).value.trim();
  if (!risk) { Toast.error("风险描述不能为空"); return; }
  reviews[prIndex].risks[riskIndex] = { risk: risk, mitigation: mitigation };
  try {
    await patchReportSection(meetingId, "projectReviews", reviews);
    Toast.success("已保存");
    fetchMeeting(meetingId);
  } catch (_) {
    Toast.error("保存失败");
  }
}

async function deletePrRisk(prIndex, riskIndex, meetingId) {
  if (!_currentReport) return;
  showConfirm({
    title: "确认删除",
    body: "确认要删除该项目风险？",
    onOk: async function() {
      var reviews = JSON.parse(JSON.stringify(_currentReport.projectReviews || []));
      reviews[prIndex].risks.splice(riskIndex, 1);
      try {
        await patchReportSection(meetingId, "projectReviews", reviews);
        Toast.success("已删除");
        fetchMeeting(meetingId);
      } catch (_) {
        Toast.error("删除失败");
      }
    }
  });
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

function formatParticipantSpeakerLabel(speakerKey) {
  const match = String(speakerKey || "").match(/^SPEAKER_(\d+)$/);
  if (!match) return "参会人";
  return `参会人 ${Number(match[1]) + 1}`;
}

function getSpeakerEntries(report, speakerMap) {
  if (Array.isArray(report.speakerRoster) && report.speakerRoster.length > 0) {
    return report.speakerRoster.map((entry, index) => ({
      speakerKey: entry.speakerKey || `SPEAKER_${index}`,
      displayLabel: entry.displayLabel || formatParticipantSpeakerLabel(entry.speakerKey || `SPEAKER_${index}`),
      possibleName: entry.possibleName || entry.resolvedName || "",
      currentName: entry.resolvedName || "",
      keypoints: Array.isArray(entry.keypoints) ? entry.keypoints : [],
      savedName: (speakerMap && speakerMap[entry.speakerKey]) || entry.resolvedName || "",
    }));
  }

  const speakerKeypoints = report.speakerKeypoints || {};
  const participantHints = new Map();
  const participantNamesByIndex = [];
  const speakerKeys = new Set();

  (report.participants || []).forEach((participant, index) => {
    const raw = typeof participant === "string"
      ? participant
      : (participant && participant.name) || JSON.stringify(participant);
    participantNamesByIndex[index] = raw;
    const matches = raw.match(/SPEAKER_\d+/g) || [];
    matches.forEach((speakerKey) => {
      speakerKeys.add(speakerKey);
      if (!participantHints.has(speakerKey)) {
        const cleaned = raw.replace(/[（(]\s*SPEAKER_\d+\s*[）)]/g, "").trim();
        participantHints.set(speakerKey, cleaned || raw);
      }
    });
  });

  Object.keys(speakerKeypoints).forEach((speakerKey) => {
    if (/^SPEAKER_\d+$/.test(speakerKey)) speakerKeys.add(speakerKey);
  });

  Object.keys(speakerMap || {}).forEach((speakerKey) => {
    if (/^SPEAKER_\d+$/.test(speakerKey)) speakerKeys.add(speakerKey);
  });

  return Array.from(speakerKeys)
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]))
    .map((speakerKey, index) => ({
      speakerKey,
      displayLabel: formatParticipantSpeakerLabel(speakerKey),
      possibleName: participantHints.get(speakerKey) || participantNamesByIndex[index] || "",
      currentName: participantNamesByIndex[index] || "",
      keypoints: speakerKeypoints[speakerKey]
        || speakerKeypoints[(speakerMap && speakerMap[speakerKey]) || ""]
        || speakerKeypoints[participantHints.get(speakerKey) || ""]
        || speakerKeypoints[participantNamesByIndex[index] || ""]
        || Object.values(speakerKeypoints)[index]
        || [],
      savedName: (speakerMap && speakerMap[speakerKey]) || "",
    }));
}

function truncateParticipantHint(text, maxLength = 50) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).trim() + "…";
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
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

    // 如果刚刚通过下拉选了名字，忽略这次 input 事件
    if (input.dataset.selectedName) {
      input.value = input.dataset.selectedName;
      delete input.dataset.selectedName;
      var sugBox2 = input.parentElement.querySelector(".name-suggestions");
      if (sugBox2) { sugBox2.style.display = "none"; sugBox2.innerHTML = ""; }
      return;
    }

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

function applyParticipantSuggestion(itemEl) {
  var name = itemEl && itemEl.dataset ? itemEl.dataset.name : "";
  var wrap = itemEl && itemEl.closest ? itemEl.closest(".participant-search-wrap") : null;
  if (!name || !wrap) return;

  var inp = wrap.querySelector(".participant-search-input");
  var sugBox = wrap.querySelector(".name-suggestions");
  if (!inp) return;

  inp.value = name;
  inp.dataset.selectedName = name;
  if (sugBox) {
    sugBox.style.display = "none";
    sugBox.innerHTML = "";
  }
  inp.dispatchEvent(new Event("change", { bubbles: true }));
  inp.focus();
}

document.addEventListener("mousedown", function(e) {
  var item = e.target && e.target.closest ? e.target.closest(".suggestion-item") : null;
  if (!item) return;
  e.preventDefault();
  applyParticipantSuggestion(item);
});

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
    applyParticipantSuggestion(e.target);
    return;
  }
});

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
    case "auto-name":          autoNameMeeting(id, el); break;
    case "start-detail-edit":  startDetailEdit(id, el.dataset.title, el.dataset.type); break;
    case "save-detail-edit":   saveDetailEdit(id); break;
    case "cancel-detail-edit": cancelDetailEdit(); break;
    case "save-speaker-map":   saveSpeakerMap(id, { applyToReport: true }); break;
    case "apply-speaker-names": applySpokenNames(id); break;
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
    case "edit-action-item":    editActionItem(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-action-item":    saveActionItem(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-action-item":  deleteActionItem(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "cancel-action-edit":  fetchMeeting(el.dataset.meetingId); break;
    case "edit-decision-item":  editDecisionItem(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-decision-item":  saveDecisionItem(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-decision-item":deleteDecisionItem(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "cancel-decision-edit":fetchMeeting(el.dataset.meetingId); break;
    case "edit-participant":    editParticipant(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-participant":  deleteParticipant(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "edit-highlight":      editHighlight(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-highlight":      saveHighlight(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-highlight":    deleteHighlight(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "add-highlight":       addHighlight(el.dataset.meetingId); break;
    case "cancel-highlight-edit":fetchMeeting(el.dataset.meetingId); break;
    case "edit-lowlight":       editLowlight(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-lowlight":       saveLowlight(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-lowlight":     deleteLowlight(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "add-lowlight":        addLowlight(el.dataset.meetingId); break;
    case "cancel-lowlight-edit":fetchMeeting(el.dataset.meetingId); break;
    case "edit-risk":           editRisk(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-risk":           saveRisk(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-risk":         deleteRisk(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "cancel-risk-edit":    fetchMeeting(el.dataset.meetingId); break;
    case "edit-announcement":   editAnnouncement(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-announcement":   saveAnnouncement(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-announcement": deleteAnnouncement(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "cancel-announcement-edit":fetchMeeting(el.dataset.meetingId); break;
    case "edit-project-review":  editProjectReview(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-project-review":  saveProjectReview(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-project-review":deleteProjectReview(parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "cancel-pr-edit":       fetchMeeting(el.dataset.meetingId); break;
    case "edit-pr-followup":     editPrFollowUp(parseInt(el.dataset.prIndex), parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-pr-followup":     savePrFollowUp(parseInt(el.dataset.prIndex), parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-pr-followup":   deletePrFollowUp(parseInt(el.dataset.prIndex), parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "cancel-prfu-edit":     fetchMeeting(el.dataset.meetingId); break;
    case "edit-pr-risk":         editPrRisk(parseInt(el.dataset.prIndex), parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "save-pr-risk":         savePrRisk(parseInt(el.dataset.prIndex), parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "delete-pr-risk":       deletePrRisk(parseInt(el.dataset.prIndex), parseInt(el.dataset.index), el.dataset.meetingId); break;
    case "cancel-prrisk-edit":   fetchMeeting(el.dataset.meetingId); break;
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
    // fetchMeeting will automatically set up dynamic polling based on meeting state
    fetchMeeting(meetingId);
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
