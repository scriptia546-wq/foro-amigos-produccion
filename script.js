// Círculo / Foro Amigos V4
// Cambia esta URL si tu backend de Render tiene otro nombre.
const API_BASE = (window.CIRCULO_API_URL || localStorage.getItem('CIRCULO_API_URL') || 'https://foro-amigos-produccion.onrender.com').replace(/\/$/, '');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  token: localStorage.getItem('circulo_token') || '',
  user: null,
  feed: 'all',
  view: 'feed',
  posts: [],
  friends: [],
  notifications: [],
  channelCounts: {},
  selectedChannel: 'general',
  chatFriend: null,
  chatTimer: null,
  pollRefresh: null,
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  bindElements();
  bindEvents();
  boot();
});

function bindElements(){
  els.modalLayer = $('#modalLayer');
  els.toastStack = $('#toastStack');
  els.hiddenFileInput = $('#hiddenFileInput');
  els.sidebar = $('#sidebar');
  els.mobileMenuBtn = $('#mobileMenuBtn');
  els.collapseMenuBtn = $('#collapseMenuBtn');
  els.postText = $('#postText');
  els.sendPostBtn = $('#sendPostBtn');
  els.feed = $('#feed');
  els.viewTitle = $('#viewTitle');
  els.channelTabs = $('#channelTabs');
  els.topAvatar = $('#topAvatar');
  els.composerAvatar = $('#composerAvatar');
  els.topName = $('#topName');
  els.profileBtn = $('#profileBtn');
  els.profileMenu = $('#profileMenu');
  els.bellBtn = $('#bellBtn');
  els.bellBadge = $('#bellBadge');
  els.globalSearch = $('#globalSearch');
  els.searchResults = $('#searchResults');
  els.clearSearch = $('#clearSearch');
  els.onlineFriends = $('#onlineFriends');
  els.offlineFriends = $('#offlineFriends');
  els.refreshFriendsBtn = $('#refreshFriendsBtn');
}

function bindEvents(){
  els.mobileMenuBtn.addEventListener('click', () => els.sidebar.classList.toggle('open'));
  els.collapseMenuBtn.addEventListener('click', () => {
    if (window.innerWidth <= 820) els.sidebar.classList.toggle('open');
    else els.sidebar.classList.toggle('minimized');
  });
  els.postText.addEventListener('input', () => autoGrow(els.postText));
  els.postText.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendTextPost();
  });
  els.sendPostBtn.addEventListener('click', sendTextPost);
  $$('.composer-tools button').forEach(btn => btn.addEventListener('click', () => openCompose(btn.dataset.compose)));
  $$('.tab', els.channelTabs).forEach(tab => tab.addEventListener('click', () => setFeed(tab.dataset.filter)));
  $$('.side-link').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  els.profileBtn.addEventListener('click', () => els.profileMenu.classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!els.profileBtn.contains(e.target) && !els.profileMenu.contains(e.target)) els.profileMenu.classList.add('hidden');
    if (!els.searchResults.contains(e.target) && !els.globalSearch.contains(e.target)) els.searchResults.classList.add('hidden');
  });
  els.profileMenu.addEventListener('click', onProfileMenu);
  els.bellBtn.addEventListener('click', openNotifications);
  els.clearSearch.addEventListener('click', () => { els.globalSearch.value = ''; els.searchResults.classList.add('hidden'); renderFeed(); });
  els.globalSearch.addEventListener('input', debounce(onSearch, 250));
  els.refreshFriendsBtn.addEventListener('click', loadFriends);
}

async function boot(){
  if (!state.token) {
    openAuthModal();
    return;
  }
  try {
    const data = await api('/api/me');
    state.user = data.user;
    updateCurrentUserUI();
    await Promise.all([loadPosts(), loadFriends(), loadNotifications()]);
    startLoops();
  } catch (err) {
    localStorage.removeItem('circulo_token');
    state.token = '';
    openAuthModal();
  }
}

function startLoops(){
  setInterval(() => api('/api/heartbeat', {method:'POST'}).catch(()=>{}), 25000);
  setInterval(loadFriends, 12000);
  setInterval(loadNotifications, 10000);
  setInterval(() => loadPosts(false), 15000);
}

async function api(path, options = {}){
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(API_BASE + path, {...options, headers});
  let data;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = {detail: txt || 'Respuesta inválida del servidor.'}; }
  if (!res.ok) {
    const msg = data.detail || data.message || 'Error de conexión.';
    throw new Error(msg);
  }
  return data;
}

function toast(message, type='ok'){
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = message;
  els.toastStack.appendChild(div);
  setTimeout(() => div.remove(), 4200);
}

