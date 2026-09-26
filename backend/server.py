#!/usr/bin/env python3
"""Local-only application server. No runtime dependency installation or CDN."""
import argparse
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import threading
import time
import uuid
import webbrowser
from contextlib import contextmanager, closing
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
if sys.version_info < (3, 10):
    sys.exit('请使用 Python 3.10 或更高版本运行本项目。')
sys.path.insert(0, str(ROOT / 'vendor'))
sys.path.insert(0, str(ROOT / 'backend'))
from core import read_excel, describe_sheets, parse_sheet, validate_plan, compute

# 规划页（根目录 index.html）由参考单页应用改造而来，页面上的目标数字与课程数据
# 都在这里按方案换算后注入，前端不再自带任何业务数据。
PLANNER_PAGE = ROOT / 'index.html'
DATA_TTL = 1800  # Unfinished imports and handoffs expire within 30 minutes.
PUBLIC_CATEGORY = re.compile(r'^公共基础课$')
DEFAULT_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
               "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
               "base-uri 'none'; form-action 'self'")


def round2(value):
    return round(float(value) + 0.0, 2)


def plan_view(plan):
    """接口适配：把方案换算成规划页需要的数据结构。

    只做字段改名并保留明确填写的目标（空目标仍为空），不参与课程有效性、必修固定与学分统计等业务计算；
    课程顺序、学分、学期、必修/选修均原样来自后端已保存的方案。
    """
    goals = plan.get('goals') or {}
    category_goals = goals.get('categories') or {}
    courses = []
    for course in plan['courses']:
        category = course['category']
        courses.append(dict(
            id=course['id'],
            name=course['name'],
            cat='public' if PUBLIC_CATEGORY.search(category) else 'major',
            type=course['type'],
            attr=category,
            credit=float(course['credits']),
            term=','.join(str(t) for t in course['terms']),
        ))

    public_courses = [c for c in courses if c['cat'] == 'public']
    major_required = [c for c in courses if c['cat'] == 'major' and c['type'] == '必修']
    return dict(
        name=plan['name'], courses=courses,
        goal=dict(
            total=goals.get('total'), elective=goals.get('elective'),
            public=dict(title='公共基础课', target=category_goals.get('公共基础课'),
                        courseCount=sum(c['type'] == '必修' for c in public_courses)),
            major=dict(title='专业课', target=category_goals.get('专业课'),
                       reqCount=len(major_required),
                       reqCredits=round2(sum(c['credit'] for c in major_required))),
        ),
    )


