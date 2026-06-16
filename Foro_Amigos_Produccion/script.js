/* =========================================================
   Círculo Privado - script.js producción
   Frontend listo para Netlify + Backend listo para Render.

   IMPORTANTE:
   1. Cuando subas el backend a Render, copia tu URL.
   2. Pégala en RENDER_BACKEND_URL.
      Ejemplo:
      const RENDER_BACKEND_URL = "https://foro-amigos-api.onrender.com";
   ========================================================= */

// =========================================================
// Configuración de API local/producción
// =========================================================

const RENDER_BACKEND_URL = "https://foro-amigos-produccion.onrender.com";

const isLocal =
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost" ||
  window.location.protocol === "file:";

function normalizeUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

const API_URL = isLocal
  ? "http://127.0.0.1:8000"
  : normalizeUrl(RENDER_BACKEND_URL);

const WS_URL = isLocal
  ? "ws://127.0.0.1:8000/ws"
  : `${API_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws`;

const STORAGE_TOKEN_KEY = "circulo_privado_token";
const STORAGE_USER_KEY = "circulo_privado_user";

// =========================================================
// Elementos existentes del HTML
// =========================================================

const body = document.body;
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const openSidebarBtn = document.getElementById("openSidebarBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const collapseSidebarBtn = document.getElementById("collapseSidebarBtn");
const searchInput = document.getElementById("searchInput");
const postsContainer = document.getElementById("posts");
const emptyState = document.getElementById("emptyState");
const filterButtons = document.querySelectorAll(".feed-filter__btn");

const composerInput = document.querySelector(".composer__input");
const navbarNewPostBtn = document.querySelector(".new-post-btn");
const composerActionButtons = document.querySelectorAll(".composer__actions button");
const imageComposerButton = document.querySelector(".composer__actions button:first-child");

const hiddenImageInput = document.createElement("input");
hiddenImageInput.type = "file";
hiddenImageInput.accept = "image/png,image/jpeg,image/webp,image/gif";
hiddenImageInput.style.display = "none";
document.body.appendChild(hiddenImageInput);

let currentFilter = "all";
let socket = null;
let currentUploadedImageUrl = null;

// =========================================================
// Estilos dinámicos para comentarios, eliminar e imágenes reales
// =========================================================

function injectDynamicStyles() {
  const style = document.createElement("style");

  style.textContent = `
    .comments-panel {
      border-top: 1px solid var(--line);
      padding: 12px 14px 14px;
      background: rgba(255, 255, 255, 0.015);
    }

    .comments-list {
      display: grid;
      gap: 10px;
      margin-bottom: 12px;
    }

    .comment-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }

    .comment-item__body {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--bg-elevated);
    }

    .comment-item__body strong {
      display: block;
      margin-bottom: 3px;
      color: var(--text);
      font-size: 13px;
    }

    .comment-item__body p {
      margin: 0;
      color: var(--text-soft);
      font-size: 13px;
      line-height: 1.45;
    }

    .comment-form {
      display: grid;
      grid-template-columns: 1fr 42px;
      gap: 8px;
    }

    .comment-form input {
      min-height: 40px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      outline: 0;
      background: var(--card);
      color: var(--text);
    }

    .comment-form input:focus {
      border-color: var(--accent);
    }

    .comment-form button {
      border: 0;
      border-radius: 8px;
      background: var(--accent);
      color: #07110E;
      font-size: 20px;
      font-weight: 800;
    }

    .delete-post-btn {
      color: var(--danger);
    }

    .delete-post-btn:hover {
      color: var(--danger);
      background: rgba(255, 95, 109, 0.12);
    }

    .post-card__media img {
      width: 100%;
      height: 100%;
      max-height: 420px;
      object-fit: cover;
      border-radius: 8px;
      display: block;
    }
  `;

  document.head.appendChild(style);
}

// =========================================================
// Autenticación básica
// =========================================================

function getToken() {
  return localStorage.getItem(STORAGE_TOKEN_KEY);
}

function getCurrentUser() {
  const rawUser = localStorage.getItem(STORAGE_USER_KEY);

  if (!rawUser) return null;

  try {
    return JSON.parse(rawUser);
  } catch {
    return null;
  }
}

function saveSession(token, user) {
  localStorage.setItem(STORAGE_TOKEN_KEY, token);
  localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_USER_KEY);
}