function modal({title, body, footer = '', large = false, className = ''}){
  els.modalLayer.classList.remove('hidden');
  els.modalLayer.innerHTML = `
    <div class="modal ${large ? 'large' : ''} ${className}">
      <div class="modal-head"><h2>${escapeHTML(title)}</h2><button class="close-btn" data-close-modal>×</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  $$('[data-close-modal]', els.modalLayer).forEach(btn => btn.addEventListener('click', closeModal));
  els.modalLayer.addEventListener('click', layerCloseOnce);
  return $('.modal', els.modalLayer);
}

function layerCloseOnce(e){
  if (e.target === els.modalLayer) closeModal();
}

function closeModal(){
  els.modalLayer.classList.add('hidden');
  els.modalLayer.innerHTML = '';
  els.modalLayer.removeEventListener('click', layerCloseOnce);
  if (state.chatTimer) { clearInterval(state.chatTimer); state.chatTimer = null; }
}

function openAuthModal(){
  const body = `
    <div class="auth-tabs">
      <button class="active" data-auth-tab="login">Iniciar sesión</button>
      <button data-auth-tab="register">Registrarse</button>
    </div>
    <form id="loginForm" class="auth-form">
      <div class="field"><label>Nombre de usuario</label><input name="username" autocomplete="username" required></div>
      <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required></div>
      <button class="primary-btn" type="submit">Iniciar sesión</button>
    </form>
    <form id="registerForm" class="auth-form hidden">
      <div class="field"><label>Nombre visible</label><input name="display_name" required placeholder="Ej. Rodrigo"></div>
      <div class="field"><label>Nombre de usuario</label><input name="username" required placeholder="Ej. rodrigo"></div>
      <div class="field"><label>Fecha de nacimiento</label><input name="birth_date" type="date" required></div>
      <div class="field"><label>Contraseña</label><input name="password" type="password" required minlength="4"></div>
      <button class="primary-btn" type="submit">Registrarme y entrar</button>
    </form>
    <p class="muted-box" style="margin-top:14px">Tus publicaciones, chats, amigos y perfil se guardan en la base de datos.</p>`;
  modal({title:'Bienvenido a Círculo', body, large:false});
  $$('.auth-tabs button', els.modalLayer).forEach(b => b.addEventListener('click', () => {
    $$('.auth-tabs button', els.modalLayer).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#loginForm', els.modalLayer).classList.toggle('hidden', b.dataset.authTab !== 'login');
    $('#registerForm', els.modalLayer).classList.toggle('hidden', b.dataset.authTab !== 'register');
  }));
  $('#loginForm', els.modalLayer).addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const data = await api('/api/auth/login', {method:'POST', body:JSON.stringify(Object.fromEntries(f))});
      onLogged(data);
    } catch(err){ toast(err.message, 'error'); }
  });
  $('#registerForm', els.modalLayer).addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const data = await api('/api/auth/register', {method:'POST', body:JSON.stringify(Object.fromEntries(f))});
      onLogged(data);
    } catch(err){ toast(err.message, 'error'); }
  });
}

async function onLogged(data){
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('circulo_token', state.token);
  closeModal();
  updateCurrentUserUI();
  await Promise.all([loadPosts(), loadFriends(), loadNotifications()]);
  startLoops();
  toast('Entraste correctamente.');
}

function updateCurrentUserUI(){
  if (!state.user) return;
  els.topName.textContent = state.user.display_name;
  renderAvatar(els.topAvatar, state.user);
  renderAvatar(els.composerAvatar, state.user);
}

function initials(user){
  const source = (user?.display_name || user?.username || '?').trim();
  return source.split(/\s+/).map(p => p[0]).join('').slice(0,2).toUpperCase();
}

function renderAvatar(el, user){
  el.innerHTML = '';
  if (user?.avatar_url) {
    const img = document.createElement('img');
    img.src = user.avatar_url;
    img.alt = user.display_name || user.username;
    el.appendChild(img);
  } else {
    el.textContent = initials(user);
  }
}

function avatarHTML(user, cls='avatar'){
  if (user?.avatar_url) return `<span class="${cls}"><img src="${escapeAttr(user.avatar_url)}" alt=""></span>`;
  return `<span class="${cls}">${escapeHTML(initials(user))}</span>`;
}

async function onProfileMenu(e){
  const btn = e.target.closest('button');
  if (!btn) return;
  els.profileMenu.classList.add('hidden');
  const action = btn.dataset.action;
  if (action === 'view-profile') openProfile(state.user.id);
  if (action === 'edit-profile') openEditProfile();
  if (action === 'notifications') openNotifications();
  if (action === 'logout') logout();
}

async function logout(){
  try { await api('/api/auth/logout', {method:'POST'}); } catch {}
  localStorage.removeItem('circulo_token');
  state.token = '';
  state.user = null;
  state.posts = [];
  renderFeed();
  openAuthModal();
}

async function openProfile(userId){
  try {
    const data = await api(`/api/users/${userId}`);
    const u = data.user;
    const isMe = u.id === state.user.id;
    const body = `
      <div class="profile-modal-head">
        ${avatarHTML(u,'avatar avatar-lg')}
        <div>
          <h3>${escapeHTML(u.display_name)}</h3>
          <small>@${escapeHTML(u.username)} · ${u.online ? 'Conectado' : 'Desconectado'}</small>
        </div>
      </div>
      <p class="post-text" style="margin-top:22px">${escapeHTML(u.bio || 'Este usuario aún no tiene biografía.')}</p>
      <div class="profile-stats"><strong>Publicaciones:</strong> ${u.publications || 0}</div>`;
    const footer = isMe
      ? `<button class="primary-btn" id="profileEditBtn">Editar mi perfil</button>`
      : `${u.are_friends ? `<button class="primary-btn" id="openChatFromProfile">Enviar mensaje</button>` : `<button class="primary-btn" id="addFriendBtn">Agregar amigo</button>`}`;
    modal({title:'Perfil', body, footer});
    if (isMe) $('#profileEditBtn').addEventListener('click', openEditProfile);
    else if (u.are_friends) $('#openChatFromProfile').addEventListener('click', () => openPrivateChat(u));
    else $('#addFriendBtn').addEventListener('click', async () => {
      try { const r = await api('/api/friends/request', {method:'POST', body:JSON.stringify({to_user_id:u.id})}); toast(r.message || 'Solicitud enviada.'); }
      catch(err){ toast(err.message,'error'); }
    });
  } catch(err){ toast(err.message, 'error'); }
}

function openEditProfile(){
  const u = state.user;
  const body = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
      ${avatarHTML(u,'avatar avatar-lg')}
      <button class="soft-btn" id="avatarUploadBtn">Cambiar foto desde galería</button>
    </div>
    <div class="field"><label>Nombre</label><input id="editName" value="${escapeAttr(u.display_name)}"></div>
    <div class="field"><label>Biografía</label><textarea id="editBio" placeholder="Escribe algo sobre ti...">${escapeHTML(u.bio || '')}</textarea></div>
    <div class="field"><label>Avatar URL</label><input id="editAvatar" value="${escapeAttr(u.avatar_url || '')}" placeholder="Opcional: pega una URL de imagen"></div>`;
  modal({title:'Editar perfil', body, footer:`<button class="soft-btn" data-close-modal>Cancelar</button><button class="primary-btn" id="saveProfileBtn">Guardar perfil</button>`, large:true});
  $('[data-close-modal]', els.modalLayer).addEventListener('click', closeModal);
  $('#avatarUploadBtn').addEventListener('click', () => pickFile('image/*', async file => {
    try {
      toast('Subiendo foto...', 'ok');
      const up = await uploadToCloudinary(file, 'circulo/avatars');
      $('#editAvatar').value = up.url;
      $('.avatar-lg', els.modalLayer).innerHTML = `<img src="${escapeAttr(up.url)}" alt="">`;
      toast('Foto subida.');
    } catch(err){ toast(err.message, 'error'); }
  }));
  $('#saveProfileBtn').addEventListener('click', async () => {
    try {
      const data = await api('/api/me', {method:'PUT', body:JSON.stringify({
        display_name: $('#editName').value,
        bio: $('#editBio').value,
        avatar_url: $('#editAvatar').value,
      })});
      state.user = data.user;
      updateCurrentUserUI();
      closeModal();
      toast('Perfil actualizado.');
      loadPosts(false);
      loadFriends();
    } catch(err){ toast(err.message,'error'); }
  });
}

