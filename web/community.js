import { icon } from './icons.js';

const categories = ['용기', '성장', '위로', '확언'];
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' });
const singleLineBreak = /[\r\n\v\f\u001c-\u001e\u0085\u2028\u2029]/u;

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, action, iconName) {
  const node = element('button', className);
  node.type = 'button';
  if (iconName) node.innerHTML = icon(iconName, 16);
  node.append(element('span', '', label));
  if (action) node.addEventListener('click', action);
  return node;
}

function field(label, input, hint) {
  const node = element('label', 'dialog-field');
  node.append(element('span', '', label), input);
  if (hint) {
    hint.id = `${input.id}-hint`;
    input.setAttribute('aria-describedby', hint.id);
    node.append(hint);
  }
  return node;
}

function control(tag, id, options = {}) {
  const node = element(tag);
  node.id = id;
  Object.assign(node, { required: true, ...options });
  return node;
}

function limitText(input, maximum, message, counter) {
  const validate = () => {
    const length = Array.from(input.value.normalize('NFC').trim()).length;
    if (counter) counter.textContent = `${length} / ${maximum}자`;
    input.setCustomValidity(length > maximum ? message : '');
  };
  input.addEventListener('input', validate);
  validate();
}

async function request(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new Error('연결이 끊겼어요. 잠시 후 다시 시도해 주세요.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error || '요청을 완료하지 못했어요. 다시 시도해 주세요.');
    error.status = response.status;
    throw error;
  }
  return result;
}

