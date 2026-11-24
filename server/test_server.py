from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import date, timedelta
from http.client import HTTPConnection
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch

from server import CommunityServer, connect


class CommunityTest(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name)
        self.database = path / 'test.sqlite3'
        self.day = date(2026, 11, 25)
        clock = patch('server.today', side_effect=lambda: self.day)
        clock.start()
        self.addCleanup(clock.stop)
        self.seeds = [
            {'id': f'seed-{i}', 'text': f'문장 {i}', 'author': '하루', 'category': '위로'}
            for i in range(4)
        ]
        seed_path = path / 'seeds.json'
        seed_path.write_text(json.dumps(self.seeds), encoding='utf-8')
        web = path / 'web'
        web.mkdir()
        (web / 'index.html').write_text('<main>하루</main>', encoding='utf-8')
        self.server = CommunityServer(('127.0.0.1', 0), self.database, seed_path, web)
        thread = Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, data=None, cookie=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        try:
            connection.request(method, path, json.dumps(data) if data is not None else None, headers)
            response = connection.getresponse()
            raw = response.read().decode('utf-8')
            body = json.loads(raw) if response.getheader('Content-Type').startswith('application/json') else raw
            return response.status, body, response.getheader('Set-Cookie')
        finally:
            connection.close()

    def signup(self, name):
        status, body, cookie = self.request('POST', '/api/signup', {'name': name, 'password': 'password123', 'admin': True})
        self.assertEqual(status, 200)
        self.assertEqual(body, {'user': {'name': name, 'admin': False}})
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        return cookie.split(';')[0]

    def test_member_history_and_admin_dashboard(self):
        reader = self.signup('작성자')
        operator = self.signup('운영자')
        with closing(connect(self.database)) as db, db:
            db.execute("UPDATE users SET admin=1 WHERE name='운영자'")
        quote = self.request('POST', '/api/quotes', {'text': '차분하게 한 걸음', 'category': '용기'}, reader)[1]['id']
        detail = f'/api/quotes/{quote}'
        self.request('POST', detail + '/comments', {'text': '좋은 문장'}, operator)
        self.request('POST', detail + '/vote', {'value': 1}, operator)
        self.request('POST', detail + '/report', {'reason': '확인 요청'}, operator)
        self.assertEqual(self.request('GET', '/api/me/submissions')[0], 401)
        self.assertEqual(self.request('GET', '/api/me/submissions', cookie=operator)[1]['quotes'], [])
        self.assertEqual(self.request('GET', '/api/admin/dashboard', cookie=reader)[0], 403)
        status, dashboard, _ = self.request('GET', '/api/admin/dashboard', cookie=operator)
        self.assertEqual(status, 200)
        self.assertEqual(dashboard['daily'], self.request('GET', '/api/daily', cookie=reader)[1]['quotes'])
        self.assertEqual(dashboard['metrics']['오늘 제출'], 1)
        self.assertEqual(dashboard['metrics']['전체 댓글'], 1)
        member = next(member for member in dashboard['members'] if member['name'] == '작성자')
        report = dashboard['reports'][0]
        def manage(body):
            self.assertEqual(self.request('POST', '/api/admin/manage', body, operator)[0], 200)
        manage({'action': 'review', 'id': quote, 'reporter': report['user_id']})
        self.assertEqual(self.request('GET', '/api/admin', cookie=operator)[1]['quotes'], [])
        manage({'action': 'visibility', 'id': quote, 'hidden': True})
        self.assertEqual(self.request('GET', detail)[0], 404)
        history = self.request('GET', '/api/me/submissions', cookie=reader)[1]['quotes'][0]
        self.assertTrue(history['hidden'])
        self.assertEqual(history['up'], 1)
        self.assertEqual(history['comments'][0]['text'], '좋은 문장')
        manage({'action': 'member', 'id': member['id'], 'suspended': True})
        self.assertEqual(self.request('GET', '/api/me', cookie=reader)[1], {'user': None})
        self.assertEqual(self.request('POST', '/api/login', {'name': '작성자', 'password': 'password123'})[0], 401)
        manage({'action': 'member', 'id': member['id'], 'suspended': False})
        self.assertEqual(self.request('POST', '/api/login', {'name': '작성자', 'password': 'password123'})[0], 200)
        seed = {'action': 'seed', 'text': '새 기본 문장', 'author': '편집부', 'category': '확언'}
        manage(seed)
        added = next(q for q in self.request('GET', '/seeds.json')[1] if q['text'] == seed['text'])
        manage(seed | {'id': added['id'], 'text': '수정한 문장'})
        self.assertEqual(self.request('GET', '/api/quotes/' + added['id'])[1]['text'], '수정한 문장')
        manage({'action': 'visibility', 'id': added['id'], 'hidden': True})
        self.assertNotIn(added['id'], {q['id'] for q in self.request('GET', '/seeds.json')[1]})

    def test_static_and_seed_daily(self):
        self.assertEqual(self.request('GET', '/q/seed-0')[1], '<main>하루</main>')
        self.assertEqual(self.request('GET', '/seeds.json')[1], self.seeds)
        offset = (self.day - date(1970, 1, 1)).days % len(self.seeds)
        self.assertEqual(self.request('GET', '/api/daily')[1]['quotes'][0], self.seeds[offset])
        self.assertEqual(self.request('GET', '/api/daily?date=2026-02-30')[0], 400)
        self.assertEqual(self.request('GET', '/api/daily?date=2026-2-02')[0], 400)

    def test_daily_freeze_and_submission_cap(self):
        cookie = self.signup('독자')
        initial = self.request('GET', '/api/daily')[1]
        self.assertEqual(self.request('POST', '/api/quotes', {'text': 'a' * 49, 'category': '용기'}, cookie)[0], 400)
        self.assertEqual(self.request('POST', '/api/quotes', {'text': 'a\n', 'category': '용기'}, cookie)[0], 400)
        payload = {'text': 'e\u0301' * 48, 'category': '용기'}
        with ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda _: self.request('POST', '/api/quotes', payload, cookie), range(2)))
        self.assertEqual(sorted(response[0] for response in responses), [200, 409])
        quote_id = next(response[1]['id'] for response in responses if response[0] == 200)
        self.assertEqual(self.request('GET', '/api/daily')[1], initial)
        self.day += timedelta(days=1)
        daily = self.request('GET', '/api/daily')[1]['quotes']
        self.assertEqual(len(daily), 3)
        self.assertEqual(daily[0]['id'], quote_id)
        self.assertEqual(daily[0]['text'], 'é' * 48)

    def test_community_primary_alternates_with_seed_primary(self):
        cookie = self.signup('작성자')
        submission = {'text': '오늘 하루', 'category': '위로'}
        quote_id = self.request('POST', '/api/quotes', submission, cookie)[1]['id']
        self.day += timedelta(days=1)
        primaries = []
        first_day = self.day
        first_result = self.request('GET', '/api/daily')[1]
        for _ in range(7):
            daily = self.request('GET', '/api/daily')[1]['quotes']
            self.assertEqual(len({quote['id'] for quote in daily}), 3)
            self.assertTrue(all(quote['id'].startswith('seed-') for quote in daily[1:]))
            primaries.append(daily[0]['id'])
            self.day += timedelta(days=1)
        self.assertTrue(all(a != b for a, b in zip(primaries, primaries[1:])))
        self.assertIn(quote_id, primaries)
        self.assertTrue(any(primary.startswith('seed-') for primary in primaries))
        self.assertEqual(self.request('GET', f'/api/daily?date={first_day}')[1], first_result)

    def test_hidden_seeds_never_return_in_daily_or_seed_feed(self):
        cookie = self.signup('관리자')
        with closing(connect(self.database)) as db, db:
            db.execute('UPDATE users SET admin=1')
        self.assertEqual(len(self.request('GET', '/api/daily')[1]['quotes']), 3)
        for remaining, seed in zip(reversed(range(4)), self.seeds):
            self.assertEqual(self.request('POST', f"/api/quotes/{seed['id']}/hide", cookie=cookie)[0], 200)
            for path in ('/api/daily', '/seeds.json'):
                status, data, _ = self.request('GET', path)
                self.assertEqual(status, 200)
                quotes = data['quotes'] if isinstance(data, dict) else data
                self.assertEqual(len(quotes), remaining)
                self.assertTrue(all(quote['id'] != seed['id'] for quote in quotes))

    def test_account_engagement_and_moderation(self):
        first = self.signup('작성자')
        second = self.signup('독자')
        payload = {'text': '오늘 하루', 'category': '위로'}
        self.assertEqual(self.request('POST', '/api/quotes', payload)[0], 401)
        quote_id = self.request('POST', '/api/quotes', payload, first)[1]['id']
        quote = f'/api/quotes/{quote_id}'
        self.assertEqual(self.request('POST', quote + '/vote', {'value': True}, second)[0], 400)
        for value in (1, -1, 0, 1, 1):
            self.assertEqual(self.request('POST', quote + '/vote', {'value': value}, second)[1],
                             {'up': int(value == 1), 'down': int(value == -1), 'vote': value})
        comment_id = self.request('POST', quote + '/comments', {'text': '고마워요'}, second)[1]['id']
        self.request('POST', f'/api/comments/{comment_id}/vote', {'value': 1}, first)
        detail = self.request('GET', quote, cookie=first)[1]
        self.assertEqual(detail['comments'][0]['vote'], 1)
        self.assertEqual(detail['up'], 1)
        self.assertEqual(detail['vote'], 0)
        self.assertEqual(self.request('POST', quote + '/hide', cookie=second)[0], 403)
        self.assertEqual(self.request('GET', '/api/admin', cookie=second)[0], 403)
        for reason in ('이유', '추가 이유'):
            self.assertEqual(self.request('POST', quote + '/report', {'reason': reason}, second)[0], 200)
        with closing(connect(self.database)) as db, db:
            db.execute('UPDATE users SET admin=1 WHERE name=?', ('독자',))
        reviewed = self.request('GET', '/api/admin', cookie=second)[1]['quotes'][0]
        self.assertEqual(reviewed['reports'], 1)
        self.assertEqual(reviewed['reportReasons'], ['추가 이유'])
        self.day += timedelta(days=1)
        featured = self.request('GET', '/api/daily')[1]['quotes']
        self.assertEqual(featured[0]['id'], quote_id)
        self.assertEqual(self.request('POST', quote + '/hide', cookie=second)[0], 200)
        self.assertEqual(self.request('GET', quote)[0], 404)
        self.assertEqual(self.request('GET', '/api/admin', cookie=second)[1], {'quotes': []})
        fallback = self.request('GET', '/api/daily')[1]['quotes']
        self.assertEqual(len(fallback), 3)
        self.assertTrue(all(item['id'] != quote_id for item in fallback))
        self.assertEqual(self.request('POST', f'/api/comments/{comment_id}/vote', {'value': 1}, second)[0], 404)
        self.assertEqual(self.request('DELETE', '/api/me', {'password': 'wrong'}, first)[0], 403)
        self.assertEqual(self.request('DELETE', '/api/me', {'password': 'password123'}, first)[0], 200)
        self.assertEqual(self.request('GET', '/api/me', cookie=first)[1], {'user': None})
        self.assertEqual(self.request('GET', '/api/admin', cookie=second)[1], {'quotes': []})

    def test_admin_queue_reports_and_dislike_threshold(self):
        admin = self.signup('관리자')
        readers = [self.signup(f'독자{i}') for i in range(4)]
        with closing(connect(self.database)) as db, db:
            db.execute('UPDATE users SET admin=1 WHERE name=?', ('관리자',))
        payload = {'text': '오늘 하루', 'category': '위로'}
        quote_id = self.request('POST', '/api/quotes', payload, readers[0])[1]['id']

        def queue_ids():
            return [quote['id'] for quote in self.request('GET', '/api/admin', cookie=admin)[1]['quotes']]

        def vote(cookie, value):
            self.assertEqual(self.request('POST', '/api/quotes/seed-0/vote', {'value': value}, cookie)[0], 200)

        self.assertEqual(queue_ids(), [])
        for reader in readers[:2]:
            vote(reader, -1)
        self.assertEqual(queue_ids(), [])
        vote(readers[2], -1)
        self.assertEqual(queue_ids(), ['seed-0'])
        vote(readers[3], 1)
        self.assertEqual(queue_ids(), [])
        vote(admin, -1)
        self.assertEqual(queue_ids(), ['seed-0'])
        self.assertEqual(
            self.request('POST', f'/api/quotes/{quote_id}/report', {'reason': '확인 요청'}, readers[1])[0], 200
        )
        self.assertEqual(queue_ids(), [quote_id, 'seed-0'])
        vote(admin, 0)
        self.assertEqual(queue_ids(), [quote_id])

    def test_login_and_logout(self):
        first = self.signup('독자')
        self.assertEqual(self.request('GET', '/api/me', cookie=first)[1]['user']['name'], '독자')
        self.assertEqual(self.request('POST', '/api/login', {'name': '독자', 'password': 'wrong'}, first)[0], 401)
        status, _, cookie = self.request('POST', '/api/login', {'name': '독자', 'password': 'password123'}, first)
        self.assertEqual(status, 200)
        self.assertEqual(self.request('GET', '/api/me', cookie=first)[1], {'user': None})
        second = cookie.split(';')[0]
        self.assertEqual(self.request('POST', '/api/logout', cookie=second)[0], 200)
        self.assertEqual(self.request('GET', '/api/me', cookie=second)[1], {'user': None})


if __name__ == '__main__':
    unittest.main()
