const $ = (id) => document.getElementById(id);
const state = { mode: 'login', user: null, friends: [], activeFriend: null };

function toast(message) { const element = $('toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2500); }
async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function show(view) { ['authView', 'userView', 'adminView'].forEach((id) => $(id).classList.toggle('hidden', id !== view)); $('accountBar').classList.toggle('hidden', view === 'authView'); }
function renderAccount() { $('accountName').textContent = `@${state.user.username}`; $('accountRole').textContent = state.user.role; }
function setAuthMode(mode) { state.mode = mode; $('loginTab').classList.toggle('active', mode === 'login'); $('signupTab').classList.toggle('active', mode === 'signup'); $('authSubmit').textContent = mode === 'login' ? 'Enter Private Relay' : 'Create account'; $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password'; $('authError').textContent = ''; }
async function loadSession() {
  const { user } = await request('/api/me');
  if (!user) return show('authView');
  state.user = user; renderAccount();
  if (user.role === 'admin') { show('adminView'); return loadAdmin(); }
  show('userView'); return loadFriends();
}
async function submitAuth(event) {
  event.preventDefault(); $('authError').textContent = '';
  try { const { user } = await request(`/api/${state.mode}`, { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) }); state.user = user; renderAccount(); $('authForm').reset(); if (user.role === 'admin') { show('adminView'); await loadAdmin(); } else { show('userView'); await loadFriends(); } }
  catch (error) { $('authError').textContent = error.message; }
}
function renderFriends() {
  $('friendsList').innerHTML = state.friends.length ? state.friends.map((friend) => `<button class="person ${state.activeFriend?.id === friend.id ? 'selected' : ''}" data-id="${friend.id}" type="button"><span class="avatar">${friend.username[0].toUpperCase()}</span><span><strong>${friend.username}</strong><small>Private connection</small></span></button>`).join('') : '<div class="empty-small">No friends yet.</div>';
  document.querySelectorAll('.person').forEach((button) => button.addEventListener('click', () => selectFriend(state.friends.find((friend) => friend.id === button.dataset.id))));
}
async function loadFriends() { const { friends } = await request('/api/friends'); state.friends = friends; renderFriends(); }
async function addFriend(event) { event.preventDefault(); $('friendError').textContent = ''; try { await request('/api/friends', { method: 'POST', body: JSON.stringify({ username: $('friendUsername').value }) }); $('friendForm').reset(); await loadFriends(); toast('Friend added'); } catch (error) { $('friendError').textContent = error.message; } }
async function selectFriend(friend) { state.activeFriend = friend; $('chatTitle').textContent = `@${friend.username}`; $('chatStatus').textContent = 'Encrypted conversation'; $('messageInput').disabled = false; renderFriends(); await loadMessages(); }
async function loadMessages() { const { messages } = await request(`/api/messages/${state.activeFriend.id}`); $('messageList').innerHTML = messages.length ? messages.map((message) => `<div class="message ${message.from === state.user.id ? 'mine' : ''}"><p>${escapeHtml(message.text)}</p><time>${new Date(message.createdAt).toLocaleString()}</time></div>`).join('') : '<div class="empty-state">No messages yet. Say hello.</div>'; $('messageList').scrollTop = $('messageList').scrollHeight; }
async function sendMessage(event) { event.preventDefault(); if (!state.activeFriend) return; const input = $('messageInput'); const text = input.value.trim(); if (!text) return; try { await request(`/api/messages/${state.activeFriend.id}`, { method: 'POST', body: JSON.stringify({ text }) }); input.value = ''; await loadMessages(); } catch (error) { toast(error.message); } }
async function loadAdmin() { const [{ users }, { messages }] = await Promise.all([request('/api/admin/users'), request('/api/admin/chats')]); $('userCount').textContent = `${users.length} accounts`; $('chatCount').textContent = `${messages.length} messages`; $('adminUsers').innerHTML = users.map((user) => `<div class="admin-row"><span class="avatar">${user.username[0].toUpperCase()}</span><span><strong>@${user.username}</strong><small>${user.role} / joined ${new Date(user.createdAt).toLocaleDateString()}</small></span></div>`).join(''); $('adminChats').innerHTML = messages.length ? messages.slice().reverse().map((message) => `<article class="audit-message"><div><strong>@${message.fromUser} <span>to</span> @${message.toUser}</strong><time>${new Date(message.createdAt).toLocaleString()}</time></div><p>${escapeHtml(message.text)}</p></article>`).join('') : '<div class="empty-small">No chat history yet.</div>'; }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

$('loginTab').addEventListener('click', () => setAuthMode('login')); $('signupTab').addEventListener('click', () => setAuthMode('signup')); $('authForm').addEventListener('submit', submitAuth); $('friendForm').addEventListener('submit', addFriend); $('messageForm').addEventListener('submit', sendMessage); $('logout').addEventListener('click', async () => { await request('/api/logout', { method: 'POST' }); state.user = null; state.activeFriend = null; show('authView'); toast('You are logged out'); });
loadSession().catch(() => show('authView'));
