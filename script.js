
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
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const searchResults = document.getElementById("searchResults");
const postsContainer = document.getElementById("posts");
const emptyState = document.getElementById("emptyState");
const filterButtons = document.querySelectorAll(".feed-filter__btn");
const composerInput = document.getElementById("composerInput");
const newPostBtn = document.getElementById("newPostBtn");
const imagePostBtn = document.getElementById("imagePostBtn");
const pollPostBtn = document.getElementById("pollPostBtn");
const eventPostBtn = document.getElementById("eventPostBtn");
const hiddenImageInput = document.getElementById("hiddenImageInput");
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

let currentFilter = "all";
let socket = null;
let currentUploadedImageUrl = null;
let currentChatFriendId = null;

function getToken(){return localStorage.getItem(STORAGE_TOKEN_KEY);}
function getCurrentUser(){try{return JSON.parse(localStorage.getItem(STORAGE_USER_KEY));}catch{return null;}}
function saveSession(token,user){localStorage.setItem(STORAGE_TOKEN_KEY,token);localStorage.setItem(STORAGE_USER_KEY,JSON.stringify(user));}
function clearSession(){localStorage.removeItem(STORAGE_TOKEN_KEY);localStorage.removeItem(STORAGE_USER_KEY);}

async function requestJson(path,options={}){
  const token=getToken();
  const response=await fetch(`${API_URL}${path}`,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  if(response.status===401){clearSession();throw new Error("Tu sesión expiró. Inicia sesión otra vez.");}
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.detail||"Error en el servidor.");
  return data;
}

