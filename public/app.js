const iconPaths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  video: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="m15 10 6-3v10l-6-3z"/>',
  reports: '<path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  statistics: '<path d="M5 20V11M12 20V4M19 20v-7"/>',
  maps: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevronDown: '<path d="m7 10 5 5 5-5"/>',
  chevronLeft: '<path d="m14 18-6-6 6-6"/>',
  chevronRight: '<path d="m10 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M16 15v3"/>',
  sort: '<path d="M8 5v14M8 19l-3-3m3 3 3-3M16 5v14m0-14 3 3m-3-3-3 3"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4"/>',
  cloudUpload: '<path d="M7 18H6a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 8.5 4.5 4.5 0 0 1 18 18h-1"/><path d="M12 22V12m0 0-4 4m4-4 4 4"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  drone: '<path d="M8 12h8m-4-4v8M5 7 3 5m16 2 2-2m-16 14-2 2m16-2 2 2"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  disk: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  trend: '<path d="m3 17 6-6 4 4 8-9m0 0h-6m6 0v6"/>',
};

function icon(name, className = "") {
  const stroke = name === "play" ? "" : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const paths = name === "play" ? '<path d="m8 5 12 7-12 7z"/>' : iconPaths[name] || "";
  return `<svg class="${className}" viewBox="0 0 24 24" ${stroke} aria-hidden="true">${paths}</svg>`;
}

document.querySelectorAll("[data-icon]").forEach((element) => {
  element.innerHTML = icon(element.dataset.icon);
});

const state = {
  status: "",
  drone: "",
  period: "all",
  sort: "newest",
  query: "",
  page: 1,
  pageSize: 6,
  framesPage: 1,
  total: 0,
  statistics: { all: 1248, processed: 1240, processing: 6, failed: 2 },
  storage: { used_gb: 186, total_gb: 500 },
  pollTimer: null,
  items: [],
  activeView: "videos",
  requestNumber: 0,
  framesRequestNumber: 0,
  searchTimer: null,
};

const elements = {
  grid: document.querySelector("#video-grid"),
  results: document.querySelector("#results-label"),
  pagination: document.querySelector("#pagination"),
  message: document.querySelector("#catalog-message"),
  search: document.querySelector("#search-input"),
  drone: document.querySelector("#drone-select"),
  period: document.querySelector("#period-select"),
  sort: document.querySelector("#sort-select"),
  fileInput: document.querySelector("#file-input"),
  dropzone: document.querySelector("#dropzone"),
  queue: document.querySelector("#upload-queue"),
  storageLabel: document.querySelector(".storage-label"),
  storageUsed: document.querySelector(".storage-used"),
  modal: document.querySelector("#modal-layer"),
  toastRegion: document.querySelector("#toast-region"),
  pageTitle: document.querySelector("#page-title"),
  videoView: document.querySelector("#videos-view"),
  secondaryView: document.querySelector("#secondary-view"),
  sidebar: document.querySelector("#sidebar"),
  menuToggle: document.querySelector(".menu-toggle"),
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });

function localDate(value) {
  const date = new Date(value);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = Math.round((midnight - targetDay) / 86400000);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);

  if (dayOffset === 0) return `Сегодня, ${time}`;
  if (dayOffset === 1) return `Вчера, ${time}`;
  if (dayOffset <= 6) return `${new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date)}, ${time}`;
  return `${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date)}, ${time}`;
}

function statusLabel(video) {
  if (video.status === "processed") return ["Обработано", "status-processed"];
  if (video.status === "failed") return ["Ошибка обработки", "status-failed"];
  if (video.source === "upload" && video.status === "queued") return ["В очереди на обработку", "status-queued"];
  if (video.source === "upload" && video.status === "processing" && video.progress === 0) return ["Загружается модель…", "status-processing"];
  if (video.progress > 0) return [`Обработка · ${video.progress}%`, "status-processing"];
  return ["В очереди", "status-queued"];
}

function thumbnailPath(video) {
  if (video.source === "upload" && video.processed_frames > 0) {
    return `/api/videos/${encodeURIComponent(video.id)}/frames/0/image`;
  }
  return `/media/${["construction", "forest", "city"].includes(video.thumbnail) ? video.thumbnail : "construction"}.svg`;
}