async function loadPosts(showLoader=true){
  if (!state.token) return;
  if (showLoader) els.feed.innerHTML = `<div class="empty-state">Cargando...</div>`;
  try {
    const feed = viewToFeed();
    const q = els.globalSearch.value.trim();
    const data = await api(`/api/posts?feed=${encodeURIComponent(feed)}&q=${encodeURIComponent(q)}`);
    state.posts = data.posts || [];
    renderFeed();
  } catch(err){ if(showLoader) els.feed.innerHTML = `<div class="empty-state">${escapeHTML(err.message)}</div>`; }
}

function viewToFeed(){
  if (state.view === 'saved') return 'saved';
  if (state.view === 'media') return 'media';
  if (state.view === 'downloads') return 'downloads';
  if (state.view === 'events') return 'events';
  return state.feed;
}

function setFeed(feed){
  state.view = 'feed';
  state.feed = feed;
  if (['general','memes','gaming','coordinación-salidas'].includes(feed)) state.selectedChannel = feed;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.filter === feed));
  $$('.side-link').forEach(x => x.classList.toggle('active', x.dataset.view === 'feed'));
  els.viewTitle.classList.add('hidden');
  if (feed !== 'all' && feed !== 'events') markChannelRead(feed);
  loadPosts();
}

function setView(view){
  state.view = view;
  $$('.side-link').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  els.sidebar.classList.remove('open');
  const titles = {feed:'Última actividad', media:'Archivos/Media', events:'Eventos', saved:'Guardados', downloads:'Descargas'};
  if (view === 'feed') els.viewTitle.classList.add('hidden');
  else { els.viewTitle.textContent = titles[view]; els.viewTitle.classList.remove('hidden'); }
  loadPosts();
}

function renderFeed(){
  const posts = state.posts || [];
  if (!posts.length) {
    els.feed.innerHTML = `<div class="empty-state">No se encontraron publicaciones con esa búsqueda.</div>`;
    return;
  }
  if (state.view === 'media') return renderMediaView(posts);
  if (state.view === 'downloads') return renderDownloadsView(posts);
  els.feed.innerHTML = posts.map(renderPost).join('');
  bindPostEvents();
}

function renderPost(p){
  const body = renderPostBody(p);
  const saveText = p.saved ? '▰ Guardado' : '▯ Guardar';
  return `
    <article class="post" data-post-id="${p.id}">
      <div class="post-head">
        ${avatarHTML(p.user)}
        <div class="post-user">
          <strong>${escapeHTML(p.user.display_name)}</strong> <a data-user-id="${p.user.id}" href="#">#${escapeHTML(p.channel)}</a>
          <small>Publicado: ${formatDate(p.created_at)} · @${escapeHTML(p.user.username)}</small>
        </div>
        ${p.owner ? `<button class="delete-btn" data-action="delete" title="Eliminar">🗑</button>` : ''}
      </div>
      <div class="post-body">${body}</div>
      <div class="post-actions">
        <button data-action="like" class="${p.liked?'active':''}">♡ Me gusta <span>${p.likes_count}</span></button>
        <button data-action="comments">💬 Comentarios <span>${p.comments_count}</span></button>
        <button data-action="share">⌯ Compartir</button>
        <button data-action="save" class="${p.saved?'active':''}">${saveText}</button>
      </div>
      <div class="comments" data-comments></div>
    </article>`;
}

function renderPostBody(p){
  let out = '';
  if (p.content) out += `<div class="post-text">${linkify(escapeHTML(p.content))}</div>`;
  if (p.type === 'image' && p.media_url) out += `<img class="post-image" src="${escapeAttr(p.media_url)}" alt="Imagen compartida">`;
  if (p.type === 'file' && p.media_url) out += renderFileCard(p);
  if (p.type === 'poll') out += renderPoll(p, false);
  if (p.type === 'event') out += renderEvent(p, false);
  if (p.type === 'share' && p.media_url) out += `<div class="file-card"><div class="file-main"><strong>Publicación compartida</strong><small>${escapeHTML(p.media_url)}</small></div></div>`;
  return out || '<div class="muted-box">Sin contenido.</div>';
}

function renderFileCard(item){
  const size = formatBytes(item.file_size || 0);
  const name = item.file_name || 'archivo';
  return `<div class="file-card">
    <span style="font-size:28px">📎</span>
    <div class="file-main"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(item.file_type || 'archivo')} · ${size}</small></div>
    <a class="download-btn" href="${escapeAttr(item.media_url)}" target="_blank" rel="noopener" download>Descargar</a>
  </div>`;
}

function renderPoll(p, isPrivate=false){
  const poll = p.poll || {question:'Encuesta', options:[]};
  const votes = p.poll_votes || poll.options.map(()=>0);
  const total = votes.reduce((a,b)=>a+b,0);
  const idAttr = isPrivate ? `data-private-poll-id="${p.id}"` : `data-poll-id="${p.id}"`;
  return `<div class="poll-card" ${idAttr}>
    <strong>${escapeHTML(poll.question || 'Encuesta')}</strong>
    ${(poll.options || []).map((opt, i) => {
      const percent = total ? Math.round((votes[i] || 0) * 100 / total) : 0;
      return `<div class="poll-option ${p.my_vote === i ? 'selected' : ''}" data-option="${i}">
        <div class="poll-row"><span>${escapeHTML(opt)}</span><strong>${votes[i] || 0}</strong></div>
        <div class="poll-bar"><div class="poll-fill" style="width:${percent}%"></div></div>
      </div>`;
    }).join('')}
    <div class="poll-total">${total} voto${total === 1 ? '' : 's'}</div>
  </div>`;
}

