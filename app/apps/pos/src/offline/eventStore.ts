// apps/pos/src/offline/eventStore.ts
// ОФЛАЙН-ЯДРО КАССЫ (главный урок Poster: офлайн — продающая фича, значит
// это фундамент, а не заплатка). Все действия кассы = события в локальном
// журнале; сеть есть — уходят пачкой; сети нет — касса полноценно работает.
//
// Хранилище: SQLite (Tauri/Capacitor плагин) с fallback на IndexedDB в dev.

// ULID без внешней зависимости: 48 бит времени + 80 бит случайности
// в Crockford base32. Сортируемость по времени сохраняется — этого
// достаточно для порядка событий в журнале.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(now = Date.now()): string {
  let t = now, time = '';
  for (let i = 0; i < 10; i++) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let rand = '';
  for (let i = 0; i < 16; i++) rand += B32[rnd[i] % 32];
  return time + rand;
}

export interface LocalEvent {
  eventId: string;
  type: string;
  payload: unknown;
  createdAt: string;
  synced: 0 | 1;
}

type SqlExec = (sql: string, params?: unknown[]) => Promise<any>;

export class EventStore {
  constructor(private exec: SqlExec, private terminalId: string) {}

  async init() {
    await this.exec(`CREATE TABLE IF NOT EXISTS events (
      eventId TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    )`);
    await this.exec(`CREATE INDEX IF NOT EXISTS idx_unsynced ON events(synced)`);
  }

  /** Записать событие ЛОКАЛЬНО — мгновенно, без сети. UI не ждёт сервер. */
  async append(type: string, payload: unknown): Promise<string> {
    const eventId = ulid();
    await this.exec(
      `INSERT INTO events (eventId, type, payload, createdAt, synced) VALUES (?,?,?,?,0)`,
      [eventId, type, JSON.stringify(payload), new Date().toISOString()],
    );
    return eventId;
  }

  async unsynced(limit = 100): Promise<LocalEvent[]> {
    const rows = await this.exec(
      `SELECT * FROM events WHERE synced=0 ORDER BY eventId LIMIT ?`, [limit],
    );
    return rows.map((r: any) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  async markSynced(ids: string[]) {
    if (!ids.length) return;
    await this.exec(
      `UPDATE events SET synced=1 WHERE eventId IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  }
}

// ── Цикл синхронизации ───────────────────────────────────────────
export class SyncLoop {
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private store: EventStore,
    private apiBase: string,
    private authToken: () => string | null,
  ) {}

  start(intervalMs = 5000) {
    this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs);
    // мгновенная попытка при восстановлении сети
    window.addEventListener('online', () => this.tick().catch(() => {}));
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (!navigator.onLine) return;             // офлайн — просто копим
    const batch = await this.store.unsynced();
    if (!batch.length) return;
    const res = await fetch(`${this.apiBase}/sync/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authToken() ?? ''}`,
      },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) return;                        // сервер недоступен — повторим
    const { results } = await res.json();
    const okIds = results
      .filter((r: any) => r.status === 'accepted' || r.status === 'duplicate')
      .map((r: any) => r.eventId);              // duplicate = идемпотентный успех
    await this.store.markSynced(okIds);
  }
}
