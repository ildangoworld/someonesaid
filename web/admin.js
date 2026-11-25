const panel = document.querySelector('#admin-panel');
const status = document.querySelector('#admin-status');
const tabs = document.querySelector('.admin-tabs');
const sections = { overview:'운영 현황', reports:'신고 내역', submissions:'제출 문장', seeds:'기본 문장', members:'회원 관리' };
let data;
let section = 'overview';

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action) {
  const node = el('button', label, 'dialog-secondary');
  node.type = 'button';
  node.onclick = action;
  return node;
}
async function request(path, body) {
  const response = await fetch(path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
async function refresh() {
  data = await request('/api/admin/dashboard');
  document.querySelector('#admin-date').textContent = data.day + ' · 한국 시간';
  document.querySelector('#dashboard').hidden = false;
  render();
}
async function mutate(body, confirmMessage) {
  if (confirmMessage && !window.confirm(confirmMessage)) return;
  if (panel.inert) return;
  panel.inert = true;
  tabs.inert = true;
  status.textContent = '저장 중이에요.';
  try {
    await request('/api/admin/manage', body);
    await refresh();
    status.textContent = '저장했어요.';
    document.querySelector('#admin-heading').focus();
  } catch (error) { status.textContent = error.message; }
  finally { panel.inert = false; tabs.inert = false; }
}
function row(title, meta) {
  const article = el('article', '', 'admin-row');
  article.append(el('strong', title), el('p', meta, 'dialog-hint'));
  return article;
}
function visibility(q) {
  return button(q.hidden ? '공개로 전환' : '숨기기', () =>
    mutate({action:'visibility',id:q.id,hidden:!q.hidden}, q.hidden ? '' : '이 문장을 숨길까요?'));
}
function seedForm(q = {}) {
  const form = el('form', '', 'dialog-form admin-form');
  form.append(el('h3', q.id ? '기본 문장 수정' : '기본 문장 추가'));
  for (const [key,label] of [['text','문장 · 48자 이내'],['author','작성자 또는 출처'],['category','분류']]) {
    const field = el('label',label,'dialog-field');
    const input = el(key === 'category' ? 'select' : 'input');
    input.name = key;
    input.required = true;
    if (key === 'category') for (const name of ['용기','성장','위로','확언']) input.append(el('option',name));
    input.value = q[key] || (key === 'category' ? '용기' : key === 'author' ? '하루한문장 편집부' : '');
    field.append(input);
    form.append(field);
  }
  const submit = el('button',q.id ? '수정 저장' : '추가','dialog-primary');
  form.append(submit);
  form.onsubmit = (event) => {
    event.preventDefault();
    mutate({action:'seed',id:q.id,...Object.fromEntries(new FormData(form))});
  };
  return form;
}
function searchList() {
  const label = el('label','목록 검색','dialog-field admin-search');
  const search = el('input');
  search.type = 'search';
  search.placeholder = '문장, 닉네임 또는 상태';
  const result = el('p','','dialog-hint');
  result.setAttribute('role','status');
  search.addEventListener('input', () => {
    const query = search.value.normalize('NFC').trim().toLocaleLowerCase('ko');
    let count = 0;
    for (const row of panel.querySelectorAll('.admin-row')) {
      row.hidden = !row.textContent.toLocaleLowerCase('ko').includes(query);
      if (!row.hidden) count++;
    }
    result.textContent = query ? `검색 결과 ${count}개` : '';
  });
  label.append(search);
  panel.append(label,result);
}
function render() {
  const heading = el('h2',sections[section]);
  heading.id = 'admin-heading';
  heading.tabIndex = -1;
  panel.replaceChildren(heading);
  if (section !== 'overview') searchList();
  for (const tab of tabs.children) tab.setAttribute('aria-current', tab.dataset.section === section ? 'page' : 'false');
  if (section === 'overview') {
    const metrics = el('div','','admin-metrics');
    for (const [label,value] of Object.entries(data.metrics)) {
      const card = el('div',label,'admin-metric');
      card.append(el('strong',String(value)));
      metrics.append(card);
    }
    panel.append(metrics,el('h3','오늘의 공개 편성'));
    data.daily.forEach((q,i) => panel.append(row(q.text,(i === 0 ? '대표 · 위젯' : '추가 문장') + ' · ' + q.author)));
    if (!data.daily.length) panel.append(el('p','현재 공개 문장이 없어요.'));
    panel.append(el('h3','검토가 필요한 문장'));
    data.queue.forEach(q => {
      const item = row(q.text,`신고 ${q.reports} · 좋아요 ${q.up} · 싫어요 ${q.down}`);
      item.append(visibility(q));
      panel.append(item);
    });
    if (!data.queue.length) panel.append(el('p','검토할 문장이 없어요.'));
  } else if (section === 'members') {
    for (const member of data.members) {
      const item = row(member.name,member.admin ? '관리자' : member.suspended ? '이용 정지' : '이용 중');
      if (!member.admin) item.append(button(member.suspended ? '이용 재개' : '이용 정지', () =>
        mutate({action:'member',id:member.id,suspended:!member.suspended}, member.suspended ? '' : '이 회원의 이용을 정지할까요?')));
      panel.append(item);
    }
  } else if (section === 'reports') {
    if (!data.reports.length) panel.append(el('p','신고 내역이 없어요.'));
    for (const report of data.reports) {
      const item = row(report.text,`${report.reporter} · ${report.hidden ? '문장 숨김' : report.reviewed ? '검토 완료' : '검토 대기'}`);
      item.append(el('p',report.reason,'comment-text'));
      const actions = el('div','','admin-row-actions');
      if (!report.reviewed) actions.append(button('검토 완료',() => mutate({action:'review',id:report.quote_id,reporter:report.user_id})));
      if (!report.hidden) actions.append(visibility({id:report.quote_id,hidden:false}));
      item.append(actions);
      panel.append(item);
    }
  } else {
    if (section === 'seeds') panel.append(seedForm());
    const quotes = data.quotes.filter(q => q.seed === (section === 'seeds'));
    if (!quotes.length) panel.append(el('p','등록된 문장이 없어요.'));
    for (const q of quotes) {
      const item = row(q.text,[q.author,q.day,q.category,q.hidden ? '숨김' : '공개',`좋아요 ${q.up} · 싫어요 ${q.down}`].filter(Boolean).join(' · '));
      const actions = el('div','','admin-row-actions');
      actions.append(visibility(q));
      if (q.seed) {
        const edit = button('수정', () => {
          edit.disabled = true;
          const form = seedForm(q);
          item.append(form);
          form.querySelector('input').focus();
        });
        actions.append(edit);
      } else if (!q.hidden) {
        const link = el('a','문장과 댓글','dialog-secondary');
        link.href = '/q/' + encodeURIComponent(q.id);
        actions.append(link);
      }
      item.append(actions);
      panel.append(item);
    }
  }
}
for (const [key,label] of Object.entries(sections)) {
  const tab = button(label, () => { section = key; render(); document.querySelector('#admin-heading').focus(); });
  tab.dataset.section = key;
  tabs.append(tab);
}
refresh().then(() => { status.textContent = ''; }).catch(error => {
  status.textContent = error.message + ' 서비스에서 관리자 계정으로 로그인한 뒤 다시 열어 주세요.';
});
