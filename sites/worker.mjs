import { assets, seeds } from './assets.mjs';

const categories = ['용기', '성장', '위로', '확언'];
const encoder = new TextEncoder();
const sessionAge = 30 * 86400;
const quoteFields = ({id,text,author,category}) => ({id,text,author,category});
const hex = (bytes) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const hash = async (text) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
const kst = () => new Date(Date.now() + 32400000).toISOString().slice(0,10);
const publicUser = (user) => user ? {name:user.name,admin:!!user.admin} : null;
const cookie = (token, age) => ({'Set-Cookie':`__Host-haru=${token}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`});
const json = (value, status=200, headers={}) => Response.json(value, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new RequestError(status,message); }
function clean(value, max, label, single=false) {
  if (typeof value !== 'string') fail(400,label);
  const normalized = value.normalize('NFC');
  const text = normalized.trim();
  if (!text || [...text].length > max || (single && /[\t\n\r\u0085\u2028\u2029]/u.test(normalized)) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail(400,label);
  return text;
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
async function verify(password, stored) {
  const [salt, expected] = (stored || '0000000000000000:' + '0'.repeat(64)).split(':');
  const actual = await passwordHash(password,salt);
  let diff = 0;
  for (let i=0;i<actual.length;i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return !!stored && !diff;
}
function validatePassword(value,min) {
  if (typeof value !== 'string' || [...value].length < min || [...value].length > 128) {
    fail(400,'비밀번호는 8~128자로 입력해 주세요.');
  }
  return value;
}
class Community {
  constructor(db) { this.db = db; }
  statement(sql,...params) { return this.db.prepare(sql).bind(...params); }
  async all(sql,...params) { return (await this.statement(sql,...params).all()).results; }
  first(sql,...params) { return this.statement(sql,...params).first(); }
  run(sql,...params) { return this.statement(sql,...params).run(); }
  async seed() {
    const existing = await this.first('SELECT id FROM quotes WHERE id=?',seeds[0].id);
    if (existing) return;
    await this.db.batch(seeds.map(q => this.statement('INSERT OR IGNORE INTO quotes(id,text,author,category) VALUES(?,?,?,?)',q.id,q.text,q.author,q.category)));
  }
  async daily(date) {
    const ordinal = Math.floor(Date.parse(date+'T00:00:00Z') / 86400000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ordinal) ||
        new Date(ordinal*86400000).toISOString().slice(0,10) !== date) fail(400,'날짜를 확인해 주세요.');
    const base = await this.all('SELECT id FROM quotes WHERE user_id IS NULL ORDER BY id');
    const offset = ((ordinal % base.length) + base.length) % base.length;
    const rotated = [...base.slice(offset),...base.slice(0,offset)].map(q=>q.id);
    let frozen = await this.first('SELECT ids FROM daily WHERE day=?',date);
    if (!frozen) {
      const visible = new Set((await this.all('SELECT id FROM quotes WHERE hidden=0 AND user_id IS NULL')).map(q=>q.id));
      const curated = rotated.filter(id=>visible.has(id));
      const members = (await this.all('SELECT id FROM quotes WHERE hidden=0 AND day<? ORDER BY id',date)).map(q=>q.id);
      const pivot = Math.abs(ordinal) % Math.max(1,members.length);
      const submitted = [...members.slice(pivot),...members.slice(0,pivot)];
      const ids = ((ordinal & 1) && submitted.length ? [submitted[0],...curated,...submitted.slice(1)] : [...curated,...submitted]).slice(0,3);
      if (date <= kst()) {
        await this.run('INSERT OR IGNORE INTO daily VALUES(?,?)',date,JSON.stringify(ids));
        frozen = await this.first('SELECT ids FROM daily WHERE day=?',date);
      } else frozen = {ids:JSON.stringify(ids)};
    }
    const quotes = [];
    for (const id of new Set([...JSON.parse(frozen.ids),...rotated])) {
      const q = await this.first('SELECT id,text,author,category FROM quotes WHERE id=? AND hidden=0',id);
      if (q) quotes.push(q);
      if (quotes.length === 3) break;
    }
    return {quotes};
  }
  async quote(id) {
    const q = await this.first('SELECT * FROM quotes WHERE id=? AND hidden=0',id);
    if (!q) fail(404,'문장을 찾을 수 없어요.');
    return q;
  }
  tally(table,column,id,user) {
    return this.first(`SELECT COUNT(CASE WHEN value=1 THEN 1 END) AS up,
      COUNT(CASE WHEN value=-1 THEN 1 END) AS down,
      COALESCE(MAX(CASE WHEN user_id=? THEN value END),0) AS vote FROM ${table} WHERE ${column}=?`,user?.id ?? null,id);
  }
  async detail(q,user) {
    const comments = await this.all(`SELECT c.id,c.text,u.name AS author,c.created_at AS createdAt,
      (SELECT COUNT(*) FROM comment_votes WHERE comment_id=c.id AND value=1) AS up,
      (SELECT COUNT(*) FROM comment_votes WHERE comment_id=c.id AND value=-1) AS down,
      COALESCE((SELECT value FROM comment_votes WHERE comment_id=c.id AND user_id=?),0) AS vote
      FROM comments c JOIN users u ON u.id=c.user_id WHERE c.quote_id=? ORDER BY c.created_at,c.id`,user?.id ?? null,q.id);
    return {...quoteFields(q),...await this.tally('quote_votes','quote_id',q.id,user),comments};
  }
  async queue() {
    const rows = await this.all(`WITH review AS (SELECT q.*,
      (SELECT COUNT(*) FROM reports WHERE quote_id=q.id AND reviewed=0) AS reports,
      (SELECT COUNT(*) FROM quote_votes WHERE quote_id=q.id AND value=1) AS up,
      (SELECT COUNT(*) FROM quote_votes WHERE quote_id=q.id AND value=-1) AS down
      FROM quotes q WHERE q.hidden=0)
      SELECT * FROM review WHERE reports>0 OR (down>=3 AND down>=2*up AND down-up>=3)
      ORDER BY reports DESC, (down-up) DESC, id`);
    return Promise.all(rows.map(async q=>({...quoteFields(q), reports:q.reports,up:q.up,down:q.down,hidden:false,
      reportReasons:(await this.all('SELECT reason FROM reports WHERE quote_id=? AND reviewed=0',q.id)).map(r=>r.reason)})));
  }
  async dashboard() {
    const day = kst();
    const members = await this.all('SELECT id,name,admin,suspended FROM users ORDER BY id DESC');
    const quotes = await this.all(`SELECT id,text,author,category,day,hidden,user_id IS NULL AS seed,
      (SELECT COUNT(*) FROM quote_votes WHERE quote_id=quotes.id AND value=1) AS up,
      (SELECT COUNT(*) FROM quote_votes WHERE quote_id=quotes.id AND value=-1) AS down FROM quotes ORDER BY day DESC,id`);
    for (const quote of quotes) { quote.seed = !!quote.seed; quote.hidden = !!quote.hidden; }
    const reports = await this.all(`SELECT r.*,u.name AS reporter,q.text,q.hidden FROM reports r
      JOIN users u ON u.id=r.user_id JOIN quotes q ON q.id=r.quote_id ORDER BY r.reviewed,r.quote_id`);
    const totals = await this.first(`SELECT (SELECT COUNT(*) FROM comments) AS comments,
      (SELECT COUNT(*) FROM quote_votes)+(SELECT COUNT(*) FROM comment_votes) AS votes`);
    return {day,members,quotes,reports, daily:(await this.daily(day)).quotes,queue:await this.queue(),
      metrics:{'회원':members.length,'오늘 제출':quotes.filter(q=>q.day===day).length,
        '전체 댓글':totals.comments,'전체 반응':totals.votes,'미처리 신고':reports.filter(r=>!r.reviewed&&!r.hidden).length}};
  }
  async manage(body) {
    const {id,action} = body;
    if (action === 'member' && Number.isInteger(id) && typeof body.suspended === 'boolean') {
      await this.db.batch([
        this.statement('UPDATE users SET suspended=? WHERE id=? AND admin=0',Number(body.suspended),id),
        this.statement('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE id=? AND suspended=1)',id),
      ]);
    } else if (action === 'visibility' && typeof id === 'string' && typeof body.hidden === 'boolean') {
      await this.run('UPDATE quotes SET hidden=? WHERE id=?',Number(body.hidden),id);
    } else if (action === 'review' && typeof id === 'string' && Number.isInteger(body.reporter)) {
      await this.run('UPDATE reports SET reviewed=1 WHERE quote_id=? AND user_id=?',id,body.reporter);
    } else if (action === 'seed') {
      const text = clean(body.text,48,'문장을 1~48자로 입력해 주세요.',true);
      const author = clean(body.author,48,'출처를 입력해 주세요.',true);
      const category = this.category(body.category);
      if (typeof id === 'string') await this.run('UPDATE quotes SET text=?,author=?,category=? WHERE id=? AND user_id IS NULL',text,author,category,id);
      else if (id == null) await this.run('INSERT INTO quotes(id,text,author,category) VALUES(?,?,?,?)','seed-'+random(),text,author,category);
      else fail(400,'문장 ID를 확인해 주세요.');
    } else fail(400,'관리 작업을 확인해 주세요.');
    return {};
  }
  category(value) {
    if (!categories.includes(value)) fail(400,'분류를 선택해 주세요.');
    return value;
  }
  async vote(table,column,id,user,value) {
    if (![-1,0,1].includes(value)) fail(400,'반응을 확인해 주세요.');
    if (value) await this.run(`INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT(${column},user_id) DO UPDATE SET value=excluded.value`,id,user.id,value);
    else await this.run(`DELETE FROM ${table} WHERE ${column}=? AND user_id=?`,id,user.id);
    return this.tally(table,column,id,user);
  }
}

async function handle(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const db = new Community(env.DB);
  if (method === 'GET' && (path === '/api/daily' || path === '/seeds.json')) {
    await db.seed();
    if (path === '/api/daily') return json(await db.daily(url.searchParams.get('date') ?? kst()));
    return json(await db.all('SELECT id,text,author,category FROM quotes WHERE hidden=0 AND user_id IS NULL ORDER BY id'));
  }
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-haru=([a-f0-9]{48})(?:;|$)/)?.[1];
  const digest = token ? await hash(token) : '';
  const now = Math.floor(Date.now()/1000);
  const user = token ? await db.first(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires>? AND u.suspended=0`,digest,now) : null;
  const requireUser = () => { if (!user) fail(401,'로그인 후 이용해 주세요.'); };
  const requireAdmin = () => { requireUser(); if (!user.admin) fail(403,'관리자만 이용할 수 있어요.'); };
  const match = path.match(/^\/api\/(quotes|comments)\/([a-zA-Z0-9_-]+)(?:\/(vote|comments|report|hide))?$/);
  const [, kind, id, action] = match || [];

  if (method === 'GET') {
    if (path === '/api/me') return json({user:publicUser(user)});
    if (path === '/api/me/submissions') {
      requireUser();
      const quotes = await db.all('SELECT * FROM quotes WHERE user_id=? ORDER BY day DESC',user.id);
      return json({quotes:await Promise.all(quotes.map(async q=>({...await db.detail(q,user),hidden:!!q.hidden,day:q.day})))});
    }
    if (path === '/api/admin/dashboard') { requireAdmin(); await db.seed(); return json(await db.dashboard()); }
    if (path === '/api/admin') { requireAdmin(); return json({quotes:await db.queue()}); }
    if (kind === 'quotes' && !action) { await db.seed(); return json(await db.detail(await db.quote(id),user)); }
  } else if (method === 'POST' || method === 'DELETE') {
    const source = request.headers.get('Origin');
    if (source !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403,'이 사이트에서 다시 시도해 주세요.');
    const raw = await request.text();
    if (raw.length > 16000) fail(413,'입력이 너무 길어요.');
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400,'요청 내용을 확인해 주세요.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400,'요청 내용을 확인해 주세요.');
    if (method === 'POST' && (path === '/api/signup' || path === '/api/login')) {
      const signup = path.endsWith('/signup');
      const name = clean(body.name,24,'닉네임을 1~24자로 입력해 주세요.',true);
      const password = validatePassword(body.password,signup ? 8 : 1);
      if (signup) {
        const salt = random();
        const inserted = await db.run('INSERT OR IGNORE INTO users(name,password) VALUES(?,?)',name,salt+':'+await passwordHash(password,salt));
        if (!inserted.meta.changes) fail(409,'이미 사용 중인 이름이에요.');
      }
      const account = await db.first('SELECT * FROM users WHERE name=?',name);
      if (!signup && (!(await verify(password,account?.password)) || account.suspended)) fail(401,'이름 또는 비밀번호를 확인해 주세요.');
      const next = random();
      await db.db.batch([
        db.statement('DELETE FROM sessions WHERE expires<=? OR token=?',now,digest),
        db.statement('INSERT INTO sessions VALUES(?,?,?)',await hash(next),account.id,now+sessionAge),
      ]);
      return json({user:publicUser(account)},200,cookie(next,sessionAge));
    }
    if (method === 'POST' && path === '/api/logout') {
      if (token) await db.run('DELETE FROM sessions WHERE token=?',digest);
      return json({},200,cookie('',0));
    }
    if ((method === 'DELETE' && path === '/api/me') || (method === 'POST' && path === '/api/delete-account')) {
      requireUser();
      if (!await verify(validatePassword(body.password,1),user.password)) fail(403,'비밀번호를 확인해 주세요.');
      await db.run('DELETE FROM users WHERE id=?',user.id);
      return json({},200,cookie('',0));
    }
    if (method !== 'POST') fail(404,'페이지를 찾을 수 없어요.');
    requireUser();
    if (path === '/api/admin/claim') {
      // A runtime secret grants only one initial administrator, even under concurrent requests.
      const proof = body.key;
      if (!env.HARU_ADMIN_KEY || typeof proof !== 'string' || proof.length > 256 ||
          await hash(proof) !== await hash(env.HARU_ADMIN_KEY)) fail(403,'관리자 설정 키를 확인해 주세요.');
      const result = await db.run('UPDATE users SET admin=1 WHERE id=? AND NOT EXISTS (SELECT 1 FROM users WHERE admin=1)',user.id);
      if (!result.meta.changes) fail(409,'관리자 계정이 이미 설정되어 있어요.');
      return json({});
    }
    if (path === '/api/admin/manage') { requireAdmin(); return json(await db.manage(body)); }
    if (path === '/api/quotes') {
      const text = clean(body.text,48,'문장을 한 줄로 1~48자 입력해 주세요.',true);
      const id = random();
      const result = await db.run('INSERT OR IGNORE INTO quotes(id,text,author,category,user_id,day) VALUES(?,?,?,?,?,?)',id,text,user.name,db.category(body.category),user.id,kst());
      if (!result.meta.changes) fail(409,'문장은 하루에 한 번 올릴 수 있어요.');
      return json({id});
    }
    if (kind === 'comments' && action === 'vote') {
      const comment = await db.first('SELECT quote_id FROM comments WHERE id=?',id);
      if (!comment) fail(404,'댓글을 찾을 수 없어요.');
      await db.quote(comment.quote_id);
      return json(await db.vote('comment_votes','comment_id',id,user,body.value));
    }
    if (kind === 'quotes' && action) {
      await db.seed();
      if (action === 'hide') { requireAdmin(); await db.quote(id); return json(await db.manage({action:'visibility',id,hidden:true})); }
      await db.quote(id);
      if (action === 'vote') return json(await db.vote('quote_votes','quote_id',id,user,body.value));
      if (action === 'comments') {
        const commentID = random();
        const text = clean(body.text,400,'댓글을 1~400자로 입력해 주세요.');
        await db.run('INSERT INTO comments VALUES(?,?,?,?,?)',commentID,id,user.id,text,new Date().toISOString());
        return json({id:commentID});
      }
      const reason = clean(body.reason,400,'신고 이유를 1~400자로 입력해 주세요.');
      await db.run(`INSERT INTO reports(quote_id,user_id,reason) VALUES(?,?,?)
        ON CONFLICT(quote_id,user_id) DO UPDATE SET reason=excluded.reason,reviewed=0`,id,user.id,reason);
      return json({});
    }
  }
  fail(404,'페이지를 찾을 수 없어요.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/api/') || path === '/seeds.json') {
      try { return await handle(request,env,url); }
      catch (error) {
        if (error instanceof RequestError) return json({error:error.message},error.status);
        console.error('Community request failed',error.message);
        return json({error:'잠시 후 다시 시도해 주세요.'},503);
      }
    }
    if (path === '/admin/setup') return this.fetch(new Request(new URL('/admin-setup.html',url),request),env);
    const route = path === '/' || /^\/q\/[\w-]+\/?$/.test(path) ? '/index.html' :
      path === '/admin' || path === '/admin/' ? '/admin.html' : path;
    const asset = Object.hasOwn(assets,route) ? assets[route] : null;
    if (!asset) return new Response('Not found',{status:404});
    const [type, body, binary] = asset;
    return new Response(request.method === 'HEAD' ? null : binary ? Uint8Array.from(atob(body),c=>c.charCodeAt(0)) : body,
      {headers:{'Content-Type':type,'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
  },
};