export function initCommunity({ onChange }) {
  const dialog = document.getElementById('community-dialog');
  const content = document.getElementById('dialog-content');
  let user = null;
  let viewVersion = 0;
  let userVersion = 0;

  dialog.setAttribute('aria-labelledby', 'community-dialog-title');
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!dialog.open) viewVersion += 1;
  });

  function setUser(nextUser) {
    userVersion += 1;
    user = nextUser;
    onChange(user);
    return user;
  }

  async function refreshUser() {
    const version = ++userVersion;
    const result = await request('/me');
    return version === userVersion ? setUser(result.user ?? null) : user;
  }

  function view(eyebrow, title, description) {
    const version = ++viewVersion;
    const node = element('section', 'dialog-view');
    const heading = element('h2', 'dialog-title', title);
    heading.id = 'community-dialog-title';
    heading.tabIndex = -1;
    const error = element('p', 'dialog-error');
    error.setAttribute('role', 'alert');
    node.append(element('p', 'dialog-eyebrow', eyebrow), heading);
    if (description) node.append(element('p', 'dialog-copy', description));
    node.append(error);
    content.replaceChildren(node);
    if (!dialog.open) dialog.showModal();
    if (typeof content.scrollTo === 'function') content.scrollTo(0, 0);
    heading.focus({ preventScroll: true });
    return { node, error, active: () => dialog.open && viewVersion === version };
  }

  function errorTo(target, error) {
    target.textContent = error.message;
  }

  async function busy(screen, operation) {
    if (screen.node.getAttribute('aria-busy') === 'true') return;
    screen.error.textContent = '';
    screen.node.setAttribute('aria-busy', 'true');
    const controls = [...screen.node.querySelectorAll('button, input, select, textarea')].filter((node) => !node.disabled);
    const focused = document.activeElement;
    controls.forEach((node) => { node.disabled = true; });
    try {
      await operation();
    } catch (error) {
      if (screen.active()) errorTo(screen.error, error);
    } finally {
      controls.forEach((node) => { node.disabled = false; });
      screen.node.removeAttribute('aria-busy');
      if (screen.active() && controls.includes(focused) && !screen.node.contains(document.activeElement)) {
        focused.focus({ preventScroll: true });
      }
    }
  }

  function formFor(screen, submitLabel, operation) {
    const form = element('form', 'dialog-form');
    const submit = button(submitLabel, 'dialog-primary');
    submit.type = 'submit';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      return busy(screen, operation);
    });
    return { form, submit };
  }

  function openAuth({ after, back, signup = false } = {}) {
    const screen = view('하루 한 문장', signup ? '회원가입' : '로그인');
    const username = control('input', 'community-name', { type: 'text', autocomplete: 'username' });
    const password = control('input', 'community-password', { type: 'password', autocomplete: signup ? 'new-password' : 'current-password' });
    limitText(username, 24, '닉네임을 24자 이내로 입력해 주세요.');
    const { form, submit } = formFor(screen, signup ? '가입하기' : '로그인', async () => {
      const result = await request(signup ? '/signup' : '/login', 'POST', {
        name: username.value.normalize('NFC').trim(),
        password: password.value,
      });
      if (result?.user) setUser(result.user);
      else await refreshUser();
      if (screen.active()) {
        if (after) await after(screen.active);
        else dialog.close();
      }
    });
    const actions = element('div', 'dialog-actions');
    actions.append(submit, button(signup ? '이미 계정이 있어요' : '새 계정 만들기', 'dialog-secondary', () => {
      openAuth({ after, back, signup: !signup });
      document.getElementById('community-name').value = username.value;
    }));
    if (back) actions.append(button('돌아가기', 'dialog-link', back, 'arrow-left'));
    const passwordHint = signup ? element('span', 'dialog-hint', '8~128자로 입력해 주세요.') : null;
    form.append(field('닉네임', username), field('비밀번호', password, passwordHint), actions);
    screen.node.append(form);
  }

  function openSubmit() {
    if (!user) return openAuth({ after: openSubmit });
    const screen = view('하루 한 문장', '문장 쓰기', '올린 문장은 다른 사람의 오늘의 문장과 위젯에 소개될 수 있어요. 하루에 한 편, 48자까지 쓸 수 있어요.');
    const quote = control('input', 'community-quote', { type: 'text', autocomplete: 'off' });
    const counter = element('span', 'dialog-hint', '0 / 48자');
    const category = control('select', 'community-category');
    for (const name of categories) category.append(element('option', '', name));
    limitText(quote, 48, '문장을 48자 이내로 적어 주세요.', counter);
    const { form, submit } = formFor(screen, '한 줄 올리기', async () => {
      const text = quote.value.normalize('NFC');
      if (!text.trim() || singleLineBreak.test(text)) throw new Error('문장을 한 줄로 적어 주세요.');
      const result = await request('/quotes', 'POST', { text: text.trim(), category: category.value });
      if (screen.active()) await openDetail(result.id);
    });
    form.append(field('문장', quote, counter), field('분류', category), submit);
    screen.node.append(form);
  }

  function voteButtons(subject, kind, activate) {
    const group = element('div', 'detail-votes');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', kind === 'quote' ? '문장 평가' : '댓글 평가');
    for (const [value, count, label, symbol] of [
      [1, subject.up, '좋아요', 'thumb-up'],
      [-1, subject.down, '싫어요', 'thumb-down'],
    ]) {
      const id = `${kind}-${subject.id}-vote-${value}`;
      const node = button(String(count ?? 0), 'vote-button', () => activate(value, id), symbol);
      node.id = id;
      node.setAttribute('aria-label', `${label} ${count ?? 0}개`);
      node.setAttribute('aria-pressed', String(subject.vote === value));
      group.append(node);
    }
    return group;
  }

  function openReport(id, back) {
    if (!user) return openAuth({ after: () => openReport(id, back), back });
    const screen = view('하루 한 문장', '문장 신고하기', '어떤 점이 문제였는지 알려 주세요.');
    const reason = control('textarea', 'community-reason', { rows: 4 });
    limitText(reason, 400, '신고 사유를 400자 이내로 입력해 주세요.');
    const { form, submit } = formFor(screen, '신고 보내기', async () => {
      if (!reason.value.trim()) throw new Error('신고 사유를 입력해 주세요.');
      await request(`/quotes/${encodeURIComponent(id)}/report`, 'POST', { reason: reason.value.trim() });
      if (screen.active()) await back({ notice: '신고를 접수했어요.' });
    });
    const actions = element('div', 'dialog-actions');
    actions.append(submit, button('돌아가기', 'dialog-secondary', () => back(), 'arrow-left'));
    form.append(field('신고 사유', reason), actions);
    screen.node.append(form);
  }

  async function openDetail(id, { sort = 'best', notice = '', focus = '', fromAdmin = false, failure = '', draft = '' } = {}) {
    const path = `/quotes/${encodeURIComponent(id)}`;
    const screen = view('하루 한 문장', '문장과 이야기');
    const loading = element('p', 'dialog-copy', '문장을 불러오는 중이에요.');
    loading.setAttribute('role', 'status');
    screen.node.append(loading);
    let quote;
    try {
      quote = await request(path);
    } catch (error) {
      if (screen.active()) {
        loading.remove();
        errorTo(screen.error, error);
        screen.node.append(button('다시 불러오기', 'dialog-secondary', () => openDetail(id, { sort })));
      }
      return;
    }
    if (!screen.active()) return;
    loading.remove();
    const back = (options) => openDetail(id, {
      sort, fromAdmin, draft: screen.node.querySelector('#community-comment')?.value ?? draft, ...options,
    });
    async function vote(subject, kind, value, buttonID) {
      const votePath = kind === 'quote' ? path : `/comments/${encodeURIComponent(subject.id)}`;
      const apply = async (nextValue) => request(`${votePath}/vote`, 'POST', { value: nextValue });
      if (!user) {
        return openAuth({ back: () => back({ focus: buttonID }), after: async (active) => {
          try {
            await apply(value);
            if (active()) await back({ focus: buttonID });
          } catch (error) {
            if (active()) await back({ failure: error.message, focus: buttonID });
          }
        } });
      }
      await busy(screen, async () => {
        await apply(subject.vote === value ? 0 : value);
        if (screen.active()) await back({ focus: buttonID });
      });
    }

    if (failure) screen.error.textContent = failure;
    if (notice) {
      const status = element('p', 'dialog-hint', notice);
      status.setAttribute('role', 'status');
      screen.node.append(status);
    }
    const quoteActions = element('div', 'dialog-actions');
    const shareUrl = new URL(`/q/${encodeURIComponent(quote.id)}`, window.location.href).href;
    const shareStatus = element('p', 'dialog-hint');
    shareStatus.setAttribute('role', 'status');
    const link = control('input', 'community-share-link', {
      type: 'text', value: shareUrl, readOnly: true, required: false, spellcheck: false,
    });
    const copyField = field('공유 링크', link, element('span', 'dialog-hint', '선택한 링크를 복사해 주세요.'));
    copyField.hidden = true;
    const copyLink = button('링크 복사', 'dialog-link', async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        if (screen.active()) {
          copyField.hidden = true;
          shareStatus.textContent = '링크를 복사했어요.';
        }
      } catch {
        if (!screen.active()) return;
        shareStatus.textContent = '';
        copyField.hidden = false;
        link.focus();
        link.select();
      }
    });
    quoteActions.append(
      voteButtons(quote, 'quote', (...args) => vote(quote, 'quote', ...args)),
      copyLink,
      button('신고', 'dialog-link', () => openReport(id, back), 'flag'),
    );
    if (fromAdmin) quoteActions.append(button('신고 관리로 돌아가기', 'dialog-link', openAdmin, 'arrow-left'));
    screen.node.append(
      element('span', 'detail-category', quote.category),
      element('blockquote', 'detail-quote', quote.text),
      element('p', 'detail-byline', quote.author),
      quoteActions,
      shareStatus,
      copyField,
    );

    const comments = quote.comments ?? [];
    const commentHeader = element('div', 'comment-header');
    const sortMenu = control('select', 'community-comment-sort', { required: false, className: 'comment-sort' });
    sortMenu.setAttribute('aria-label', '댓글 정렬');
    for (const [key, label] of [['best', '공감순'], ['latest', '최신순']]) {
      const option = element('option', '', label);
      option.value = key;
      sortMenu.append(option);
    }
    sortMenu.value = sort;
    commentHeader.append(element('h3', '', '댓글'), sortMenu);
    const list = element('div', 'comment-list');
    const newestFirst = (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
      || String(b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      || String(b.id).localeCompare(a.id);
    const score = (comment) => (comment.up ?? 0) - (comment.down ?? 0);
    const ranked = [...comments].sort((a, b) => score(b) - score(a) || newestFirst(a, b));
    const best = score(ranked[0] ?? {}) > 0 ? ranked[0] : null;
    function renderComments() {
      const ordered = sort === 'best' ? ranked : [...comments].sort(newestFirst);
      list.replaceChildren();
      if (!ordered.length) list.append(element('p', 'dialog-copy', '아직 댓글이 없어요.'));
      for (const comment of ordered) {
        const card = element('article', 'comment-card');
        const byline = element('p', 'comment-author');
        byline.append(element('strong', '', comment.author));
        if (comment === best) byline.append(element('span', 'comment-best', 'BEST'));
        const date = new Date(comment.createdAt);
        if (!Number.isNaN(date.valueOf())) {
          const time = element('time', '', dateFormat.format(date));
          time.dateTime = date.toISOString();
          byline.append(time);
        }
        card.append(byline, element('p', 'comment-text', comment.text), voteButtons(comment, 'comment', (...args) => vote(comment, 'comment', ...args)));
        list.append(card);
      }
    }
    sortMenu.addEventListener('change', () => {
      sort = sortMenu.value;
      renderComments();
    });
    renderComments();
    screen.node.append(commentHeader, list);
    if (user) {
      const comment = control('textarea', 'community-comment', { rows: 3, value: draft });
      const counter = element('span', 'dialog-hint');
      limitText(comment, 400, '댓글을 400자 이내로 입력해 주세요.', counter);
      const { form, submit } = formFor(screen, '댓글 쓰기', async () => {
        if (!comment.value.trim()) throw new Error('댓글을 입력해 주세요.');
        await request(`${path}/comments`, 'POST', { text: comment.value.trim() });
        if (screen.active()) await back({ notice: '댓글을 남겼어요.', focus: comment.id, draft: '' });
      });
      form.append(field('댓글 남기기', comment, counter), submit);
      screen.node.append(form);
    } else {
      const returnToComment = () => back({ focus: 'community-comment' });
      screen.node.append(button('로그인하고 댓글 쓰기', 'dialog-secondary', () => openAuth({ after: returnToComment, back: () => back() }), 'message'));
    }
    if (focus) document.getElementById(focus)?.focus();
  }

  async function openHistory() {
    const screen = view('내 계정', '내가 올린 문장');
    try {
      const {quotes} = await request('/me/submissions');
      if (!screen.active()) return;
      if (!quotes.length) screen.node.append(element('p', 'dialog-copy', '아직 올린 문장이 없어요.'));
      for (const quote of quotes) {
        const card = element('article', 'comment-card');
        card.append(element('p', 'dialog-hint', quote.day + (quote.hidden ? ' · 숨김' : ' · 공개')),
          element('strong', '', quote.text),
          element('p', 'detail-byline', `좋아요 ${quote.up} · 싫어요 ${quote.down} · 댓글 ${quote.comments.length}`));
        if (!quote.hidden) card.append(button('문장 상세 열기', 'dialog-link', () => openDetail(quote.id)));
        for (const comment of quote.comments) {
          card.append(element('p', 'comment-author', comment.author),
            element('p', 'comment-text', comment.text),
            element('p', 'detail-byline', `좋아요 ${comment.up} · 싫어요 ${comment.down}`));
        }
        screen.node.append(card);
      }
    } catch (error) {
      if (screen.active()) errorTo(screen.error, error);
    }
    if (screen.active()) screen.node.append(button('내 계정으로', 'dialog-secondary', openAccount));
  }

  function openAccount() {
    if (!user) return openAuth();
    const screen = view('내 계정', user.name);
    const actions = element('div', 'dialog-actions');
    actions.append(button('로그아웃', 'dialog-secondary', () => busy(screen, async () => {
      await request('/logout', 'POST');
      setUser(null);
      if (screen.active()) dialog.close();
    })));
    actions.prepend(button('내가 올린 문장', 'dialog-secondary', openHistory, 'book'));
    if (user.admin) {
      const admin = element('a', 'dialog-secondary', '관리자 대시보드');
      admin.href = '/admin';
      actions.append(admin, button('신고 관리', 'dialog-secondary', openAdmin, 'flag'));
    }
    actions.append(button('계정 삭제', 'dialog-link', openDeleteAccount));
    screen.node.append(actions);
  }

  function openDeleteAccount() {
    const screen = view('내 계정', '계정 삭제', '계정 삭제를 확인하려면 비밀번호를 입력해 주세요. 삭제한 계정은 복구할 수 없어요.');
    const password = control('input', 'community-delete-password', { type: 'password', autocomplete: 'current-password' });
    const { form, submit } = formFor(screen, '계정 영구 삭제', async () => {
      await request('/me', 'DELETE', { password: password.value });
      setUser(null);
      if (screen.active()) dialog.close();
    });
    submit.className = 'dialog-danger';
    const actions = element('div', 'dialog-actions');
    actions.append(submit, button('취소', 'dialog-secondary', openAccount));
    form.append(field('비밀번호', password), actions);
    screen.node.append(form);
  }

  function openHideConfirmation(quote) {
    const screen = view('관리자', '이 문장을 숨길까요?', '숨긴 문장은 오늘의 문장과 문장 상세에서 보이지 않아요.');
    const actions = element('div', 'dialog-actions');
    actions.append(
      button('숨기기', 'dialog-danger', () => busy(screen, async () => {
        await request(`/quotes/${encodeURIComponent(quote.id)}/hide`, 'POST');
        if (screen.active()) await openAdmin();
      })),
      button('취소', 'dialog-secondary', openAdmin),
    );
    screen.node.append(element('blockquote', 'detail-quote', quote.text), actions);
  }

  async function openAdmin() {
    if (!user) return openAuth({ after: openAdmin });
    const screen = view('관리자', '신고 관리');
    if (!user.admin) {
      screen.error.textContent = '관리자만 열 수 있어요.';
      return;
    }
    const queue = element('div', 'moderation-list');
    queue.setAttribute('aria-busy', 'true');
    queue.append(element('p', 'dialog-copy', '신고를 불러오는 중이에요.'));
    screen.node.append(queue);
    try {
      const { quotes } = await request('/admin');
      if (!screen.active()) return;
      queue.replaceChildren();
      if (!quotes.length) queue.append(element('p', 'dialog-copy', '접수된 신고가 없어요.'));
      for (const quote of quotes) {
        const card = element('article', 'moderation-card');
        card.append(element('p', 'comment-text', quote.text), element('p', 'comment-author', quote.author));
        const reports = quote.reportReasons ?? (Array.isArray(quote.reports) ? quote.reports : []);
        const count = typeof quote.reports === 'number' ? quote.reports : reports.length;
        card.append(element('p', 'dialog-hint', `좋아요 ${quote.up ?? 0}개 · 싫어요 ${quote.down ?? 0}개`));
        card.append(element('p', 'dialog-hint', `신고 ${count}건`));
        for (const report of reports) {
          card.append(element('p', 'dialog-copy', typeof report === 'string' ? report : report.reason));
        }
        const actions = element('div', 'dialog-actions');
        if (quote.hidden) {
          card.append(element('p', 'dialog-hint', '숨김 처리됨'));
          queue.append(card);
          continue;
        }
        actions.append(button('문장 보기', 'dialog-secondary', () => openDetail(quote.id, { fromAdmin: true }), 'chevron-right'));
        actions.append(button('숨기기', 'dialog-danger', () => openHideConfirmation(quote)));
        card.append(actions);
        queue.append(card);
      }
    } catch (error) {
      if (screen.active()) {
        queue.replaceChildren(button('다시 불러오기', 'dialog-secondary', openAdmin));
        errorTo(screen.error, error);
      }
    } finally {
      queue.removeAttribute('aria-busy');
    }
  }

  refreshUser().catch(() => {
    if (userVersion === 1) setUser(null);
  });

  return { openDetail, openAuth, openSubmit, openAccount, openAdmin, refreshUser };
}