function renderEvent(p){
  const ev = p.event || {};
  return `<div class="event-card">
    <h3>▣ ${escapeHTML(ev.name || p.content || 'Evento')}</h3>
    ${ev.description ? `<p>${escapeHTML(ev.description)}</p>` : ''}
    <div class="event-meta"><strong>Fecha:</strong> ${escapeHTML(formatEventDate(ev))}</div>
    ${ev.place ? `<div class="event-place"><strong>Lugar:</strong> ${escapeHTML(ev.place)}</div>` : ''}
    ${p.owner ? `<button class="soft-btn" data-action="edit-event" style="margin-top:12px">Editar evento</button>` : ''}
  </div>`;
}

function bindPostEvents(){
  $$('.post').forEach(postEl => {
    const postId = Number(postEl.dataset.postId);
    postEl.addEventListener('click', async e => {
      const userLink = e.target.closest('[data-user-id]');
      if (userLink) { e.preventDefault(); return openProfile(Number(userLink.dataset.userId)); }
      const actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.action;
      if (action === 'like') return toggleLike(postId);
      if (action === 'save') return toggleSave(postId);
      if (action === 'comments') return toggleComments(postId, postEl);
      if (action === 'share') return openShareModal(postId);
      if (action === 'delete') return openDeletePostModal(postId);
      if (action === 'edit-event') return openEventModal(getPost(postId));
    });
  });
  $$('[data-poll-id] .poll-option').forEach(opt => opt.addEventListener('click', () => votePoll(Number(opt.closest('[data-poll-id]').dataset.pollId), Number(opt.dataset.option))));
}

function getPost(id){ return state.posts.find(p => p.id === id); }

async function toggleLike(postId){
  try { await api(`/api/posts/${postId}/like`, {method:'POST'}); loadPosts(false); } catch(err){ toast(err.message,'error'); }
}
async function toggleSave(postId){
  try { const r = await api(`/api/posts/${postId}/save`, {method:'POST'}); toast(r.saved ? 'Añadido a guardados.' : 'Quitado de guardados.'); loadPosts(false); } catch(err){ toast(err.message,'error'); }
}
async function votePoll(postId, option){
  try { await api(`/api/posts/${postId}/vote`, {method:'POST', body:JSON.stringify({option_index:option})}); await loadPosts(false); } catch(err){ toast(err.message,'error'); }
}

function openDeletePostModal(postId){
  modal({title:'Eliminar publicación', body:'<p>¿Seguro que quieres eliminar esta publicación?</p>', footer:`<button class="soft-btn" data-close-modal>Cancelar</button><button class="danger-btn" id="confirmDeletePost">Eliminar</button>`});
  $('[data-close-modal]', els.modalLayer).addEventListener('click', closeModal);
  $('#confirmDeletePost').addEventListener('click', async () => {
    try { await api(`/api/posts/${postId}`, {method:'DELETE'}); closeModal(); toast('Publicación eliminada.'); loadPosts(); } catch(err){ toast(err.message,'error'); }
  });
}

async function toggleComments(postId, postEl){
  const box = $('[data-comments]', postEl);
  box.classList.toggle('open');
  if (!box.classList.contains('open')) return;
  await renderComments(postId, box);
}

async function renderComments(postId, box){
  try {
    const data = await api(`/api/posts/${postId}/comments`);
    box.innerHTML = `${(data.comments || []).map(c => `
      <div class="comment">
        ${avatarHTML(c.user,'avatar avatar-sm')}
        <div class="comment-bubble"><strong>${escapeHTML(c.user.display_name)}</strong><p>${linkify(escapeHTML(c.content))}</p></div>
      </div>`).join('')}
      <form class="comment-form"><input placeholder="Escribe un comentario..." autocomplete="off"><button class="primary-btn">➤</button></form>`;
    $('.comment-form', box).addEventListener('submit', async e => {
      e.preventDefault();
      const input = $('input', e.currentTarget);
      const content = input.value;
      if (!content.trim()) return;
      try { await api(`/api/posts/${postId}/comments`, {method:'POST', body:JSON.stringify({content})}); input.value=''; await renderComments(postId, box); await loadPosts(false); } catch(err){ toast(err.message,'error'); }
    });
  } catch(err){ box.innerHTML = `<div class="muted-box">${escapeHTML(err.message)}</div>`; }
}

async function sendTextPost(){
  const content = els.postText.value.trim();
  if (!content) return toast('Escribe algo antes de enviar.', 'error');
  try {
    await api('/api/posts', {method:'POST', body:JSON.stringify({type:'text', channel: state.selectedChannel, content})});
    els.postText.value = ''; autoGrow(els.postText); toast('Publicado.'); loadPosts();
  } catch(err){ toast(err.message,'error'); }
}

function openCompose(type, privateFriendId=null){
  if (type === 'image') return openImageModal(privateFriendId);
  if (type === 'file') return openFileModal(privateFriendId);
  if (type === 'poll') return openPollModal(privateFriendId);
  if (type === 'event') return openEventModal(null, privateFriendId);
}

function channelSelectHTML(){
  return `<div class="field"><label>Canal</label><select id="modalChannel">
    <option value="general">general</option>
    <option value="memes">memes</option>
    <option value="gaming">gaming</option>
    <option value="coordinación-salidas">coordinación-salidas</option>
  </select></div>`;
}