def render_planner(plan):
    """把方案数据注入根目录 index.html，并用 nonce 放行页内脚本。"""
    html = PLANNER_PAGE.read_text(encoding='utf-8')
    nonce = secrets.token_urlsafe(16)
    data = json.dumps(plan_view(plan), ensure_ascii=False, allow_nan=False).replace('<', '\\u003c')
    injected = f'<script id="course-data" nonce="{nonce}">window.__ENOUGH_POINTS__={data};</script>'
    if '<script>' in html:
        html = html.replace('<script>', f'{injected}<script nonce="{nonce}">', 1)
        script_src = f"'self' 'nonce-{nonce}'"
    else:
        html = html.replace('</head>', f'{injected}</head>', 1)
        script_src = "'self' 'unsafe-inline'"
    csp = ("default-src 'self'; script-src " + script_src + "; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    return html.encode('utf-8'), csp


class App:
    def __init__(self, database):
        # Legacy versions stored customer courses on disk. Retire that table on upgrade.
        self.database = Path(database)
        if self.database.exists():
            with closing(sqlite3.connect(self.database)) as legacy:
                with legacy:
                    legacy.execute('PRAGMA secure_delete=ON')
                    if legacy.execute("SELECT 1 FROM sqlite_master WHERE name='plans' AND type='table'").fetchone():
                        legacy.execute('DELETE FROM plans')
                legacy.execute('VACUUM')
                legacy.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.lock = threading.RLock()
        self._db = sqlite3.connect(':memory:', check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute('PRAGMA temp_store=MEMORY')
        self._db.execute('PRAGMA secure_delete=ON')
        self._db.execute('CREATE TABLE plans (id TEXT PRIMARY KEY, version INTEGER NOT NULL, created REAL NOT NULL, updated REAL NOT NULL, body TEXT NOT NULL, owner TEXT NOT NULL)')
        self.imports = {}
        self._stop = threading.Event()
        self._janitor = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._janitor.start()

    @contextmanager
    def connect(self):
        with self.lock, self._db:
            yield self._db

    def cleanup(self):
        with self.lock:
            cutoff = time.time() - DATA_TTL
            self.imports = {k: v for k, v in self.imports.items() if v['time'] > cutoff}
            with self.connect() as db:
                db.execute('DELETE FROM plans WHERE created<=?', (cutoff,))

    def _cleanup_loop(self):
        while not self._stop.wait(30):
            self.cleanup()

    def close(self):
        self._stop.set()
        self._janitor.join()
        with self.lock:
            self.imports.clear()
            self._db.close()

    def pack(self, row):
        if row is None:
            raise LookupError('方案不存在或已删除')
        data = json.loads(row['body'])
        return dict(data, id=row['id'], version=row['version'], created=row['created'], updated=row['updated'], stats=compute(data))

    def import_file(self, data, filename, owner):
        sheets = read_excel(data, filename)
        token = str(uuid.uuid4())
        with self.lock:
            now = time.time()
            self.cleanup()
            owned = [k for k, v in self.imports.items() if v['owner'] == owner]
            for k in owned:
                del self.imports[k]
            if len(self.imports) >= 50:
                raise ValueError('当前导入较多，请稍后重试')
            self.imports[token] = dict(time=now, sheets=sheets, owner=owner)
        return dict(importId=token, filename=filename, sheets=describe_sheets(sheets))


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'EnoughPoints/1.0'

        def log_message(self, fmt, *args):
            # Do not log filenames, query strings, course contents or credentials.
            pass

        def send(self, status, data, content_type='application/json; charset=utf-8', csp=None):
            if not isinstance(data, bytes):
                data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            if getattr(self, 'new_session', False):
                self.send_header('Set-Cookie', f'ep_session={self.owner}; HttpOnly; SameSite=Strict; Path=/')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', csp or DEFAULT_CSP)
            self.end_headers()
            self.wfile.write(data)

        def redirect(self, location):
            self.send_response(302)
            self.send_header('Location', location)
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            if getattr(self, 'new_session', False):
                self.send_header('Set-Cookie', f'ep_session={self.owner}; HttpOnly; SameSite=Strict; Path=/')
            self.end_headers()

        def read_body(self, limit):
            if self.headers.get('Transfer-Encoding'):
                raise ValueError('不支持分块请求')
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= limit:
                raise ValueError(f'请求大小无效或超过 {limit // 1024 // 1024} MB')
            self.connection.settimeout(30)
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError('上传内容不完整')
            return data

        def route(self):
            port = self.server.server_port
            hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
            if self.headers.get('Host') not in hosts:
                return self.send(403, dict(error='仅允许本机访问'))
            if self.command != 'GET':
                origin = self.headers.get('Origin')
                if self.headers.get('X-EnoughPoints') != '1' or (origin and origin not in {f'http://{h}' for h in hosts}):
                    return self.send(403, dict(error='请从本应用页面操作'))
            cookies = SimpleCookie()
            cookies.load(self.headers.get('Cookie', ''))
            session = cookies.get('ep_session')
            self.new_session = not (session and re.fullmatch(r'[A-Za-z0-9_-]{43}', session.value))
            self.owner = secrets.token_urlsafe(32) if self.new_session else session.value
            app.cleanup()
            parts = urlsplit(self.path)
            path = parts.path
            method = self.command
            if method == 'GET' and not path.startswith('/api/'):
                # 规划页：导入窗口确认后进入，课程与目标由后端按方案注入
                if path == '/planner':
                    pid = parse_qs(parts.query).get('id', [''])[0]
                    with app.connect() as db:
                        row = db.execute('SELECT * FROM plans WHERE id=? AND owner=?', (pid, self.owner)).fetchone() if pid else None
                        if row is None or not PLANNER_PAGE.exists():
                            return self.redirect('/')
                        body, csp = render_planner(app.pack(row))
                        db.execute('DELETE FROM plans WHERE id=? AND owner=?', (pid, self.owner))
                    return self.send(200, body, 'text/html; charset=utf-8', csp=csp)
                routes = {'/': ROOT/'frontend/index.html', '/app.js': ROOT/'frontend/app.js', '/style.css': ROOT/'frontend/style.css', '/sample.xlsx': ROOT/'samples/原始课程表.xlsx'}
                file = routes.get(path)
                if not file or not file.exists():
                    return self.send(404, dict(error='页面不存在'))
                return self.send(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
            if path == '/api/import' and method == 'POST':
                filename = Path(parse_qs(parts.query).get('filename', [''])[0]).name
                return self.send(200, app.import_file(self.read_body(10*1024*1024), filename, self.owner))
            if path.startswith('/api/imports/') and method == 'DELETE':
                with app.lock:
                    token = path.removeprefix('/api/imports/')
                    if app.imports.get(token, {}).get('owner') == self.owner:
                        del app.imports[token]
                return self.send(200, dict(ok=True))
            payload = {}
            if method in ('POST', 'PUT'):
                try:
                    payload = json.loads(self.read_body(4*1024*1024), parse_constant=lambda v: (_ for _ in ()).throw(ValueError('非法数字')))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    raise ValueError('请求不是有效 JSON')
                if not isinstance(payload, dict):
                    raise ValueError('请求格式无效')
            if path == '/api/parse' and method == 'POST':
                token = payload.get('importId')
                with app.lock:
                    imported = app.imports.get(token)
                if not imported or imported['owner'] != self.owner or time.time()-imported['time'] >= DATA_TTL:
                    raise ValueError('导入已过期，请重新上传文件')
                sheet = next((s for s in imported['sheets'] if s['name'] == payload.get('sheet')), None)
                if sheet is None:
                    raise ValueError('工作表不存在')
                if not isinstance(payload.get('mapping'), dict):
                    raise ValueError('请提供字段映射')
                result = parse_sheet(sheet, payload.get('header'), payload['mapping'])
                with app.lock:
                    app.imports.pop(token, None)
                return self.send(200, result)
            if path == '/api/validate' and method == 'POST':
                plan, issues = validate_plan(payload)
                return self.send(200, dict(plan=plan, issues=issues))
            if path == '/api/plans' and method == 'GET':
                with app.connect() as db:
                    rows = db.execute('SELECT * FROM plans WHERE owner=? ORDER BY updated DESC', (self.owner,)).fetchall()
                return self.send(200, [dict(id=r['id'], name=json.loads(r['body'])['name'], updated=r['updated'], courseCount=len(json.loads(r['body'])['courses'])) for r in rows])
            if path == '/api/plans' and method == 'POST':
                plan, issues = validate_plan(payload)
                if any(i['level'] == 'error' for i in issues):
                    return self.send(422, dict(error='请修正课程错误后再保存', issues=issues))
                pid, now = str(uuid.uuid4()), time.time()
                with app.connect() as db:
                    db.execute('INSERT INTO plans VALUES (?, ?, ?, ?, ?, ?)', (pid, 1, now, now, json.dumps(plan, ensure_ascii=False), self.owner))
                    row = db.execute('SELECT * FROM plans WHERE id=? AND owner=?', (pid, self.owner)).fetchone()
                return self.send(201, app.pack(row))
            if path.startswith('/api/plans/'):
                pid = path.removeprefix('/api/plans/')
                if method == 'GET':
                    with app.connect() as db:
                        row = db.execute('SELECT * FROM plans WHERE id=? AND owner=?', (pid, self.owner)).fetchone()
                    return self.send(200, app.pack(row))
                if method == 'PUT':
                    plan, issues = validate_plan(payload)
                    if any(i['level'] == 'error' for i in issues):
                        return self.send(422, dict(error='请修正课程错误后再保存', issues=issues))
                    with app.connect() as db:
                        result = db.execute('UPDATE plans SET version=version+1, updated=?, body=? WHERE id=? AND version=? AND owner=?', (time.time(), json.dumps(plan, ensure_ascii=False), pid, payload.get('version'), self.owner))
                        if result.rowcount != 1:
                            return self.send(409, dict(error='方案已在其他页面更新或删除，请刷新后重试'))
                        row = db.execute('SELECT * FROM plans WHERE id=? AND owner=?', (pid, self.owner)).fetchone()
                    return self.send(200, app.pack(row))
                if method == 'DELETE':
                    with app.connect() as db:
                        db.execute('DELETE FROM plans WHERE id=? AND owner=?', (pid, self.owner))
                    return self.send(200, dict(ok=True))
            return self.send(404, dict(error='接口不存在'))

        def handle_request(self):
            try:
                self.route()
            except (ValueError, TypeError, KeyError, IndexError) as exc:
                self.send(400, dict(error=str(exc) if isinstance(exc, ValueError) else '请求字段格式无效'))
            except LookupError as exc:
                self.send(404, dict(error=str(exc)))
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.send(500, dict(error='本地服务处理失败，请检查数据或重启服务'))

        do_GET = do_POST = do_PUT = do_DELETE = handle_request
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--database', default=str(ROOT/'data/plans.sqlite3'))
    args = parser.parse_args()
    app = App(args.database)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(app))
    except OSError:
        sys.exit('端口被占用：请关闭其他 EnoughPoints 窗口，或添加 --port 8766 启动。')
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'EnoughPoints 已启动：{url}\n按 Ctrl+C 停止服务。', flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务已停止。')
    finally:
        server.server_close()
        app.close()


if __name__ == '__main__':
    main()
