/**
 * Harem Altın canlı fiyat akışı (yalnızca masaüstü sürüm başlatır).
 *
 * Harem'in sitesi fiyatları socket.io ile `price_changed` olayında gönderir:
 *   42["price_changed", {meta: {...}, data: {ALTIN: {alis, satis, ...}, USDTRY: {...}}}]
 * Burada socket.io istemcisi yerine Node'un yerleşik WebSocket'i ile Engine.IO
 * protokolü konuşulur (v4, olmazsa v3). Gelen kodlar birikir; fiyat.ts son
 * HAREM_TAZE_MS içinde veri geldiyse Harem'i, gelmediyse Truncgil'i kullanır.
 * Bağlantı koparsa artan aralıklarla yeniden bağlanılır.
 */

export const HAREM_SOCKET = 'wss://hrmsocketonly.haremaltin.com';
export const HAREM_TAZE_MS = 2 * 60 * 1000;

type Pair = { alis: unknown; satis: unknown };
export type HaremState = { at: number; data: Record<string, Pair>; tarih: string };

const g = globalThis as { __harem__?: HaremState };

/** Akıştan gelen son veriler; HAREM_TAZE_MS'den eskiyse null. */
export function haremSnapshot(now = Date.now()): HaremState | null {
  const s = g.__harem__;
  return s && now - s.at < HAREM_TAZE_MS && s.data.ALTIN ? s : null;
}

/**
 * Bir socket.io mesajını işler. Fiyat geldiyse true döner.
 * `42["price_changed",{...}]` dışındaki mesajlar yok sayılır.
 */
export function haremMesaj(text: string, now = Date.now()): boolean {
  if (!text.startsWith('42')) return false;
  let msg: unknown;
  try { msg = JSON.parse(text.slice(2)); } catch { return false; }
  if (!Array.isArray(msg) || msg[0] !== 'price_changed') return false;
  const body = msg[1] as { meta?: { tarih?: string; time?: unknown }; data?: Record<string, Pair> } | undefined;
  const data = body?.data;
  if (!data || typeof data !== 'object') return false;
  const prev = g.__harem__?.data ?? {};
  const merged: Record<string, Pair> = { ...prev };
  for (const [code, item] of Object.entries(data)) {
    if (item && typeof item === 'object' && 'alis' in item && 'satis' in item) merged[code.toUpperCase()] = { alis: item.alis, satis: item.satis };
  }
  g.__harem__ = { at: now, data: merged, tarih: String(body?.meta?.tarih ?? '') };
  return true;
}

/** Akışı başlatır; dönen fonksiyon durdurur. */
export function startHaremStream(log: (...a: unknown[]) => void = console.log, server = HAREM_SOCKET): () => void {
  const WS = (globalThis as { WebSocket?: any }).WebSocket;
  if (!WS) { log('Harem: WebSocket yok, akış başlatılmadı'); return () => {}; }
  let stopped = false;
  let ws: any = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let retry = 0;
  let eio = 4;
  let gotPrice = false;

  const cleanup = () => { if (ping) clearInterval(ping); ping = null; try { ws?.close(); } catch { /* kapalı */ } ws = null; };
  const schedule = () => {
    cleanup();
    if (stopped) return;
    // Hiç fiyat alınamadıysa protokol sürümünü değiştirip dene (v4 <-> v3).
    if (!gotPrice) eio = eio === 4 ? 3 : 4;
    const wait = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(retry++, 6));
    setTimeout(connect, wait);
  };

  function connect() {
    if (stopped) return;
    gotPrice = false;
    const url = `${server}/socket.io/?EIO=${eio}&transport=websocket`;
    try {
      ws = new WS(url, { headers: { Origin: 'https://www.haremaltin.com', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } });
    } catch {
      try { ws = new WS(url); } catch (e) { log('Harem: bağlanılamadı', e); schedule(); return; }
    }
    ws.onmessage = (ev: { data: unknown }) => {
      const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
      if (text.startsWith('0')) {
        // Açılış: v4'te ad alanına bağlanmak için "40" gönderilir; v3'te istemci ping atar.
        let interval = 25_000;
        try { interval = Number(JSON.parse(text.slice(1)).pingInterval) || interval; } catch { /* varsayılan */ }
        if (eio === 4) ws.send('40');
        else ping = setInterval(() => { try { ws?.send('2'); } catch { /* yeniden bağlanır */ } }, interval);
        return;
      }
      if (text === '2') { ws.send('3'); return; } // v4: sunucu ping, istemci pong
      if (haremMesaj(text)) {
        if (!gotPrice) log(`Harem: canlı fiyat alınıyor (EIO=${eio})`);
        gotPrice = true; retry = 0;
      }
    };
    ws.onclose = () => { if (!stopped) schedule(); };
    ws.onerror = () => { /* onclose yeniden bağlar */ };
  }

  connect();
  return () => { stopped = true; cleanup(); };
}