async function ensureAuthenticated(){
  const token=getToken();
  if(token){
    try{const user=await requestJson("/me");saveSession(token,user);updateActiveUserUI(user);return;}catch{clearSession();}
  }
  const hasAccount=confirm("¿Ya tienes una cuenta?\n\nAceptar = Iniciar sesión\nCancelar = Registrarte");
  if(hasAccount)await loginWithPrompt();else await registerWithPrompt();
}
async function loginWithPrompt(){
  const username=prompt("Usuario:","rodrigo"); if(!username)return loginWithPrompt();
  const password=prompt("Contraseña:","1234"); if(!password)return loginWithPrompt();
  const response=await fetch(`${API_URL}/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
  const data=await response.json().catch(()=>null);
  if(!response.ok){alert(data?.detail||"No se pudo iniciar sesión.");return loginWithPrompt();}
  saveSession(data.token,data.user); updateActiveUserUI(data.user);
}
async function registerWithPrompt(){
  const displayName=prompt("Nombre para mostrar:","Nuevo Amigo"); if(!displayName)return registerWithPrompt();
  const username=prompt("Usuario sin espacios:",displayName.toLowerCase().replaceAll(" ","")); if(!username)return registerWithPrompt();
  const password=prompt("Contraseña:","1234"); if(!password)return registerWithPrompt();
  const response=await fetch(`${API_URL}/register`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password,display_name:displayName})});
  const data=await response.json().catch(()=>null);
  if(!response.ok){alert(data?.detail||"No se pudo registrar.");return registerWithPrompt();}
  saveSession(data.token,data.user); updateActiveUserUI(data.user);
}
function updateActiveUserUI(user){
  activeUserAvatar.textContent=user.avatar_initials||"U"; composerAvatar.textContent=user.avatar_initials||"U"; activeUserName.textContent=user.display_name||user.username;
  applyAvatar(activeUserAvatar,user); applyAvatar(composerAvatar,user);
}
function openSidebar(){sidebar.classList.add("is-open");overlay.classList.add("is-visible");}
function closeSidebar(){sidebar.classList.remove("is-open");overlay.classList.remove("is-visible");}
function toggleSidebarCollapse(){body.classList.toggle("sidebar-collapsed");}
function openModal(html){modalPanel.innerHTML=html;modal.hidden=false;}
function closeModal(){modal.hidden=true;modalPanel.innerHTML="";currentChatFriendId=null;}
function modalHeader(title){return `<div class="modal__header"><h3>${title}</h3><button class="modal-close" type="button" data-close-modal><i class="bx bx-x"></i></button></div>`;}

async function loadPosts(){const posts=await requestJson("/posts");postsContainer.innerHTML="";posts.forEach(post=>postsContainer.appendChild(createPostElement(post)));filterPosts();}
function createPostElement(post){
  const me=getCurrentUser();const canDelete=me&&post.author&&Number(me.id)===Number(post.author.id);
  const article=document.createElement("article");article.className="post-card";article.dataset.postId=String(post.id);article.dataset.category=post.post_type==="event"?"eventos":post.channel;
  article.innerHTML=`
    <header class="post-card__header">
      <span class="avatar ${getAvatarClass(post.author.avatar_initials)}" data-avatar></span>
      <div class="post-card__meta"><div><strong>${escapeHtml(post.author.display_name)}</strong><span class="post-card__channel">#${escapeHtml(post.channel)}</span></div><small>${formatRelativeTime(post.created_at)}</small></div>
      <button class="post-card__more ${canDelete?"delete-post-btn":""}" type="button" ${canDelete?`data-post-id="${post.id}"`:""}><i class="bx ${canDelete?"bx-trash":"bx-dots-horizontal-rounded"}"></i></button>
    </header>
    <div class="post-card__body">
      ${post.post_type!=="poll"&&post.post_type!=="event"?`<p>${escapeHtml(post.content)}</p>`:""}
      ${post.image_url?`<div class="post-card__media"><img src="${escapeHtml(post.image_url)}" alt="Imagen adjunta" /></div>`:""}
      ${post.poll?renderPoll(post.poll):""}
      ${post.event?renderEvent(post.event,canDelete):""}
    </div>
    <footer class="post-card__footer">
      <button class="reaction-btn ${post.liked_by_me?"is-liked":""}" type="button" data-post-id="${post.id}" data-liked="${post.liked_by_me?"true":"false"}"><i class="bx ${post.liked_by_me?"bxs-heart":"bx-heart"}"></i><span>Me gusta</span><strong class="like-count">${post.likes}</strong></button>
      <button class="comment-btn" type="button" data-post-id="${post.id}"><i class="bx bx-message-rounded"></i><span>Comentarios</span><strong class="comments-count">${post.comments_count||0}</strong></button>
      <button class="share-btn" type="button"><i class="bx bx-share-alt"></i><span>Compartir</span></button>
    </footer>
    <section class="comments-panel" data-comments-panel hidden><div class="comments-list" data-comments-list></div><form class="comment-form" data-comment-form><input type="text" name="comment" placeholder="Escribe un comentario..." autocomplete="off" /><button class="btn-primary" type="submit"><i class="bx bx-send"></i></button></form></section>`;
  const avatar=article.querySelector("[data-avatar]");avatar.textContent=escapeHtml(post.author.avatar_initials||"U");applyAvatar(avatar,post.author);return article;
}
function renderPoll(poll){
  const total=Math.max(1,poll.total_votes||0);
  return `<div class="poll-card" data-poll-id="${poll.id}"><h4>${escapeHtml(poll.question)}</h4>${poll.options.map(o=>{const percent=Math.round((o.votes/total)*100);const selected=poll.selected_option_ids?.includes(o.id);return `<button class="poll-option ${selected?"is-selected":""}" type="button" data-poll-id="${poll.id}" data-option-id="${o.id}"><span>${escapeHtml(o.text)}</span><strong>${o.votes}</strong><div class="poll-option__bar"><span style="width:${percent}%"></span></div></button>`}).join("")}<small>${poll.total_votes||0} votos</small></div>`;
}
function renderEvent(event,canEdit){return `<div class="event-card" data-event-id="${event.id}"><h4><i class="bx bx-calendar-event"></i> ${escapeHtml(event.title)}</h4>${event.description?`<p>${escapeHtml(event.description)}</p>`:""}${event.start_at?`<p><strong>Fecha:</strong> ${formatDateTime(event.start_at)}</p>`:""}${event.location?`<p><strong>Lugar:</strong> ${escapeHtml(event.location)}</p>`:""}<div class="event-card__actions">${canEdit?`<button class="btn-secondary edit-event-btn" type="button" data-event-id="${event.id}">Editar evento</button>`:""}</div></div>`;}
function prependPost(post){if(postsContainer.querySelector(`[data-post-id="${post.id}"]`))return;postsContainer.prepend(createPostElement(post));filterPosts();}
function replacePost(post){const old=postsContainer.querySelector(`[data-post-id="${post.id}"]`);const fresh=createPostElement(post);if(old)old.replaceWith(fresh);else postsContainer.prepend(fresh);filterPosts();}
function removePostFromDOM(postId){postsContainer.querySelector(`[data-post-id="${postId}"]`)?.remove();filterPosts();}
async function createTextPost(){const content=prompt("Escribe tu nuevo post para el grupo:");if(!content||!content.trim())return;const channel=prompt("Canal: general, memes, coordinación-salidas o gaming","general");await createPost({content:content.trim(),channel:channel||"general",image_url:currentUploadedImageUrl,post_type:"text"});currentUploadedImageUrl=null;}
async function createPost(payload){const post=await requestJson("/posts",{method:"POST",body:JSON.stringify(payload)});if(!socket||socket.readyState!==WebSocket.OPEN)prependPost(post);}
async function deletePost(postId){if(!confirm("¿Seguro que quieres eliminar esta publicación?"))return;await requestJson(`/posts/${postId}`,{method:"DELETE"});removePostFromDOM(postId);}
async function uploadImage(file){const token=getToken();const formData=new FormData();formData.append("file",file);const response=await fetch(`${API_URL}/upload`,{method:"POST",headers:{Authorization:`Bearer ${token}`},body:formData});const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.detail||"No se pudo subir la imagen.");return data.url;}
hiddenImageInput.addEventListener("change",async()=>{const file=hiddenImageInput.files?.[0];if(!file)return;try{currentUploadedImageUrl=await uploadImage(file);alert("Imagen subida. Ahora escribe el texto que acompañará la imagen.");await createTextPost();}catch(e){alert(e.message);}});
function openPollModal(){openModal(`${modalHeader("Crear encuesta")}<form class="form-grid" id="pollForm"><label>Pregunta<input name="question" required maxlength="220" placeholder="Ej. ¿Qué jugamos hoy?" /></label><label>Opción 1<input name="option" required maxlength="160" /></label><label>Opción 2<input name="option" required maxlength="160" /></label><label>Opción 3<input name="option" maxlength="160" /></label><label>Opción 4<input name="option" maxlength="160" /></label><label>Canal<select name="channel"><option value="general">general</option><option value="memes">memes</option><option value="gaming">gaming</option><option value="coordinación-salidas">coordinación-salidas</option></select></label><div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="submit">Crear encuesta</button></div></form>`);}
async function submitPoll(form){const options=[...form.querySelectorAll('input[name="option"]')].map(i=>i.value.trim()).filter(Boolean);if(options.length<2)return alert("Agrega al menos 2 opciones.");const post=await requestJson("/polls",{method:"POST",body:JSON.stringify({question:form.question.value.trim(),options,multiple:false,channel:form.channel.value})});if(!socket||socket.readyState!==WebSocket.OPEN)prependPost(post);closeModal();}
async function votePoll(button){const post=await requestJson(`/polls/${button.dataset.pollId}/vote`,{method:"POST",body:JSON.stringify({option_ids:[Number(button.dataset.optionId)]})});replacePost(post);}
function openEventModal(event=null){const isEdit=Boolean(event);openModal(`${modalHeader(isEdit?"Editar evento":"Crear evento")}<form class="form-grid" id="${isEdit?"editEventForm":"eventForm"}" ${isEdit?`data-event-id="${event.id}"`:""}><label>Nombre del evento<input name="title" required maxlength="180" value="${escapeAttr(event?.title||"")}" placeholder="Ej. Partida privada, salida, reunión..." /></label><label>Descripción<textarea name="description" placeholder="Detalles del evento">${escapeHtml(event?.description||"")}</textarea></label><label>Fecha y hora<input name="start_at" type="datetime-local" value="${event?.start_at?toDatetimeLocal(event.start_at):""}" /></label><label>Lugar<input name="location" maxlength="180" value="${escapeAttr(event?.location||"")}" placeholder="Opcional" /></label>${!isEdit?`<label>Canal<select name="channel"><option value="general">general</option><option value="gaming">gaming</option><option value="coordinación-salidas">coordinación-salidas</option></select></label>`:""}<div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="submit">${isEdit?"Guardar cambios":"Crear evento"}</button></div></form>`);}
async function submitEvent(form){const payload={title:form.title.value.trim(),description:form.description.value.trim(),start_at:form.start_at.value||null,location:form.location.value.trim()||null,channel:form.channel?.value||"general"};const post=await requestJson("/events",{method:"POST",body:JSON.stringify(payload)});if(!socket||socket.readyState!==WebSocket.OPEN)prependPost(post);closeModal();}
async function submitEventEdit(form){const eventId=form.dataset.eventId;const payload={title:form.title.value.trim(),description:form.description.value.trim(),start_at:form.start_at.value||null,location:form.location.value.trim()||null};const post=await requestJson(`/events/${eventId}`,{method:"PATCH",body:JSON.stringify(payload)});replacePost(post);closeModal();}
async function handleLikeClick(button){const r=await requestJson(`/posts/${button.dataset.postId}/like`,{method:"POST"});updateLikeButton(r.post_id,r.likes,r.liked_by_me);}
function updateLikeButton(postId,likes,likedByMe=null){const card=postsContainer.querySelector(`[data-post-id="${postId}"]`);if(!card)return;const b=card.querySelector(".reaction-btn");const i=b.querySelector("i");card.querySelector(".like-count").textContent=String(likes);if(likedByMe===null)return;b.classList.toggle("is-liked",likedByMe);i.classList.toggle("bxs-heart",likedByMe);i.classList.toggle("bx-heart",!likedByMe);}
async function toggleComments(postId){const card=postsContainer.querySelector(`[data-post-id="${postId}"]`);const panel=card?.querySelector("[data-comments-panel]");if(!panel)return;const open=panel.hidden;panel.hidden=!panel.hidden;if(open&&!panel.dataset.loaded){await loadComments(postId);panel.dataset.loaded="true";}}
async function loadComments(postId){const card=postsContainer.querySelector(`[data-post-id="${postId}"]`);const list=card?.querySelector("[data-comments-list]");if(!list)return;list.innerHTML="";const comments=await requestJson(`/posts/${postId}/comments`);comments.forEach(c=>list.appendChild(createCommentElement(c)));}
function createCommentElement(comment){const item=document.createElement("div");item.className="comment-item";item.dataset.commentId=String(comment.id);item.innerHTML=`<span class="avatar ${getAvatarClass(comment.author.avatar_initials)}">${escapeHtml(comment.author.avatar_initials)}</span><div class="comment-item__body"><strong>${escapeHtml(comment.author.display_name)}</strong><p>${escapeHtml(comment.content)}</p></div>`;applyAvatar(item.querySelector(".avatar"),comment.author);return item;}
async function submitComment(postId,content){const c=await requestJson(`/posts/${postId}/comments`,{method:"POST",body:JSON.stringify({content})});appendComment(postId,c);}
function appendComment(postId,c){const card=postsContainer.querySelector(`[data-post-id="${postId}"]`);const list=card?.querySelector("[data-comments-list]");const panel=card?.querySelector("[data-comments-panel]");if(!list||!panel)return;if(list.querySelector(`[data-comment-id="${c.id}"]`))return;list.appendChild(createCommentElement(c));panel.dataset.loaded="true";}
function updateCommentsCount(postId,n){const c=postsContainer.querySelector(`[data-post-id="${postId}"] .comments-count`);if(c)c.textContent=String(n);}
async function searchUsers(q){if(q.length<2){searchResults.hidden=true;searchResults.innerHTML="";return;}const users=await requestJson(`/users/search?q=${encodeURIComponent(q)}`);if(!users.length){searchResults.innerHTML=`<div class="empty-mini">No se encontraron usuarios.</div>`;searchResults.hidden=false;return;}searchResults.innerHTML=users.map(u=>`<button class="search-result" type="button" data-user-id="${u.id}"><span class="avatar ${getAvatarClass(u.avatar_initials)}">${escapeHtml(u.avatar_initials)}</span><span class="search-result__meta"><strong>${escapeHtml(u.display_name)}</strong><small>@${escapeHtml(u.username)} · ${friendshipText(u.friendship_status)}</small></span></button>`).join("");users.forEach(u=>applyAvatar(searchResults.querySelector(`[data-user-id="${u.id}"] .avatar`),u));searchResults.hidden=false;}
function friendshipText(s){if(s==="accepted")return"Amigo";if(s==="pending")return"Solicitud pendiente";return"Ver perfil";}
async function openUserProfile(id){const u=await requestJson(`/users/${id}`);searchResults.hidden=true;const me=getCurrentUser();const isMe=Number(me.id)===Number(u.id);const isFriend=u.friendship_status==="accepted";const pending=u.friendship_status==="pending";openModal(`${modalHeader("Perfil")}<div class="profile-view"><div class="profile-head"><span class="avatar ${getAvatarClass(u.avatar_initials)}" id="profileAvatar">${escapeHtml(u.avatar_initials)}</span><div><h3>${escapeHtml(u.display_name)}</h3><p>@${escapeHtml(u.username)} · ${u.online?"Conectado":"Desconectado"}</p></div></div><p>${escapeHtml(u.bio||"Este usuario aún no tiene biografía.")}</p><p><strong>Publicaciones:</strong> ${u.posts_count||0}</p><div class="form-actions">${isMe?`<button class="btn-primary" data-action="edit-profile">Editar mi perfil</button>`:""}${!isMe&&!isFriend&&!pending?`<button class="btn-primary" data-action="add-friend" data-user-id="${u.id}">Agregar amigo</button>`:""}${!isMe&&pending?`<button class="btn-secondary" disabled>Solicitud pendiente</button>`:""}${!isMe&&isFriend?`<button class="btn-primary" data-action="open-chat" data-user-id="${u.id}" data-user-name="${escapeAttr(u.display_name)}">Mensaje privado</button>`:""}</div></div>`);applyAvatar(document.getElementById("profileAvatar"),u);}
async function sendFriendRequest(id){await requestJson(`/friends/request/${id}`,{method:"POST"});alert("Solicitud enviada.");closeModal();}
async function loadFriends(){const data=await requestJson("/friends");renderFriendsList(onlineFriends,data.online,true);renderFriendsList(offlineFriends,data.offline,false);}
function renderFriendsList(container,friends,online){if(!friends.length){container.innerHTML=`<div class="empty-mini">${online?"No hay amigos conectados.":"No hay amigos desconectados."}</div>`;return;}container.innerHTML=friends.map(f=>`<button class="friend" type="button" data-chat-user-id="${f.id}" data-chat-user-name="${escapeAttr(f.display_name)}"><span class="avatar ${getAvatarClass(f.avatar_initials)}">${escapeHtml(f.avatar_initials)}</span><span class="friend__info"><strong>${escapeHtml(f.display_name)}</strong><small>${online?"En línea":"Desconectado"}</small></span><span class="status-dot ${online?"":"status-dot--off"}"></span></button>`).join("");friends.forEach(f=>applyAvatar(container.querySelector(`[data-chat-user-id="${f.id}"] .avatar`),f));}
async function openNotifications(){const items=await requestJson("/notifications");openModal(`${modalHeader("Notificaciones")}<div class="notification-list">${items.length?items.map(renderNotification).join(""):`<p class="empty-mini">No tienes notificaciones.</p>`}</div>`);}
function renderNotification(n){const req=n.type==="friend_request";return `<div class="notification-item" data-notification-id="${n.id}"><strong>${escapeHtml(n.message)}</strong><small>${formatRelativeTime(n.created_at)}</small>${req?`<div class="notification-actions"><button class="btn-primary" data-action="accept-friend" data-friendship-id="${n.entity_id}">Aceptar</button><button class="btn-secondary" data-action="reject-friend" data-friendship-id="${n.entity_id}">Rechazar</button></div>`:""}</div>`;}
async function respondFriend(fid,action){await requestJson(`/friends/respond/${fid}?action=${action}`,{method:"POST"});await loadFriends();await openNotifications();}
function openEditProfileModal(){const u=getCurrentUser();openModal(`${modalHeader("Editar perfil")}<form class="form-grid" id="editProfileForm"><label>Nombre<input name="display_name" maxlength="80" value="${escapeAttr(u.display_name||"")}" /></label><label>Biografía<textarea name="bio" maxlength="240" placeholder="Escribe algo sobre ti...">${escapeHtml(u.bio||"")}</textarea></label><label>Avatar URL<input name="avatar_url" maxlength="700" value="${escapeAttr(u.avatar_url||"")}" placeholder="Opcional: pega una URL de imagen" /></label><div class="form-actions"><button class="btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn-primary" type="submit">Guardar perfil</button></div></form>`);}
async function submitProfile(form){const user=await requestJson("/me",{method:"PATCH",body:JSON.stringify({display_name:form.display_name.value.trim(),bio:form.bio.value.trim(),avatar_url:form.avatar_url.value.trim()})});saveSession(getToken(),user);updateActiveUserUI(user);closeModal();}
async function openPrivateChat(id,name){currentChatFriendId=Number(id);const messages=await requestJson(`/dm/${id}`);openModal(`${modalHeader(`Chat con ${escapeHtml(name)}`)}<div class="chat-box"><div class="chat-messages" id="chatMessages">${messages.map(renderDm).join("")}</div><form class="chat-form" id="chatForm"><input name="message" placeholder="Escribe un mensaje privado..." autocomplete="off" /><button class="btn-primary" type="submit"><i class="bx bx-send"></i></button></form></div>`);scrollChatToBottom();}
function renderDm(m){return `<div class="dm ${m.mine?"dm--me":""}" data-dm-id="${m.id}">${escapeHtml(m.content)}<small>${formatRelativeTime(m.created_at)}</small></div>`;}
function appendDm(m){if(!currentChatFriendId)return;const other=m.mine?m.receiver.id:m.sender.id;if(Number(other)!==Number(currentChatFriendId))return;const box=document.getElementById("chatMessages");if(!box||box.querySelector(`[data-dm-id="${m.id}"]`))return;box.insertAdjacentHTML("beforeend",renderDm(m));scrollChatToBottom();}
function scrollChatToBottom(){const box=document.getElementById("chatMessages");if(box)box.scrollTop=box.scrollHeight;}
async function sendDm(id,content){const m=await requestJson(`/dm/${id}`,{method:"POST",body:JSON.stringify({content})});appendDm(m);}
function filterPosts(){const q=searchInput.value.trim().toLowerCase();const posts=document.querySelectorAll(".post-card");let visible=0;posts.forEach(p=>{const okFilter=currentFilter==="all"||p.dataset.category===currentFilter;const okSearch=!q||p.textContent.toLowerCase().includes(q);const show=okFilter&&okSearch;p.style.display=show?"":"none";if(show)visible++;});emptyState.classList.toggle("is-visible",visible===0);}
function setActiveFilter(v){currentFilter=v;filterButtons.forEach(b=>b.classList.toggle("is-active",b.dataset.filter===v));filterPosts();}
function connectWebSocket(){const token=getToken();if(!token)return;socket=new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);socket.addEventListener("message",e=>{const p=JSON.parse(e.data);if(p.type==="new_post")prependPost(p.post);if(p.type==="post_updated"||p.type==="poll_updated")replacePost(p.post);if(p.type==="post_deleted")removePostFromDOM(p.post_id);if(p.type==="like_updated")updateLikeButton(p.post_id,p.likes,null);if(p.type==="new_comment"){appendComment(p.post_id,p.comment);updateCommentsCount(p.post_id,p.comments_count);}if(p.type==="notification"){notificationDot.hidden=false;}if(p.type==="friends_updated"||p.type==="presence_updated")loadFriends().catch(console.error);if(p.type==="direct_message"){appendDm(p.message);notificationDot.hidden=false;}});socket.addEventListener("close",()=>setTimeout(()=>{if(getToken())connectWebSocket();},3000));}

openSidebarBtn.addEventListener("click",openSidebar);closeSidebarBtn.addEventListener("click",closeSidebar);overlay.addEventListener("click",closeSidebar);collapseSidebarBtn.addEventListener("click",toggleSidebarCollapse);refreshFriendsBtn.addEventListener("click",()=>loadFriends().catch(e=>alert(e.message)));
composerInput.addEventListener("click",createTextPost);newPostBtn.addEventListener("click",createTextPost);imagePostBtn.addEventListener("click",()=>{hiddenImageInput.value="";hiddenImageInput.click();});pollPostBtn.addEventListener("click",openPollModal);eventPostBtn.addEventListener("click",()=>openEventModal());
profileMenuBtn.addEventListener("click",()=>profileMenu.hidden=!profileMenu.hidden);notificationsBtn.addEventListener("click",()=>{notificationDot.hidden=true;openNotifications().catch(e=>alert(e.message));});
profileMenu.addEventListener("click",e=>{const a=e.target.closest("[data-profile-action]")?.dataset.profileAction;profileMenu.hidden=true;if(a==="view-my-profile")openUserProfile(getCurrentUser().id);if(a==="edit-profile")openEditProfileModal();if(a==="notifications")openNotifications().catch(err=>alert(err.message));if(a==="logout"){clearSession();location.reload();}});
searchInput.addEventListener("input",()=>{const q=searchInput.value.trim();filterPosts();searchUsers(q).catch(console.error);});clearSearchBtn.addEventListener("click",()=>{searchInput.value="";searchResults.hidden=true;filterPosts();});searchResults.addEventListener("click",e=>{const b=e.target.closest("[data-user-id]");if(b)openUserProfile(b.dataset.userId).catch(err=>alert(err.message));});
filterButtons.forEach(b=>b.addEventListener("click",()=>setActiveFilter(b.dataset.filter)));document.querySelectorAll("[data-channel-link]").forEach(l=>l.addEventListener("click",e=>{e.preventDefault();setActiveFilter(l.dataset.channelLink);}));document.querySelectorAll("[data-filter-sidebar]").forEach(l=>l.addEventListener("click",e=>{e.preventDefault();const v=l.dataset.filterSidebar;if(v==="media"){document.querySelectorAll(".post-card").forEach(c=>c.style.display=c.querySelector(".post-card__media img")?"":"none");return;}if(v==="saved"){alert("Guardados queda listo como sección visual para una siguiente versión.");return;}setActiveFilter(v);}));
postsContainer.addEventListener("click",async e=>{try{const like=e.target.closest(".reaction-btn"),comment=e.target.closest(".comment-btn"),del=e.target.closest(".delete-post-btn"),poll=e.target.closest(".poll-option"),edit=e.target.closest(".edit-event-btn");if(like)return await handleLikeClick(like);if(comment)return await toggleComments(comment.dataset.postId);if(del)return await deletePost(del.dataset.postId);if(poll)return await votePoll(poll);if(edit)return openEventModal({id:edit.dataset.eventId,title:"",description:"",start_at:"",location:""});}catch(err){alert(err.message);}});
postsContainer.addEventListener("submit",async e=>{const form=e.target.closest("[data-comment-form]");if(!form)return;e.preventDefault();const card=form.closest(".post-card");const input=form.querySelector('input[name="comment"]');const content=input.value.trim();if(!content)return;input.value="";try{await submitComment(card.dataset.postId,content);}catch(err){alert(err.message);}});
document.addEventListener("click",e=>{if(!profileMenu.contains(e.target)&&!profileMenuBtn.contains(e.target))profileMenu.hidden=true;});
modal.addEventListener("click",e=>{if(e.target.closest("[data-close-modal]"))closeModal();});
modal.addEventListener("submit",async e=>{e.preventDefault();try{if(e.target.id==="pollForm")await submitPoll(e.target);if(e.target.id==="eventForm")await submitEvent(e.target);if(e.target.id==="editEventForm")await submitEventEdit(e.target);if(e.target.id==="editProfileForm")await submitProfile(e.target);if(e.target.id==="chatForm"){const input=e.target.message;const content=input.value.trim();if(!content)return;input.value="";await sendDm(currentChatFriendId,content);}}catch(err){alert(err.message);}});
modal.addEventListener("click",async e=>{const a=e.target.closest("[data-action]")?.dataset.action;try{if(a==="add-friend")await sendFriendRequest(e.target.closest("[data-user-id]").dataset.userId);if(a==="edit-profile")openEditProfileModal();if(a==="accept-friend")await respondFriend(e.target.closest("[data-friendship-id]").dataset.friendshipId,"accept");if(a==="reject-friend")await respondFriend(e.target.closest("[data-friendship-id]").dataset.friendshipId,"reject");if(a==="open-chat"){const b=e.target.closest("[data-user-id]");await openPrivateChat(b.dataset.userId,b.dataset.userName);}}catch(err){alert(err.message);}});
onlineFriends.addEventListener("click",e=>{const b=e.target.closest("[data-chat-user-id]");if(b)openPrivateChat(b.dataset.chatUserId,b.dataset.chatUserName).catch(err=>alert(err.message));});offlineFriends.addEventListener("click",e=>{const b=e.target.closest("[data-chat-user-id]");if(b)openPrivateChat(b.dataset.chatUserId,b.dataset.chatUserName).catch(err=>alert(err.message));});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!modal.hidden)closeModal();closeSidebar();}});window.addEventListener("resize",()=>{if(window.innerWidth>980)closeSidebar();});
function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function escapeAttr(v){return escapeHtml(v).replaceAll("\n"," ");}
function getAvatarClass(i){const c=["avatar--blue","avatar--green","avatar--purple","avatar--me"];const code=String(i||"U").charCodeAt(0);return c[Number.isNaN(code)?0:code%c.length];}
function applyAvatar(el,u){if(!el||!u)return;el.textContent=u.avatar_initials||"U";if(u.avatar_url){el.style.backgroundImage=`url("${u.avatar_url}")`;el.style.color="transparent";}else{el.style.backgroundImage="";el.style.color="";}}
function formatRelativeTime(iso){const d=new Date(iso),now=new Date(),min=Math.floor((now-d)/60000),h=Math.floor(min/60),days=Math.floor(h/24);if(Number.isNaN(d.getTime())||min<1)return"hace un momento";if(min<60)return`hace ${min} min`;if(h<24)return`hace ${h} h`;if(days===1)return"ayer";return d.toLocaleDateString("es-PE",{day:"2-digit",month:"short",year:"numeric"});}
function formatDateTime(iso){return iso?new Date(iso).toLocaleString("es-PE",{dateStyle:"medium",timeStyle:"short"}):"";}
function toDatetimeLocal(iso){const d=new Date(iso);if(Number.isNaN(d.getTime()))return"";const p=n=>String(n).padStart(2,"0");return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
(async function initApp(){try{await ensureAuthenticated();await loadPosts();await loadFriends();connectWebSocket();}catch(e){alert(e.message||"No se pudo iniciar la app.");}})();
