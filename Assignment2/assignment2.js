<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Stock Broker Client Dashboard</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui, -apple-system,Segoe UI,Roboto,Helvetica,Arial;}
    body{margin:0;background:#0f172a;color:#e6eef8;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{background:linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01));padding:20px;border-radius:12px;box-shadow:0 6px 24px rgba(2,6,23,0.6);width:960px;max-width:95%}
    h1{margin:0 0 12px 0;font-size:20px}
    .row{display:flex;gap:12px}
    .col{flex:1}
    label{display:block;font-size:13px;color:#9fb0d9;margin-bottom:6px}
    input[type=email],button,select{padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:inherit}
    button{cursor:pointer}
    .stocks-list{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
    .stock{padding:10px;border-radius:8px;background:rgba(255,255,255,0.02);display:flex;justify-content:space-between;align-items:center}
    .subscribed{margin-top:12px}
    table{width:100%;border-collapse:collapse}
    th,td{text-align:left;padding:8px;border-bottom:1px dashed rgba(255,255,255,0.03)}
    .muted{color:#9fb0d9;font-size:13px}
    .small{font-size:12px}
    .tag{background:rgba(0,0,0,0.35);padding:6px;border-radius:6px}
    .controls{display:flex;gap:8px;align-items:center}
    .hint{font-size:12px;color:#9fb0d9;margin-top:8px}
  </style>
</head>
<body>
  <div class="card" id="app">
    <h1>Stock Broker Client Dashboard</h1>
    <div id="loginScreen">
      <label for="email">Login with your email</label>
      <div class="row">
        <input type="email" id="email" placeholder="you@example.com" />
        <button id="loginBtn">Login</button>
      </div>
      <p class="hint">Open multiple tabs and login as different emails to simulate multiple users. Subscriptions are per-email.</p>
    </div>

    <div id="dashboard" style="display:none">
      <div class="row">
        <div class="col">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="muted">Logged in as</div>
              <div id="userEmail" style="font-weight:600"></div>
            </div>
            <div class="controls">
              <div class="tag" id="leaderTag">Leader: ?</div>
              <button id="logoutBtn">Logout</button>
            </div>
          </div>

          <h3 style="margin-top:16px">Supported Stocks</h3>
          <div class="stocks-list" id="supportedStocks"></div>

          <div class="subscribed">
            <h3>Your Subscriptions</h3>
            <div id="subsContainer"></div>
          </div>
        </div>
        <div class="col" style="min-width:260px">
          <h3>Market Prices (live)</h3>
          <div id="pricesContainer"></div>

          <h3 style="margin-top:16px">App Info</h3>
          <div class="muted small">
            <p>Price updates are generated randomly every second. Subscriptions are stored per email in localStorage. The app uses <strong>BroadcastChannel</strong> and a simple leader election to generate one stream of price updates shared across tabs.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // --- CONFIG ---
    const SUPPORTED = ['GOOG','TSLA','AMZN','META','NVDA'];
    const PRICE_UPDATE_INTERVAL = 1000; // ms
    const LEADER_HEARTBEAT = 1500; // ms (leader heartbeat fresh threshold)

    // --- UTIL ---
    const uid = () => Math.random().toString(36).slice(2,9);
    const format = v => (typeof v === 'number' ? '₹' + v.toLocaleString('en-IN',{maximumFractionDigits:0}) : v);

    // --- State ---
    let user = null;
    let prices = {}; // current market prices

    // initialize prices randomly
    SUPPORTED.forEach(t => prices[t] = 1000 + Math.round(Math.random()*2000));

    // --- Channels ---
    const priceChannel = new BroadcastChannel('stock-prices-v1');
    const controlChannel = new BroadcastChannel('stock-control-v1');

    // leader election
    const TAB_ID = uid();
    const LEADER_KEY = 'stock_leader_v1';

    function getLeader(){
      try{ return JSON.parse(localStorage.getItem(LEADER_KEY)); }catch(e){return null}
    }
    function setLeader(obj){ localStorage.setItem(LEADER_KEY, JSON.stringify(obj)); }
    function clearLeader(){ localStorage.removeItem(LEADER_KEY); }

    let amLeader = false;
    let leaderHeartbeatTimer = null;
    let priceGeneratorTimer = null;

    function tryBecomeLeader(){
      const cur = getLeader();
      const now = Date.now();
      if(!cur || (now - cur.heartbeat) > LEADER_HEARTBEAT*2){
        // become leader
        setLeader({id:TAB_ID, heartbeat: now});
        amLeader = true;
        leaderTagUpdate();
        startGeneratingPrices();
      } else {
        amLeader = (cur.id === TAB_ID);
        leaderTagUpdate();
      }
    }

    function startLeaderHeartbeat(){
      if(leaderHeartbeatTimer) clearInterval(leaderHeartbeatTimer);
      leaderHeartbeatTimer = setInterval(()=>{
        const cur = getLeader();
        const now = Date.now();
        if(cur && cur.id === TAB_ID){
          setLeader({id:TAB_ID, heartbeat: now});
        } else {
          // if no leader or leader stale -> try to become leader
          tryBecomeLeader();
        }
      }, LEADER_HEARTBEAT);
    }

    function leaderTagUpdate(){
      const leader = getLeader();
      const el = document.getElementById('leaderTag');
      el.textContent = 'Leader: ' + (leader ? (leader.id===TAB_ID ? 'This tab' : leader.id.slice(0,6)) : '—');
    }

    // Price generator (only leader runs actual generation)
    function startGeneratingPrices(){
      stopGeneratingPrices();
      priceGeneratorTimer = setInterval(()=>{
        // random walk small changes
        SUPPORTED.forEach(t=>{
          const change = Math.round((Math.random()*2-1)*50); // -50..+50
          prices[t] = Math.max(50, prices[t] + change);
        });
        // broadcast new prices
        priceChannel.postMessage({type:'prices', prices, ts:Date.now()});
      }, PRICE_UPDATE_INTERVAL);
    }
    function stopGeneratingPrices(){ if(priceGeneratorTimer) { clearInterval(priceGeneratorTimer); priceGeneratorTimer = null; } }

    // Listen to price broadcasts
    priceChannel.onmessage = (ev)=>{
      if(ev.data && ev.data.type==='prices'){
        prices = ev.data.prices;
        renderPrices();
        renderSubscriptions();
      }
    }

    // Also listen to storage changes (in case leader changes)
    window.addEventListener('storage', (e)=>{
      if(e.key === LEADER_KEY){ leaderTagUpdate(); }
    });

    // Control channel for manual actions (not used heavily but here for future)
    controlChannel.onmessage = (ev)=>{
      // placeholder
    }

    // --- UI Rendering ---
    function el(q, p=document){ return p.querySelector(q); }

    function renderSupported(){
      const container = el('#supportedStocks');
      container.innerHTML='';
      SUPPORTED.forEach(t=>{
        const div = document.createElement('div');
        div.className='stock';
        const left = document.createElement('div');
        left.innerHTML = `<strong>${t}</strong><div class="muted small">Price: <span id="p-${t}">${format(prices[t])}</span></div>`;
        const btn = document.createElement('button');
        btn.textContent = isSubscribed(t) ? 'Unsubscribe' : 'Subscribe';
        btn.onclick = ()=>{ toggleSubscription(t); btn.textContent = isSubscribed(t) ? 'Unsubscribe' : 'Subscribe'; };
        div.appendChild(left);
        div.appendChild(btn);
        container.appendChild(div);
      });
    }

    function renderPrices(){
      const c = el('#pricesContainer');
      c.innerHTML = '';
      SUPPORTED.forEach(t=>{
        const d = document.createElement('div');
        d.className='stock';
        d.style.marginBottom='6px';
        d.innerHTML = `<div><strong>${t}</strong><div class="muted small">${new Date().toLocaleTimeString()}</div></div><div>${format(prices[t])}</div>`;
        c.appendChild(d);
      });
    }

    function getSubscriptionsFor(email){
      try{
        const key = 'subs_' + email;
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      }catch(e){return []}
    }
    function saveSubscriptionsFor(email, arr){
      localStorage.setItem('subs_'+email, JSON.stringify(arr));
    }
    function isSubscribed(t){ if(!user) return false; return getSubscriptionsFor(user).includes(t); }
    function toggleSubscription(t){ if(!user) return; const s = new Set(getSubscriptionsFor(user)); if(s.has(t)) s.delete(t); else s.add(t); saveSubscriptionsFor(user, Array.from(s)); renderSubscriptions(); renderSupported(); }

    function renderSubscriptions(){
      const container = el('#subsContainer');
      container.innerHTML='';
      if(!user) return;
      const subs = getSubscriptionsFor(user);
      if(subs.length===0){ container.innerHTML = '<div class="muted small">No subscriptions yet</div>'; return; }
      const table = document.createElement('table');
      const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>Stock</th><th>Price</th><th>Detail</th></tr>';
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      subs.forEach(t=>{
        const tr = document.createElement('tr');
        const priceCell = format(prices[t]);
        tr.innerHTML = `<td><strong>${t}</strong></td><td>${priceCell}</td><td><button data-t="${t}">Unsubscribe</button></td>`;
        tr.querySelector('button').onclick = ()=>{ toggleSubscription(t); };
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    }

    // --- Auth UI ---
    function showLogin(){ el('#loginScreen').style.display='block'; el('#dashboard').style.display='none'; }
    function showDashboard(){ el('#loginScreen').style.display='none'; el('#dashboard').style.display='block'; }

    function login(email){ user = email.toLowerCase(); sessionStorage.setItem('user', user); el('#userEmail').textContent = user; renderSupported(); renderPrices(); renderSubscriptions(); showDashboard(); }

    function logout(){ sessionStorage.removeItem('user'); user=null; showLogin(); }

    // --- Init handlers ---
    document.getElementById('loginBtn').addEventListener('click', ()=>{
      const v = document.getElementById('email').value.trim();
      if(!v || !v.includes('@')) return alert('Please enter a valid email');
      login(v);
    });
    document.getElementById('logoutBtn').addEventListener('click', ()=>{ logout(); });

    // restore session
    (function init(){
      // start leader heartbeat and attempt to elect
      tryBecomeLeader();
      startLeaderHeartbeat();

      // if this tab becomes leader, start generator
      setTimeout(()=>{
        const cur = getLeader();
        amLeader = cur && cur.id===TAB_ID;
        if(amLeader) startGeneratingPrices();
      }, 200);

      // render UI
      const sess = sessionStorage.getItem('user');
      if(sess){ login(sess); }
      renderSupported(); renderPrices();

      // when tab unloads, if leader, clear leader marker (so others can take over fast)
      window.addEventListener('beforeunload', ()=>{
        const cur = getLeader();
        if(cur && cur.id===TAB_ID) clearLeader();
      });

      // fallback: if no one broadcasts prices for a while, assume leader failed and try to become leader
      let lastPriceTs = Date.now();
      priceChannel.onmessage = (ev)=>{ if(ev.data && ev.data.type==='prices'){ prices=ev.data.prices; lastPriceTs = ev.data.ts; renderPrices(); renderSubscriptions(); } };
      setInterval(()=>{
        if(Date.now() - lastPriceTs > LEADER_HEARTBEAT*3){ tryBecomeLeader(); }
      }, 1000);

    })();
  </script>
</body>
</html>
