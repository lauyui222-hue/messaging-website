const $ = (id) => document.getElementById(id);
const state = { mode: 'login', user: null, friends: [], activeFriend: null };
let qrScanner = null;

function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  $('themeToggle').setAttribute('aria-label', isDark ? 'Enable light mode' : 'Enable dark mode');
  $('themeToggle').title = isDark ? 'Enable light mode' : 'Enable dark mode';
  $('themeToggle').querySelector('span').textContent = isDark ? '☀' : '☾';
  $('themeLabel').textContent = isDark ? 'Light mode' : 'Dark mode';
  localStorage.setItem('private-relay-theme', isDark ? 'dark' : 'light');
}

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
  show('userView'); await loadFriends(); return loadPosts();
}
async function submitAuth(event) {
  event.preventDefault(); $('authError').textContent = '';
  try { const { user } = await request(`/api/${state.mode}`, { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) }); state.user = user; renderAccount(); $('authForm').reset(); if (user.role === 'admin') { show('adminView'); await loadAdmin(); } else { show('userView'); await loadFriends(); await loadPosts(); } }
  catch (error) { $('authError').textContent = error.message; }
}
function renderFriends() {
  $('friendsList').innerHTML = state.friends.length ? state.friends.map((friend) => `<button class="person ${state.activeFriend?.id === friend.id ? 'selected' : ''}" data-id="${friend.id}" type="button"><span class="avatar">${friend.username[0].toUpperCase()}</span><span><strong>${friend.username}</strong><small>Private connection</small></span></button>`).join('') : '<div class="empty-small">No friends yet.</div>';
  document.querySelectorAll('.person').forEach((button) => button.addEventListener('click', () => selectFriend(state.friends.find((friend) => friend.id === button.dataset.id))));
}
async function loadFriends() { const { friends } = await request('/api/friends'); state.friends = friends; renderFriends(); }
async function addFriend(event) { event.preventDefault(); $('friendError').textContent = ''; try { await request('/api/friends', { method: 'POST', body: JSON.stringify({ username: $('friendUsername').value }) }); $('friendForm').reset(); await loadFriends(); toast('Friend added'); } catch (error) { $('friendError').textContent = error.message; } }
async function addFriendByUsername(username) { const cleanUsername = username.trim().replace(/^@/, '').toLowerCase(); if (!cleanUsername) throw new Error('Enter a username first.'); await request('/api/friends', { method: 'POST', body: JSON.stringify({ username: cleanUsername }) }); await loadFriends(); toast(`@${cleanUsername} added as a friend`); }
function openQrModal() { if (typeof QRCode === 'undefined') return toast('QR display is unavailable right now.'); $('qrCode').replaceChildren(); new QRCode($('qrCode'), { text: `private-relay:${state.user.username}`, width: 190, height: 190, colorDark: '#142522', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); $('qrModal').classList.remove('hidden'); }
function closeQrModal() { $('qrModal').classList.add('hidden'); }
async function openScanner() { $('scannerModal').classList.remove('hidden'); $('scannerStatus').textContent = 'Allow camera access to scan a code.'; if (typeof QrScanner === 'undefined') { $('scannerStatus').textContent = 'Camera scanner unavailable. Enter a username below.'; return; } QrScanner.WORKER_PATH = 'https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner-worker.min.js'; qrScanner = new QrScanner($('qrVideo'), async (result) => { const value = typeof result === 'string' ? result : result.data; if (!value.startsWith('private-relay:')) return; stopScanner(); try { await addFriendByUsername(value.slice('private-relay:'.length)); } catch (error) { $('friendError').textContent = error.message; } }, { returnDetailedScanResult: true }); try { await qrScanner.start(); $('scannerStatus').textContent = 'Point your camera at a friend code.'; } catch (error) { $('scannerStatus').textContent = 'Camera unavailable. Enter a username below.'; } }
function stopScanner() { if (qrScanner) { qrScanner.stop(); qrScanner.destroy(); qrScanner = null; } $('scannerModal').classList.add('hidden'); }
async function selectFriend(friend) { state.activeFriend = friend; $('chatTitle').textContent = `@${friend.username}`; $('chatStatus').textContent = 'Encrypted conversation'; $('messageInput').disabled = false; renderFriends(); await loadMessages(); }
async function loadMessages() { const { messages } = await request(`/api/messages/${state.activeFriend.id}`); $('messageList').innerHTML = messages.length ? messages.map((message) => `<div class="message ${message.from === state.user.id ? 'mine' : ''}"><p>${escapeHtml(message.text)}</p><time>${new Date(message.createdAt).toLocaleString()}</time></div>`).join('') : '<div class="empty-state">No messages yet. Say hello.</div>'; $('messageList').scrollTop = $('messageList').scrollHeight; }
async function sendMessage(event) { event.preventDefault(); if (!state.activeFriend) return; const input = $('messageInput'); const text = input.value.trim(); if (!text) return; try { await request(`/api/messages/${state.activeFriend.id}`, { method: 'POST', body: JSON.stringify({ text }) }); input.value = ''; await loadMessages(); } catch (error) { toast(error.message); } }
function renderPosts(posts) { $('postsList').innerHTML = posts.length ? posts.map((post) => `<article class="post-card"><div class="post-meta"><span class="avatar">${post.author[0].toUpperCase()}</span><span><strong>@${escapeHtml(post.author)}</strong><time>${new Date(post.createdAt).toLocaleString()}</time></span></div><p>${escapeHtml(post.text)}</p></article>`).join('') : '<div class="empty-small">No posts yet. Be the first to share something.</div>'; }
async function loadPosts() { const { posts } = await request('/api/posts'); renderPosts(posts); }
async function createPost(event) { event.preventDefault(); $('postError').textContent = ''; const text = $('postText').value.trim(); if (!text) return; try { await request('/api/posts', { method: 'POST', body: JSON.stringify({ text }) }); $('postForm').reset(); $('postCount').textContent = '0 / 1,000'; await loadPosts(); toast('Post published'); } catch (error) { $('postError').textContent = error.message; } }
let adminUsers = [];
let adminMessages = [];
function renderAdminUsers() { const query = $('adminUserFilter').value.trim().toLowerCase(); const users = adminUsers.filter((user) => user.username.includes(query)); $('adminUsers').innerHTML = users.length ? users.map((user) => `<div class="admin-row"><span class="avatar">${user.username[0].toUpperCase()}</span><span><strong>@${user.username}</strong><small>${user.role} / joined ${new Date(user.createdAt).toLocaleDateString()}</small></span></div>`).join('') : '<div class="empty-small">No matching users.</div>'; }
async function loadAdmin() { const [{ users }, { messages }, overview] = await Promise.all([request('/api/admin/users'), request('/api/admin/chats'), request('/api/admin/overview')]); adminUsers = users; adminMessages = messages; $('userCount').textContent = `${users.length} accounts`; $('chatCount').textContent = `${messages.length} messages`; $('statUsers').textContent = overview.users; $('statMessages').textContent = overview.messages; $('statConnections').textContent = overview.connections; $('statActivity').textContent = overview.lastActivity ? new Date(overview.lastActivity).toLocaleDateString() : 'None'; renderAdminUsers(); $('adminChats').innerHTML = messages.length ? messages.slice().reverse().map((message) => `<article class="audit-message"><div><strong>@${message.fromUser} <span>to</span> @${message.toUser}</strong><time>${new Date(message.createdAt).toLocaleString()}</time></div><p>${escapeHtml(message.text)}</p></article>`).join('') : '<div class="empty-small">No chat history yet.</div>'; }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

$('loginTab').addEventListener('click', () => setAuthMode('login')); $('signupTab').addEventListener('click', () => setAuthMode('signup')); $('authForm').addEventListener('submit', submitAuth); $('friendForm').addEventListener('submit', addFriend); $('messageForm').addEventListener('submit', sendMessage); $('postForm').addEventListener('submit', createPost); $('postText').addEventListener('input', (event) => { $('postCount').textContent = `${event.target.value.length} / 1,000`; }); $('refreshPosts').addEventListener('click', async () => { await loadPosts(); toast('Feed refreshed'); }); $('adminUserFilter').addEventListener('input', renderAdminUsers); $('refreshAdmin').addEventListener('click', async () => { $('refreshAdmin').textContent = 'Refreshing...'; await loadAdmin(); $('refreshAdmin').textContent = 'Refresh data'; toast('Admin data refreshed'); }); $('logout').addEventListener('click', async () => { await request('/api/logout', { method: 'POST' }); state.user = null; state.activeFriend = null; show('authView'); toast('You are logged out'); });
$('showQr').addEventListener('click', openQrModal); $('scanQr').addEventListener('click', openScanner); $('scanFallback').addEventListener('submit', async (event) => { event.preventDefault(); try { stopScanner(); await addFriendByUsername($('scanUsername').value); $('scanFallback').reset(); } catch (error) { $('scannerStatus').textContent = error.message; } }); document.querySelector('[data-close-modal]').addEventListener('click', closeQrModal); document.querySelector('[data-close-scanner]').addEventListener('click', stopScanner); $('qrModal').addEventListener('click', (event) => { if (event.target === $('qrModal')) closeQrModal(); }); $('scannerModal').addEventListener('click', (event) => { if (event.target === $('scannerModal')) stopScanner(); });
applyTheme(localStorage.getItem('private-relay-theme') === 'dark'); $('themeToggle').addEventListener('click', () => applyTheme(!document.body.classList.contains('dark-mode')));
loadSession().catch(() => show('authView'));