function renderCard(video) {
  const [label, badgeClass] = statusLabel(video);
  const progress = video.source === "upload" && video.status === "processing"
    ? `<div class="progress-track" aria-label="Обработка видео: ${video.progress}%"><span class="progress-fill" style="width:${video.progress}%"></span></div>`
    : "";
  const cardMeta = video.source === "upload"
    ? `${escapeHtml(localDate(video.created_at))} · ${video.processed_frames || 0}/${video.frame_count || "…"} кадров · найдено ${video.detection_count || 0} объектов`
    : `${escapeHtml(localDate(video.created_at))} · ${escapeHtml(video.drone)}`;
  return `
    <article class="video-card" data-video-id="${escapeHtml(video.id)}">
      <div class="thumbnail">
        <img src="${thumbnailPath(video)}" alt="" loading="lazy" decoding="async">
        <button class="play-button" type="button" data-action="details" aria-label="Открыть ${escapeHtml(video.title)}">${icon("play")}</button>
        <span class="duration">${escapeHtml(video.duration)}</span>
      </div>
      <div class="card-content">
        <div class="card-heading">
          <h3 class="video-title">${escapeHtml(video.title)}</h3>
          <button class="card-menu-button" type="button" data-action="menu" aria-label="Действия: ${escapeHtml(video.title)}">${icon("dots")}</button>
        </div>
        <p class="video-meta">${cardMeta}</p>
        <div class="card-bottom"><span class="status-badge ${badgeClass}">${escapeHtml(label)}</span><span class="file-size">${escapeHtml(video.size)}</span></div>
        ${progress}
      </div>
    </article>`;
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const button = (page, text, disabled = false, active = false, label = text) =>
    `<button class="page-button${active ? " is-active" : ""}" type="button" data-page="${page}" aria-label="${label}"${active ? ' aria-current="page"' : ""}${disabled ? " disabled" : ""}>${text}</button>`;

  let pages = [];
  if (totalPages <= 5) {
    pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  } else if (state.page <= 3) {
    pages = [1, 2, 3, "…", totalPages];
  } else if (state.page >= totalPages - 2) {
    pages = [1, "…", totalPages - 2, totalPages - 1, totalPages];
  } else {
    pages = [1, "…", state.page - 1, state.page, state.page + 1, "…", totalPages];
  }

  elements.pagination.innerHTML = [
    button(Math.max(1, state.page - 1), icon("chevronLeft"), state.page === 1, false, "Предыдущая страница"),
    ...pages.map((page) =>
      page === "…" ? '<span class="page-ellipsis" aria-hidden="true">…</span>' : button(page, page, false, page === state.page)
    ),
    button(Math.min(totalPages, state.page + 1), icon("chevronRight"), state.page === totalPages, false, "Следующая страница"),
  ].join("");
}

function renderCards() {
  if (!state.items.length) {
    elements.grid.innerHTML = `<div class="empty-state"><strong>Ничего не найдено</strong><span>Измените фильтры или попробуйте другой поисковый запрос.</span></div>`;
    return;
  }
  elements.grid.innerHTML = state.items.map(renderCard).join("");
  elements.grid.querySelectorAll(".thumbnail img[src^='/api/videos/']").forEach((image) => {
    image.addEventListener("error", () => {
      image.src = "/media/construction.svg";
    }, { once: true });
  });
}

function renderCatalog() {
  renderCards();
  if (state.total === 0) {
    elements.results.textContent = "Совпадений не найдено";
  } else {
    const first = (state.page - 1) * state.pageSize + 1;
    const last = Math.min(state.page * state.pageSize, state.total);
    elements.results.textContent = `Показано ${first}–${last} из ${state.total.toLocaleString("ru-RU")} записей`;
  }
  renderPagination();
  for (const [key, count] of Object.entries(state.statistics)) {
    const countElement = document.querySelector(`[data-count="${key}"]`);
    if (countElement) countElement.textContent = Number(count).toLocaleString("ru-RU");
  }
  const used = Number(state.storage.used_gb);
  const total = Number(state.storage.total_gb);
  elements.storageLabel.innerHTML = `Хранилище: <strong>${used.toFixed(used % 1 ? 1 : 0).replace(".", ",")}</strong> из ${total} ГБ`;
  elements.storageUsed.style.width = `${Math.min(100, (used / total) * 100)}%`;
  syncProcessingPolling();
}