function ensureApiConfigured() {
  if (!API_URL) {
    throw new Error(
      "Falta configurar RENDER_BACKEND_URL en script.js. Pega la URL de tu backend de Render."
    );
  }
}

async function requestJson(path, options = {}) {
  ensureApiConfigured();

  const token = getToken();

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    clearSession();
    throw new Error("Tu sesión expiró o el token es inválido. Inicia sesión otra vez.");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "Ocurrió un error en el servidor.");
  }

  return data;
}

async function ensureAuthenticated() {
  const existingToken = getToken();

  if (existingToken) {
    try {
      await requestJson("/me");
      return;
    } catch {
      clearSession();
    }
  }

  const hasAccount = confirm(
    "¿Ya tienes una cuenta?\n\nAceptar = Iniciar sesión\nCancelar = Registrarte"
  );

  if (hasAccount) {
    await loginWithPrompt();
  } else {
    await registerWithPrompt();
  }
}

async function loginWithPrompt() {
  const username = prompt("Usuario:", "rodrigo");
  if (!username) return loginWithPrompt();

  const password = prompt("Contraseña:", "1234");
  if (!password) return loginWithPrompt();

  const response = await fetch(`${API_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    alert(data?.detail || "No se pudo iniciar sesión.");
    return loginWithPrompt();
  }

  saveSession(data.token, data.user);
}

async function registerWithPrompt() {
  const displayName = prompt("Nombre para mostrar:", "Nuevo Amigo");
  if (!displayName) return registerWithPrompt();

  const username = prompt("Usuario sin espacios:", displayName.toLowerCase().replaceAll(" ", ""));
  if (!username) return registerWithPrompt();

  const password = prompt("Contraseña:", "1234");
  if (!password) return registerWithPrompt();

  const response = await fetch(`${API_URL}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username,
      password,
      display_name: displayName
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    alert(data?.detail || "No se pudo registrar el usuario.");
    return registerWithPrompt();
  }

  saveSession(data.token, data.user);
}

// =========================================================
// Sidebar móvil y colapsable
// =========================================================

function openSidebar() {
  sidebar.classList.add("is-open");
  overlay.classList.add("is-visible");
  overlay.setAttribute("aria-hidden", "false");
}

function closeSidebar() {
  sidebar.classList.remove("is-open");
  overlay.classList.remove("is-visible");
  overlay.setAttribute("aria-hidden", "true");
}

function toggleSidebarCollapse() {
  body.classList.toggle("sidebar-collapsed");
}

// =========================================================
// Posts
// =========================================================

