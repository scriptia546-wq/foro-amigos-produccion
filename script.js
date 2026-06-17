const RENDER_BACKEND_URL = "https://foro-amigos-produccion.onrender.com";
const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost" || window.location.protocol === "file:";
const API_URL = isLocal ? "http://127.0.0.1:8000" : RENDER_BACKEND_URL.replace(/\/+$/, "");
const WS_URL = isLocal ? "ws://127.0.0.1:8000/ws" : `${API_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws`;
const STORAGE_TOKEN_KEY = "circulo_privado_token";
const STORAGE_USER_KEY = "circulo_privado_user";

const body = document.body;
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const openSidebarBtn = document.getElementById("openSidebarBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const collapseSidebarBtn = document.getElementById("collapseSidebarBtn");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const searchResults = document.getElementById("searchResults");
const postsContainer = document.getElementById("posts");
const emptyState = document.getElementById("emptyState");
const filterButtons = document.querySelectorAll(".feed-filter__btn");
const composerInput = document.getElementById("composerInput");
const sendPostBtn = document.getElementById("sendPostBtn");
const attachmentPreview = document.getElementById("attachmentPreview");
const newPostBtn = document.getElementById("newPostBtn");
const imagePostBtn = document.getElementById("imagePostBtn");
const filePostBtn = document.getElementById("filePostBtn");
const pollPostBtn = document.getElementById("pollPostBtn");
const eventPostBtn = document.getElementById("eventPostBtn");
const hiddenImageInput = document.getElementById("hiddenImageInput");
const hiddenFileInput = document.getElementById("hiddenFileInput");
const hiddenDmFileInput = document.getElementById("hiddenDmFileInput");
const modal = document.getElementById("modal");
const modalPanel = document.getElementById("modalPanel");
const profileMenuBtn = document.getElementById("profileMenuBtn");
const profileMenu = document.getElementById("profileMenu");
const notificationsBtn = document.getElementById("notificationsBtn");
const notificationDot = document.getElementById("notificationDot");
const onlineFriends = document.getElementById("onlineFriends");
const offlineFriends = document.getElementById("offlineFriends");
const refreshFriendsBtn = document.getElementById("refreshFriendsBtn");
const activeUserAvatar = document.getElementById("activeUserAvatar");
const activeUserName = document.getElementById("activeUserName");
const composerAvatar = document.getElementById("composerAvatar");
const toastArea = document.getElementById("toastArea");

let currentFilter = "all";
let socket = null;
let currentAttachment = null;
let currentChatFriendId = null;
let currentDmAttachment = null;
let allPostsCache = [];

function getToken(){return localStorage.getItem(STORAGE_TOKEN_KEY);}
function getCurrentUser(){try{return JSON.parse(localStorage.getItem(STORAGE_USER_KEY));}catch{return null;}}
function saveSession(token,user){localStorage.setItem(STORAGE_TOKEN_KEY,token);localStorage.setItem(STORAGE_USER_KEY,JSON.stringify(user));}
function clearSession(){localStorage.removeItem(STORAGE_TOKEN_KEY);localStorage.removeItem(STORAGE_USER_KEY);}

async function requestJson(path,options={}){
  const token=getToken();
  const response=await fetch(`${API_URL}${path}`,{
    ...options,
    headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}
  });
  const data=await response.json().catch(()=>null);
  if(response.status===401){clearSession();throw new Error("Tu sesión expiró. Inicia sesión otra vez.");}
  if(!response.ok)throw new Error(data?.detail||"Error en el servidor.");
  return data;
}

function toast(message){
  const node=document.createElement("div");
  node.className="toast";
  node.textContent=message;
  toastArea.appendChild(node);
  setTimeout(()=>node.remove(),3200);
}
function openModal(html,extraClass=""){modalPanel.className=`modal__panel ${extraClass}`.trim();modalPanel.innerHTML=html;modal.hidden=false;}
function closeModal(){modal.hidden=true;modalPanel.innerHTML="";modalPanel.className="modal__panel";currentChatFriendId=null;currentDmAttachment=null;}
function modalHeader(title){return `<div class="modal__header"><h3>${title}</h3><button class="modal-close" type="button" data-close-modal><i class="bx bx-x"></i></button></div>`;}
function showConfirm(message,onAccept){
  openModal(`${modalHeader("Confirmar")}<p>${escapeHtml(message)}</p><div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="button" data-confirm-accept>Aceptar</button></div>`);
  modalPanel.querySelector("[data-confirm-accept]").addEventListener("click",async()=>{try{await onAccept();closeModal();}catch(e){toast(e.message);}});
}