function openImageModal(privateFriendId=null){
  const isPrivate = !!privateFriendId;
  const body = `
    <div class="field"><label>Imagen</label><button class="soft-btn" id="chooseImageBtn">Seleccionar imagen desde galería</button></div>
    <div id="imagePreview" class="preview-box muted-box">Aún no seleccionaste imagen.</div>
    <div class="field"><label>Descripción</label><textarea id="imageCaption" placeholder="Escribe una descripción opcional..."></textarea></div>
    ${isPrivate ? '' : channelSelectHTML()}`;
  modal({title:'Publicar imagen', body, footer:`<button class="soft-btn" data-close-modal>Cancelar</button><button class="primary-btn" id="sendImageBtn">Enviar imagen</button>`, large:true});
  $('[data-close-modal]', els.modalLayer).addEventListener('click', closeModal);
  let chosenFile = null;
  $('#chooseImageBtn').addEventListener('click', () => pickFile('image/*', file => {
    chosenFile = file;
    const url = URL.createObjectURL(file);
    $('#imagePreview').innerHTML = `<img src="${url}" alt="preview"><p class="muted-box">${escapeHTML(file.name)} · ${formatBytes(file.size)}</p>`;
  }));
  $('#sendImageBtn').addEventListener('click', async () => {
    if (!chosenFile) return toast('Selecciona una imagen.', 'error');
    try {
      toast('Subiendo imagen...');
      const up = await uploadToCloudinary(chosenFile, 'circulo/posts');
      if (isPrivate) await sendPrivatePayload(privateFriendId, {type:'image', content:$('#imageCaption').value, media_url:up.url, file_name:up.file_name, file_size:up.bytes, file_type:up.file_type});
      else await api('/api/posts', {method:'POST', body:JSON.stringify({type:'image', channel:$('#modalChannel').value, content:$('#imageCaption').value, media_url:up.url, file_name:up.file_name, file_size:up.bytes, file_type:up.file_type})});
      closeModal(); toast('Imagen enviada.'); isPrivate ? openPrivateChat(state.chatFriend) : loadPosts();
    } catch(err){ toast(err.message,'error'); }
  });
}

function openFileModal(privateFriendId=null){
  const isPrivate = !!privateFriendId;
  const body = `
    <div class="field"><label>Archivo</label><button class="soft-btn" id="chooseFileBtn">Seleccionar archivo</button></div>
    <div id="filePreview" class="preview-box muted-box">Aún no seleccionaste archivo.</div>
    <div class="field"><label>Mensaje</label><textarea id="fileCaption" placeholder="Mensaje opcional..."></textarea></div>
    ${isPrivate ? '' : channelSelectHTML()}`;
  modal({title:'Compartir archivo', body, footer:`<button class="soft-btn" data-close-modal>Cancelar</button><button class="primary-btn" id="sendFileBtn">Enviar archivo</button>`, large:true});
  $('[data-close-modal]', els.modalLayer).addEventListener('click', closeModal);
  let chosenFile = null;
  $('#chooseFileBtn').addEventListener('click', () => pickFile('*/*', file => {
    chosenFile = file;
    $('#filePreview').innerHTML = `<strong>📎 ${escapeHTML(file.name)}</strong><br><span class="muted-box">${escapeHTML(file.type || 'archivo')} · ${formatBytes(file.size)}</span>`;
  }));
  $('#sendFileBtn').addEventListener('click', async () => {
    if (!chosenFile) return toast('Selecciona un archivo.', 'error');
    try {
      toast('Subiendo archivo...');
      const up = await uploadToCloudinary(chosenFile, 'circulo/files');
      const payload = {type:'file', content:$('#fileCaption').value, media_url:up.url, file_name:up.file_name, file_size:up.bytes, file_type:up.file_type};
      if (isPrivate) await sendPrivatePayload(privateFriendId, payload);
      else await api('/api/posts', {method:'POST', body:JSON.stringify({...payload, channel:$('#modalChannel').value})});
      closeModal(); toast('Archivo enviado.'); isPrivate ? openPrivateChat(state.chatFriend) : loadPosts();
    } catch(err){ toast(err.message,'error'); }
  });
}

function openPollModal(privateFriendId=null){
  const isPrivate = !!privateFriendId;
  const body = `
    <div class="field"><label>Pregunta</label><input id="pollQuestion" placeholder="Ej. ¿Qué prefieres?"></div>
    <div class="field"><label>Opción 1</label><input class="pollOpt" placeholder="Primera opción"></div>
    <div class="field"><label>Opción 2</label><input class="pollOpt" placeholder="Segunda opción"></div>
    <div class="field"><label>Opción 3</label><input class="pollOpt" placeholder="Opcional"></div>
    <div class="field"><label>Opción 4</label><input class="pollOpt" placeholder="Opcional"></div>
    ${isPrivate ? '' : channelSelectHTML()}`;
  modal({title:'Crear encuesta', body, footer:`<button class="soft-btn" data-close-modal>Cancelar</button><button class="primary-btn" id="sendPollBtn">Crear encuesta</button>`, large:true});
  $('[data-close-modal]', els.modalLayer).addEventListener('click', closeModal);
  $('#sendPollBtn').addEventListener('click', async () => {
    const question = $('#pollQuestion').value.trim();
    const options = $$('.pollOpt', els.modalLayer).map(i => i.value.trim()).filter(Boolean);
    if (!question || options.length < 2) return toast('Escribe una pregunta y mínimo 2 opciones.', 'error');
    try {
      const payload = {type:'poll', content:question, poll:{question, options}};
      if (isPrivate) await sendPrivatePayload(privateFriendId, payload);
      else await api('/api/posts', {method:'POST', body:JSON.stringify({...payload, channel:$('#modalChannel').value})});
      closeModal(); toast('Encuesta creada.'); isPrivate ? openPrivateChat(state.chatFriend) : loadPosts();
    } catch(err){ toast(err.message,'error'); }
  });
}

