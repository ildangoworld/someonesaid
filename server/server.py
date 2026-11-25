"""Haru community HTTP service. Requires Python 3.11+ and no dependencies."""

import argparse
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
import hashlib
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import unicodedata
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))
CATEGORIES = {'용기', '성장', '위로', '확언'}
EPOCH = date(1970, 1, 1)
SESSION_AGE = 30 * 24 * 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, text TEXT NOT NULL, author TEXT NOT NULL, category TEXT NOT NULL,
    user_id INTEGER REFERENCES users ON DELETE CASCADE, day TEXT,
    hidden INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, day)
);
CREATE TABLE IF NOT EXISTS daily (
    day TEXT PRIMARY KEY, ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES quotes ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quote_votes (
    quote_id TEXT NOT NULL REFERENCES quotes ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    value INTEGER NOT NULL CHECK(value IN (-1, 1)), PRIMARY KEY(quote_id, user_id)
);
CREATE TABLE IF NOT EXISTS comment_votes (
    comment_id TEXT NOT NULL REFERENCES comments ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    value INTEGER NOT NULL CHECK(value IN (-1, 1)), PRIMARY KEY(comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS reports (
    quote_id TEXT NOT NULL REFERENCES quotes ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    reason TEXT NOT NULL, PRIMARY KEY(quote_id, user_id)
);
CREATE INDEX IF NOT EXISTS comments_by_quote ON comments(quote_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
"""


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def today():
    return datetime.now(KST).date()


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    return db


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return f'{salt.hex()}:{digest.hex()}'


def password_matches(password, stored):
    return secrets.compare_digest(password_hash(password, bytes.fromhex(stored.split(':')[0])), stored)


def normalized(value, maximum, message, minimum=1, single_line=False):
    if not isinstance(value, str):
        raise APIError(400, message)
    value = unicodedata.normalize('NFC', value)
    if single_line and (value.splitlines() != [value] or '\t' in value):
        raise APIError(400, message)
    value = value.strip()
    if not minimum <= len(value) <= maximum or any(unicodedata.category(char) in {'Cs', 'Cc'} and char not in '\n\t' for char in value):
        raise APIError(400, message)
    return value


def credentials(body, minimum):
    name = normalized(body.get('name'), 24, '이름을 1~24자로 입력해 주세요.', single_line=True)
    password = body.get('password')
    if not isinstance(password, str) or not minimum <= len(password) <= 128 or any(unicodedata.category(char) == 'Cs' for char in password):
        raise APIError(400, '비밀번호는 8~128자로 입력해 주세요.')
    return name, password


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


class CommunityServer(ThreadingHTTPServer):
    def __init__(self, address, database, seeds, web, secure_cookie=False):
        self.database = database
        self.seeds = json.loads(Path(seeds).read_text(encoding='utf-8'))
        self.web = Path(web).resolve()
        self.secure_cookie = secure_cookie
        if len(self.seeds) < 3 or len({quote['id'] for quote in self.seeds}) != len(self.seeds):
            raise ValueError('At least three seeds with unique IDs are required.')
        with closing(connect(database)) as db, db:
            db.execute('PRAGMA journal_mode = WAL')
            db.executescript(SCHEMA)
            for table, column in [('users', 'suspended'), ('reports', 'reviewed')]:
                if column not in {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0')
            db.executemany(
                'INSERT OR IGNORE INTO quotes(id, text, author, category) VALUES(:id,:text,:author,:category)',
                self.seeds,
            )
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')

    def do_DELETE(self):
        self.dispatch('DELETE')

    def dispatch(self, method):
        try:
            request = urlsplit(self.path)
            self.cookie = None
            if not request.path.startswith('/api/'):
                if method != 'GET':
                    raise APIError(405, '지원하지 않는 요청이에요.')
                self.static(request.path)
                return
            if method != 'GET' and self.headers.get('Sec-Fetch-Site') in {'same-site', 'cross-site'}:
                raise APIError(403, '이 사이트에서 다시 요청해 주세요.')
            body = self.read_json() if method in {'POST', 'DELETE'} else {}
            with closing(connect(self.server.database)) as db, db:
                if method in {'POST', 'DELETE'} and request.path not in {'/api/login', '/api/signup'}:
                    db.execute('BEGIN IMMEDIATE')
                payload = self.api(db, method, request.path, parse_qs(request.query, keep_blank_values=True), body)
            self.json_response(200, payload)
        except APIError as error:
            self.json_response(error.status, {'error': error.message})
        except (ValueError, UnicodeError):
            self.json_response(400, {'error': '요청 내용을 확인해 주세요.'})
        except sqlite3.Error as error:
            self.log_error('Database request failed: %s', type(error).__name__)
            self.json_response(503, {'error': '잠시 후 다시 시도해 주세요.'})

    def read_json(self):
        content_length = int(self.headers.get('Content-Length', '0'))
        if not 0 <= content_length <= 16000:
            raise APIError(413, '요청이 너무 길어요.')
        if content_length == 0:
            return {}
        if self.headers.get_content_type() != 'application/json':
            raise APIError(415, 'JSON 형식으로 요청해 주세요.')
        body = json.loads(self.rfile.read(content_length).decode('utf-8'))
        if not isinstance(body, dict):
            raise APIError(400, '요청 내용을 확인해 주세요.')
        return body

    def respond(self, status, body, content_type, cache='no-store'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        if self.cookie:
            self.send_header('Set-Cookie', self.cookie)
        self.end_headers()
        self.wfile.write(body)

    def json_response(self, status, body):
        self.respond(status, json.dumps(body, ensure_ascii=False).encode(), 'application/json; charset=utf-8')

    def static(self, path):
        if path == '/seeds.json':
            with closing(connect(self.server.database)) as db:
                seeds = [self.public_quote(row) for row in db.execute(
                    'SELECT * FROM quotes WHERE hidden=0 AND user_id IS NULL ORDER BY id'
                )]
            self.json_response(200, seeds)
            return
        if path in {'/admin', '/admin/'}:
            path = '/admin.html'
        if path == '/' or re.fullmatch(r'/q/[^/]+/?', path):
            path = '/index.html'
        file = (self.server.web / path.lstrip('/')).resolve()
        if not file.is_relative_to(self.server.web) or not file.is_file() or file.name.startswith('.'):
            raise APIError(404, '페이지를 찾을 수 없어요.')
        guessed = mimetypes.guess_type(file)[0] or 'application/octet-stream'
        content_type = f'{guessed}; charset=utf-8' if guessed.startswith('text/') else guessed
        self.respond(200, file.read_bytes(), content_type, 'no-cache')

    def session(self, token='', age=0):
        secure = '; Secure' if self.server.secure_cookie else ''
        self.cookie = f'haru={token}; Max-Age={age}; Path=/; HttpOnly; SameSite=Lax{secure}'

    def get_token(self):
        try:
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
        except CookieError:
            return ''
        item = cookies.get('haru')
        token = item.value if item else ''
        return token if re.fullmatch(r'[A-Za-z0-9_-]{43}', token) else ''

    def api(self, db, method, path, params, body):
        token = self.get_token()
        user = None
        if token:
            user = db.execute(
                'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.suspended=0',
                (token_digest(token), int(time.time())),
            ).fetchone()
        if method == 'GET':
            if path == '/api/daily':
                return self.daily(db, params)
            if path == '/api/me':
                return {'user': self.public_user(user)}
            match = re.fullmatch(r'/api/quotes/([A-Za-z0-9_-]+)', path)
            if match:
                return self.quote_detail(db, self.quote(db, match[1]), user)
            if path == '/api/me/submissions':
                self.require_user(user)
                return {'quotes': [self.quote_detail(db, row, user) | {'hidden': bool(row['hidden']), 'day': row['day']}
                    for row in db.execute('SELECT * FROM quotes WHERE user_id=? ORDER BY day DESC', (user['id'],))]}
            admin_quote = re.fullmatch(r'/api/admin/quotes/([A-Za-z0-9_-]+)', path)
            if admin_quote:
                self.require_admin(user)
                quote = db.execute('SELECT * FROM quotes WHERE id=? AND user_id IS NOT NULL',
                                   (admin_quote[1],)).fetchone()
                if quote is None:
                    raise APIError(404, '제출 문장을 찾을 수 없어요.')
                return self.quote_detail(db, quote, user) | {'hidden': bool(quote['hidden'])}
            if path == '/api/admin/dashboard':
                self.require_admin(user)
                return self.dashboard(db)
            if path == '/api/admin':
                self.require_admin(user)
                return self.admin_quotes(db)
        if method == 'POST':
            if path in {'/api/signup', '/api/login'}:
                return self.authenticate(db, path, body, token)
            if path == '/api/admin/manage':
                self.require_admin(user)
                return self.manage(db, user, body)
            if path == '/api/logout':
                db.execute('DELETE FROM sessions WHERE token=?', (token_digest(token),))
                self.session()
                return {}
            if path == '/api/quotes':
                self.require_user(user)
                return self.submit_quote(db, user, body)
            match = re.fullmatch(r'/api/(quotes|comments)/([A-Za-z0-9_-]+)/(vote|comments|report|hide)', path)
            if match:
                self.require_user(user)
                return self.interact(db, user, match.groups(), body)
        if (method, path) in {('DELETE', '/api/me'), ('POST', '/api/delete-account')}:
            self.require_user(user)
            password = body.get('password')
            if not isinstance(password, str) or not 1 <= len(password) <= 128 or not password_matches(password, user['password']):
                raise APIError(403, '비밀번호를 확인해 주세요.')
            db.execute('DELETE FROM users WHERE id=?', (user['id'],))
            self.session()
            return {}
        raise APIError(404, '요청하신 주소를 찾을 수 없어요.')

    @staticmethod
    def require_user(user):
        if not user:
            raise APIError(401, '로그인 후 이용해 주세요.')

    @classmethod
    def require_admin(cls, user):
        cls.require_user(user)
        if not user['admin']:
            raise APIError(403, '관리자만 이용할 수 있어요.')

    @staticmethod
    def public_user(user):
        return {'name': user['name'], 'admin': bool(user['admin'])} if user else None

    def authenticate(self, db, path, body, token):
        signup = path == '/api/signup'
        name, password = credentials(body, 8 if signup else 1)
        if signup:
            try:
                db.execute('INSERT INTO users(name,password) VALUES(?,?)', (name, password_hash(password)))
            except sqlite3.IntegrityError:
                raise APIError(409, '이미 사용 중인 이름이에요.') from None
        user = db.execute('SELECT * FROM users WHERE name=?', (name,)).fetchone()
        if not signup:
            stored = user['password'] if user else '0' * 32 + ':' + '0' * 128
            if not password_matches(password, stored) or not user or user['suspended']:
                raise APIError(401, '이름 또는 비밀번호를 확인해 주세요.')
        now = int(time.time())
        new_token = secrets.token_urlsafe(32)
        db.execute('DELETE FROM sessions WHERE expires<=? OR token=?', (now, token_digest(token)))
        db.execute('INSERT INTO sessions VALUES(?,?,?)', (token_digest(new_token), user['id'], now + SESSION_AGE))
        self.session(new_token, SESSION_AGE)
        return {'user': self.public_user(user)}

    @staticmethod
    def quote(db, quote_id):
        row = db.execute('SELECT * FROM quotes WHERE id=? AND hidden=0', (quote_id,)).fetchone()
        if not row:
            raise APIError(404, '문장을 찾을 수 없어요.')
        return row

    @staticmethod
    def public_quote(row):
        return {key: row[key] for key in ('id', 'text', 'author', 'category')}

    def daily(self, db, params):
        current = today()
        value = params.get('date', [current.isoformat()])[0]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value, re.ASCII):
            raise APIError(400, '날짜를 확인해 주세요.')
        try:
            requested = date.fromisoformat(value)
        except ValueError:
            raise APIError(400, '날짜를 확인해 주세요.') from None
        ordinal = (requested - EPOCH).days
        offset = ordinal % len(self.server.seeds)
        seeds = self.server.seeds[offset:] + self.server.seeds[:offset]
        seed_ids = [quote['id'] for quote in seeds]
        bundled = set(seed_ids)
        seed_ids.extend(row['id'] for row in db.execute(
            'SELECT id FROM quotes WHERE user_id IS NULL ORDER BY id'
        ) if row['id'] not in bundled)
        if len(seed_ids) > len(seeds):
            catalog = [quote['id'] for quote in self.server.seeds] + seed_ids[len(seeds):]
            start = ordinal % len(catalog)
            seed_ids = catalog[start:] + catalog[:start]
        frozen = db.execute('SELECT ids FROM daily WHERE day=?', (value,)).fetchone()
        if not frozen and requested <= current:
            db.execute('BEGIN IMMEDIATE')
            frozen = db.execute('SELECT ids FROM daily WHERE day=?', (value,)).fetchone()
        if frozen:
            ids = json.loads(frozen['ids'])
        else:
            hidden = {row['id'] for row in db.execute(
                'SELECT id FROM quotes WHERE hidden=1 AND user_id IS NULL'
            )}
            visible_seeds = [quote_id for quote_id in seed_ids if quote_id not in hidden]
            community = db.execute(
                'SELECT id FROM quotes WHERE hidden=0 AND user_id IS NOT NULL AND day<?', (value,)
            ).fetchall()
            community_ids = sorted(
                (row['id'] for row in community),
                key=lambda item: hashlib.sha256(f'{value}:{item}'.encode()).digest(),
            )
            # An isolated community submission should not occupy consecutive primary slots.
            if community_ids and ordinal % 2:
                candidates = community_ids[:1] + visible_seeds + community_ids[1:]
            else:
                candidates = visible_seeds + community_ids
            ids = candidates[:3]
            if requested <= current:
                db.execute('INSERT INTO daily(day, ids) VALUES(?,?)', (value, json.dumps(ids)))
        quotes = []
        for quote_id in dict.fromkeys(ids + seed_ids):
            row = db.execute('SELECT * FROM quotes WHERE id=? AND hidden=0', (quote_id,)).fetchone()
            if row:
                quotes.append(self.public_quote(row))
                if len(quotes) == 3:
                    break
        return {'quotes': quotes}

    @staticmethod
    def submit_quote(db, user, body):
        text = normalized(body.get('text'), 48, '문장을 한 줄로 1~48자 입력해 주세요.', single_line=True)
        category = body.get('category')
        if not isinstance(category, str) or category not in CATEGORIES:
            raise APIError(400, '카테고리를 선택해 주세요.')
        quote_id = secrets.token_hex(12)
        try:
            db.execute(
                'INSERT INTO quotes(id,text,author,category,user_id,day) VALUES(?,?,?,?,?,?)',
                (quote_id, text, user['name'], category, user['id'], today().isoformat()),
            )
        except sqlite3.IntegrityError:
            raise APIError(409, '문장은 하루에 한 번 올릴 수 있어요.') from None
        return {'id': quote_id}

    @staticmethod
    def tally(db, table, key, target, user):
        row = db.execute(
            f'''SELECT COUNT(CASE WHEN value=1 THEN 1 END) AS up,
                       COUNT(CASE WHEN value=-1 THEN 1 END) AS down,
                       MAX(CASE WHEN user_id=? THEN value END) AS vote
                FROM {table} WHERE {key}=?''',
            (user['id'] if user else None, target),
        ).fetchone()
        return {'up': row['up'], 'down': row['down'], 'vote': row['vote'] or 0}

    def quote_detail(self, db, quote, user):
        detail = self.public_quote(quote)
        detail.update(self.tally(db, 'quote_votes', 'quote_id', quote['id'], user))
        rows = db.execute(
            '''SELECT c.id,c.text,u.name AS author,c.created_at AS createdAt
               FROM comments c JOIN users u ON u.id=c.user_id
               WHERE c.quote_id=? ORDER BY c.created_at,c.id''', (quote['id'],)
        )
        detail['comments'] = [
            dict(row) | self.tally(db, 'comment_votes', 'comment_id', row['id'], user)
            for row in rows
        ]
        return detail

    def interact(self, db, user, parts, body):
        kind, target, action = parts
        if kind == 'comments':
            if action != 'vote':
                raise APIError(404, '요청하신 주소를 찾을 수 없어요.')
            comment = db.execute('SELECT quote_id FROM comments WHERE id=?', (target,)).fetchone()
            if not comment:
                raise APIError(404, '댓글을 찾을 수 없어요.')
            self.quote(db, comment['quote_id'])
            return self.vote(db, 'comment_votes', 'comment_id', target, user, body)

        if action == 'hide':
            self.require_admin(user)
            if db.execute('UPDATE quotes SET hidden=1 WHERE id=?', (target,)).rowcount == 0:
                raise APIError(404, '문장을 찾을 수 없어요.')
            return {}
        self.quote(db, target)
        if action == 'vote':
            return self.vote(db, 'quote_votes', 'quote_id', target, user, body)
        if action == 'comments':
            text = normalized(body.get('text'), 400, '댓글을 1~400자로 입력해 주세요.')
            comment_id = secrets.token_hex(12)
            db.execute(
                'INSERT INTO comments VALUES(?,?,?,?,?)',
                (comment_id, target, user['id'], text, datetime.now(timezone.utc).isoformat()),
            )
            return {'id': comment_id}
        reason = normalized(body.get('reason'), 400, '신고 이유를 1~400자로 입력해 주세요.')
        db.execute(
            '''INSERT INTO reports(quote_id,user_id,reason) VALUES(?,?,?)
               ON CONFLICT(quote_id,user_id) DO UPDATE SET reason=excluded.reason, reviewed=0''',
            (target, user['id'], reason),
        )
        return {}

    def vote(self, db, table, key, target, user, body):
        value = body.get('value')
        if type(value) is not int or value not in {-1, 0, 1}:
            raise APIError(400, '반응을 확인해 주세요.')
        if value:
            db.execute(
                f'''INSERT INTO {table} VALUES(?,?,?)
                    ON CONFLICT({key},user_id) DO UPDATE SET value=excluded.value''',
                (target, user['id'], value),
            )
        else:
            db.execute(f'DELETE FROM {table} WHERE {key}=? AND user_id=?', (target, user['id']))
        return self.tally(db, table, key, target, user)

    def dashboard(self, db):
        day = today().isoformat()
        daily = self.daily(db, {})['quotes']
        members = [dict(row) for row in db.execute(
            'SELECT id,name,admin,suspended FROM users ORDER BY id DESC')]
        quotes = [self.public_quote(row) | self.tally(db, 'quote_votes', 'quote_id', row['id'], None)
                  | {'day': row['day'], 'hidden': bool(row['hidden']), 'seed': row['user_id'] is None}
                  for row in db.execute('SELECT * FROM quotes ORDER BY day DESC,id')]
        reports = [dict(row) for row in db.execute(
            """SELECT r.quote_id,r.user_id,r.reason,r.reviewed,u.name AS reporter,q.text,q.hidden
               FROM reports r JOIN users u ON r.user_id=u.id JOIN quotes q ON r.quote_id=q.id
               ORDER BY r.reviewed,q.day DESC,r.quote_id,r.user_id""")]
        metrics = {'회원': len(members), '오늘 제출': sum(q['day'] == day for q in quotes),
                   '전체 댓글': db.execute('SELECT COUNT(*) FROM comments').fetchone()[0],
                   '전체 반응': db.execute('SELECT (SELECT COUNT(*) FROM quote_votes)+(SELECT COUNT(*) FROM comment_votes)').fetchone()[0],
                   '미처리 신고': sum(not r['reviewed'] and not r['hidden'] for r in reports)}
        return {'day': day, 'daily': daily, 'members': members, 'quotes': quotes, 'reports': reports,
                'metrics': metrics, 'queue': self.admin_quotes(db)['quotes']}

    def manage(self, db, user, body):
        action = body.get('action')
        target = body.get('id')
        if action == 'member':
            if type(target) is not int or type(body.get('suspended')) is not bool:
                raise APIError(400, '회원과 상태를 확인해 주세요.')
            changed = db.execute('UPDATE users SET suspended=? WHERE id=? AND admin=0',
                                 (body['suspended'], target)).rowcount
            if not changed:
                raise APIError(400, '이 회원의 상태를 변경할 수 없어요.')
            if body['suspended']:
                db.execute('DELETE FROM sessions WHERE user_id=?', (target,))
        elif action == 'visibility' and isinstance(target, str) and type(body.get('hidden')) is bool:
            db.execute('UPDATE quotes SET hidden=? WHERE id=?', (body['hidden'], target))
        elif action == 'review' and isinstance(target, str) and type(body.get('reporter')) is int:
            db.execute('UPDATE reports SET reviewed=1 WHERE quote_id=? AND user_id=?', (target, body['reporter']))
        elif action == 'seed':
            text = normalized(body.get('text'), 48, '문장을 1~48자로 입력해 주세요.', single_line=True)
            author = normalized(body.get('author'), 48, '출처를 입력해 주세요.', single_line=True)
            category = body.get('category')
            if not isinstance(category, str) or category not in CATEGORIES:
                raise APIError(400, '분류를 선택해 주세요.')
            if target is None:
                db.execute('INSERT INTO quotes(id,text,author,category) VALUES(?,?,?,?)',
                           ('seed-' + secrets.token_hex(12), text, author, category))
            elif isinstance(target, str):
                if not db.execute('UPDATE quotes SET text=?,author=?,category=? WHERE id=? AND user_id IS NULL',
                                  (text, author, category, target)).rowcount:
                    raise APIError(404, '기본 문장을 찾을 수 없어요.')
            else:
                raise APIError(400, '문장 ID를 확인해 주세요.')
        else:
            raise APIError(400, '관리 작업을 확인해 주세요.')
        return {}

    def admin_quotes(self, db):
        rows = db.execute(
            '''WITH votes AS (
                   SELECT quote_id, COUNT(CASE WHEN value=1 THEN 1 END) AS up,
                          COUNT(CASE WHEN value=-1 THEN 1 END) AS down
                   FROM quote_votes GROUP BY quote_id
               ), review AS (
                   SELECT q.*, COALESCE(votes.up, 0) AS up, COALESCE(votes.down, 0) AS down,
                          (SELECT COUNT(*) FROM reports r WHERE r.quote_id=q.id AND r.reviewed=0) AS reports
                   FROM quotes q LEFT JOIN votes ON votes.quote_id=q.id
                   WHERE q.hidden=0
               )
               SELECT * FROM review
               WHERE reports>0 OR (down>=3 AND down>=2*up AND down-up>=3)
               ORDER BY (reports>0) DESC, reports DESC, (down-up) DESC, day DESC, id'''
        )
        quotes = []
        for row in rows:
            reasons = db.execute('SELECT reason FROM reports WHERE quote_id=? AND reviewed=0 ORDER BY user_id', (row['id'],))
            quotes.append(
                self.public_quote(row) | {'up': row['up'], 'down': row['down'], 'vote': 0}
                | {'reports': row['reports'], 'reportReasons': [report['reason'] for report in reasons],
                   'hidden': False}
            )
        return {'quotes': quotes}


def main():
    parser = argparse.ArgumentParser(description='Run the Haru community server.')
    parser.add_argument('--grant-admin', metavar='NAME', help='grant admin access to an existing account and exit')
    args = parser.parse_args()
    database = Path(os.environ.get('HARU_DB', Path(__file__).with_name('haru.sqlite3')))
    if args.grant_admin:
        if not database.is_file():
            parser.error('Start the server and register the account first.')
        name = unicodedata.normalize('NFC', args.grant_admin).strip()
        with closing(connect(database)) as db, db:
            if db.execute('UPDATE users SET admin=1 WHERE name=?', (name,)).rowcount != 1:
                parser.error('Account not found.')
        print(f'Administrator access granted to {name}.')
        return

    host = os.environ.get('HARU_HOST', '127.0.0.1')
    port = int(os.environ.get('HARU_PORT', '8000'))
    secure = os.environ.get('HARU_SECURE_COOKIE', '0') == '1'
    with CommunityServer((host, port), database, ROOT / 'shared/seeds.json', ROOT / 'web', secure) as server:
        print(f'Haru is listening at http://{host}:{server.server_port}', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
