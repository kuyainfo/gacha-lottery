/* ================================================================
   扭蛋抽獎｜共用資料層
   - 預設：Firebase Realtime Database（kuya-stock-game），資料放在 gacha/{活動代碼}
     → 後台、執行頁可以在不同電腦 / 手機打開，即時同步
   - 網址加 ?local=1：改用本機瀏覽器儲存（同一台電腦測試用）
   - 網址加 ?e=代碼：切換活動（每場活動資料分開），沒加就是 main
   ================================================================ */
(function () {
  const FB = {
    root: 'gacha',
    config: {
      apiKey: 'AIzaSyAoLICybR4P-bzVb_wCwcscsQ3Pd7yiT2s',
      authDomain: 'kuya-stock-game.firebaseapp.com',
      databaseURL: 'https://kuya-stock-game-default-rtdb.asia-southeast1.firebasedatabase.app',
      projectId: 'kuya-stock-game',
      storageBucket: 'kuya-stock-game.firebasestorage.app',
      messagingSenderId: '34287693549',
      appId: '1:34287693549:web:c617470b93badfaa7a66e4'
    },
    appUrl: 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
    dbUrl: 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js'
  };

  const params = new URLSearchParams(location.search);
  const LOCAL = params.get('local') === '1';
  const EVENT = (params.get('e') || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'main';
  const LKEY = 'gacha_lottery_v2_' + EVENT;
  const ABORT = Symbol('abort');

  let fb = null, nodeRef = null;
  let raw = null, ready = false, connected = LOCAL;
  const subs = [], connSubs = [];

  /* 資料庫原始格式 → 頁面好用的格式 */
  function view() {
    const r = raw || {};
    const prizes = Object.entries(r.prizes || {}).map(([id, p]) => ({
      id, name: String(p.name || ''), qty: +p.qty || 0, remaining: +p.remaining || 0, order: +p.order || 0
    })).sort((a, b) => a.order - b.order);
    const log = Object.values(r.log || {}).sort((a, b) => a.no - b.no);
    return { prizes, log, settings: r.settings || {}, seq: r.seq || 0, ready };
  }
  const emit = () => { const v = view(); subs.forEach(f => f(v)); };
  const emitConn = () => connSubs.forEach(f => f(connected));
  const clone = o => JSON.parse(JSON.stringify(o || {}));
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function init() {
    if (LOCAL) {
      try { raw = JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch (e) { raw = null; }
      ready = true;
      addEventListener('storage', e => {
        if (e.key !== LKEY) return;
        try { raw = JSON.parse(e.newValue || 'null'); } catch (err) { raw = null; }
        emit();
      });
      emit(); emitConn();
      return;
    }
    const [appM, dbM] = await Promise.all([import(FB.appUrl), import(FB.dbUrl)]);
    const app = appM.initializeApp(FB.config, 'gacha-lottery');
    const db = dbM.getDatabase(app);
    fb = dbM;
    nodeRef = dbM.ref(db, `${FB.root}/${EVENT}`);
    dbM.onValue(nodeRef, s => { raw = s.val(); ready = true; emit(); });
    dbM.onValue(dbM.ref(db, '.info/connected'), s => { connected = !!s.val(); emitConn(); });
  }

  /* 所有寫入都走這裡：fn 直接改 d（物件），回傳 ABORT 代表取消 */
  async function mutate(fn) {
    if (LOCAL) {
      let d; try { d = JSON.parse(localStorage.getItem(LKEY) || 'null') || {}; } catch (e) { d = {}; }
      const r = fn(d);
      if (r === ABORT) return { committed: false };
      localStorage.setItem(LKEY, JSON.stringify(d));
      raw = d; emit();
      return { committed: true, result: r };
    }
    let result;
    const res = await fb.runTransaction(nodeRef, cur => {
      /* 本機快取還沒拿到資料時先回 null，Firebase 會用伺服器上的真實資料重跑一次 */
      if (cur === null && raw && Object.keys(raw).length) return null;
      const d = cur ? clone(cur) : {};
      const r = fn(d);
      if (r === ABORT) return;           // 回傳 undefined = 取消交易
      result = r;
      return d;
    }, { applyLocally: false });
    return { committed: res.committed, result };
  }

  /* ---------- 抽獎：每個「還有剩」的品項機率相同 ---------- */
  function draw() {
    return mutate(d => {
      const ids = Object.keys(d.prizes || {}).filter(id => (+d.prizes[id].remaining || 0) > 0);
      if (!ids.length) return ABORT;
      const buf = new Uint32Array(1); crypto.getRandomValues(buf);
      const id = ids[buf[0] % ids.length];
      const p = d.prizes[id];
      p.remaining = (+p.remaining || 0) - 1;
      d.seq = (+d.seq || 0) + 1;
      d.log = d.log || {};
      const entry = { no: d.seq, prizeId: id, name: p.name, time: Date.now() };
      d.log['n' + String(d.seq).padStart(5, '0')] = entry;
      return { entry, prize: { id, name: p.name } };
    });
  }

  /* ---------- 後台用 ---------- */
  function importPrizes(list) {
    return mutate(d => {
      d.prizes = {};
      list.forEach((p, i) => { d.prizes[uid()] = { name: p.name, qty: p.qty, remaining: p.qty, order: i }; });
      delete d.log; d.seq = 0;
    });
  }
  function updatePrize(id, fn) {
    return mutate(d => { const p = d.prizes && d.prizes[id]; if (!p) return ABORT; fn(p); });
  }
  function addPrize(name, qty) {
    return mutate(d => {
      d.prizes = d.prizes || {};
      const max = Object.values(d.prizes).reduce((m, p) => Math.max(m, +p.order || 0), -1);
      d.prizes[uid()] = { name, qty, remaining: qty, order: max + 1 };
    });
  }
  function deletePrize(id) {
    return mutate(d => { if (!d.prizes || !d.prizes[id]) return ABORT; delete d.prizes[id]; });
  }
  function undoLast() {
    return mutate(d => {
      const keys = Object.keys(d.log || {}).sort();
      if (!keys.length) return ABORT;
      const k = keys[keys.length - 1]; const last = d.log[k];
      delete d.log[k];
      const p = d.prizes && d.prizes[last.prizeId];
      if (p) p.remaining = Math.min(+p.qty || 0, (+p.remaining || 0) + 1);
      d.seq = Math.max(0, (+d.seq || 0) - 1);
      return last;
    });
  }
  function resetDraw() {
    return mutate(d => { Object.values(d.prizes || {}).forEach(p => { p.remaining = +p.qty || 0; }); delete d.log; d.seq = 0; });
  }
  function wipe() {
    return mutate(d => { delete d.prizes; delete d.log; d.seq = 0; });
  }
  function setTitle(t) {
    return mutate(d => { d.settings = d.settings || {}; d.settings.title = t; });
  }

  window.GachaStore = {
    EVENT, LOCAL, init, view,
    isConnected: () => connected,
    subscribe: f => { subs.push(f); if (ready) f(view()); },
    onConnection: f => { connSubs.push(f); f(connected); },
    draw, importPrizes, updatePrize, addPrize, deletePrize, undoLast, resetDraw, wipe, setTitle
  };
})();
