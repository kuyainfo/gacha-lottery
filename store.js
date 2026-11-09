/* 簡易扭蛋抽獎｜共用資料層（存在這台電腦的瀏覽器 localStorage） */
(function () {
  const KEY = 'gacha_lottery_v1';

  function empty() { return { prizes: [], log: [], updatedAt: Date.now() }; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const d = JSON.parse(raw);
      if (!Array.isArray(d.prizes)) d.prizes = [];
      if (!Array.isArray(d.log)) d.log = [];
      return d;
    } catch (e) { return empty(); }
  }

  function save(d) {
    d.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(d));
  }

  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* 抽一次：每個「還有剩」的品項機率相同（不看數量多寡） */
  function draw() {
    const d = load();
    const pool = d.prizes.filter(p => p.remaining > 0);
    if (!pool.length) return null;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const pick = pool[buf[0] % pool.length];
    pick.remaining -= 1;
    const entry = { no: d.log.length + 1, prizeId: pick.id, name: pick.name, time: Date.now() };
    d.log.push(entry);
    save(d);
    return { entry, prize: pick, poolSize: pool.length };
  }

  function undoLast() {
    const d = load();
    const last = d.log.pop();
    if (!last) return null;
    const p = d.prizes.find(x => x.id === last.prizeId);
    if (p) p.remaining = Math.min(p.qty, p.remaining + 1);
    save(d);
    return last;
  }

  window.GachaStore = { KEY, load, save, draw, undoLast, uid };
})();
