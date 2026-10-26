// Шина событий для WebSocket-клиентов
const clients = new Set();

function subscribe(client) {
  clients.add(client);
  client.onClose(() => clients.delete(client));
}

function emit(type, data) {
  const msg = JSON.stringify({ type, ...data });
  for (const c of clients) c.send(msg);
}

function ping() {
  for (const c of clients) c.ping();
}

module.exports = { subscribe, emit, ping };
