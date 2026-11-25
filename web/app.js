import { icon } from './icons.js';
import { initCommunity } from './community.js';

const $ = (selector) => document.querySelector(selector);
document.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
const timezone = 'Asia/Seoul';
const dateFormat = (options) => new Intl.DateTimeFormat('ko-KR', { timeZone: timezone, ...options });
const longDate = dateFormat({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const shortDate = dateFormat({ month: 'long', day: 'numeric', weekday: 'long' });
const time = dateFormat({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const storageKey = 'haru.saved.ids.v1';
let saved = [];
try {
  const ids = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(ids)) saved = ids.filter((x) => typeof x === 'string');
} catch {}
let page, index = 0, quotes = [], loadedDate = '', currentUser = null;
let requestSerial = 0, savedSerial = 0;
const community = initCommunity({ onChange(user) {
  currentUser = user;
  $('#account span').textContent = user ? '계정 관리' : '로그인';
  $('#profile-name').textContent = user?.name || '로그인하면 내 문장과 반응을 볼 수 있어요.';
} });

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function glyph(name, size) {
  const el = make('span', 'glyph');
  el.innerHTML = icon(name, size);
  return el;
}
function dayKey(now = new Date()) {
  return new Date(now.valueOf() + 9 * 3600000).toISOString().slice(0, 10);
}
function clockTick() {
  const now = new Date();
  $('#day').textContent = longDate.format(now);
  $('#day').dateTime = dayKey(now);
  $('#lockdate').textContent = shortDate.format(now);
  $('#clock').textContent = time.format(now);
  if (loadedDate && loadedDate !== dayKey(now)) loadDaily();
}
function excerpt(text) {
  const units = Array.from(text);
  return units.length < 19 ? text : units.slice(0, 17).join('').trimEnd() + '…';
}
function quoteRow(quote, variant, action, preview) {
  const btn = make('button', 'quote-row');
  const thumb = make('span', 'thumb thumb-' + variant);
  thumb.setAttribute('aria-hidden','true');
  const body = make('span', 'row-copy');
  body.append(make('small', 'row-category', quote.category), make('strong', '', preview ? excerpt(quote.text) : quote.text));
  btn.append(thumb, body, glyph('chevron-right', 17));
  btn.onclick = action;
  return btn;
}
function paintQuote() {
  const q = quotes[index];
  for (const id of ['#save','#discuss','#lock-quote']) $(id).disabled = !q;
  $('.more').hidden = quotes.length < 2;
  $('.pager').hidden = quotes.length < 2;
  $('#category').hidden = !q;
  $('.byline').hidden = !q;
  if (!q) {
    $('#quote').textContent = '지금 공개된 문장이 없어요.';
    $('#lock-text').textContent = '새 문장을 기다리고 있어요.';
    $('#more-list').replaceChildren();
    return;
  }
  $('#quote').textContent = q.text;
  $('#category span').textContent = q.category;
  $('#author').textContent = q.author;
  const stored = saved.includes(q.id);
  $('#save').setAttribute('aria-pressed', stored);
  $('#save').setAttribute('aria-label', stored ? '보관함에서 빼기' : '문장 보관하기');
  $('#lock-text').textContent = quotes[0].text;
  $('#position').textContent = (index + 1) + ' / ' + quotes.length;
  $('#prev').disabled = index === 0;
  $('#next').disabled = index === quotes.length - 1;
  $('#more-list').replaceChildren(...quotes.flatMap((other, i) => i === index ? [] : [
    quoteRow(other, i === 1 ? 'leaves' : 'dawn', () => selectQuote(i, true), true),
  ]));
}
function selectQuote(i, scroll = false) {
  if (i < 0 || i >= quotes.length) return;
  index = i;
  paintQuote();
  if (scroll) { $('#quote').tabIndex = -1; $('#quote').focus({ preventScroll: true }); $('.hero').scrollIntoView({block:'nearest'}); }
}
async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw Object.assign(new Error('불러올 수 없어요.'), {status:response.status});
  return response.json();
}
async function loadDaily() {
  const version = ++requestSerial;
  const key = dayKey();
  try {
    let entries;
    try {
      entries = (await json('/api/daily?date=' + key)).quotes;
    } catch {
      const seeds = await json('/seeds.json');
      const ordinal = Math.floor(Date.parse(key + 'T00:00:00Z') / 86400000);
      entries = seeds.slice(0,3).map((_, offset) => seeds[(ordinal + offset) % seeds.length]);
    }
    if (version !== requestSerial) return;
    const prior = loadedDate === key && quotes[index]?.id;
    quotes = entries;
    index = Math.max(0, quotes.findIndex((q) => q.id === prior));
    loadedDate = key;
    $('#page-status').textContent = '';
    paintQuote();
  } catch {
    if (version !== requestSerial) return;
    $('#page-status').textContent = '오늘의 문장을 불러올 수 없어요. ';
    const retry = make('button', 'dialog-link', '다시 시도');
    retry.onclick = loadDaily;
    $('#page-status').append(retry);
  }
}
async function paintSaved() {
  const version = ++savedSerial;
  const list = $('#saved-list');
  if (!saved.length) {
    const empty = make('div', 'empty');
    empty.append(glyph('bookmark',28), make('h2','','아직 보관한 문장이 없어요'), make('p','','문장 오른쪽의 책갈피를 눌러 이 기기에 간직하세요.'));
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(make('p','', '보관한 문장을 펼치고 있어요.'));
  const results = await Promise.allSettled(saved.map((id) => json('/api/quotes/' + encodeURIComponent(id))));
  if (version !== savedSerial) return;
  list.replaceChildren();
  results.forEach((result,i) => {
    const id = saved[i];
    const holder = make('div','saved-item');
    if (result.status === 'fulfilled') holder.append(quoteRow(result.value, i%2?'dawn':'leaves',() => community.openDetail(id),false));
    else holder.append(make('p','',result.reason.status === 404 ? '공개가 종료된 문장이에요.' : '연결 후 다시 열어 주세요.'));
    const remove = make('button','round');
    remove.setAttribute('aria-label','보관함에서 빼기'); remove.append(glyph('x',16));
    remove.onclick = () => { if (saveIDs(saved.filter((value) => value !== id))) paintSaved(); };
    holder.append(remove);
    list.append(holder);
  });
}
function saveIDs(ids) {
  try { localStorage.setItem(storageKey, JSON.stringify(ids)); saved = ids; paintQuote(); return true; }
  catch { $('#page-status').textContent = '이 기기에 저장할 수 없어요. 브라우저 저장 공간을 확인해 주세요.'; return false; }
}
function navigate(next, focus = true) {
  page = next;
  const titles = {today:'오늘의 문장', saved:'문장 보관함', widget:'위젯 추가 방법', profile:'내 정보'};
  for (const id of Object.keys(titles)) $('#' + id).hidden = id !== next;
  for (const btn of document.querySelectorAll('[data-page]')) {
    if (btn.closest('nav') && (btn.dataset.page === next || (next === 'widget' && btn.dataset.page === 'profile'))) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
  }
  $('.date').hidden = next !== 'today';
  $('#page-title').textContent = titles[next];
  document.title = titles[next] + ' · 하루한문장';
  if (focus) { $('#main').focus({preventScroll:true}); window.scrollTo(0,0); }
  if (page === 'saved') paintSaved();
}
const steps = {
  ios: ['잠금 화면을 길게 누르고 ‘사용자화’를 선택하세요.', '잠금 화면의 시계 아래 ‘위젯 추가’를 누르세요.', '하루한문장을 선택해 직사각형 위젯을 추가하고 ‘완료’를 누르세요.'],
  android: ['홈 화면 빈 곳을 길게 누르고 ‘위젯’을 선택하세요.', '하루한문장 위젯을 길게 눌러 원하는 곳에 놓으세요.'],
};
function platform(name) {
  for (const btn of document.querySelectorAll('[data-platform]')) btn.setAttribute('aria-pressed', btn.dataset.platform === name);
  const list = make('ol', 'steps');
  for (const entry of steps[name]) list.append(make('li','',entry));
  $('#platform-steps').replaceChildren(list);
  if (name === 'android') $('#platform-steps').append(make('p','dialog-hint','잠금 화면 위젯 제공 여부와 추가 경로는 기기와 Android 버전에 따라 달라요.'));
}
for (const btn of document.querySelectorAll('[data-page]')) btn.onclick = () => navigate(btn.dataset.page);
for (const btn of document.querySelectorAll('[data-platform]')) btn.onclick = () => platform(btn.dataset.platform);
$('#widget-guide').onclick = () => navigate('widget');
$('#prev').onclick = () => selectQuote(index - 1);
$('#next').onclick = () => selectQuote(index + 1);
$('#discuss').onclick = () => quotes[index] && community.openDetail(quotes[index].id);
$('#lock-quote').onclick = () => quotes.length && community.openDetail(quotes[0].id);
$('#save').onclick = () => {
  const q = quotes[index]; if (!q) return;
  const included = saved.includes(q.id);
  if (saveIDs(included ? saved.filter((id) => id !== q.id) : [q.id,...saved])) {
    $('#page-status').textContent = included ? '보관함에서 뺐어요.' : '문장을 이 기기 보관함에 담았어요.';
  }
};
$('#account').onclick = () => currentUser ? community.openAccount() : community.openAuth();
$('#submit-header').onclick = () => community.openSubmit();
$('#community-dialog').addEventListener('close', () => {
  if (/^\/q\//.test(location.pathname)) history.replaceState(null,'','/');
  loadDaily();
  if (page === 'saved') paintSaved();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { clockTick(); loadDaily(); community.refreshUser().catch(() => {}); }
});
clockTick();
setInterval(clockTick, 15000);
platform(/Android/.test(navigator.userAgent) ? 'android' : 'ios');
navigate('today', false);
loadDaily();
const match = location.pathname.match(/^\/q\/([\w-]+)\/?$/);
if (match) community.openDetail(match[1]);