function openEventModal(post=null, privateFriendId=null){
  const isPrivate = !!privateFriendId;
  const ev = post?.event || {};
  const body = `
    <div class="field"><label>Nombre del evento</label><input id="eventName" value="${escapeAttr(ev.name || '')}" placeholder="Ej. Salida del grupo"></div>
    <div class="field"><label>Descripción</label><textarea id="eventDesc" placeholder="Detalles del evento">${escapeHTML(ev.description || '')}</textarea></div>
    <div class="grid-4">
      <div class="field"><label>Día</label><select id="eventDay">${optionsRange(1,31,ev.day)}</select></div>
      <div class="field"><label>Mes</label><select id="eventMonth">${optionsRange(1,12,ev.month)}</select></div>
      <div class="field"><label>Año</label><select id="eventYear">${optionsRange(new Date().getFullYear(), new Date().getFullYear()+6, ev.year)}</select></div>
      <div class="field"><label>AM/PM</label><select id="eventAmPm"><option ${ev.ampm==='AM'?'selected':''}>AM</option><option ${ev.ampm==='PM'?'selected':''}>PM</option></select></div>
    </div>
    <div class="grid-2">
      <div class="field"><label>Hora</label><select id="eventHour">${optionsRange(1,12,ev.hour)}</select></div>
      <div class="field"><label>Minutos</label><select id="eventMinute">${['00','05','10','15','20','25','30','35','40','45','50','55'].map(m => `<option ${String(ev.minute||'00').padStart(2,'0')===m?'selected':''}>${m}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Lugar</label><input id="eventPlace" value="${escapeAttr(ev.place || '')}" placeholder="Opcional"></div>
    ${isPrivate || post ? '' : channelSelectHTML()}`;
  const title = post ? 'Editar evento' : 'Crear evento';
  modal({title, body, footer:`<button class="soft-btn" data-close-modal>Cancelar</button><button class="primary-btn" id="sendEventBtn">${post?'Guardar cambios':'Crear evento'}</button>`, large:true});
  $('[data-close-modal]', els.modalLayer).addEventListener('click', closeModal);
  $('#sendEventBtn').addEventListener('click', async () => {
    const event = getEventFromModal();
    if (!event.name) return toast('Pon el nombre del evento.', 'error');
    try {
      if (post) await api(`/api/posts/${post.id}/event`, {method:'PUT', body:JSON.stringify({type:'event', content:event.name, event})});
      else if (isPrivate) await sendPrivatePayload(privateFriendId, {type:'event', content:event.name, event});
      else await api('/api/posts', {method:'POST', body:JSON.stringify({type:'event', channel:$('#modalChannel').value, content:event.name, event})});
      closeModal(); toast(post?'Evento actualizado.':'Evento creado.'); isPrivate ? openPrivateChat(state.chatFriend) : loadPosts();
    } catch(err){ toast(err.message,'error'); }
  });
}

function getEventFromModal(){
  return {
    name: $('#eventName').value.trim(),
    description: $('#eventDesc').value.trim(),
    day: Number($('#eventDay').value),
    month: Number($('#eventMonth').value),
    year: Number($('#eventYear').value),
    hour: Number($('#eventHour').value),
    minute: $('#eventMinute').value,
    ampm: $('#eventAmPm').value,
    place: $('#eventPlace').value.trim(),
  };
}

function optionsRange(a,b,selected){
  let s='';
  for(let i=a;i<=b;i++) s += `<option value="${i}" ${Number(selected || a)===i?'selected':''}>${String(i).padStart(i<100?2:4,'0')}</option>`;
  return s;
}

function pickFile(accept, callback){
  els.hiddenFileInput.value = '';
  els.hiddenFileInput.accept = accept;
  els.hiddenFileInput.onchange = () => {
    const file = els.hiddenFileInput.files?.[0];
    if (file) callback(file);
  };
  els.hiddenFileInput.click();
}

async function uploadToCloudinary(file, folder){
  const fd = new FormData();
  fd.append('upload', file);
  fd.append('folder', folder);
  return api('/api/upload', {method:'POST', body:fd, headers:{}});
}

function openShareModal(postId){
  const post = getPost(postId);
  const link = `${location.origin}${location.pathname}#post-${postId}`;
  const body = `<div class="share-options">
    <button id="copyPostLink">Copiar enlace <span>⧉</span></button>
    <button id="shareInWeb">Compartir dentro de la web <span>↗</span></button>
    <button id="sharePrivate">Compartir en privado a un amigo <span>✉</span></button>
  </div>`;
  modal({title:'Compartir publicación', body});
  $('#copyPostLink').addEventListener('click', async () => { await navigator.clipboard.writeText(link); toast('Enlace copiado.'); closeModal(); });
  $('#shareInWeb').addEventListener('click', async () => {
    try { await api('/api/posts', {method:'POST', body:JSON.stringify({type:'share', channel:state.selectedChannel, content:`Compartí una publicación de ${post.user.display_name}`, media_url:link})}); closeModal(); toast('Compartido en el grupo.'); loadPosts(); } catch(err){ toast(err.message,'error'); }
  });
  $('#sharePrivate').addEventListener('click', () => openFriendPicker(async friend => {
    await sendPrivatePayload(friend.id, {type:'link', content:`Te compartí una publicación: ${link}`});
    toast('Compartido por privado.');
  }));
}

function openFriendPicker(callback){
  const friends = state.friends || [];
  const body = friends.length ? friends.map(f => `<button class="search-row" data-friend-id="${f.id}">${avatarHTML(f,'avatar avatar-sm')}<span class="meta"><strong>${escapeHTML(f.display_name)}</strong><small>@${escapeHTML(f.username)}</small></span></button>`).join('') : '<p class="muted-box">No tienes amigos aceptados todavía.</p>';
  modal({title:'Elegir amigo', body:`<div>${body}</div>`});
  $$('[data-friend-id]', els.modalLayer).forEach(btn => btn.addEventListener('click', async () => {
    const f = friends.find(x => x.id === Number(btn.dataset.friendId));
    try { await callback(f); closeModal(); } catch(err){ toast(err.message,'error'); }
  }));
}

async function loadFriends(){
  if (!state.token) return;
  try {
    const data = await api('/api/friends');
    state.friends = data.friends || [];
    renderFriends();
  } catch {}
}

function renderFriends(){
  const online = state.friends.filter(f => f.online);
  const offline = state.friends.filter(f => !f.online);
  els.onlineFriends.innerHTML = online.length ? online.map(renderFriend).join('') : 'No hay amigos conectados.';
  els.offlineFriends.innerHTML = offline.length ? offline.map(renderFriend).join('') : 'No hay amigos desconectados.';
  $$('.friend-card').forEach(card => card.addEventListener('click', () => openPrivateChat(state.friends.find(f => f.id === Number(card.dataset.friendId)))));
}

