(function () {
  'use strict';

  const cfg = window.BOOKCLUB_CONFIG || {};
  const SHARED = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const SUPABASE_SCRIPT = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js';

  // ---------- Small helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
  // Scores are shown with one decimal and a decimal comma, e.g. 4,2
  const fmt = (n) => (n == null || isNaN(n) ? '–' : Number(n).toFixed(1).replace('.', ','));
  const round1 = (n) => Math.round(Number(n) * 10) / 10;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // A stable colour (0–359) per title or name, for covers and avatars
  const hue = (s) => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const avatarHtml = (name) => `<span class="avatar" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  const fmtDate = (d) => {
    if (!d) return '';
    const date = new Date(d.length === 10 ? d + 'T00:00:00' : d);
    return isNaN(date) ? d : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtMonth = (d) => {
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    return isNaN(date) ? d : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  // Turn HTML descriptions (Apple/Google) into plain text
  const plainText = (html) => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n'), 'text/html');
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  };

  function readLocal(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2500);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- Data storage ----------
  // Both stores have the same functions, so the rest of the app
  // doesn't care whether data lives in this browser or in Supabase.

  function localStore() {
    const KEY = 'bookclub-data-v1';
    const load = () => readLocal(KEY, { books: [], ratings: [] });
    const save = (d) => { if (!writeLocal(KEY, d)) throw new Error('Could not save on this device — storage may be full.'); };
    return {
      async listBooks() {
        const d = load();
        return d.books.map((b) => ({ ...b, ratings: d.ratings.filter((r) => r.book_id === b.id) }));
      },
      async addBook(book) {
        const d = load();
        const row = { ...book, id: uid(), created_at: new Date().toISOString() };
        d.books.push(row); save(d); return row;
      },
      async updateBook(id, patch) {
        const d = load();
        const b = d.books.find((x) => x.id === id);
        if (b) {
          if ('rating_open' in patch && patch.rating_open !== b.rating_open) {
            patch = { ...patch, rating_closed_at: patch.rating_open ? null : new Date().toISOString() };
          }
          Object.assign(b, patch);
        }
        save(d);
      },
      async deleteBook(id) {
        const d = load();
        d.books = d.books.filter((b) => b.id !== id);
        d.ratings = d.ratings.filter((r) => r.book_id !== id);
        save(d);
      },
      async saveRating(r) {
        const d = load();
        const i = d.ratings.findIndex((x) => x.book_id === r.book_id && x.member === r.member);
        if (i >= 0) d.ratings[i] = { ...d.ratings[i], ...r };
        else d.ratings.push({ ...r, id: uid(), created_at: new Date().toISOString() });
        save(d);
      },
      async deleteRating(id) {
        const d = load();
        d.ratings = d.ratings.filter((r) => r.id !== id);
        save(d);
      },
      async importRatings(rows) {
        const d = load();
        rows.forEach((r) => d.ratings.push({ ...r, id: uid(), created_at: new Date().toISOString() }));
        save(d);
      },
      async claimRatings() { return 0; },
      async isAdmin() { return true; }, // on one device, you are the admin
    };
  }

  function supabaseStore(sb) {
    const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    return {
      async listBooks() { return check(await sb.from('books').select('*, ratings(*)')); },
      async addBook(book) { return check(await sb.from('books').insert(book).select().single()); },
      async updateBook(id, patch) { check(await sb.from('books').update(patch).eq('id', id)); },
      async deleteBook(id) { check(await sb.from('books').delete().eq('id', id)); },
      async saveRating(r) { check(await sb.from('ratings').upsert(r, { onConflict: 'book_id,user_id' })); },
      async deleteRating(id) { check(await sb.from('ratings').delete().eq('id', id)); },
      async importRatings(rows) { check(await sb.from('ratings').insert(rows.map((r) => ({ ...r, user_id: null })))); },
      async claimRatings() {
        const { data, error } = await sb.rpc('claim_my_ratings');
        return error ? 0 : Number(data) || 0;
      },
      async isAdmin(userId) {
        const { data, error } = await sb.from('club_admins').select('user_id').eq('user_id', userId);
        return !error && data.length > 0;
      },
    };
  }

  // ---------- State ----------
  let store;
  let sb; // Supabase client (shared mode only)
  const state = {
    books: [],
    user: null,       // the signed-in Supabase user (shared mode only)
    isAdmin: false,
    member: SHARED ? '' : readLocal('bookclub-member', ''),
    view: 'books',    // 'books' | 'stats'
    filter: '',
    sort: readLocal('bookclub-sort', 'recent'),
    openBookId: null,
    editingId: null,
    edit: { cover: '' },
  };

  function scoresOf(book) {
    const rs = book.ratings || [];
    const language = avg(rs.map((r) => r.language));
    const content = avg(rs.map((r) => r.content));
    const overall = language == null ? null : (language + content) / 2;
    return { language, content, overall, count: rs.length };
  }

  // Rating round status: 'open' (members can score), 'closed' (final), 'waiting' (not started yet)
  function statusOf(b) {
    if (b.rating_open === false) return b.rating_closed_at ? 'closed' : 'waiting';
    return 'open';
  }

  async function refresh() {
    try {
      // Decimal scores can arrive from the database as text ("4.2"); make them numbers
      state.books = (await store.listBooks()).map((b) => ({
        ...b,
        ratings: (b.ratings || []).map((r) => ({ ...r, language: Number(r.language), content: Number(r.content) })),
      }));
      render();
      if (state.openBookId && $('#bookDialog').open) renderBook();
    } catch (e) {
      toast('Could not load books: ' + e.message, true);
    }
  }

  // One key per person: their account, or their name for imported scores without an account
  const memberKey = (r) => (SHARED && r.user_id ? r.user_id : 'name:' + String(r.member || '').trim().toLowerCase());

  // In shared mode a score belongs to a login; on one device it belongs to a name.
  function isMine(r) {
    return SHARED ? Boolean(state.user) && r.user_id === state.user.id : r.member === state.member;
  }
  // The person who added a book, or the admin, may delete it (the database enforces this too).
  function canDelete(b) {
    return !SHARED || state.isAdmin || (state.user && b.added_by_id === state.user.id);
  }

  // ---------- Views ----------
  function setView(view) {
    state.view = view === 'stats' ? 'stats' : 'books';
    $('#booksView').hidden = state.view !== 'books';
    $('#statsView').hidden = state.view !== 'stats';
    document.querySelectorAll('[data-view]').forEach((t) => {
      const on = t.dataset.view === state.view;
      t.classList.toggle('on', on);
      t.setAttribute('aria-current', on ? 'page' : 'false');
    });
    render();
    window.scrollTo({ top: 0 });
  }

  function render() {
    if (state.view === 'stats') renderStats();
    else renderBooks();
  }

  // ---------- Rendering: books page ----------
  function coverHtml(book, cls = '') {
    const style = `style="--h:${hue(book.title)}"`;
    const fallback = `<span class="cover-title">${esc(book.title || 'No cover')}</span>`;
    // If a cover link breaks, the image removes itself and the coloured title cover shows instead
    if (book.cover) return `<div class="cover ${cls}" ${style}>${fallback}<img src="${esc(book.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>`;
    return `<div class="cover ${cls}" ${style}>${fallback}</div>`;
  }

  function statusBadge(b) {
    const s = statusOf(b);
    if (s === 'open') return '<span class="badge open"><i></i>Rating open</span>';
    if (s === 'waiting') return '<span class="badge waiting">Not started</span>';
    return '';
  }

  function renderHero() {
    const name = cfg.clubName || 'Book Club';
    const rated = state.books.filter((b) => scoresOf(b).count);
    const scores = state.books.reduce((n, b) => n + (b.ratings || []).length, 0);
    $('#heroTitle').textContent = name;
    $('#heroMeta').textContent = state.books.length
      ? `${plural(state.books.length, 'book', 'books')} · ${plural(scores, 'score', 'scores')} · ${plural(rated.length, 'book rated', 'books rated')}`
      : '';
  }

  function renderOpenStrip() {
    const open = state.books.filter((b) => statusOf(b) === 'open')
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const wrap = $('#openSection');
    wrap.hidden = open.length === 0;
    if (!open.length) return;
    $('#openCount').textContent = open.length;
    $('#openList').innerHTML = open.map((b, i) => {
      const mine = (b.ratings || []).find(isMine);
      const n = (b.ratings || []).length;
      return `<button class="open-card${mine ? ' done' : ''}" type="button" data-id="${esc(b.id)}" style="--i:${i}">
        ${coverHtml(b, 'mini')}
        <span class="open-info">
          <strong>${esc(b.title)}</strong>
          <small>${esc(b.author || '')}</small>
          <small class="open-progress">${n ? plural(n, 'score', 'scores') + ' so far' : 'No scores yet'}</small>
        </span>
        <span class="open-cta">${mine ? '✓ Rated' : 'Rate now'}</span>
      </button>`;
    }).join('');
  }

  function sortBooks(list) {
    const by = state.sort;
    const nullsLast = (a, b) => (a == null) - (b == null) || (b ?? 0) - (a ?? 0);
    return list.slice().sort((a, b) => {
      if (by === 'title') return (a.title || '').localeCompare(b.title || '');
      if (by === 'read') return (b.read_on || '').localeCompare(a.read_on || '');
      if (by === 'overall' || by === 'language' || by === 'content') {
        return nullsLast(scoresOf(a)[by], scoresOf(b)[by]);
      }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }

  function renderBooks() {
    renderHero();
    renderOpenStrip();
    const q = state.filter.trim().toLowerCase();
    const list = sortBooks(state.books.filter((b) => !q || `${b.title} ${b.author || ''}`.toLowerCase().includes(q)));

    const grid = $('#grid');
    grid.innerHTML = list.map((b, i) => {
      const s = scoresOf(b);
      const scores = !s.count ? `<p class="unrated">Not scored yet</p>`
        : statusOf(b) === 'closed'
        ? `<div class="final-pill" title="Final score: average of everyone's Language and Content"><span class="star">★</span>${fmt(s.overall)}<small>Final score</small></div>`
        : `<div class="pills">
             <span class="pill" title="Language"><span class="lbl">Lang</span><span class="star">★</span>${fmt(s.language)}</span>
             <span class="pill" title="Content"><span class="lbl">Content</span><span class="star">★</span>${fmt(s.content)}</span>
           </div>`;
      return `<button class="card" type="button" data-id="${esc(b.id)}" style="--i:${Math.min(i, 12)}">
          <span class="cover-wrap">${coverHtml(b)}${statusBadge(b)}</span>
          <div class="card-body">
            <h3>${esc(b.title)}</h3>
            ${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}
            ${scores}
          </div>
        </button>`;
    }).join('');

    $('#shelfSection').hidden = state.books.length === 0;
    $('#empty').hidden = state.books.length > 0;
    if (q && !list.length) grid.innerHTML = '<p class="muted">No books in your list match that search.</p>';
  }

  // ---------- Rendering: statistics page ----------
  function renderStats() {
    const el = $('#statsBody');
    const rated = state.books.map((b) => ({ b, s: scoresOf(b) })).filter((x) => x.s.count);
    if (!rated.length) {
      el.innerHTML = `<div class="empty"><div class="empty-art" aria-hidden="true">📊</div>
        <p class="empty-title">No statistics yet</p>
        <p>Once the club has scored a book, the top lists show up here.</p></div>`;
      return;
    }
    const allRatings = state.books.flatMap((b) => b.ratings || []);
    const members = new Map();
    allRatings.forEach((r) => members.set(memberKey(r), r.member));
    const clubAvg = avg(rated.map((x) => x.s.overall));
    const by = (key) => rated.slice().sort((a, b) => b.s[key] - a.s[key] || b.s.count - a.s.count);

    const row = (x, i, key) => `
      <li><button type="button" class="rank-row" data-id="${esc(x.b.id)}" style="--i:${i}">
        <span class="rank r${i + 1}">${i + 1}</span>
        ${coverHtml(x.b, 'mini')}
        <span class="rank-info">
          <strong>${esc(x.b.title)}</strong>
          <small>${esc(x.b.author || '')}${statusOf(x.b) === 'open' ? ' · <em>still open</em>' : ''}</small>
          ${key === 'overall' ? `<span class="bars">
            <span class="bar"><span class="bar-lbl">Language</span><span class="track"><i style="--v:${x.s.language}"></i></span><b>${fmt(x.s.language)}</b></span>
            <span class="bar"><span class="bar-lbl">Content</span><span class="track"><i style="--v:${x.s.content}" class="alt"></i></span><b>${fmt(x.s.content)}</b></span>
          </span>` : ''}
        </span>
        <span class="rank-score">${fmt(x.s[key])}<small>${plural(x.s.count, 'score', 'scores')}</small></span>
      </button></li>`;

    // Most divided: biggest gap between the highest and lowest member score
    const divided = rated.filter((x) => x.s.count >= 2).map((x) => {
      const o = x.b.ratings.map((r) => (r.language + r.content) / 2);
      return { ...x, spread: Math.max(...o) - Math.min(...o) };
    }).filter((x) => x.spread > 0).sort((a, b) => b.spread - a.spread).slice(0, 3);

    const readers = [...members.entries()].map(([key, name]) => ({
      name, n: allRatings.filter((r) => memberKey(r) === key).length,
    })).sort((a, b) => b.n - a.n).slice(0, 5);
    const maxN = readers[0] ? readers[0].n : 1;

    el.innerHTML = `
      <div class="overview">
        <div class="stat"><div class="k">Books read</div><div class="v">${state.books.length}</div></div>
        <div class="stat"><div class="k">Scores given</div><div class="v">${allRatings.length}</div></div>
        <div class="stat"><div class="k">Members scoring</div><div class="v">${members.size}</div></div>
        <div class="stat accent"><div class="k">Club average</div><div class="v">${fmt(clubAvg)} <small>/ 5</small></div></div>
      </div>

      <section class="stats-card">
        <h2>🏆 Top rated books</h2>
        <p class="muted">Average of Language and Content from everyone's scores.</p>
        <ol class="rank-list">${by('overall').slice(0, 10).map((x, i) => row(x, i, 'overall')).join('')}</ol>
      </section>

      <div class="stats-grid">
        <section class="stats-card">
          <h2>✍️ Best language</h2>
          <ol class="rank-list compact">${by('language').slice(0, 3).map((x, i) => row(x, i, 'language')).join('')}</ol>
        </section>
        <section class="stats-card">
          <h2>💡 Best content</h2>
          <ol class="rank-list compact">${by('content').slice(0, 3).map((x, i) => row(x, i, 'content')).join('')}</ol>
        </section>
        ${divided.length ? `<section class="stats-card">
          <h2>⚡ Most divided opinions</h2>
          <p class="muted">Biggest gap between the highest and lowest score.</p>
          <ol class="rank-list compact">${divided.map((x, i) => `
            <li><button type="button" class="rank-row" data-id="${esc(x.b.id)}" style="--i:${i}">
              <span class="rank">${i + 1}</span>${coverHtml(x.b, 'mini')}
              <span class="rank-info"><strong>${esc(x.b.title)}</strong><small>${esc(x.b.author || '')}</small></span>
              <span class="rank-score">${fmt(x.spread)}<small>point gap</small></span>
            </button></li>`).join('')}</ol>
        </section>` : ''}
        <section class="stats-card">
          <h2>📚 Most active readers</h2>
          <ul class="reader-list">${readers.map((r) => `
            <li>${avatarHtml(r.name)}<span class="reader-name">${esc(r.name)}</span>
              <span class="track"><i style="--v:${(r.n / maxN) * 5}"></i></span><b>${r.n}</b></li>`).join('')}</ul>
        </section>
      </div>`;
  }

  // ---------- Rendering: book detail ----------
  // A score from 1,0 to 5,0 in steps of 0,1: drag the slider, or tap − / + to fine-tune.
  function pickerHtml(name, value) {
    const v = value ? round1(value) : null;
    return `<div class="score-input${v ? '' : ' unset'}" data-name="${name}" data-value="${v || 0}">
      <button type="button" class="step" data-step="-0.1" aria-label="Lower ${name} score">−</button>
      <div class="score-mid">
        <div class="score-top">
          <output class="score-val">${v ? fmt(v) : '–'}</output>
          <span class="stars" style="--v:${v || 0}" aria-hidden="true">★★★★★</span>
        </div>
        <input type="range" min="1" max="5" step="0.1" value="${v || 3}" style="--p:${((v || 3) - 1) / 4 * 100}%" aria-label="${name} score from 1 to 5">
      </div>
      <button type="button" class="step" data-step="0.1" aria-label="Raise ${name} score">+</button>
    </div>`;
  }

  function setScore(box, value) {
    const v = Math.min(5, Math.max(1, round1(value)));
    box.dataset.value = v;
    box.classList.remove('unset');
    $('.score-val', box).textContent = fmt(v);
    $('.stars', box).style.setProperty('--v', v);
    const range = $('input[type="range"]', box);
    range.value = v;
    range.style.setProperty('--p', `${(v - 1) / 4 * 100}%`);
  }

  function roundPanel(b, s, mine) {
    const status = statusOf(b);
    const adminBtn = !state.isAdmin ? '' : status === 'open'
      ? '<button class="btn small" type="button" data-action="close-rating">🔒 Close rating</button>'
      : `<button class="btn small" type="button" data-action="open-rating">${status === 'closed' ? '🔓 Reopen rating' : '▶ Start rating'}</button>`;

    if (status === 'open') {
      return `<form class="panel round open" id="rateForm">
        <div class="round-head">
          <span class="badge open"><i></i>Rating open</span>
          <span class="muted small">${s.count ? plural(s.count, 'member has', 'members have') + ' scored' : 'Be the first to score'}</span>
          ${adminBtn}
        </div>
        <h3 class="section-title">${mine ? 'Your score' : 'Give your score'}</h3>
        <div class="rate-row"><span class="label">Language<span class="hint">How well is it written?</span></span>${pickerHtml('language', mine?.language)}</div>
        <div class="rate-row"><span class="label">Content<span class="hint">Story, ideas and characters</span></span>${pickerHtml('content', mine?.content)}</div>
        <textarea id="rateComment" rows="2" maxlength="1000" placeholder="A few words about the book (optional)">${esc(mine?.comment || '')}</textarea>
        <div class="dialog-actions">
          ${mine ? `<button class="btn ghost danger small" type="button" data-action="delete-rating" data-id="${esc(mine.id)}">Remove my score</button>` : ''}
          <button class="btn primary" type="submit">${mine ? 'Update score' : 'Save score'}</button>
        </div>
      </form>`;
    }
    if (status === 'waiting') {
      return `<div class="panel round">
        <div class="round-head"><span class="badge waiting">Not started</span>${adminBtn}</div>
        <p class="muted">Rating hasn't started for this book yet. ${state.isAdmin ? 'Start it when the club is ready.' : 'The admin will open it when the club is ready.'}</p>
      </div>`;
    }
    return `<div class="panel round closed">
      <div class="round-head"><span class="badge closed">🔒 Rating closed</span>
        <span class="muted small">${b.rating_closed_at ? 'on ' + esc(fmtDate(b.rating_closed_at)) : ''}</span>${adminBtn}</div>
      <p class="muted">${s.count ? `Final score from ${plural(s.count, 'member', 'members')}.` : 'Nobody scored this book before rating closed.'}${mine ? ` You gave Language ${fmt(mine.language)} and Content ${fmt(mine.content)}.` : ''}</p>
    </div>`;
  }

  function renderBook() {
    const b = state.books.find((x) => x.id === state.openBookId);
    if (!b) { $('#bookDialog').close(); return; }
    const s = scoresOf(b);
    const mine = (b.ratings || []).find(isMine);
    const closed = statusOf(b) === 'closed';
    const memberOverall = (r) => (r.language + r.content) / 2;
    // Highest overall first; ties by name
    const rows = (b.ratings || []).slice().sort((x, y) => memberOverall(y) - memberOverall(x) || x.member.localeCompare(y.member));
    const comments = rows.filter((r) => r.comment);
    const tags = [b.year ? `Published ${b.year}` : '', b.read_on ? `Read ${fmtMonth(b.read_on)}` : '', b.added_by ? `Added by ${b.added_by}` : '']
      .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    const avgBox = (v, label, cls = '') => `<div class="avg-box ${cls}"><div class="big-num">${fmt(v)}</div><div class="label">${label}</div><div class="meter" style="--v:${v ?? 0}"><i></i></div></div>`;

    $('#bookBody').innerHTML = `
      <div class="detail-hero" style="--h:${hue(b.title)}">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="dialog-head">
          <span></span>
          <button class="icon-btn" type="button" data-close aria-label="Close">✕</button>
        </div>
        <div class="detail-top">
          ${coverHtml(b, 'big')}
          <div class="detail-info">
            <h2>${esc(b.title)}</h2>
            ${b.author ? `<p class="author">${esc(b.author)}</p>` : ''}
            ${tags ? `<div class="tags">${tags}</div>` : ''}
          </div>
        </div>
      </div>
      ${closed && s.count ? `
      <div class="final-card">
        <div class="final-main">
          <div class="label">Final score</div>
          <div class="final-num">${fmt(s.overall)}</div>
          <span class="stars" style="--v:${s.overall}" aria-hidden="true">★★★★★</span>
        </div>
        <div class="final-parts">
          <div><span>Language</span><b>${fmt(s.language)}</b></div>
          <div><span>Content</span><b>${fmt(s.content)}</b></div>
          <div><span>Members</span><b>${s.count}</b></div>
        </div>
      </div>` : `
      <div class="averages">
        ${avgBox(s.language, 'Language')}
        ${avgBox(s.content, 'Content')}
        ${avgBox(s.overall, 'Overall so far', 'main')}
      </div>`}

      ${roundPanel(b, s, mine)}

      <div class="panel">
        <h3 class="section-title">Who rated what (${s.count})</h3>
        ${s.count ? `
        <div class="score-table" role="table" aria-label="Scores per member">
          <div class="st-row st-head" role="row">
            <span role="columnheader">Member</span>
            <span role="columnheader"><span class="long">Language</span><span class="short">Lang</span></span>
            <span role="columnheader"><span class="long">Content</span><span class="short">Cont</span></span>
            <span role="columnheader"><span class="long">Overall</span><span class="short">Total</span></span>
          </div>
          ${rows.map((r) => `
          <div class="st-row${isMine(r) ? ' me' : ''}" role="row">
            <span class="st-member" role="cell">${avatarHtml(r.member)}<span>${esc(r.member)}${isMine(r) ? ' <em>(you)</em>' : ''}</span></span>
            <span role="cell">${fmt(r.language)}</span>
            <span role="cell">${fmt(r.content)}</span>
            <span role="cell" class="st-overall">${fmt(memberOverall(r))}</span>
          </div>`).join('')}
          <div class="st-row st-foot" role="row">
            <span role="cell">${closed ? 'Final score' : 'Average'}</span>
            <span role="cell">${fmt(s.language)}</span>
            <span role="cell">${fmt(s.content)}</span>
            <span role="cell" class="st-overall">${fmt(s.overall)}</span>
          </div>
        </div>
        <p class="muted small">Overall (total) = the average of Language and Content.</p>
        ${comments.length ? `<h4 class="comments-title">Comments</h4>
        <ul class="rating-list">${comments.map((r) => `
          <li>
            ${avatarHtml(r.member)}
            <div class="bubble">
              <div class="who">${esc(r.member)}${isMine(r) ? ' (you)' : ''}</div>
              <p>${esc(r.comment)}</p>
            </div>
          </li>`).join('')}</ul>` : ''}`
        : '<p class="muted">Nobody has scored this book yet.</p>'}
      </div>

      ${b.description ? `<details><summary>About the book</summary><p>${esc(b.description)}</p></details>` : ''}

      <div class="dialog-actions">
        ${canDelete(b) ? '<button class="btn ghost danger" type="button" data-action="delete-book">Delete book</button>' : ''}
        <button class="btn" type="button" data-action="edit-book">Edit book</button>
      </div>`;
  }

  function openBook(id) {
    state.openBookId = id;
    renderBook();
    const d = $('#bookDialog');
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }

  // ---------- Add / edit book ----------
  function setCover(src) {
    state.edit.cover = src || '';
    $('#coverPreview').innerHTML = src ? `<img src="${esc(src)}" alt="Book cover" referrerpolicy="no-referrer">` : 'No picture';
    $('#coverRemove').hidden = !src;
  }

  function openEdit(book) {
    state.editingId = book ? book.id : null;
    $('#editTitle').textContent = book ? 'Edit book' : 'Add a book';
    $('#searchSection').hidden = Boolean(book);
    $('#startRatingRow').hidden = Boolean(book);
    $('#fStartRating').checked = true;
    $('#searchResults').innerHTML = '';
    $('#searchInput').value = '';
    $('#fTitle').value = book?.title || '';
    $('#fAuthor').value = book?.author || '';
    $('#fYear').value = book?.year || '';
    $('#fReadOn').value = book?.read_on || '';
    $('#fDescription').value = book?.description || '';
    setCover(book?.cover || '');
    $('#editDialog').showModal();
    (book ? $('#fTitle') : $('#searchInput')).focus();
  }

  // Shrink a photo before saving so it loads fast and fits in the database.
  function resizeImage(file, maxW = 400, maxH = 600) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can read.')); };
      img.src = url;
    });
  }

  // ---------- Search the internet ----------
  // Apple Books (Danish store) finds Danish titles with covers; Open Library and
  // Google Books add international titles and original publishing years.
  let lastResults = [];

  // Apple's Danish store also sells English books, so guess the language from the text
  function looksDanish(text) {
    const words = String(text).toLowerCase().match(/[a-zæøå]+/g) || [];
    const da = new Set(['og', 'ikke', 'det', 'der', 'hun', 'han', 'som', 'med', 'til', 'på', 'af', 'er', 'en', 'et', 'hans', 'hendes', 'bliver', 'om']);
    const en = new Set(['the', 'and', 'of', 'to', 'is', 'in', 'her', 'his', 'with', 'a', 'that', 'she', 'he', 'for']);
    let d = 0, e = 0;
    words.forEach((w) => { if (da.has(w)) d++; else if (en.has(w)) e++; });
    return /[æøå]/i.test(text) ? d >= e : d > e;
  }

  const getJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  async function searchOnline(q) {
    const isbn = q.replace(/[-\s]/g, '');
    const isIsbn = /^(97[89])?\d{9}[\dXx]$/.test(isbn);
    const enc = encodeURIComponent(isIsbn ? isbn : q);
    const gKey = cfg.googleBooksApiKey ? `&key=${encodeURIComponent(cfg.googleBooksApiKey)}` : '';

    const [apple, ol, gb] = await Promise.allSettled([
      isIsbn ? Promise.resolve({ results: [] })
        : getJson(`https://itunes.apple.com/search?term=${enc}&media=ebook&country=dk&limit=15`),
      getJson(`https://openlibrary.org/search.json?${isIsbn ? 'isbn' : 'q'}=${enc}&limit=10&fields=key,title,author_name,first_publish_year,cover_i,language`),
      getJson(`https://www.googleapis.com/books/v1/volumes?q=${isIsbn ? 'isbn:' : ''}${enc}&maxResults=10&printType=books&country=DK${gKey}`),
    ]);

    const fromApple = apple.status === 'fulfilled' ? (apple.value.results || [])
      .filter((x) => !/\b(summary|study guide|analysis|resumé)\b/i.test(x.trackName || ''))
      .map((x) => {
        const description = plainText(x.description);
        return {
          title: x.trackName,
          author: x.artistName || '',
          year: null, // Apple gives the e-book's date, not the first edition; Open Library fills this in when it can
          cover: (x.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x900bb.'),
          description,
          danish: looksDanish(`${x.trackName} ${description}`),
          source: 'Apple Books',
        };
      }) : [];

    const fromOL = ol.status === 'fulfilled' ? (ol.value.docs || []).map((d) => ({
      title: d.title,
      author: (d.author_name || []).slice(0, 2).join(', '),
      year: d.first_publish_year || null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
      description: '',
      danish: (d.language || [])[0] === 'dan',
      source: 'Open Library',
    })) : [];

    const fromGB = gb.status === 'fulfilled' ? (gb.value.items || []).map((it) => {
      const v = it.volumeInfo || {};
      const thumb = (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || '';
      return {
        title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
        author: (v.authors || []).slice(0, 2).join(', '),
        year: v.publishedDate ? parseInt(v.publishedDate, 10) || null : null,
        cover: thumb ? thumb.replace(/^http:/, 'https:').replace('&edge=curl', '') + '&fife=w600' : '',
        description: plainText(v.description),
        danish: v.language === 'da',
        source: 'Google Books',
      };
    }) : [];

    if ([apple, ol, gb].every((x) => x.status === 'rejected')) {
      throw new Error('Search is not reachable right now. Check your internet connection.');
    }

    // Merge: same title + first author counts as one book; keep the best cover,
    // the earliest year and any description. Danish results first.
    const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9æøå]/g, '');
    const map = new Map();
    const order = [];
    const lists = [fromApple, fromGB, fromOL];
    const longest = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) {
      for (const list of lists) {
        const r = list[i];
        if (!r || !r.title) continue;
        const key = norm(r.title.split(':')[0]) + '|' + norm((r.author.split(',')[0] || '').split(' ').pop());
        const prev = map.get(key);
        if (!prev) { map.set(key, { ...r }); order.push(key); continue; }
        if (!prev.cover && r.cover) prev.cover = r.cover;
        if (!prev.description && r.description) prev.description = r.description;
        if (r.year && (!prev.year || r.year < prev.year)) prev.year = r.year;
        prev.danish = prev.danish || r.danish;
      }
    }
    const out = order.map((k) => map.get(k));
    // Books with a cover first, then Danish ones, keeping the search order otherwise
    return out.map((r, i) => ({ r, i }))
      .sort((a, b) => (!!b.r.cover - !!a.r.cover) || (b.r.danish - a.r.danish) || a.i - b.i)
      .map((x) => x.r).slice(0, 20);
  }

  function renderResults(results) {
    lastResults = results;
    $('#searchResults').innerHTML = results.length
      ? results.map((r, i) => `<button class="result" type="button" data-result="${i}" style="--i:${Math.min(i, 10)}">
          ${coverHtml(r)}
          <div><strong>${esc(r.title)}</strong><small>${esc([r.author, r.year].filter(Boolean).join(' · '))}</small></div>
          <span class="src">${r.danish ? '<span class="flag" title="Danish">🇩🇰</span>' : ''}${esc(r.source)}</span>
        </button>`).join('')
      : '<p class="muted">No books found. Try other words, or fill in the details below.</p>';
  }

  // ---------- Member name / account ----------
  function askName() {
    $('#nameInput').value = state.member;
    if (SHARED) {
      $('#nameTitle').textContent = 'Your account';
      $('#nameLead').textContent = 'Your name is shown next to the scores you give.';
      $('#accountEmail').innerHTML = state.user
        ? `Signed in as ${esc(state.user.email)}${state.isAdmin ? ' <span class="badge admin">Admin</span>' : ''}` : '';
      $('#accountEmail').hidden = !state.user;
      $('#signOutBtn').hidden = false;
    }
    $('#importOpenBtn').hidden = !state.isAdmin || !state.member;
    $('#nameDialog').showModal();
  }

  // ---------- Import old ratings (admin) ----------
  // Reads text like:
  //   Khaled Hosseini - Drageløberen:
  //   Jasp:
  //   Indhold: 4.3
  //   Skriveri: 4.8
  // "Indhold" = Content, "Skriveri"/"Sprog" = Language. Total lines are skipped (the app calculates them).
  function parseImport(text) {
    const books = [];
    let book = null;
    let member = null;
    const problems = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim().replace(/:\s*$/, '').trim();
      if (!line) continue;
      if (/^(samlet|total|i alt|gennemsnit|average|overall)\b/i.test(line)) continue;
      const score = line.match(/^(indhold|content|skriveri|sprog|language|skrivning)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*$/i);
      if (score) {
        if (!member) continue;
        const v = Number(score[2].replace(',', '.'));
        const key = /^(indhold|content)/i.test(score[1]) ? 'content' : 'language';
        if (v < 1 || v > 5) problems.push(`${member.member}: ${score[1]} ${score[2]} is not between 1 and 5`);
        else member[key] = round1(v);
        continue;
      }
      const head = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (head || !book) {
        book = head ? { author: head[1].trim(), title: head[2].trim(), ratings: [] } : { author: '', title: line, ratings: [] };
        books.push(book);
        member = null;
        continue;
      }
      member = { member: line, language: null, content: null };
      book.ratings.push(member);
    }
    books.forEach((b) => {
      b.ratings.filter((r) => r.language == null || r.content == null)
        .forEach((r) => problems.push(`${r.member} on "${b.title}" is missing ${r.language == null ? 'Skriveri/Language' : 'Indhold/Content'}`));
      b.ratings = b.ratings.filter((r) => r.language != null && r.content != null);
    });
    return { books: books.filter((b) => b.ratings.length), problems };
  }

  let importParsed = { books: [], problems: [] };

  function renderImportPreview() {
    importParsed = parseImport($('#importText').value);
    const { books, problems } = importParsed;
    $('#importBtn').disabled = !books.length;
    $('#importBtn').textContent = books.length ? `Import ${plural(books.length, 'book', 'books')}` : 'Import';
    $('#importPreview').innerHTML = (books.map((b) => {
      const lang = avg(b.ratings.map((r) => r.language));
      const cont = avg(b.ratings.map((r) => r.content));
      const existing = findBook(b.title);
      return `<div class="import-book">
        <div class="import-head"><strong>${esc(b.title)}</strong>${b.author ? `<span class="muted"> by ${esc(b.author)}</span>` : ''}
          ${existing ? '<span class="badge waiting">Already on the shelf: scores are added to it</span>' : ''}</div>
        <div class="score-table">
          <div class="st-row st-head"><span>Member</span><span>Lang</span><span>Cont</span><span>Total</span></div>
          ${b.ratings.map((r) => `<div class="st-row"><span class="st-member">${avatarHtml(r.member)}<span>${esc(r.member)}</span></span>
            <span>${fmt(r.language)}</span><span>${fmt(r.content)}</span><span class="st-overall">${fmt((r.language + r.content) / 2)}</span></div>`).join('')}
          <div class="st-row st-foot"><span>Final score</span><span>${fmt(lang)}</span><span>${fmt(cont)}</span><span class="st-overall">${fmt((lang + cont) / 2)}</span></div>
        </div>
      </div>`;
    }).join('')) + (problems.length ? `<div class="import-problems"><strong>Skipped:</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '');
  }

  const normTitle = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9æøå]/g, '');
  const findBook = (title) => state.books.find((x) => normTitle(x.title) === normTitle(title));

  async function runImport() {
    const btn = $('#importBtn');
    btn.disabled = true;
    let done = 0;
    try {
      for (const b of importParsed.books) {
        btn.textContent = `Importing ${done + 1} of ${importParsed.books.length}…`;
        let book = findBook(b.title);
        if (!book) {
          // Find a cover, description and year online; a title match is required
          let extra = {};
          try {
            const hits = await searchOnline(`${b.title} ${b.author}`.trim());
            const hit = hits.find((h) => h.cover && normTitle(h.title).startsWith(normTitle(b.title)))
              || hits.find((h) => normTitle(h.title).startsWith(normTitle(b.title)));
            if (hit) extra = { cover: hit.cover || null, description: hit.description || null, year: hit.year || null };
          } catch { /* no cover is fine */ }
          book = await store.addBook({
            title: b.title, author: b.author || null, ...extra, added_by: state.member || null,
            rating_open: false, rating_closed_at: new Date().toISOString(),
          });
        }
        const already = new Set((book.ratings || []).map((r) => String(r.member).trim().toLowerCase()));
        const rows = b.ratings.filter((r) => !already.has(r.member.trim().toLowerCase()))
          .map((r) => ({ book_id: book.id, member: r.member, language: r.language, content: r.content, comment: null }));
        if (rows.length) await store.importRatings(rows);
        done++;
      }
      $('#importDialog').close();
      toast(`Imported ${plural(done, 'book', 'books')}`);
      await refresh();
    } catch (err) {
      toast(`Import stopped after ${plural(done, 'book', 'books')}: ${err.message}`, true);
      await refresh();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  }

  function renderMember() {
    $('#memberBtn').innerHTML = state.member
      ? `${avatarHtml(state.member)}<span class="chip-name">${esc(state.member)}</span>`
      : '<span class="chip-name" style="padding-left:7px">Set name</span>';
  }

  // ---------- Sign in / create account (shared mode) ----------
  const appUrl = () => location.origin + location.pathname;
  let authMode = 'signin';
  let lastUserId = null;

  function displayName(user) {
    return (user.user_metadata && user.user_metadata.display_name) || (user.email || '').split('@')[0];
  }

  function friendlyAuthError(msg) {
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.';
    if (/already registered/i.test(msg)) return 'That email already has an account. Try signing in instead.';
    if (/password should be at least/i.test(msg)) return 'Your password needs at least 6 characters.';
    if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
    return msg;
  }

  function authMessage(text, isError) {
    const el = $('#authMsg');
    el.textContent = text || '';
    el.className = 'auth-msg' + (isError ? ' error' : '');
    el.hidden = !text;
  }

  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('#authView [data-only]').forEach((el) => {
      el.hidden = !el.dataset.only.split(' ').includes(mode);
    });
    document.querySelectorAll('#authTabs [data-auth-mode]').forEach((b) => {
      b.classList.toggle('on', b.dataset.authMode === mode);
      b.setAttribute('aria-selected', String(b.dataset.authMode === mode));
    });
    $('#authTabs').hidden = mode === 'forgot' || mode === 'reset';
    $('#authSubmit').textContent = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Save new password' }[mode];
    $('#authLead').textContent = {
      signin: 'Sign in to see what the club is reading.',
      signup: 'Join the club: make an account to add books and give scores.',
      forgot: "Enter your email and we'll send you a link to choose a new password.",
      reset: 'Choose a new password for your account.',
    }[mode];
    $('#authPassword').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    authMessage('');
  }

  function showAuth(mode) {
    document.body.classList.add('signed-out');
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    $('#authView').hidden = false;
    setAuthMode(mode || 'signin');
  }

  function hideAuth() {
    document.body.classList.remove('signed-out');
    $('#authView').hidden = true;
  }

  async function applySession(session) {
    state.user = session ? session.user : null;
    if (!state.user) {
      lastUserId = null;
      state.member = '';
      state.books = [];
      state.isAdmin = false;
      showAuth(authMode === 'signup' ? 'signup' : 'signin');
      return;
    }
    state.member = displayName(state.user);
    renderMember();
    hideAuth();
    if (state.user.id !== lastUserId) {
      lastUserId = state.user.id;
      state.isAdmin = await store.isAdmin(state.user.id);
      const linked = await store.claimRatings();
      if (linked) toast(`Welcome! ${plural(linked, 'earlier score was', 'earlier scores were')} linked to your account.`);
      refresh();
    }
  }

  async function submitAuth(e) {
    e.preventDefault();
    const name = $('#authName').value.trim();
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    if (authMode === 'signup' && !name) return authMessage('Please tell us your name.', true);
    if (authMode !== 'reset' && !/^\S+@\S+\.\S+$/.test(email)) return authMessage('Please enter a valid email address.', true);
    if (authMode !== 'forgot' && password.length < 6) return authMessage('Your password needs at least 6 characters.', true);

    const btn = $('#authSubmit');
    btn.disabled = true;
    try {
      if (authMode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (authMode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email, password, options: { data: { display_name: name }, emailRedirectTo: appUrl() },
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMode('signin');
          authMessage(`Almost done! We sent an email to ${email}. Click the link in it, then sign in here.`);
        }
      } else if (authMode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
        if (error) throw error;
        authMessage('If that email has an account, a reset link is on its way. Check your inbox.');
      } else if (authMode === 'reset') {
        const { data, error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        authMode = 'signin';
        toast('Password changed');
        applySession({ user: data.user });
      }
    } catch (err) {
      authMessage(friendlyAuthError(err.message || String(err)), true);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Events ----------
  function bindEvents() {
    $('#addBtn').addEventListener('click', () => openEdit(null));
    $('#memberBtn').addEventListener('click', askName);
    $('#filter').addEventListener('input', (e) => { state.filter = e.target.value; renderBooks(); });
    $('#sort').value = state.sort;
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; writeLocal('bookclub-sort', state.sort); renderBooks(); });

    // Views (Books / Statistics)
    document.querySelectorAll('[data-view]').forEach((t) => t.addEventListener('click', (e) => {
      e.preventDefault();
      history.replaceState(null, '', t.dataset.view === 'stats' ? '#stats' : location.pathname);
      setView(t.dataset.view);
    }));

    // Open a book from the shelf, the "open for rating" strip or the statistics
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.card[data-id], .open-card[data-id], .rank-row[data-id]');
      if (card) { openBook(card.dataset.id); return; }
      if (e.target.closest('[data-action="add"]')) openEdit(null);
      const closer = e.target.closest('[data-close]');
      if (closer) closer.closest('dialog').close();
    });
    // Close a dialog when tapping the dark area around it
    document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => {
      if (e.target === d && d.id !== 'nameDialog') d.close();
    }));

    // Name
    $('#nameDialog').addEventListener('cancel', (e) => { if (!state.member) e.preventDefault(); });
    $('#nameForm').addEventListener('submit', async () => {
      const name = $('#nameInput').value.trim();
      if (!name || name === state.member) return;
      if (SHARED) {
        const { error } = await sb.auth.updateUser({ data: { display_name: name } });
        if (error) { toast('Could not change your name: ' + error.message, true); return; }
      } else {
        writeLocal('bookclub-member', name);
      }
      state.member = name;
      renderMember();
      toast('Name saved');
      if ($('#bookDialog').open) renderBook();
    });
    $('#signOutBtn').addEventListener('click', async () => {
      $('#nameDialog').close();
      await sb.auth.signOut();
    });

    // Import old ratings (admin)
    $('#importOpenBtn').addEventListener('click', () => {
      $('#nameDialog').close();
      $('#importText').value = '';
      renderImportPreview();
      $('#importDialog').showModal();
    });
    $('#importText').addEventListener('input', renderImportPreview);
    $('#importBtn').addEventListener('click', runImport);

    // Sign in / create account
    $('#authForm').addEventListener('submit', submitAuth);
    document.querySelectorAll('#authView [data-auth-mode]').forEach((b) =>
      b.addEventListener('click', () => setAuthMode(b.dataset.authMode)));

    // Book detail: score sliders, save score, rating round, edit/delete
    const body = $('#bookBody');
    body.addEventListener('input', (e) => {
      const range = e.target.closest('.score-input input[type="range"]');
      if (range) setScore(range.closest('.score-input'), range.value);
    });
    body.addEventListener('click', async (e) => {
      const step = e.target.closest('.score-input .step');
      if (step) {
        const box = step.closest('.score-input');
        const current = Number(box.dataset.value) || 3;
        setScore(box, current + Number(step.dataset.step));
        return;
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      const book = state.books.find((x) => x.id === state.openBookId);
      if (!book || !action) return;
      if (action === 'edit-book') { $('#bookDialog').close(); openEdit(book); }
      if (action === 'close-rating' || action === 'open-rating') {
        const open = action === 'open-rating';
        if (!open && !confirm(`Close rating for "${book.title}"? Members can't change their scores after this.`)) return;
        try {
          await store.updateBook(book.id, { rating_open: open });
          toast(open ? 'Rating is open' : 'Rating closed. Final score is in!');
          await refresh();
        } catch (err) { toast('Could not change rating: ' + err.message, true); }
      }
      if (action === 'delete-book') {
        if (!confirm(`Delete "${book.title}" and all its scores? This cannot be undone.`)) return;
        try { await store.deleteBook(book.id); $('#bookDialog').close(); toast('Book deleted'); await refresh(); }
        catch (err) { toast('Could not delete: ' + err.message, true); }
      }
      if (action === 'delete-rating') {
        try { await store.deleteRating(e.target.closest('[data-id]').dataset.id); toast('Score removed'); await refresh(); }
        catch (err) { toast('Could not remove score: ' + err.message, true); }
      }
    });
    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.member) { askName(); return; }
      const language = round1($('.score-input[data-name="language"]', body).dataset.value);
      const content = round1($('.score-input[data-name="content"]', body).dataset.value);
      if (!language || !content) { toast('Set a score from 1,0 to 5,0 for both Language and Content', true); return; }
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const rating = { book_id: state.openBookId, member: state.member, language, content, comment: $('#rateComment').value.trim() || null };
        if (SHARED) rating.user_id = state.user.id;
        await store.saveRating(rating);
        toast('Score saved');
        await refresh();
      } catch (err) {
        toast('Could not save score: ' + (/row-level security/i.test(err.message) ? 'rating for this book is closed.' : err.message), true);
        btn.disabled = false;
      }
    });

    // Search online
    $('#searchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#searchInput').value.trim();
      if (!q) return;
      $('#searchResults').innerHTML = '<p class="loading"><span class="spinner"></span>Searching the internet…</p>';
      try { renderResults(await searchOnline(q)); }
      catch (err) { $('#searchResults').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    });
    $('#searchResults').addEventListener('click', (e) => {
      const el = e.target.closest('[data-result]');
      if (!el) return;
      const r = lastResults[Number(el.dataset.result)];
      $('#fTitle').value = r.title || '';
      $('#fAuthor').value = r.author || '';
      $('#fYear').value = r.year || '';
      $('#fDescription').value = r.description || '';
      setCover(r.cover);
      $('#searchResults').innerHTML = `<p class="muted">✓ Filled in from ${esc(r.source)}. Check the details, add when you read it, then save.</p>`;
      $('#fReadOn').focus();
    });

    // Cover photo
    $('#coverFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try { setCover(await resizeImage(file)); }
      catch (err) { toast(err.message, true); }
    });
    $('#coverRemove').addEventListener('click', () => setCover(''));

    // Save book
    $('#editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = $('#fTitle').value.trim();
      if (!title) return;
      const yearNum = parseInt($('#fYear').value, 10);
      const data = {
        title,
        author: $('#fAuthor').value.trim() || null,
        year: Number.isFinite(yearNum) ? yearNum : null,
        read_on: $('#fReadOn').value || null,
        description: $('#fDescription').value.trim() || null,
        cover: state.edit.cover || null,
      };
      const btn = $('#saveBook');
      btn.disabled = true;
      try {
        if (state.editingId) {
          await store.updateBook(state.editingId, data);
          toast('Book updated');
          $('#editDialog').close();
          await refresh();
          openBook(state.editingId);
        } else {
          const startNow = $('#fStartRating').checked;
          const row = await store.addBook({ ...data, added_by: state.member || null, ...(startNow ? {} : { rating_open: false }) });
          toast(startNow ? 'Book added. Rating is open!' : 'Book added');
          $('#editDialog').close();
          await refresh();
          openBook(row.id);
        }
      } catch (err) {
        toast('Could not save book: ' + err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    // Pick up other members' changes when coming back to the app
    if (SHARED) {
      document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refresh(); });
    }
  }

  // ---------- Start ----------
  async function init() {
    const name = cfg.clubName || 'Book Club';
    $('#clubName').textContent = name;
    $('#authClub').textContent = name;
    document.title = name;
    renderMember();
    bindEvents();
    setView(location.hash === '#stats' ? 'stats' : 'books');

    if (SHARED) {
      try {
        if (!window.supabase) await loadScript(SUPABASE_SCRIPT);
        sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        store = supabaseStore(sb);
      } catch (e) {
        toast('Could not connect to the shared database. Check your internet connection.', true);
        return;
      }
      // Fires once at start (with any saved login) and on every sign in / sign out.
      sb.auth.onAuthStateChange((event, session) => {
        setTimeout(() => {
          if (event === 'PASSWORD_RECOVERY') { showAuth('reset'); return; }
          if (authMode === 'reset' && !$('#authView').hidden) return; // finish choosing a new password first
          applySession(session);
        }, 0);
      });
      return;
    }

    store = localStore();
    state.isAdmin = true;
    const n = $('#modeNotice');
    n.textContent = 'Books are saved on this device only. Connect the free Supabase database (see README) so club members can create a login and share one list.';
    n.hidden = false;
    await refresh();
    if (!state.member) askName();
  }

  init();
})();