async function loadPosts() {
  try {
    const posts = await requestJson("/posts");
    postsContainer.innerHTML = "";

    posts.forEach((post) => {
      postsContainer.appendChild(createPostElement(post));
    });

    filterPosts();
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

function createPostElement(post) {
  const loggedUser = getCurrentUser();
  const canDelete = loggedUser && post.author && Number(loggedUser.id) === Number(post.author.id);

  const article = document.createElement("article");
  article.className = "post-card";
  article.dataset.postId = String(post.id);
  article.dataset.category = post.channel;

  article.innerHTML = `
    <header class="post-card__header">
      <span class="avatar ${getAvatarClass(post.author.avatar_initials)}">
        ${escapeHtml(post.author.avatar_initials)}
      </span>

      <div class="post-card__meta">
        <div>
          <strong>${escapeHtml(post.author.display_name)}</strong>
          <span class="post-card__channel">#${escapeHtml(post.channel)}</span>
        </div>
        <small>${formatRelativeTime(post.created_at)}</small>
      </div>

      <button class="post-card__more ${canDelete ? "delete-post-btn" : ""}" 
              type="button" 
              aria-label="${canDelete ? "Eliminar publicación" : "Más opciones"}"
              ${canDelete ? `data-post-id="${post.id}"` : ""}>
        <i class="bx ${canDelete ? "bx-trash" : "bx-dots-horizontal-rounded"}"></i>
      </button>
    </header>

    <div class="post-card__body">
      <p>${escapeHtml(post.content)}</p>

      ${
        post.image_url
          ? `
            <div class="post-card__media">
              <img src="${escapeHtml(post.image_url)}" alt="Imagen adjunta" />
            </div>
          `
          : ""
      }
    </div>

    <footer class="post-card__footer">
      <button
        class="reaction-btn ${post.liked_by_me ? "is-liked" : ""}"
        type="button"
        data-post-id="${post.id}"
        data-liked="${post.liked_by_me ? "true" : "false"}"
      >
        <i class="bx ${post.liked_by_me ? "bxs-heart" : "bx-heart"}"></i>
        <span>Me gusta</span>
        <strong class="like-count">${post.likes}</strong>
      </button>

      <button class="comment-btn" type="button" data-post-id="${post.id}">
        <i class="bx bx-message-rounded"></i>
        <span>Comentarios</span>
        <strong class="comments-count">${post.comments_count ?? 0}</strong>
      </button>

      <button class="share-btn" type="button">
        <i class="bx bx-share-alt"></i>
        <span>Compartir</span>
      </button>
    </footer>

    <section class="comments-panel" data-comments-panel hidden>
      <div class="comments-list" data-comments-list></div>

      <form class="comment-form" data-comment-form>
        <input 
          type="text" 
          name="comment" 
          placeholder="Escribe un comentario..." 
          autocomplete="off"
        />
        <button type="submit">
          <i class="bx bx-send"></i>
        </button>
      </form>
    </section>
  `;

  return article;
}

function prependPost(post) {
  const existingPost = postsContainer.querySelector(`[data-post-id="${post.id}"]`);

  if (existingPost) return;

  postsContainer.prepend(createPostElement(post));
  filterPosts();
}

function openCreatePostDialog() {
  const imageUrl = currentUploadedImageUrl;

  const content = prompt("Escribe tu nuevo post para el grupo:");

  if (!content || !content.trim()) {
    currentUploadedImageUrl = null;
    return;
  }

  const channel = prompt(
    "Canal del post: general, memes, coordinación-salidas o gaming",
    "general"
  );

  createPost({
    content: content.trim(),
    channel: channel || "general",
    image_url: imageUrl
  });

  currentUploadedImageUrl = null;
}

async function createPost(payload) {
  try {
    const createdPost = await requestJson("/posts", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      prependPost(createdPost);
    }
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

async function deletePost(postId) {
  const confirmed = confirm("¿Seguro que quieres eliminar esta publicación?");

  if (!confirmed) return;

  try {
    await requestJson(`/posts/${postId}`, {
      method: "DELETE"
    });

    removePostFromDOM(postId);
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

function removePostFromDOM(postId) {
  const postCard = postsContainer.querySelector(`[data-post-id="${postId}"]`);

  if (postCard) {
    postCard.remove();
  }

  filterPosts();
}

// =========================================================
// Upload Cloudinary vía backend
// =========================================================

async function uploadImage(file) {
  const token = getToken();

  if (!token) {
    throw new Error("Necesitas iniciar sesión para subir imágenes.");
  }

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "No se pudo subir la imagen.");
  }

  return data.url;
}

function handleImageButtonClick() {
  hiddenImageInput.value = "";
  hiddenImageInput.click();
}

hiddenImageInput.addEventListener("change", async () => {
  const file = hiddenImageInput.files?.[0];

  if (!file) return;

  try {
    currentUploadedImageUrl = await uploadImage(file);

    alert("Imagen subida correctamente. Ahora escribe el post que acompañará la imagen.");

    openCreatePostDialog();
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
});

// =========================================================
// Me gusta
// =========================================================

async function handleLikeClick(button) {
  const postId = button.dataset.postId;

  if (!postId) return;

  try {
    const result = await requestJson(`/posts/${postId}/like`, {
      method: "POST"
    });

    updateLikeButton(postId, result.likes, result.liked_by_me);
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

function updateLikeButton(postId, likes, likedByMe = null) {
  const postCard = postsContainer.querySelector(`[data-post-id="${postId}"]`);
  if (!postCard) return;

  const button = postCard.querySelector(".reaction-btn");
  const icon = button.querySelector("i");
  const counter = button.querySelector(".like-count");

  counter.textContent = String(likes);

  if (likedByMe === null) {
    return;
  }

  button.dataset.liked = likedByMe ? "true" : "false";
  button.classList.toggle("is-liked", likedByMe);

  icon.classList.toggle("bxs-heart", likedByMe);
  icon.classList.toggle("bx-heart", !likedByMe);
}

// =========================================================
// Comentarios
// =========================================================

async function toggleComments(postId) {
  const postCard = postsContainer.querySelector(`[data-post-id="${postId}"]`);
  if (!postCard) return;

  const panel = postCard.querySelector("[data-comments-panel]");
  const list = postCard.querySelector("[data-comments-list]");

  if (!panel || !list) return;

  const isOpening = panel.hidden;

  panel.hidden = !panel.hidden;

  if (isOpening && !panel.dataset.loaded) {
    await loadComments(postId);
    panel.dataset.loaded = "true";
  }
}

async function loadComments(postId) {
  const postCard = postsContainer.querySelector(`[data-post-id="${postId}"]`);
  const list = postCard?.querySelector("[data-comments-list]");

  if (!list) return;

  list.innerHTML = "";

  try {
    const comments = await requestJson(`/posts/${postId}/comments`);

    comments.forEach((comment) => {
      list.appendChild(createCommentElement(comment));
    });
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

function createCommentElement(comment) {
  const item = document.createElement("div");
  item.className = "comment-item";
  item.dataset.commentId = String(comment.id);

  item.innerHTML = `
    <span class="avatar ${getAvatarClass(comment.author.avatar_initials)}">
      ${escapeHtml(comment.author.avatar_initials)}
    </span>

    <div class="comment-item__body">
      <strong>${escapeHtml(comment.author.display_name)}</strong>
      <p>${escapeHtml(comment.content)}</p>
    </div>
  `;

  return item;
}

async function submitComment(postId, content) {
  try {
    const comment = await requestJson(`/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content })
    });

    appendComment(postId, comment);
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

function appendComment(postId, comment) {
  const postCard = postsContainer.querySelector(`[data-post-id="${postId}"]`);
  if (!postCard) return;

  const list = postCard.querySelector("[data-comments-list]");
  const panel = postCard.querySelector("[data-comments-panel]");

  if (!list || !panel) return;

  const existingComment = list.querySelector(`[data-comment-id="${comment.id}"]`);

  if (existingComment) return;

  list.appendChild(createCommentElement(comment));
  panel.dataset.loaded = "true";
}

function updateCommentsCount(postId, commentsCount) {
  const postCard = postsContainer.querySelector(`[data-post-id="${postId}"]`);
  if (!postCard) return;

  const counter = postCard.querySelector(".comments-count");

  if (counter) {
    counter.textContent = String(commentsCount);
  }
}

// =========================================================
// Filtros y búsqueda
// =========================================================

function setActiveFilter(filterValue) {
  currentFilter = filterValue;

  filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === filterValue);
  });

  filterPosts();
}

function filterPosts() {
  const searchText = searchInput.value.trim().toLowerCase();
  const posts = document.querySelectorAll(".post-card");

  let visiblePosts = 0;

  posts.forEach((post) => {
    const category = post.dataset.category;
    const content = post.textContent.toLowerCase();

    const matchesFilter = currentFilter === "all" || category === currentFilter;
    const matchesSearch = content.includes(searchText);

    const shouldShow = matchesFilter && matchesSearch;

    post.style.display = shouldShow ? "" : "none";

    if (shouldShow) {
      visiblePosts += 1;
    }
  });

  emptyState.classList.toggle("is-visible", visiblePosts === 0);
}

// =========================================================
// WebSocket
// =========================================================

function connectWebSocket() {
  const token = getToken();

  if (!token || !WS_URL) return;

  socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);

  socket.addEventListener("open", () => {
    console.log("WebSocket conectado.");
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "new_post") {
      prependPost(payload.post);
    }

    if (payload.type === "like_updated") {
      updateLikeButton(payload.post_id, payload.likes, null);
    }

    if (payload.type === "new_comment") {
      appendComment(payload.post_id, payload.comment);
      updateCommentsCount(payload.post_id, payload.comments_count);
    }

    if (payload.type === "post_deleted") {
      removePostFromDOM(payload.post_id);
    }
  });

  socket.addEventListener("close", () => {
    console.warn("WebSocket cerrado. Reintentando en 3 segundos...");

    setTimeout(() => {
      if (getToken()) {
        connectWebSocket();
      }
    }, 3000);
  });

  socket.addEventListener("error", (error) => {
    console.error("Error WebSocket:", error);
  });
}

// =========================================================
// Eventos
// =========================================================

openSidebarBtn.addEventListener("click", openSidebar);
closeSidebarBtn.addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);
collapseSidebarBtn.addEventListener("click", toggleSidebarCollapse);

composerInput.addEventListener("click", openCreatePostDialog);
navbarNewPostBtn.addEventListener("click", openCreatePostDialog);

composerActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button === imageComposerButton) {
      handleImageButtonClick();
      return;
    }

    openCreatePostDialog();
  });
});

postsContainer.addEventListener("click", async (event) => {
  const likeButton = event.target.closest(".reaction-btn");
  const commentButton = event.target.closest(".comment-btn");
  const deleteButton = event.target.closest(".delete-post-btn");

  if (likeButton) {
    await handleLikeClick(likeButton);
    return;
  }

  if (commentButton) {
    await toggleComments(commentButton.dataset.postId);
    return;
  }

  if (deleteButton) {
    await deletePost(deleteButton.dataset.postId);
  }
});

postsContainer.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-comment-form]");

  if (!form) return;

  event.preventDefault();

  const postCard = form.closest(".post-card");
  const input = form.querySelector("input[name='comment']");

  if (!postCard || !input) return;

  const postId = postCard.dataset.postId;
  const content = input.value.trim();

  if (!content) return;

  input.value = "";

  await submitComment(postId, content);
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveFilter(button.dataset.filter);
  });
});

searchInput.addEventListener("input", filterPosts);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSidebar();
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 980) {
    closeSidebar();
  }
});

// =========================================================
// Helpers
// =========================================================

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getAvatarClass(initials) {
  const classes = ["avatar--blue", "avatar--green", "avatar--purple", "avatar--me"];
  const firstChar = String(initials || "U").charCodeAt(0);
  const index = Number.isNaN(firstChar) ? 0 : firstChar % classes.length;

  return classes[index];
}

function formatRelativeTime(isoDate) {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now - date;

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (Number.isNaN(date.getTime())) return "hace un momento";
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  if (hours < 24) return `hace ${hours} h`;
  if (days === 1) return "ayer";

  return date.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

// =========================================================
// Inicio de aplicación
// =========================================================

(async function initApp() {
  try {
    injectDynamicStyles();
    ensureApiConfigured();
    await ensureAuthenticated();
    await loadPosts();
    connectWebSocket();
  } catch (error) {
    console.error(error);
    alert(error.message || "No se pudo iniciar la aplicación.");
  }
})();