function renderFriend(f){
  return `<button class="friend-card" data-friend-id="${f.id}">
    ${avatarHTML(f,'avatar avatar-sm')}
    <span class="friend-info"><strong>${escapeHTML(f.display_name)}</strong><small>${f.online?'En línea':'Desconectado'}</small></span>
    <span class="status-dot ${f.online?'online':''}"></span>
  </button>`;
}

async function openPrivateChat(friend){
  if (!friend) return;
  state.chatFriend = friend;
  const chat = modal({title:'', body:'', className:'chat-modal fullscreen-chat', large:true});
  chat.innerHTML = `
    <div class="modal-head">
      <div class="chat-head">${avatarHTML(friend,'avatar avatar-sm')}<div class="chat-title"><strong>Chat con ${escapeHTML(friend.display_name)}</strong><small>@${escapeHTML(friend.username)} · ${friend.online?'Conectado':'Desconectado'}</small></div></div>
      <button class="close-btn" data-close-modal>×</button>
    </div>
    <div id="chatMessages" class="chat-messages"></div>
    <div class="chat-inputbar">
      <button class="chat-tool" data-chat-tool="image" title="Imagen">▧</button>
      <button class="chat-tool" data-chat-tool="file" title="Archivo">📎</button>
      <button class="chat-tool" data-chat-tool="poll" title="Encuesta">⚑</button>
      <button class="chat-tool" data-chat-tool="event" title="Evento">▣</button>
      <textarea id="privateText" placeholder="Escribe un mensaje privado..."></textarea>
      <button id="privateSend" class="send-btn">➤</button>
    </div>`;
  $('[data-close-modal]', chat).addEventListener('click', closeModal);
  $$('.chat-tool', chat).forEach(b => b.addEventListener('click', () => openCompose(b.dataset.chatTool, friend.id)));
  $('#privateSend', chat).addEventListener('click', () => sendPrivateText(friend.id));
  $('#privateText', chat).addEventListener('keydown', e => { if(e.key==='Enter' && (e.ctrlKey || e.metaKey)) sendPrivateText(friend.id); });
  $('#privateText', chat).addEventListener('input', e => autoGrow(e.target));
  await loadPrivateMessages(friend.id);
  state.chatTimer = setInterval(() => loadPrivateMessages(friend.id, false), 5000);
}

async function loadPrivateMessages(friendId, scroll=true){
  try {
    const data = await api(`/api/private/${friendId}`);
    state.chatFriend = data.friend;
    const box = $('#chatMessages');
    if (!box) return;
    box.innerHTML = (data.messages || []).map(renderPrivateMessage).join('') || '<div class="muted-box">Aún no hay mensajes.</div>';
    $$('[data-private-poll-id] .poll-option', box).forEach(opt => opt.addEventListener('click', () => votePrivatePoll(Number(opt.closest('[data-private-poll-id]').dataset.privatePollId), Number(opt.dataset.option))));
    if (scroll) box.scrollTop = box.scrollHeight;
  } catch(err){ toast(err.message,'error'); }
}

function renderPrivateMessage(m){
  return `<div class="chat-msg ${m.mine?'mine':''}"><div class="chat-bubble">
    ${m.type === 'text' || m.type === 'link' ? `<div class="msg-text">${linkify(escapeHTML(m.content))}</div>` : ''}
    ${m.type === 'image' ? `${m.content ? `<div class="msg-text">${escapeHTML(m.content)}</div>` : ''}<img class="post-image" src="${escapeAttr(m.media_url)}" alt="Imagen">` : ''}
    ${m.type === 'file' ? `${m.content ? `<div class="msg-text">${escapeHTML(m.content)}</div>` : ''}${renderFileCard(m)}` : ''}
    ${m.type === 'poll' ? renderPoll(m, true) : ''}
    ${m.type === 'event' ? renderEvent(m) : ''}
    <span class="chat-time">${formatTime(m.created_at)}</span>
  </div></div>`;
}

async function sendPrivateText(friendId){
  const input = $('#privateText');
  const content = input.value.trim();
  if (!content) return;
  try { await sendPrivatePayload(friendId, {type:'text', content}); input.value=''; autoGrow(input); await loadPrivateMessages(friendId); } catch(err){ toast(err.message,'error'); }
}

async function sendPrivatePayload(friendId, payload){
  return api(`/api/private/${friendId}`, {method:'POST', body:JSON.stringify(payload)});
}

async function votePrivatePoll(messageId, option){
  try { await api(`/api/private/message/${messageId}/vote`, {method:'POST', body:JSON.stringify({option_index:option})}); if(state.chatFriend) loadPrivateMessages(state.chatFriend.id, false); } catch(err){ toast(err.message,'error'); }
}

async function loadNotifications(){
  if (!state.token) return;
  try {
    const data = await api('/api/notifications');
    state.notifications = data.notifications || [];
    state.channelCounts = data.channel_counts || {};
    renderNotificationBadges();
  } catch {}
}

function renderNotificationBadges(){
  const hasAny = state.notifications.some(n => !n.is_read) || Object.keys(state.channelCounts).length;
  els.bellBadge.classList.toggle('hidden', !hasAny);
  $$('.tab').forEach(tab => {
    const feed = tab.dataset.filter;
    const badge = $('.tab-badge', tab);
    const info = state.channelCounts[feed];
    if (!info) { badge.classList.add('hidden'); badge.classList.remove('mention'); badge.textContent=''; return; }
    badge.textContent = info.mention ? '@' : info.count;
    badge.classList.toggle('mention', !!info.mention);
    badge.classList.remove('hidden');
  });
}