function syncProcessingPolling() {
  const hasActiveUpload = state.items.some(
    (video) => video.source === "upload" && ["queued", "processing"].includes(video.status),
  );
  if (hasActiveUpload && !state.pollTimer) {
    state.pollTimer = window.setInterval(() => {
      if (state.activeView === "videos") loadVideos();
    }, 2500);
  } else if (!hasActiveUpload && state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function showCatalogError(message) {
  elements.message.hidden = false;
  elements.message.textContent = message;
  elements.results.textContent = "Не удалось загрузить библиотеку";
  elements.grid.innerHTML = `<div class="empty-state"><strong>Связь с сервером потеряна</strong><span>${escapeHtml(message)}</span><button class="button button-primary" type="button" data-action="retry">Повторить</button></div>`;
}

async function loadVideos() {
  if (state.activeView !== "videos") return;
  const requestNumber = ++state.requestNumber;
  elements.message.hidden = true;
  elements.results.textContent = "Загружаем библиотеку…";
  const params = new URLSearchParams({
    page: String(state.page),
    page_size: String(state.pageSize),
    period: state.period,
    sort: state.sort,
  });
  if (state.status) params.set("status", state.status);
  if (state.drone) params.set("drone", state.drone);
  if (state.query) params.set("query", state.query);

  try {
    const response = await fetch(`/api/videos?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || `Ошибка сервера (${response.status})`);
    if (requestNumber !== state.requestNumber) return;
    state.items = payload.items;
    state.total = payload.total;
    state.statistics = payload.statistics;
    state.storage = payload.storage;
    renderCatalog();
    updateOpenVideoModal();
  } catch (error) {
    if (requestNumber === state.requestNumber) showCatalogError(error.message || "Не удалось связаться с сервером.");
  }
}

function toast(message, isError = false) {
  const element = document.createElement("div");
  element.className = `toast${isError ? " is-error" : ""}`;
  element.setAttribute("role", isError ? "alert" : "status");
  element.textContent = message;
  elements.toastRegion.append(element);
  window.setTimeout(() => element.remove(), 4000);
}

function formatFrameTime(value) {
  const minutes = Math.floor(value / 60);
  const seconds = (value % 60).toFixed(2).padStart(5, "0").replace(".", ",");
  return `${String(minutes).padStart(2, "0")}:${seconds}`;
}

function renderFrameGallery(payload) {
  const gallery = elements.modal.querySelector(".frame-gallery");
  const summary = elements.modal.querySelector(".frame-gallery-status");
  const pagination = elements.modal.querySelector(".frame-gallery-pagination");
  if (!gallery || !summary || !pagination) return;

  const signature = `${payload.page}:${payload.total}:${payload.status}:${payload.processed_frames}`;
  if (gallery.dataset.signature === signature) return;
  gallery.dataset.signature = signature;
  summary.textContent = payload.total
    ? `Кадры каждые 0,25 с · ${payload.total.toLocaleString("ru-RU")} кадров · ${payload.status === "processed" ? "обработка завершена" : "обработка видео"}`
    : payload.status === "failed"
      ? "Кадры не удалось обработать."
      : "Модель выделяет кадры каждые 0,25 с. Результаты появятся здесь.";

  if (!payload.items.length) {
    gallery.innerHTML = payload.status === "failed"
      ? '<p class="frame-gallery-empty is-error">Видео не удалось обработать. Попробуйте загрузить другой файл.</p>'
      : '<p class="frame-gallery-empty">Загрузка модели и подготовка первых кадров…</p>';
  } else {
    gallery.innerHTML = payload.items.map((frame) => {
      const counts = new Map();
      for (const detection of frame.detections) {
        counts.set(detection.name, (counts.get(detection.name) || 0) + 1);
      }
      const labels = [...counts.entries()].map(([name, count]) => `${escapeHtml(name)} × ${count}`);
      const description = labels.length ? labels.join(", ") : "Объектов не найдено";
      const suffix = String(frame.frame_index).padStart(8, "0");
      return `
        <article class="frame-card">
          <a class="frame-image-link" href="${escapeHtml(frame.image_url)}" target="_blank" rel="noreferrer" aria-label="Открыть обработанный кадр ${escapeHtml(formatFrameTime(frame.timestamp_seconds))}">
            <img src="${escapeHtml(frame.image_url)}" alt="Кадр ${escapeHtml(formatFrameTime(frame.timestamp_seconds))}; ${description}" loading="lazy">
          </a>
          <div class="frame-card-copy">
            <strong>${escapeHtml(formatFrameTime(frame.timestamp_seconds))}</strong>
            <span>${description}</span>
            <a href="${escapeHtml(frame.image_url)}" download="aeroview-frame-${suffix}.jpg">Скачать кадр</a>
          </div>
        </article>`;
    }).join("");
  }

  const pageCount = Math.max(1, Math.ceil(payload.total / payload.page_size));
  if (pageCount > 1) {
    pagination.innerHTML = `
      <button class="frame-page-button" type="button" data-frames-page="${payload.page - 1}" aria-label="Предыдущая страница кадров"${payload.page <= 1 ? " disabled" : ""}>${icon("chevronLeft")}</button>
      <span>Страница ${payload.page} из ${pageCount}</span>
      <button class="frame-page-button" type="button" data-frames-page="${payload.page + 1}" aria-label="Следующая страница кадров"${payload.page >= pageCount ? " disabled" : ""}>${icon("chevronRight")}</button>`;
  } else {
    pagination.innerHTML = "";
  }
}

async function loadVideoFrames(video, page) {
  if (!video || video.source !== "upload" || elements.modal.dataset.videoId !== video.id) return;
  const gallery = elements.modal.querySelector(".frame-gallery");
  if (!gallery) return;
  const requestNumber = ++state.framesRequestNumber;
  try {
    const response = await fetch(`/api/videos/${encodeURIComponent(video.id)}/frames?page=${page}&page_size=12`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "Не удалось загрузить кадры видео.");
    if (requestNumber === state.framesRequestNumber && elements.modal.dataset.videoId === video.id) renderFrameGallery(payload);
  } catch (error) {
    if (requestNumber === state.framesRequestNumber && elements.modal.dataset.videoId === video.id) {
      elements.modal.querySelector(".frame-gallery-status").textContent = error.message;
      gallery.innerHTML = '<p class="frame-gallery-empty is-error">Не удалось загрузить кадры.</p>';
    }
  }
}

function updateOpenVideoModal() {
  const videoId = elements.modal.dataset.videoId;
  if (!videoId || elements.modal.hidden) return;
  const video = state.items.find((item) => item.id === videoId);
  if (!video) return;
  const [label] = statusLabel(video);
  const headingStatus = elements.modal.querySelector(".modal-header p");
  if (headingStatus) headingStatus.textContent = `${label} · ${localDate(video.created_at)}`;
  const processed = elements.modal.querySelector("[data-modal-processed-frames]");
  if (processed) {
    processed.textContent = `${(video.processed_frames || 0).toLocaleString("ru-RU")} / ${video.frame_count || "…"} кадров · найдено ${(video.detection_count || 0).toLocaleString("ru-RU")} объектов`;
  }
  const error = elements.modal.querySelector(".modal-processing-error");
  if (error) {
    error.hidden = video.status !== "failed";
    error.textContent = video.error_message || "Не удалось обработать видео.";
  }
  loadVideoFrames(video, state.framesPage);
}

function openDetails(video) {
  if (!video) return;
  state.framesPage = 1;
  const [label] = statusLabel(video);
  const media = video.source === "upload"
    ? `<video class="uploaded-player" controls playsinline preload="metadata" poster="${thumbnailPath(video)}" src="/api/videos/${encodeURIComponent(video.id)}/file">Ваш браузер не поддерживает воспроизведение видео.</video>`
    : `<img src="${thumbnailPath(video)}" alt="Превью записи «${escapeHtml(video.title)}»"><span class="modal-play" aria-hidden="true">${icon("play")}</span>`;
  elements.modal.innerHTML = `
    <section class="video-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-media">${media}</div>
      <div class="modal-body">
        <div class="modal-header"><div><h2 id="modal-title">${escapeHtml(video.title)}</h2><p>${escapeHtml(label)} · ${escapeHtml(localDate(video.created_at))}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Закрыть">${icon("close")}</button></div>
        <div class="modal-details">
          <div class="modal-detail"><span>${video.source === "upload" ? "Модель" : "Дрон"}</span><span>${video.source === "upload" ? "YOLO · waste" : escapeHtml(video.drone)}</span></div>
          <div class="modal-detail"><span>Длительность</span><span>${escapeHtml(video.duration)}</span></div>
          <div class="modal-detail"><span>Размер файла</span><span>${escapeHtml(video.size)}</span></div>
        </div>
        ${video.source === "upload" ? `
          <section class="frame-panel" aria-label="Результаты распознавания на видеокадрах">
            <div class="frame-panel-heading"><div><h3>Кадры и обнаруженные объекты</h3><p>Модель <strong>waste</strong> анализирует видео с шагом 0,25 секунды.</p></div><a class="original-video-link" href="/api/videos/${encodeURIComponent(video.id)}/file" download>Скачать видео</a></div>
            <p class="frame-gallery-status">Загружаем обработанные кадры…</p>
            <p class="frame-processed-summary" data-modal-processed-frames>${(video.processed_frames || 0).toLocaleString("ru-RU")} / ${video.frame_count || "…"} кадров · найдено ${(video.detection_count || 0).toLocaleString("ru-RU")} объектов</p>
            <p class="modal-processing-error"${video.status === "failed" ? "" : " hidden"}>${escapeHtml(video.error_message || "Не удалось обработать видео.")}</p>
            <div class="frame-gallery"></div>
            <nav class="frame-gallery-pagination" aria-label="Страницы кадров"></nav>
          </section>` : '<p class="modal-note">Для демонстрационных записей доступен кадр-превью; оригинальный видеофайл не входит в образцы проекта.</p>'}
      </div>
    </section>`;
  elements.modal.dataset.videoId = video.id;
  elements.modal.hidden = false;
  elements.modal.querySelector(".modal-close").focus();
  loadVideoFrames(video, state.framesPage);
}

function closeModal() {
  if (elements.modal.hidden) return;
  const player = elements.modal.querySelector("video");
  if (player) player.pause();
  elements.modal.hidden = true;
  delete elements.modal.dataset.videoId;
  state.framesRequestNumber += 1;
  elements.modal.innerHTML = "";
}

function uploadItem(file) {
  const row = document.createElement("div");
  row.className = "upload-item";
  row.innerHTML = `<span class="upload-file-copy"></span><span class="upload-file-status">Подготовка…</span><span class="upload-progress-track"><span class="upload-progress-fill"></span></span>`;
  row.querySelector(".upload-file-copy").textContent = file.name;
  elements.queue.prepend(row);
  return {
    row,
    status: row.querySelector(".upload-file-status"),
    progress: row.querySelector(".upload-progress-fill"),
  };
}

function uploadFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["mp4", "mov", "avi"].includes(extension)) {
    toast(`Формат «${file.name}» не поддерживается. Выберите MP4, MOV или AVI.`, true);
    return;
  }
  if (file.size === 0) {
    toast(`Файл «${file.name}» пуст.`, true);
    return;
  }
  if (file.size > 10 * 1024 * 1024 * 1024) {
    toast(`Файл «${file.name}» превышает ограничение 10 ГБ.`, true);
    return;
  }

  const indicator = uploadItem(file);
  const request = new XMLHttpRequest();
  request.open("POST", "/api/videos/upload");
  request.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const percentage = Math.round((event.loaded / event.total) * 100);
    indicator.progress.style.width = `${percentage}%`;
    indicator.status.textContent = `Загрузка ${percentage}%`;
  });
  request.addEventListener("load", () => {
    let response = {};
    try {
      response = JSON.parse(request.responseText);
    } catch {
      indicator.status.textContent = "Ошибка ответа сервера";
      toast(`Не удалось разобрать ответ при загрузке «${file.name}».`, true);
      return;
    }
    if (request.status < 200 || request.status >= 300) {
      indicator.status.textContent = "Ошибка загрузки";
      toast(response.detail || `Не удалось загрузить «${file.name}».`, true);
      return;
    }
    indicator.progress.style.width = "100%";
    indicator.status.textContent = "Сохранено · обработчик не подключён";
    toast(`«${file.name}» сохранён. Автоматическая обработка видео пока не настроена.`);
    state.page = 1;
    loadVideos();
  });
  request.addEventListener("error", () => {
    indicator.status.textContent = "Сеть недоступна";
    toast(`Не удалось передать «${file.name}»: проверьте подключение к серверу.`, true);
  });
  request.addEventListener("abort", () => {
    indicator.status.textContent = "Загрузка отменена";
    toast(`Загрузка «${file.name}» отменена.`, true);
  });
  const form = new FormData();
  form.append("file", file, file.name);
  request.send(form);
}

function renderSecondaryView(view) {
  state.activeView = view;
  const titles = {
    overview: ["Обзор", "Все важные показатели проекта — на одной панели."],
    reports: ["Отчёты", "История полётов и сводные отчёты проекта."],
    statistics: ["Статистика", "Сводка по записям и загрузке хранилища."],
    maps: ["Карты", "Визуальный обзор района аэросъёмки."],
  };
  const [title, description] = titles[view];
  const reportRows = [
    ["Северный борт · Облёт №128", "Сегодня, 09:42", "В обработке"],
    ["Лесной участок · Облёт №127", "Сегодня, 08:15", "Обработано"],
    ["Промзона · Облёт №126", "Вчера, 16:30", "Обработано"],
  ];
  const isMap = view === "maps";
  const panel = isMap
    ? `<div class="secondary-card"><h3>Северный карьер</h3><div class="map-preview"><span class="map-label">Северный карьер · 6 записей</span></div></div>`
    : `<div class="secondary-card"><h3>${view === "reports" ? "Недавние полёты" : "Активность проекта"}</h3>${reportRows.map(([name, date, status]) => `<div class="activity-row"><span>${name}</span><span>${date} · ${status}</span></div>`).join("")}</div>`;

  elements.pageTitle.textContent = title;
  elements.videoView.hidden = true;
  elements.secondaryView.hidden = false;
  elements.secondaryView.innerHTML = `
    <p class="section-kicker">Проект · Северный карьер</p>
    <h2 class="section-title">${title}</h2>
    <p class="section-description">${description}</p>
    <div class="metric-grid">
      <article class="metric-card"><span class="metric-label">Всего записей</span><strong class="metric-value">${Number(state.statistics.all).toLocaleString("ru-RU")}</strong></article>
      <article class="metric-card"><span class="metric-label">Обработано</span><strong class="metric-value">${Number(state.statistics.processed).toLocaleString("ru-RU")}</strong></article>
      <article class="metric-card"><span class="metric-label">В обработке</span><strong class="metric-value">${Number(state.statistics.processing).toLocaleString("ru-RU")}</strong></article>
      <article class="metric-card"><span class="metric-label">Занято места</span><strong class="metric-value">${Number(state.storage.used_gb).toFixed(0)} ГБ</strong></article>
    </div>
    ${panel}
    ${view === "overview" ? '<button type="button" class="button button-primary secondary-open-videos">Открыть библиотеку записей</button>' : ""}
  `;
  const openVideos = elements.secondaryView.querySelector(".secondary-open-videos");
  if (openVideos) openVideos.addEventListener("click", () => navigate("videos"));
}

function navigate(view) {
  state.activeView = view;
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  elements.sidebar.classList.remove("is-open");
  elements.menuToggle.setAttribute("aria-expanded", "false");
  if (view === "videos") {
    elements.pageTitle.textContent = "Видео с дронов";
    elements.videoView.hidden = false;
    elements.secondaryView.hidden = true;
    loadVideos();
  } else {
    renderSecondaryView(view);
  }
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    navigate(link.dataset.view);
  });
});

document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  navigate("overview");
});

document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((item) => item.classList.toggle("is-active", item === tab));
    state.status = tab.dataset.status;
    state.page = 1;
    loadVideos();
  });
});

elements.search.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    state.query = elements.search.value.trim();
    state.page = 1;
    loadVideos();
  }, 220);
});

elements.drone.addEventListener("change", () => {
  state.drone = elements.drone.value;
  state.page = 1;
  loadVideos();
});

elements.period.addEventListener("change", () => {
  state.period = elements.period.value;
  state.page = 1;
  loadVideos();
});

elements.sort.addEventListener("change", () => {
  state.sort = elements.sort.value;
  state.page = 1;
  loadVideos();
});

elements.pagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  loadVideos();
});

elements.grid.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "retry") {
    loadVideos();
    return;
  }
  const card = action.closest("[data-video-id]");
  const video = state.items.find((item) => item.id === card?.dataset.videoId);
  if (!video) return;
  if (action.dataset.action === "details") {
    openDetails(video);
    return;
  }
  if (action.dataset.action === "menu") {
    const existing = card.querySelector(".video-menu");
    document.querySelectorAll(".video-menu").forEach((menu) => menu.remove());
    if (existing) return;
    const menu = document.createElement("div");
    menu.className = "video-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<button type="button" role="menuitem" data-menu-action="details">Открыть запись</button><button type="button" role="menuitem" data-menu-action="copy">Скопировать название</button>${video.source === "upload" ? '<a role="menuitem" href="/api/videos/' + encodeURIComponent(video.id) + '/file" download>Скачать оригинал</a>' : ""}`;
    card.append(menu);
    const bounds = action.getBoundingClientRect();
    menu.style.top = `${Math.min(bounds.bottom + 4, window.innerHeight - 104)}px`;
    menu.style.left = `${Math.min(bounds.right - 172, window.innerWidth - 182)}px`;
  }
});

document.addEventListener("click", async (event) => {
  const menuAction = event.target.closest("[data-menu-action]");
  if (menuAction) {
    const card = menuAction.closest("[data-video-id]");
    const video = state.items.find((item) => item.id === card?.dataset.videoId);
    document.querySelectorAll(".video-menu").forEach((menu) => menu.remove());
    if (menuAction.dataset.menuAction === "details") openDetails(video);
    if (menuAction.dataset.menuAction === "copy" && video) {
      try {
        await navigator.clipboard.writeText(video.title);
        toast("Название записи скопировано.");
      } catch {
        toast("Не удалось скопировать название.", true);
      }
    }
    return;
  }
  if (!event.target.closest(".video-menu") && !event.target.closest('[data-action="menu"]')) {
    document.querySelectorAll(".video-menu").forEach((menu) => menu.remove());
  }
});

elements.modal.addEventListener("click", (event) => {
  const framePage = event.target.closest("[data-frames-page]");
  if (framePage && !framePage.disabled) {
    state.framesPage = Number(framePage.dataset.framesPage);
    const video = state.items.find((item) => item.id === elements.modal.dataset.videoId);
    loadVideoFrames(video, state.framesPage);
    return;
  }
  if (event.target === elements.modal || event.target.closest('[data-action="close-modal"]')) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    document.querySelectorAll(".video-menu").forEach((menu) => menu.remove());
    elements.sidebar.classList.remove("is-open");
    elements.menuToggle.setAttribute("aria-expanded", "false");
  }
});

elements.menuToggle.addEventListener("click", () => {
  const isOpen = elements.sidebar.classList.toggle("is-open");
  elements.menuToggle.setAttribute("aria-expanded", String(isOpen));
});

document.querySelector(".upload-trigger").addEventListener("click", () => elements.fileInput.click());
elements.dropzone.addEventListener("click", () => elements.fileInput.click());
elements.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("is-dragging");
});
elements.dropzone.addEventListener("dragleave", (event) => {
  if (!elements.dropzone.contains(event.relatedTarget)) elements.dropzone.classList.remove("is-dragging");
});
elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("is-dragging");
  Array.from(event.dataTransfer.files).forEach(uploadFile);
});
elements.fileInput.addEventListener("change", () => {
  Array.from(elements.fileInput.files).forEach(uploadFile);
  elements.fileInput.value = "";
});

loadVideos();