async function ensureAuthenticated(){
  const token=getToken();
  if(token){
    try{const user=await requestJson("/me");saveSession(token,user);updateActiveUserUI(user);return;}catch{clearSession();}
  }
  await openAuthModal("login");
}
function openAuthModal(mode="login"){
  return new Promise(resolve=>{
    const render=(active)=>{
      const isLogin=active==="login";
      openModal(`${modalHeader("Círculo privado")}<div class="auth-tabs"><button type="button" class="${isLogin?"is-active":""}" data-auth-tab="login">Iniciar sesión</button><button type="button" class="${!isLogin?"is-active":""}" data-auth-tab="register">Registrarse</button></div>${isLogin?loginFormHtml():registerFormHtml()}`,"modal__panel--auth");
      modalPanel.querySelectorAll("[data-auth-tab]").forEach(b=>b.addEventListener("click",()=>render(b.dataset.authTab)));
      const form=modalPanel.querySelector("form");
      form.addEventListener("submit",async e=>{
        e.preventDefault();
        try{
          if(isLogin) await submitLogin(form); else await submitRegister(form);
          closeModal();
          resolve();
        }catch(err){toast(err.message);}
      });
    };
    render(mode);
  });
}
function loginFormHtml(){return `<form class="form-grid" id="loginForm"><label>Nombre de usuario<input name="username" autocomplete="username" placeholder="rodrigo" required /></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required /></label><p class="form-hint">Si ya te registraste desde otro celular o PC, solo escribe tu usuario y contraseña.</p><button class="btn-primary" type="submit">Iniciar sesión</button></form>`;}
function registerFormHtml(){return `<form class="form-grid" id="registerForm"><label>Nombre para mostrar<input name="display_name" placeholder="Ej. Rodrigo" required /></label><label>Nombre de usuario<input name="username" autocomplete="username" placeholder="ej. rodrigo" required /></label><label>Fecha de nacimiento<input name="birth_date" type="date" /></label><label>Contraseña<input name="password" type="password" autocomplete="new-password" minlength="4" required /></label><p class="form-hint">Al registrarte entras automáticamente al grupo y podrás publicar en el feed general.</p><button class="btn-primary" type="submit">Registrarme y entrar</button></form>`;}
async function submitLogin(form){
  const payload={username:form.username.value.trim(),password:form.password.value};
  const res=await fetch(`${API_URL}/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw new Error(data?.detail||"No se pudo iniciar sesión.");
  saveSession(data.token,data.user);updateActiveUserUI(data.user);
}
async function submitRegister(form){
  const payload={display_name:form.display_name.value.trim(),username:form.username.value.trim(),birth_date:form.birth_date.value,password:form.password.value};
  const res=await fetch(`${API_URL}/register`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw new Error(data?.detail||"No se pudo registrar.");
  saveSession(data.token,data.user);updateActiveUserUI(data.user);
}

function updateActiveUserUI(user){
  activeUserName.textContent=user.display_name||user.username;
  applyAvatar(activeUserAvatar,user);applyAvatar(composerAvatar,user);
}
function openSidebar(){sidebar.classList.add("is-open");overlay.classList.add("is-visible");}
function closeSidebar(){sidebar.classList.remove("is-open");overlay.classList.remove("is-visible");}
function toggleSidebarCollapse(){body.classList.toggle("sidebar-collapsed");}

async function loadPosts(){
  const posts=await requestJson("/posts");
  allPostsCache=posts;
  postsContainer.innerHTML="";
  posts.forEach(post=>postsContainer.appendChild(createPostElement(post)));
  filterPosts();
}
function createPostElement(post){
  const me=getCurrentUser();
  const canDelete=me&&post.author&&Number(me.id)===Number(post.author.id);
  const article=document.createElement("article");
  article.className="post-card";
  article.dataset.postId=String(post.id);
  article.dataset.category=post.post_type==="event"?"eventos":post.channel;
  article.dataset.hasMedia=post.image_url||post.file_url?"true":"false";
  article.dataset.saved=post.saved_by_me?"true":"false";
  article.innerHTML=`
    <header class="post-card__header">
      <button class="avatar ${getAvatarClass(post.author.avatar_initials)}" data-avatar data-user-id="${post.author.id}" title="Ver perfil"></button>
      <div class="post-card__meta"><div><strong>${escapeHtml(post.author.display_name)}</strong><span class="post-card__channel">#${escapeHtml(post.channel)}</span></div><small>Publicado: ${formatDateTime(post.created_at)}</small></div>
      <button class="post-card__more ${canDelete?"delete-post-btn":""}" type="button" ${canDelete?`data-post-id="${post.id}"`:""}><i class="bx ${canDelete?"bx-trash":"bx-dots-horizontal-rounded"}"></i></button>
    </header>
    <div class="post-card__body">
      ${post.post_type!=="poll"&&post.post_type!=="event"&&post.content?`<p>${linkify(escapeHtml(post.content))}</p>`:""}
      ${post.image_url?`<div class="post-card__media"><img src="${escapeAttr(post.image_url)}" alt="Imagen adjunta" /></div>`:""}
      ${post.file_url?renderFile(post):""}
      ${post.poll?renderPoll(post.poll):""}
      ${post.event?renderEvent(post.event,canDelete):""}
    </div>
    <footer class="post-card__footer">
      <button class="reaction-btn ${post.liked_by_me?"is-liked":""}" type="button" data-post-id="${post.id}" data-liked="${post.liked_by_me?"true":"false"}"><i class="bx ${post.liked_by_me?"bxs-heart":"bx-heart"}"></i><span>Me gusta</span><strong class="like-count">${post.likes}</strong></button>
      <button class="comment-btn" type="button" data-post-id="${post.id}"><i class="bx bx-message-rounded"></i><span>Comentarios</span><strong class="comments-count">${post.comments_count||0}</strong></button>
      <button class="share-btn" type="button" data-post-id="${post.id}"><i class="bx bx-share-alt"></i><span>Compartir</span></button>
      <button class="save-btn ${post.saved_by_me?"is-saved":""}" type="button" data-post-id="${post.id}"><i class="bx ${post.saved_by_me?"bxs-bookmark":"bx-bookmark"}"></i><span>${post.saved_by_me?"Guardado":"Guardar"}</span></button>
    </footer>
    <section class="comments-panel" data-comments-panel hidden><div class="comments-list" data-comments-list></div><form class="comment-form" data-comment-form><input type="text" name="comment" placeholder="Escribe un comentario..." autocomplete="off" /><button class="btn-primary" type="submit"><i class="bx bx-send"></i></button></form></section>`;
  const avatar=article.querySelector("[data-avatar]");applyAvatar(avatar,post.author);
  return article;
}
function renderFile(post){return `<a class="post-file" href="${escapeAttr(post.file_url)}" target="_blank" rel="noopener" download><span><i class="bx bx-file"></i></span><div><strong>${escapeHtml(post.file_name||"Archivo adjunto")}</strong><small>${escapeHtml(post.file_type||"Archivo")}</small></div><i class="bx bx-download"></i></a>`;}
function renderPoll(poll){
  const total=Math.max(1,poll.total_votes||0);
  return `<div class="poll-card" data-poll-id="${poll.id}"><h4>${escapeHtml(poll.question)}</h4>${poll.options.map(o=>{const percent=Math.round((o.votes/total)*100);const selected=poll.selected_option_ids?.includes(o.id);return `<button class="poll-option ${selected?"is-selected":""}" type="button" data-poll-id="${poll.id}" data-option-id="${o.id}"><span>${escapeHtml(o.text)}</span><strong>${o.votes}</strong><div class="poll-option__bar"><span style="width:${percent}%"></span></div></button>`}).join("")}<small>${poll.total_votes||0} votos</small></div>`;
}
function renderEvent(event,canEdit){return `<div class="event-card" data-event-id="${event.id}"><h4><i class="bx bx-calendar-event"></i> ${escapeHtml(event.title)}</h4>${event.description?`<p>${escapeHtml(event.description)}</p>`:""}${event.start_at?`<p><strong>Fecha:</strong> ${formatDateTime(event.start_at)}</p>`:""}${event.location?`<p><strong>Lugar:</strong> ${escapeHtml(event.location)}</p>`:""}<div class="event-card__actions">${canEdit?`<button class="btn-secondary edit-event-btn" type="button" data-event-id="${event.id}" data-event-title="${escapeAttr(event.title)}" data-event-description="${escapeAttr(event.description||"")}" data-event-start="${escapeAttr(event.start_at||"")}" data-event-location="${escapeAttr(event.location||"")}">Editar evento</button>`:""}</div></div>`;}
function prependPost(post){if(document.querySelector(`[data-post-id="${post.id}"]`))return;allPostsCache.unshift(post);postsContainer.prepend(createPostElement(post));filterPosts();}
function replacePost(post){const old=document.querySelector(`[data-post-id="${post.id}"]`);if(old)old.replaceWith(createPostElement(post));allPostsCache=allPostsCache.map(p=>Number(p.id)===Number(post.id)?post:p);filterPosts();}
function removePostFromDOM(id){document.querySelector(`[data-post-id="${id}"]`)?.remove();allPostsCache=allPostsCache.filter(p=>Number(p.id)!==Number(id));filterPosts();}

async function uploadFile(file){
  const token=getToken();
  const formData=new FormData();formData.append("file",file);
  const response=await fetch(`${API_URL}/upload`,{method:"POST",headers:{Authorization:`Bearer ${token}`},body:formData});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.detail||"No se pudo subir el archivo.");
  return data;
}
function setAttachment(att){currentAttachment=att;renderAttachmentPreview();}
function clearAttachment(){currentAttachment=null;renderAttachmentPreview();}
function renderAttachmentPreview(){
  if(!currentAttachment){attachmentPreview.hidden=true;attachmentPreview.innerHTML="";return;}
  const isImage=currentAttachment.content_type?.startsWith("image/")||currentAttachment.resource_type==="image";
  attachmentPreview.hidden=false;
  attachmentPreview.innerHTML=`<div class="attachment-preview__row"><strong><i class="bx ${isImage?"bx-image":"bx-file"}"></i> ${escapeHtml(currentAttachment.file_name||"Archivo")}</strong><button type="button" id="clearAttachmentBtn"><i class="bx bx-x"></i></button></div>${isImage?`<img src="${escapeAttr(currentAttachment.url)}" alt="Vista previa" />`:""}`;
  document.getElementById("clearAttachmentBtn").addEventListener("click",clearAttachment);
}
async function handleComposerSubmit(){
  const content=composerInput.textContent.trim();
  if(!content&&!currentAttachment){toast("Escribe algo o adjunta una imagen/archivo.");composerInput.focus();return;}
  const isImage=currentAttachment&&(currentAttachment.content_type?.startsWith("image/")||currentAttachment.resource_type==="image");
  const payload={content:content||currentAttachment.file_name||"Archivo",channel:currentFilter&&["general","memes","gaming","coordinación-salidas"].includes(currentFilter)?currentFilter:"general",post_type:isImage?"image":currentAttachment?"file":"text"};
  if(currentAttachment){
    if(isImage) payload.image_url=currentAttachment.url; else {payload.file_url=currentAttachment.url;payload.file_name=currentAttachment.file_name;payload.file_type=currentAttachment.content_type;}
  }
  await createPost(payload);
  composerInput.textContent="";clearAttachment();
  toast("Publicado en el grupo.");
}
async function createPost(payload){const post=await requestJson("/posts",{method:"POST",body:JSON.stringify(payload)});if(!socket||socket.readyState!==WebSocket.OPEN)prependPost(post);}

function openPollModal(){
  openModal(`${modalHeader("Crear encuesta")}<form class="form-grid" id="pollForm"><label>Pregunta<input name="question" required placeholder="¿Qué prefieren?" /></label><label>Opción 1<input name="option" required /></label><label>Opción 2<input name="option" required /></label><label>Opción 3<input name="option" /></label><label>Opción 4<input name="option" /></label><label>Canal<select name="channel"><option>general</option><option>memes</option><option>gaming</option><option>coordinación-salidas</option></select></label><div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="submit">Crear encuesta</button></div></form>`);
}
async function submitPoll(form){
  const options=[...form.querySelectorAll('input[name="option"]')].map(i=>i.value.trim()).filter(Boolean);
  if(options.length<2){toast("Agrega al menos 2 opciones.");return;}
  const post=await requestJson("/polls",{method:"POST",body:JSON.stringify({question:form.question.value.trim(),options,multiple:false,channel:form.channel.value})});
  if(!socket||socket.readyState!==WebSocket.OPEN)prependPost(post);closeModal();toast("Encuesta creada.");
}
function openEventModal(event=null){
  const isEdit=!!event;
  openModal(`${modalHeader(isEdit?"Editar evento":"Crear evento")}<form class="form-grid" id="${isEdit?"editEventForm":"eventForm"}"><input type="hidden" name="event_id" value="${event?.id||""}" /><label>Nombre del evento<input name="title" value="${escapeAttr(event?.title||"")}" required /></label><label>Descripción<textarea name="description" placeholder="Detalles del evento">${escapeHtml(event?.description||"")}</textarea></label><label>Fecha y hora<input name="start_at" type="datetime-local" value="${event?.start_at?toDatetimeLocal(event.start_at):""}" /></label><label>Lugar<input name="location" value="${escapeAttr(event?.location||"")}" placeholder="Opcional" /></label>${!isEdit?`<label>Canal<select name="channel"><option>general</option><option>memes</option><option>gaming</option><option>coordinación-salidas</option></select></label>`:""}<div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="submit">${isEdit?"Guardar cambios":"Crear evento"}</button></div></form>`);
}
async function submitEvent(form){
  const post=await requestJson("/events",{method:"POST",body:JSON.stringify({title:form.title.value.trim(),description:form.description.value.trim(),start_at:form.start_at.value,location:form.location.value.trim(),channel:form.channel.value})});
  if(!socket||socket.readyState!==WebSocket.OPEN)prependPost(post);closeModal();toast("Evento creado.");
}
async function submitEventEdit(form){
  const post=await requestJson(`/events/${form.event_id.value}`,{method:"PATCH",body:JSON.stringify({title:form.title.value.trim(),description:form.description.value.trim(),start_at:form.start_at.value,location:form.location.value.trim()})});
  replacePost(post);closeModal();toast("Evento actualizado.");
}

async function handleLikeClick(btn){
  const data=await requestJson(`/posts/${btn.dataset.postId}/like`,{method:"POST"});
  updateLikeButton(data.post_id,data.likes,data.liked_by_me);
}
function updateLikeButton(id,likes,liked){
  const b=document.querySelector(`[data-post-id="${id}"] .reaction-btn`);if(!b)return;
  b.querySelector(".like-count").textContent=likes;
  if(liked!==null){b.dataset.liked=liked?"true":"false";b.classList.toggle("is-liked",liked);b.querySelector("i").className=`bx ${liked?"bxs-heart":"bx-heart"}`;}
}
async function handleSaveClick(btn){
  const data=await requestJson(`/posts/${btn.dataset.postId}/save`,{method:"POST"});
  btn.classList.toggle("is-saved",data.saved_by_me);
  btn.querySelector("i").className=`bx ${data.saved_by_me?"bxs-bookmark":"bx-bookmark"}`;
  btn.querySelector("span").textContent=data.saved_by_me?"Guardado":"Guardar";
  const card=btn.closest(".post-card");if(card)card.dataset.saved=data.saved_by_me?"true":"false";
  toast(data.saved_by_me?"Añadido a guardados.":"Quitado de guardados.");
  filterPosts();
}
async function toggleComments(postId){
  const card=document.querySelector(`[data-post-id="${postId}"]`);const panel=card.querySelector("[data-comments-panel]");const list=card.querySelector("[data-comments-list]");
  panel.hidden=!panel.hidden;
  if(!panel.hidden&&list.children.length===0){const comments=await requestJson(`/posts/${postId}/comments`);list.innerHTML=comments.map(renderComment).join("");}
}
function renderComment(c){return `<div class="comment-item" data-comment-id="${c.id}"><span class="avatar ${getAvatarClass(c.author.avatar_initials)}">${escapeHtml(c.author.avatar_initials||"U")}</span><div class="comment-bubble"><strong>${escapeHtml(c.author.display_name)}</strong>${escapeHtml(c.content)}<small>${formatRelativeTime(c.created_at)}</small></div></div>`;}
function appendComment(postId,c){const list=document.querySelector(`[data-post-id="${postId}"] [data-comments-list]`);if(list&&!list.querySelector(`[data-comment-id="${c.id}"]`))list.insertAdjacentHTML("beforeend",renderComment(c));}
function updateCommentsCount(postId,count){const el=document.querySelector(`[data-post-id="${postId}"] .comments-count`);if(el)el.textContent=count;}
async function submitComment(postId,content){const c=await requestJson(`/posts/${postId}/comments`,{method:"POST",body:JSON.stringify({content})});appendComment(postId,c);}
async function votePoll(btn){const post=await requestJson(`/polls/${btn.dataset.pollId}/vote`,{method:"POST",body:JSON.stringify({option_ids:[Number(btn.dataset.optionId)]})});replacePost(post);}
async function deletePost(postId){showConfirm("¿Seguro que quieres eliminar esta publicación?",async()=>{await requestJson(`/posts/${postId}`,{method:"DELETE"});removePostFromDOM(postId);toast("Publicación eliminada.");});}
async function sharePost(postId){
  const url=`${location.origin}${location.pathname}#post-${postId}`;
  try{if(navigator.share){await navigator.share({title:"Círculo privado",url});}else{await navigator.clipboard.writeText(url);toast("Link copiado para compartir.");}}catch{try{await navigator.clipboard.writeText(url);toast("Link copiado para compartir.");}catch{toast("No se pudo copiar el link.");}}
}

async function searchUsers(q){
  if(q.length<2){searchResults.hidden=true;searchResults.innerHTML="";return;}
  const users=await requestJson(`/users/search?q=${encodeURIComponent(q)}`);
  if(!users.length){searchResults.innerHTML=`<div class="search-result"><small>No se encontraron usuarios.</small></div>`;searchResults.hidden=false;return;}
  searchResults.innerHTML=users.map(u=>`<button class="search-result" type="button" data-user-id="${u.id}"><span class="avatar ${getAvatarClass(u.avatar_initials)}">${escapeHtml(u.avatar_initials||"U")}</span><span><strong>${escapeHtml(u.display_name)}</strong><small>@${escapeHtml(u.username)} · ${u.online?"Conectado":"Desconectado"}</small></span></button>`).join("");
  searchResults.hidden=false;
}
async function openUserProfile(id){
  const u=await requestJson(`/users/${id}`);const me=getCurrentUser();const isMe=Number(me.id)===Number(u.id);const isFriend=u.friendship_status==="accepted";const pending=u.friendship_status==="pending";
  openModal(`${modalHeader("Perfil")}<div class="profile-view" data-user-id="${u.id}" data-user-name="${escapeAttr(u.display_name)}"><div class="profile-head"><span class="avatar ${getAvatarClass(u.avatar_initials)}" data-avatar-profile></span><div><h3>${escapeHtml(u.display_name)}</h3><p>@${escapeHtml(u.username)} · ${u.online?"Conectado":"Desconectado"}</p></div></div><p>${escapeHtml(u.bio||"Este usuario aún no tiene biografía.")}</p><p><strong>Publicaciones:</strong> ${u.posts_count||0}</p><div class="form-actions">${isMe?`<button class="btn-primary" type="button" data-action="edit-profile">Editar mi perfil</button>`:isFriend?`<button class="btn-primary" type="button" data-action="open-chat" data-user-id="${u.id}" data-user-name="${escapeAttr(u.display_name)}"><i class="bx bx-message-rounded"></i> Mensaje privado</button>`:pending?`<button class="btn-secondary" type="button" disabled>Solicitud pendiente</button>`:`<button class="btn-primary" type="button" data-action="add-friend" data-user-id="${u.id}">Agregar amigo</button>`}</div></div>`);
  applyAvatar(modalPanel.querySelector("[data-avatar-profile]"),u);
}
function openEditProfileModal(){const u=getCurrentUser();openModal(`${modalHeader("Editar perfil")}<form class="form-grid" id="editProfileForm"><label>Nombre<input name="display_name" value="${escapeAttr(u.display_name||"")}" required /></label><label>Biografía<textarea name="bio" placeholder="Escribe algo sobre ti...">${escapeHtml(u.bio||"")}</textarea></label><label>Avatar URL<input name="avatar_url" value="${escapeAttr(u.avatar_url||"")}" placeholder="Opcional: pega una URL de imagen" /></label><div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="submit">Guardar perfil</button></div></form>`);}
async function submitProfile(form){const user=await requestJson("/me",{method:"PATCH",body:JSON.stringify({display_name:form.display_name.value.trim(),bio:form.bio.value.trim(),avatar_url:form.avatar_url.value.trim()})});saveSession(getToken(),user);updateActiveUserUI(user);closeModal();toast("Perfil actualizado.");}
async function sendFriendRequest(id){await requestJson(`/friends/request/${id}`,{method:"POST"});toast("Solicitud enviada.");closeModal();}
async function respondFriend(id,action){await requestJson(`/friends/respond/${id}?action=${action}`,{method:"POST"});toast(action==="accept"?"Solicitud aceptada.":"Solicitud rechazada.");await openNotifications();await loadFriends();}
async function openNotifications(){
  notificationDot.hidden=true;const ns=await requestJson("/notifications");
  openModal(`${modalHeader("Notificaciones")}<div class="notification-list">${ns.length?ns.map(n=>`<div class="notification-item"><strong>${escapeHtml(n.message)}</strong><small>${formatRelativeTime(n.created_at)}</small>${n.type==="friend_request"?`<div class="notification-actions"><button class="btn-primary" data-action="accept-friend" data-friendship-id="${n.entity_id}">Aceptar</button><button class="btn-secondary" data-action="reject-friend" data-friendship-id="${n.entity_id}">Rechazar</button></div>`:""}</div>`).join(""):`<p class="form-hint">No tienes notificaciones.</p>`}</div>`);
}
async function loadFriends(){
  const data=await requestJson("/friends");
  onlineFriends.innerHTML=data.online.length?data.online.map(renderFriend).join(""):`<p class="sidebar-empty">No hay amigos conectados.</p>`;
  offlineFriends.innerHTML=data.offline.length?data.offline.map(renderFriend).join(""):`<p class="sidebar-empty">No hay amigos desconectados.</p>`;
}
function renderFriend(u){return `<button class="friend-item" type="button" data-chat-user-id="${u.id}" data-chat-user-name="${escapeAttr(u.display_name)}"><span class="avatar ${getAvatarClass(u.avatar_initials)}">${escapeHtml(u.avatar_initials||"U")}</span><span class="friend-item__meta"><strong>${escapeHtml(u.display_name)}</strong><small>${u.online?"En línea":"Desconectado"}</small></span><span class="friend-dot ${u.online?"":"is-offline"}"></span></button>`;}

async function openPrivateChat(id,name){
  currentChatFriendId=Number(id);currentDmAttachment=null;
  const messages=await requestJson(`/dm/${id}`);
  openModal(`${modalHeader(`Chat con ${escapeHtml(name)}`)}<div class="chat-box"><div class="chat-messages" id="chatMessages">${messages.map(renderDm).join("")}</div><div id="dmAttachmentPreview" class="attachment-preview" hidden></div><form class="chat-form" id="chatForm"><button class="chat-mini-btn" type="button" data-chat-attach="image" title="Imagen"><i class="bx bx-image-add"></i></button><button class="chat-mini-btn" type="button" data-chat-attach="file" title="Archivo"><i class="bx bx-paperclip"></i></button><button class="chat-mini-btn" type="button" data-chat-attach="poll" title="Encuesta"><i class="bx bx-poll"></i></button><input name="message" placeholder="Escribe un mensaje privado..." autocomplete="off" /><button class="btn-primary" type="submit"><i class="bx bx-send"></i></button></form></div>`);
  scrollChatToBottom();
}
function renderDm(m){
  const extra=m.message_type==="image"&&m.file_url?`<img src="${escapeAttr(m.file_url)}" alt="imagen" />`:m.file_url?`<a class="dm-file" href="${escapeAttr(m.file_url)}" target="_blank" rel="noopener" download><i class="bx bx-file"></i>${escapeHtml(m.file_name||"Archivo")}</a>`:"";
  const content=m.message_type==="poll"?renderDmPollText(m.content):linkify(escapeHtml(m.content));
  return `<div class="dm ${m.mine?"dm--me":""}" data-dm-id="${m.id}">${content}${extra}<small>${formatRelativeTime(m.created_at)}</small></div>`;
}
function renderDmPollText(content){const lines=String(content).split("\n").map(escapeHtml);return `<strong>Encuesta</strong><br>${lines.join("<br>")}`;}
function appendDm(m){if(!currentChatFriendId)return;const other=m.mine?m.receiver.id:m.sender.id;if(Number(other)!==Number(currentChatFriendId))return;const box=document.getElementById("chatMessages");if(!box||box.querySelector(`[data-dm-id="${m.id}"]`))return;box.insertAdjacentHTML("beforeend",renderDm(m));scrollChatToBottom();}
function scrollChatToBottom(){const box=document.getElementById("chatMessages");if(box)box.scrollTop=box.scrollHeight;}
async function sendDm(id,payload){const m=await requestJson(`/dm/${id}`,{method:"POST",body:JSON.stringify(payload)});appendDm(m);}
function renderDmAttachment(){const box=document.getElementById("dmAttachmentPreview");if(!box)return;if(!currentDmAttachment){box.hidden=true;box.innerHTML="";return;}box.hidden=false;box.innerHTML=`<div class="attachment-preview__row"><strong><i class="bx bx-file"></i> ${escapeHtml(currentDmAttachment.file_name||"Archivo")}</strong><button type="button" data-clear-dm-attachment><i class="bx bx-x"></i></button></div>`;}
function openDmPollModal(){openModal(`${modalHeader("Encuesta privada")}<form class="form-grid" id="dmPollForm"><label>Pregunta<input name="question" required /></label><label>Opción 1<input name="option" required /></label><label>Opción 2<input name="option" required /></label><label>Opción 3<input name="option" /></label><div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="submit">Enviar encuesta</button></div></form>`);}

function filterPosts(){
  const q=searchInput.value.trim().toLowerCase();const posts=document.querySelectorAll(".post-card");let visible=0;
  posts.forEach(p=>{let okFilter=true;if(currentFilter!=="all")okFilter=p.dataset.category===currentFilter;if(currentFilter==="media")okFilter=p.dataset.hasMedia==="true";if(currentFilter==="saved")okFilter=p.dataset.saved==="true";if(currentFilter==="downloads")okFilter=!!p.querySelector(".post-file");const okSearch=!q||p.textContent.toLowerCase().includes(q);const show=okFilter&&okSearch;p.style.display=show?"":"none";if(show)visible++;});
  emptyState.classList.toggle("is-visible",visible===0);
}
function setActiveFilter(v){currentFilter=v;filterButtons.forEach(b=>b.classList.toggle("is-active",b.dataset.filter===v));filterPosts();}
function showSavedSection(){
  const saved=[...document.querySelectorAll('.post-card[data-saved="true"]')];
  openModal(`${modalHeader("Guardados")}<div class="saved-grid">${saved.length?saved.map(card=>`<button class="mini-post" data-jump-post="${card.dataset.postId}"><span class="mini-post__info"><i class="bx bx-bookmark"></i><span><strong>${escapeHtml(card.querySelector('.post-card__body')?.innerText?.slice(0,60)||'Publicación guardada')}</strong><small>Ver publicación</small></span></span><i class="bx bx-chevron-right"></i></button>`).join(""):`<p class="form-hint">Aún no guardaste publicaciones. Usa el botón Guardar debajo de cada post.</p>`}</div>`);
}
function showDownloadsSection(){
  const files=[...document.querySelectorAll(".post-card")].filter(c=>c.querySelector(".post-file"));
  openModal(`${modalHeader("Descargas")}<div class="downloads-grid">${files.length?files.map(c=>{const a=c.querySelector(".post-file");return `<a class="download-item" href="${a.href}" target="_blank" download><span class="download-item__info"><i class="bx bx-download"></i><span><strong>${escapeHtml(a.querySelector("strong")?.textContent||"Archivo")}</strong><small>Descargar archivo</small></span></span><i class="bx bx-link-external"></i></a>`}).join(""):`<p class="form-hint">No hay archivos para descargar todavía.</p>`}</div>`);
}

function connectWebSocket(){
  const token=getToken();if(!token)return;
  socket=new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  socket.addEventListener("message",e=>{const p=JSON.parse(e.data);if(p.type==="new_post")prependPost(p.post);if(p.type==="post_updated"||p.type==="poll_updated")replacePost(p.post);if(p.type==="post_deleted")removePostFromDOM(p.post_id);if(p.type==="like_updated")updateLikeButton(p.post_id,p.likes,null);if(p.type==="new_comment"){appendComment(p.post_id,p.comment);updateCommentsCount(p.post_id,p.comments_count);}if(p.type==="notification"){notificationDot.hidden=false;}if(p.type==="friends_updated"||p.type==="presence_updated")loadFriends().catch(console.error);if(p.type==="direct_message"){appendDm(p.message);notificationDot.hidden=false;}});
  socket.addEventListener("close",()=>setTimeout(()=>{if(getToken())connectWebSocket();},3000));
}

openSidebarBtn.addEventListener("click",openSidebar);closeSidebarBtn.addEventListener("click",closeSidebar);overlay.addEventListener("click",closeSidebar);collapseSidebarBtn.addEventListener("click",toggleSidebarCollapse);refreshFriendsBtn.addEventListener("click",()=>loadFriends().catch(e=>toast(e.message)));
newPostBtn.addEventListener("click",()=>{composerInput.focus();composerInput.scrollIntoView({behavior:"smooth",block:"center"});});composerInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendPostBtn.click();}});sendPostBtn.addEventListener("click",()=>handleComposerSubmit().catch(e=>toast(e.message)));
imagePostBtn.addEventListener("click",()=>{hiddenImageInput.value="";hiddenImageInput.click();});filePostBtn.addEventListener("click",()=>{hiddenFileInput.value="";hiddenFileInput.click();});pollPostBtn.addEventListener("click",openPollModal);eventPostBtn.addEventListener("click",()=>openEventModal());
hiddenImageInput.addEventListener("change",async()=>{const file=hiddenImageInput.files?.[0];if(!file)return;try{toast("Subiendo imagen...");setAttachment(await uploadFile(file));composerInput.focus();}catch(e){toast(e.message);}});
hiddenFileInput.addEventListener("change",async()=>{const file=hiddenFileInput.files?.[0];if(!file)return;try{toast("Subiendo archivo...");setAttachment(await uploadFile(file));composerInput.focus();}catch(e){toast(e.message);}});
profileMenuBtn.addEventListener("click",()=>profileMenu.hidden=!profileMenu.hidden);notificationsBtn.addEventListener("click",()=>openNotifications().catch(e=>toast(e.message)));
profileMenu.addEventListener("click",e=>{const a=e.target.closest("[data-profile-action]")?.dataset.profileAction;profileMenu.hidden=true;if(a==="view-my-profile")openUserProfile(getCurrentUser().id).catch(err=>toast(err.message));if(a==="edit-profile")openEditProfileModal();if(a==="notifications")openNotifications().catch(err=>toast(err.message));if(a==="logout"){clearSession();location.reload();}});
searchForm.addEventListener("submit",e=>e.preventDefault());searchInput.addEventListener("input",()=>{const q=searchInput.value.trim();filterPosts();searchUsers(q).catch(console.error);});clearSearchBtn.addEventListener("click",()=>{searchInput.value="";searchResults.hidden=true;filterPosts();});searchResults.addEventListener("click",e=>{const b=e.target.closest("[data-user-id]");if(b)openUserProfile(b.dataset.userId).catch(err=>toast(err.message));});
filterButtons.forEach(b=>b.addEventListener("click",()=>setActiveFilter(b.dataset.filter)));document.querySelectorAll("[data-channel-link]").forEach(l=>l.addEventListener("click",e=>{e.preventDefault();setActiveFilter(l.dataset.channelLink);}));document.querySelectorAll("[data-filter-sidebar]").forEach(l=>l.addEventListener("click",e=>{e.preventDefault();document.querySelectorAll(".sidebar__link").forEach(x=>x.classList.remove("is-active"));l.classList.add("is-active");const v=l.dataset.filterSidebar;if(v==="saved")showSavedSection();else if(v==="downloads")showDownloadsSection();else setActiveFilter(v);}));
postsContainer.addEventListener("click",async e=>{try{const avatar=e.target.closest("[data-avatar]");const like=e.target.closest(".reaction-btn"),comment=e.target.closest(".comment-btn"),del=e.target.closest(".delete-post-btn"),poll=e.target.closest(".poll-option"),edit=e.target.closest(".edit-event-btn"),share=e.target.closest(".share-btn"),save=e.target.closest(".save-btn");if(avatar)return await openUserProfile(avatar.dataset.userId);if(like)return await handleLikeClick(like);if(comment)return await toggleComments(comment.dataset.postId);if(del)return await deletePost(del.dataset.postId);if(poll)return await votePoll(poll);if(edit)return openEventModal({id:edit.dataset.eventId,title:edit.dataset.eventTitle,description:edit.dataset.eventDescription,start_at:edit.dataset.eventStart,location:edit.dataset.eventLocation});if(share)return await sharePost(share.dataset.postId);if(save)return await handleSaveClick(save);}catch(err){toast(err.message);}});
postsContainer.addEventListener("submit",async e=>{const form=e.target.closest("[data-comment-form]");if(!form)return;e.preventDefault();const card=form.closest(".post-card");const input=form.querySelector('input[name="comment"]');const content=input.value.trim();if(!content)return;input.value="";try{await submitComment(card.dataset.postId,content);}catch(err){toast(err.message);}});
document.addEventListener("click",e=>{if(!profileMenu.contains(e.target)&&!profileMenuBtn.contains(e.target))profileMenu.hidden=true;});
modal.addEventListener("click",async e=>{if(e.target.closest("[data-close-modal]")){closeModal();return;}const action=e.target.closest("[data-action]")?.dataset.action;try{if(action==="add-friend")await sendFriendRequest(e.target.closest("[data-user-id]").dataset.userId);if(action==="edit-profile")openEditProfileModal();if(action==="accept-friend")await respondFriend(e.target.closest("[data-friendship-id]").dataset.friendshipId,"accept");if(action==="reject-friend")await respondFriend(e.target.closest("[data-friendship-id]").dataset.friendshipId,"reject");if(action==="open-chat"){const b=e.target.closest("[data-user-id]");await openPrivateChat(b.dataset.userId,b.dataset.userName);}}catch(err){toast(err.message);}});
modal.addEventListener("click",e=>{const jump=e.target.closest("[data-jump-post]");if(jump){const id=jump.dataset.jumpPost;closeModal();document.querySelector(`[data-post-id="${id}"]`)?.scrollIntoView({behavior:"smooth",block:"center"});}});
modal.addEventListener("submit",async e=>{e.preventDefault();try{if(e.target.id==="pollForm")await submitPoll(e.target);if(e.target.id==="eventForm")await submitEvent(e.target);if(e.target.id==="editEventForm")await submitEventEdit(e.target);if(e.target.id==="editProfileForm")await submitProfile(e.target);if(e.target.id==="chatForm"){const input=e.target.message;const content=input.value.trim();if(!content&&!currentDmAttachment)return;const isImage=currentDmAttachment&&currentDmAttachment.content_type?.startsWith("image/");const payload={content:content||currentDmAttachment?.file_name||"Archivo",message_type:currentDmAttachment?(isImage?"image":"file"):looksLikeUrl(content)?"link":"text",file_url:currentDmAttachment?.url||null,file_name:currentDmAttachment?.file_name||null};input.value="";currentDmAttachment=null;renderDmAttachment();await sendDm(currentChatFriendId,payload);}if(e.target.id==="dmPollForm"){const options=[...e.target.querySelectorAll('input[name="option"]')].map(i=>i.value.trim()).filter(Boolean);if(options.length<2)return toast("Agrega 2 opciones.");const content=`${e.target.question.value.trim()}\n${options.map((o,i)=>`${i+1}. ${o}`).join("\n")}`;const friendId=currentChatFriendId;closeModal();await openPrivateChat(friendId,"amigo");await sendDm(friendId,{content,message_type:"poll"});}}catch(err){toast(err.message);}});
modal.addEventListener("click",e=>{if(e.target.closest("[data-chat-attach='image']")){hiddenDmFileInput.accept="image/png,image/jpeg,image/webp,image/gif";hiddenDmFileInput.value="";hiddenDmFileInput.click();}if(e.target.closest("[data-chat-attach='file']")){hiddenDmFileInput.accept="";hiddenDmFileInput.value="";hiddenDmFileInput.click();}if(e.target.closest("[data-chat-attach='poll']")){const id=currentChatFriendId;closeModal();currentChatFriendId=id;openDmPollModal();}if(e.target.closest("[data-clear-dm-attachment]")){currentDmAttachment=null;renderDmAttachment();}});
hiddenDmFileInput.addEventListener("change",async()=>{const file=hiddenDmFileInput.files?.[0];if(!file)return;try{toast("Subiendo archivo para mensaje...");currentDmAttachment=await uploadFile(file);renderDmAttachment();}catch(e){toast(e.message);}});
onlineFriends.addEventListener("click",e=>{const b=e.target.closest("[data-chat-user-id]");if(b)openPrivateChat(b.dataset.chatUserId,b.dataset.chatUserName).catch(err=>toast(err.message));});offlineFriends.addEventListener("click",e=>{const b=e.target.closest("[data-chat-user-id]");if(b)openPrivateChat(b.dataset.chatUserId,b.dataset.chatUserName).catch(err=>toast(err.message));});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!modal.hidden)closeModal();closeSidebar();}});window.addEventListener("resize",()=>{if(window.innerWidth>1100)closeSidebar();});