async function openNotifications(){
  await loadNotifications();
  const notifs = state.notifications.filter(n => !n.is_read || n.type === 'friend_request');
  const body = notifs.length ? notifs.map(renderNotification).join('') : '<p class="muted-box">No tienes notificaciones.</p>';
  modal({title:'Notificaciones', body, large:true});
  $$('[data-accept-request]', els.modalLayer).forEach(btn => btn.addEventListener('click', () => respondRequest(Number(btn.dataset.acceptRequest), 'accept')));
  $$('[data-reject-request]', els.modalLayer).forEach(btn => btn.addEventListener('click', () => respondRequest(Number(btn.dataset.rejectRequest), 'reject')));
  $$('[data-open-post]', els.modalLayer).forEach(btn => btn.addEventListener('click', () => { closeModal(); location.hash = `post-${btn.dataset.openPost}`; setView('feed'); }));
  $$('[data-open-chat]', els.modalLayer).forEach(btn => btn.addEventListener('click', async () => {
    const actorId = Number(btn.dataset.openChat);
    const f = state.friends.find(x => x.id === actorId);
    closeModal(); if (f) openPrivateChat(f);
  }));
}

function renderNotification(n){
  const actor = n.actor || {};
  const actions = n.type === 'friend_request'
    ? `<button class="primary-btn" data-accept-request="${n.friend_request_id}">Aceptar</button><button class="soft-btn" data-reject-request="${n.friend_request_id}">Rechazar</button>`
    : n.type === 'private_message'
      ? `<button class="primary-btn" data-open-chat="${actor.id}">Abrir chat</button>`
      : n.post_id ? `<button class="primary-btn" data-open-post="${n.post_id}">Ver publicación</button>` : '';
  return `<div class="notification-card">
    ${avatarHTML(actor,'avatar avatar-sm')}
    <div class="notification-main">
      <strong>${escapeHTML(n.message)}</strong>
      <small>${formatRelative(n.created_at)}</small>
      <div class="notification-actions">${actions}</div>
    </div>
  </div>`;
}

async function respondRequest(id, action){
  try {
    const r = await api(`/api/friends/request/${id}/respond`, {method:'POST', body:JSON.stringify({action})});
    toast(r.message || 'Listo.'); closeModal(); await Promise.all([loadNotifications(), loadFriends()]); openNotifications();
  } catch(err){ toast(err.message,'error'); }
}

async function markChannelRead(channel){
  try { await api(`/api/notifications/mark_channel/${encodeURIComponent(channel)}`, {method:'POST'}); await loadNotifications(); } catch {}
}

function renderMediaView(posts){
  const media = posts.filter(p => p.type === 'image' || p.type === 'file');
  if (!media.length) { els.feed.innerHTML = `<div class="empty-state">No hay archivos o imágenes todavía.</div>`; return; }
  els.feed.innerHTML = `<div class="media-grid">${media.map(p => `
    <div class="media-item">
      ${p.type === 'image' ? `<img src="${escapeAttr(p.media_url)}" alt="">` : `<div style="height:170px;display:grid;place-items:center;font-size:52px">📎</div>`}
      <div><strong>${escapeHTML(p.file_name || p.content || 'Media')}</strong><small class="muted-box">${escapeHTML(p.user.display_name)} · ${formatDate(p.created_at)}</small>${p.media_url ? `<br><a class="download-btn" href="${escapeAttr(p.media_url)}" target="_blank" download>Ver / descargar</a>` : ''}</div>
    </div>`).join('')}</div>`;
}

function renderDownloadsView(posts){
  const files = posts.filter(p => p.type === 'file');
  if (!files.length) { els.feed.innerHTML = `<div class="empty-state">No hay descargas todavía.</div>`; return; }
  els.feed.innerHTML = files.map(p => `<article class="post"><div class="post-body">${renderFileCard(p)}<p class="muted-box">Subido por ${escapeHTML(p.user.display_name)} · ${formatDate(p.created_at)}</p></div></article>`).join('');
}

async function onSearch(){
  const q = els.globalSearch.value.trim();
  if (!q) { els.searchResults.classList.add('hidden'); loadPosts(false); return; }
  try {
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    const users = data.users || [];
    els.searchResults.innerHTML = users.length ? users.map(u => `
      <button class="search-row" data-search-user="${u.id}">
        ${avatarHTML(u,'avatar avatar-sm')}
        <span class="meta"><strong>${escapeHTML(u.display_name)}</strong><small>@${escapeHTML(u.username)} · ${u.online?'Conectado':'Desconectado'}</small></span>
        <span>${u.is_me?'Tú':u.are_friends?'Amigo':u.pending_request?'Pendiente':'Ver'}</span>
      </button>`).join('') : `<div class="muted-box" style="padding:12px">No se encontraron usuarios.</div>`;
    els.searchResults.classList.remove('hidden');
    $$('[data-search-user]', els.searchResults).forEach(btn => btn.addEventListener('click', () => { els.searchResults.classList.add('hidden'); openProfile(Number(btn.dataset.searchUser)); }));
    loadPosts(false);
  } catch(err){ toast(err.message,'error'); }
}

function autoGrow(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 220) + 'px';
}
function debounce(fn, wait){ let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
function escapeHTML(s=''){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s=''){ return escapeHTML(s).replace(/'/g, '&#039;'); }
function linkify(s){ return s.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
function formatBytes(bytes){ if(!bytes) return '0 B'; const sizes=['B','KB','MB','GB']; const i=Math.floor(Math.log(bytes)/Math.log(1024)); return `${(bytes/Math.pow(1024,i)).toFixed(i?1:0)} ${sizes[i]}`; }
function formatDate(iso){ if(!iso) return ''; return new Date(iso).toLocaleString('es-PE', {dateStyle:'medium', timeStyle:'short'}); }
function formatTime(iso){ if(!iso) return ''; return new Date(iso).toLocaleTimeString('es-PE', {hour:'2-digit', minute:'2-digit'}); }
function formatRelative(iso){ if(!iso) return 'hace un momento'; const diff=(Date.now()-new Date(iso).getTime())/1000; if(diff<60) return 'hace un momento'; if(diff<3600) return `hace ${Math.floor(diff/60)} min`; if(diff<86400) return `hace ${Math.floor(diff/3600)} h`; return formatDate(iso); }
function formatEventDate(ev){
  if (!ev) return '';
  const minute = String(ev.minute || '00').padStart(2,'0');
  return `${String(ev.day).padStart(2,'0')}/${String(ev.month).padStart(2,'0')}/${ev.year}, ${ev.hour}:${minute} ${ev.ampm || 'AM'}`;
}
