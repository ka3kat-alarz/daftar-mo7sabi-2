 // دفتر المحاسبة 2 — Firebase + حفظ محلي + رجوع ما بيطلّع من البرنامج
// إذا Firebase مش معبّى (PASTE_HERE) أو ما في انترنت، بيحفظ على التلفون بـ localStorage وبيفتح فوراً، ما بيضل يحمّل
(function(){
  const BOOK = new URLSearchParams(location.search).get('b') || 'ruwais-2026';
  const STORAGE_KEY = 'daftar_local_' + BOOK;
  function isFirebaseValid(){
    const c = window.FIREBASE_CONFIG;
    return c && c.apiKey && c.apiKey !== 'PASTE_HERE' && c.projectId && c.projectId !== 'PASTE_HERE' && c.apiKey.length > 10;
  }
  function loadStore(){
    try{ const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); if(!s.collections) s.collections={}; return s; }catch(e){ return {collections:{}}; }
  }
  function saveStore(s){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }catch(e){} }
  function makeLocalDB(){
    let store = loadStore();
    let listeners = [];
    function getColl(name){ if(!store.collections[name]) store.collections[name]={}; return store.collections[name]; }
    function makeSnapshot(collName, field, dir){
      const coll = getColl(collName);
      let docs = Object.keys(coll).map(id => ({ id: id, data: function(){ return JSON.parse(JSON.stringify(coll[id])); }, exists: true }));
      if(field){
        docs.sort((a,b)=>{
          const av = a.data()[field] || 0, bv = b.data()[field] || 0;
          if(av < bv) return dir === 'desc' ? 1 : -1;
          if(av > bv) return dir === 'desc' ? -1 : 1;
          return 0;
        });
      }
      return { docs: docs, forEach: function(fn){ docs.forEach(fn); }, empty: docs.length===0, size: docs.length };
    }
    function notify(collName){
      saveStore(store);
      listeners.filter(l=>l.coll===collName).forEach(l=>{
        try{ l.cb(makeSnapshot(collName, l.field, l.dir)); }catch(e){}
      });
    }
    function parsePath(p){
      const parts = String(p).split('/');
      return { coll: parts[0], id: parts.slice(1).join('/') };
    }
    function docRef(path){
      const {coll, id} = parsePath(path);
      return {
        id: id,
        path: path,
        get: async function(){
          const c = getColl(coll);
          const exists = !!(c && c[id] !== undefined);
          const val = exists ? JSON.parse(JSON.stringify(c[id])) : null;
          return { exists: exists, id: id, data: function(){ return val; } };
        },
        set: async function(data){
          const c = getColl(coll); c[id] = JSON.parse(JSON.stringify(data||{})); notify(coll); return;
        },
        update: async function(partial){
          const c = getColl(coll); const cur = c[id] || {}; c[id] = Object.assign({}, cur, partial); notify(coll); return;
        },
        delete: async function(){
          const c = getColl(coll); delete c[id]; notify(coll); return;
        },
        onSnapshot: function(cb){
          const wrapper = function(snap){
            const found = snap.docs.find(d=>d.id===id);
            cb({ exists: !!found, id: id, data: function(){ return found ? found.data() : null; } });
          };
          listeners.push({coll: coll, field: null, dir: null, cb: wrapper, isDoc: true, docId: id});
          const c = getColl(coll);
          const exists = !!(c && c[id] !== undefined);
          const val = exists ? JSON.parse(JSON.stringify(c[id])) : null;
          setTimeout(()=>cb({ exists: exists, id: id, data: function(){ return val; } }), 0);
          return function(){ listeners = listeners.filter(l=>l.cb!==wrapper); };
        }
      };
    }
    function collRef(name){
      return {
        _name: name,
        doc: function(id){ return docRef(name + '/' + id); },
        add: async function(data){
          const c = getColl(name);
          const id = 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
          c[id] = JSON.parse(JSON.stringify(data||{})); notify(name); return { id: id };
        },
        get: async function(){ return makeSnapshot(name, null, null); },
        onSnapshot: function(cb){
          listeners.push({coll: name, field: null, dir: null, cb: cb});
          setTimeout(()=>{ try{ cb(makeSnapshot(name, null, null)); }catch(e){} }, 0);
          return function(){ listeners = listeners.filter(l=>l.cb!==cb); };
        },
        orderBy: function(field, dir){
          return {
            get: async function(){ return makeSnapshot(name, field, dir); },
            onSnapshot: function(cb){
              listeners.push({coll: name, field: field, dir: dir, cb: cb});
              setTimeout(()=>{ try{ cb(makeSnapshot(name, field, dir)); }catch(e){} }, 0);
              return function(){ listeners = listeners.filter(l=>l.cb!==cb); };
            }
          };
        },
        where: function(){ return collRef(name); }
      };
    }
    return { collection: collRef, doc: docRef };
  }
  let fs = null;
  function makeFirebaseDB(){
    if(!fs){
      firebase.initializeApp(window.FIREBASE_CONFIG);
      fs = firebase.firestore();
      try{ fs.enablePersistence({synchronizeTabs:true}).catch(()=>{}); }catch(e){}
    }
    function root(){ return fs.collection('books').doc(BOOK); }
    return {
      collection: function(n){ return root().collection(n); },
      doc: function(p){ const a=p.split('/'); return root().collection(a[0]).doc(a.slice(1).join('/')); }
    };
  }
  const dl = {
    async save({filename, data}){
      const blob = data instanceof Blob ? data : new Blob([data]);
      const C = window.Capacitor;
      if(C && C.isNativePlatform && C.isNativePlatform() && C.Plugins.Filesystem && C.Plugins.Share){
        const b64 = await new Promise(r=>{ const f=new FileReader(); f.onload=()=>r(String(f.result).split(',')[1]); f.readAsDataURL(blob); });
        const w = await C.Plugins.Filesystem.writeFile({path: filename, data: b64, directory: 'CACHE'});
        await C.Plugins.Share.share({title: filename, url: w.uri});
      } else {
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); a.remove();
      }
    }
  };
  let cachedDB = null;
  window.claude = { use: async function(n){
    if(n==='downloads') return dl;
    if(n==='db'){
      if(cachedDB) return cachedDB;
      if(isFirebaseValid()){
        try{
          cachedDB = makeFirebaseDB();
          window.__DAFTAR_MODE__ = 'firebase';
          return cachedDB;
        }catch(e){
          console.log('Firebase failed, using local', e);
        }
      }
      cachedDB = makeLocalDB();
      window.__DAFTAR_MODE__ = 'local';
      return cachedDB;
    }
    return null;
  }};

  // ---------- زر الرجوع: قوي - ما بيطلّع من البرنامج ----------
  // المشكلة قبل: Capacitor ما كان جاهز وقت تسجيل المستمع، فكان الرجوع يطلّعك
  // الحل الجديد: 1) حيلة التاريخ (history) + 2) إعادة المحاولة كل شوي + 3) popstate
  let lastBackPress = 0;
  let backListenerAdded = false;
  function showBackToast(msg){
    let t = document.getElementById('backToast');
    if(!t){
      t = document.createElement('div');
      t.id = 'backToast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#071a31;color:#fff;padding:10px 18px;border-radius:20px;font-size:14px;font-family:Tahoma;z-index:99999;box-shadow:0 8px 20px rgba(0,0,0,.3);white-space:nowrap';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(()=>{ t.style.display='none'; }, 2000);
  }
  function isLedgerPage(){
    return location.pathname.indexOf('ledger.html') !== -1 || location.href.indexOf('ledger.html') !== -1;
  }
  function handleBack(){
    const ask = document.getElementById('askModal');
    if(ask && getComputedStyle(ask).display !== 'none' && ask.offsetParent !== null){
      const btns = ask.querySelectorAll('button');
      for(const b of btns){ if(/لأ|إلغاء|Cancel/.test(b.textContent)){ b.click(); return; } }
      ask.style.display='none';
      return;
    }
    if(isLedgerPage()){
      // كنت بالحساب -> ارجع على الرئيسية، ما تطلع
      window.location.href = 'index.html';
      return;
    }
    // كنت بالرئيسية -> لازم مرتين لتطلع
    const now = Date.now();
    if(now - lastBackPress < 2000){
      const C = window.Capacitor;
      if(C && C.Plugins && C.Plugins.App && C.Plugins.App.exitApp){
        C.Plugins.App.exitApp();
      } else {
        showBackToast('كبست مرتين - هيدي آخر صفحة');
      }
      return;
    }
    lastBackPress = now;
    showBackToast('كبس رجوع مرة تانية لتطلع من البرنامج');
    // أعد حجز مكان بالتاريخ كرمال الرجوع الجاي ما يطلّعك
    try{ history.pushState({page:'home-guard'}, '', location.href); }catch(e){}
  }
  function tryAddCapacitorListener(){
    const C = window.Capacitor;
    if(C && C.Plugins && C.Plugins.App && C.Plugins.App.addListener && !backListenerAdded){
      try{
        C.Plugins.App.addListener('backButton', function(){
          handleBack();
        });
        backListenerAdded = true;
        // console.log('backButton listener added');
      }catch(e){}
    }
  }
  function setupBack(){
    // 1) حيلة التاريخ: حطّ حاجز، فالرجوع بيروح على الحاجز مش بيطلّعك
    try{
      // إذا كنت بالحساب، حطّ حاجز واحد. إذا بالرئيسية، حطّ حاجز واحد كمان
      history.pushState({page:'guard'}, '', location.href);
    }catch(e){}
    // 2) لما يضغط رجوع ويصير popstate (بالمتصفح أو بالـ WebView)
    window.addEventListener('popstate', function(e){
      // إذا كان في حاجز، لا تطلع، نفّذ منطقنا
      if(isLedgerPage()){
        // رجعنا من الحاجز، روح على الرئيسية
        window.location.href = 'index.html';
      } else {
        // بالرئيسية: رجّع الحاجز كرمال ما يطلع، وطبّق منطق المرتين
        try{ history.pushState({page:'guard'}, '', location.href); }catch(err){}
        handleBack();
        // handleBack عمل pushState تاني، صار في حاجزين - لا مشكلة، منشيل واحد زيادة إذا لزم
        // بس كرمال ما يتجمعو، إذا ضغط مرتين بسرعة، التانية بتطلّعو
      }
    });
    // 3) Capacitor: جرّب هلق، وارجع جرّب كل 500ms لحد ما يجهز
    tryAddCapacitorListener();
    let tries = 0;
    const iv = setInterval(()=>{
      tryAddCapacitorListener();
      tries++;
      if(backListenerAdded || tries > 20) clearInterval(iv);
    }, 500);
    // 4) كمان جرّب وقت load
    window.addEventListener('load', tryAddCapacitorListener);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', setupBack);
  } else {
    setupBack();
  }
})();
