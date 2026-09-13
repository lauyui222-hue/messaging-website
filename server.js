const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const dataPath = path.join(root, 'data.json');
const secretPath = path.join(root, '.message-secret');
const sessions = new Map();
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

function loadData() {
  if (!fs.existsSync(dataPath)) return { users: [], friendships: [], messages: [] };
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}
function saveData() { fs.writeFileSync(dataPath, JSON.stringify(data, null, 2)); }
function id() { return crypto.randomUUID(); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function passwordMatches(password, user) { const candidate = Buffer.from(hashPassword(password, user.salt).hash, 'hex'); return crypto.timingSafeEqual(candidate, Buffer.from(user.passwordHash, 'hex')); }
function publicUser(user) { return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt }; }
function getSecret() {
  if (process.env.MESSAGE_ENCRYPTION_KEY) return crypto.createHash('sha256').update(process.env.MESSAGE_ENCRYPTION_KEY).digest();
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(32).toString('base64'));
  return crypto.createHash('sha256').update(fs.readFileSync(secretPath)).digest();
}
function encryptMessage(text) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv); const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }; }
function decryptMessage(message) { const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(message.iv, 'base64')); decipher.setAuthTag(Buffer.from(message.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(message.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }
function send(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(payload)); }
function parseCookies(request) { return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => part.trim().split('=').map(decodeURIComponent))); }
function currentUser(request) { const userId = sessions.get(parseCookies(request).session); return data.users.find((user) => user.id === userId); }
function requireUser(request, response) { const user = currentUser(request); if (!user) send(response, 401, { error: 'Please log in first.' }); return user; }
function areFriends(first, second) { return data.friendships.some((friendship) => friendship.includes(first) && friendship.includes(second)); }
function friendUsers(userId) { return data.friendships.filter((friendship) => friendship.includes(userId)).map((friendship) => friendship.find((friendId) => friendId !== userId)).map((friendId) => data.users.find((user) => user.id === friendId)).filter(Boolean).map(publicUser); }
async function body(request) { let raw = ''; for await (const chunk of request) raw += chunk; return raw ? JSON.parse(raw) : {}; }
function loginResponse(response, user) { const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, user.id); response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `session=${token}; ${cookieFlags}` }); response.end(JSON.stringify({ user: publicUser(user) })); }

const encryptionKey = getSecret();
const data = loadData();
if (!data.users.some((user) => user.username === (process.env.ADMIN_USER || 'admin'))) {
  const credentials = hashPassword(process.env.ADMIN_PASSWORD || 'admin-change-me');
  data.users.push({ id: id(), username: process.env.ADMIN_USER || 'admin', passwordHash: credentials.hash, salt: credentials.salt, role: 'admin', createdAt: new Date().toISOString() });
  saveData();
}

async function api(request, response, pathname) {
  try {
    if (request.method === 'POST' && pathname === '/api/signup') {
      const input = await body(request); const username = String(input.username || '').trim().toLowerCase(); const password = String(input.password || '');
      if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 8) return send(response, 400, { error: 'Use a 3-24 character username and an 8 character password.' });
      if (data.users.some((user) => user.username === username)) return send(response, 409, { error: 'That username is already taken.' });
      const credentials = hashPassword(password); const user = { id: id(), username, passwordHash: credentials.hash, salt: credentials.salt, role: 'user', createdAt: new Date().toISOString() }; data.users.push(user); saveData(); return loginResponse(response, user);
    }
    if (request.method === 'POST' && pathname === '/api/login') {
      const input = await body(request); const user = data.users.find((candidate) => candidate.username === String(input.username || '').trim().toLowerCase());
      if (!user || !passwordMatches(String(input.password || ''), user)) return send(response, 401, { error: 'Invalid username or password.' });
      return loginResponse(response, user);
    }
    if (request.method === 'POST' && pathname === '/api/logout') { sessions.delete(parseCookies(request).session); response.writeHead(204, { 'Set-Cookie': `session=; ${cookieFlags}; Max-Age=0` }); return response.end(); }
    if (request.method === 'GET' && pathname === '/api/me') { const user = currentUser(request); return send(response, 200, { user: user ? publicUser(user) : null }); }
    const user = requireUser(request, response); if (!user) return;
    if (request.method === 'GET' && pathname === '/api/friends') return send(response, 200, { friends: friendUsers(user.id) });
    if (request.method === 'POST' && pathname === '/api/friends') {
      const input = await body(request); const target = data.users.find((candidate) => candidate.username === String(input.username || '').trim().toLowerCase());
      if (!target || target.id === user.id) return send(response, 404, { error: 'User not found.' });
      if (!areFriends(user.id, target.id)) { data.friendships.push([user.id, target.id]); saveData(); }
      return send(response, 200, { friend: publicUser(target) });
    }
    const messageMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
    if (messageMatch) {
      const otherId = messageMatch[1]; const other = data.users.find((candidate) => candidate.id === otherId);
      if (!other || !areFriends(user.id, otherId)) return send(response, 403, { error: 'You can only message friends.' });
      if (request.method === 'GET') {
        const messages = data.messages.filter((message) => (message.from === user.id && message.to === otherId) || (message.from === otherId && message.to === user.id)).map((message) => ({ id: message.id, from: message.from, to: message.to, text: decryptMessage(message), createdAt: message.createdAt }));
        return send(response, 200, { messages });
      }
      if (request.method === 'POST') {
        const input = await body(request); const text = String(input.text || '').trim();
        if (!text || text.length > 2000) return send(response, 400, { error: 'Message must be between 1 and 2,000 characters.' });
        const message = { id: id(), from: user.id, to: otherId, createdAt: new Date().toISOString(), ...encryptMessage(text) }; data.messages.push(message); saveData();
        return send(response, 201, { message: { id: message.id, from: user.id, to: otherId, text, createdAt: message.createdAt } });
      }
    }
    if (request.method === 'GET' && pathname === '/api/admin/users') { if (user.role !== 'admin') return send(response, 403, { error: 'Admin access required.' }); return send(response, 200, { users: data.users.map(publicUser) }); }
    if (request.method === 'GET' && pathname === '/api/admin/chats') {
      if (user.role !== 'admin') return send(response, 403, { error: 'Admin access required.' });
      return send(response, 200, { messages: data.messages.map((message) => ({ ...message, text: decryptMessage(message), fromUser: data.users.find((candidate) => candidate.id === message.from)?.username, toUser: data.users.find((candidate) => candidate.id === message.to)?.username })) });
    }
    return send(response, 404, { error: 'API route not found.' });
  } catch (error) { console.error(error); return send(response, 400, { error: 'Request could not be processed.' }); }
}

http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (pathname.startsWith('/api/')) return api(request, response, pathname);
  const requestedPath = pathname === '/' ? '/index.html' : pathname; const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { response.writeHead(404); return response.end('Not found'); }
  response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' }); fs.createReadStream(filePath).pipe(response);
}).listen(port, () => console.log(`Private Relay listening on http://localhost:${port}`));