function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function escapeAttr(v){return escapeHtml(v).replaceAll("\n"," ");}
function linkify(s){return s.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');}
function looksLikeUrl(v){return /^https?:\/\//i.test(String(v||"").trim());}
function getAvatarClass(i){const c=["avatar--blue","avatar--green","avatar--purple","avatar--me"];const code=String(i||"U").charCodeAt(0);return c[Number.isNaN(code)?0:code%c.length];}
function applyAvatar(el,u){if(!el||!u)return;el.textContent=u.avatar_initials||"U";if(u.avatar_url){el.style.backgroundImage=`url("${u.avatar_url}")`;el.style.color="transparent";}else{el.style.backgroundImage="";el.style.color="";}}
function formatRelativeTime(iso){const d=new Date(iso),now=new Date(),min=Math.floor((now-d)/60000),h=Math.floor(min/60),days=Math.floor(h/24);if(Number.isNaN(d.getTime())||min<1)return"hace un momento";if(min<60)return`hace ${min} min`;if(h<24)return`hace ${h} h`;if(days===1)return"ayer";return d.toLocaleDateString("es-PE",{day:"2-digit",month:"short",year:"numeric"});}
function formatDateTime(iso){return iso?new Date(iso).toLocaleString("es-PE",{dateStyle:"medium",timeStyle:"short"}):"";}
function toDatetimeLocal(iso){const d=new Date(iso);if(Number.isNaN(d.getTime()))return"";const p=n=>String(n).padStart(2,"0");return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}

(async function initApp(){try{await ensureAuthenticated();await loadPosts();await loadFriends();connectWebSocket();}catch(e){toast(e.message||"No se pudo iniciar la app.");}})();
