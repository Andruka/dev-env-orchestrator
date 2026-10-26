// Шина событий для SSE-клиентов
const clients = new Set();

function subscribe(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function emit(type, data) {
  const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const res of clients) res.write(msg);
}

module.exports = { subscribe, emit };
