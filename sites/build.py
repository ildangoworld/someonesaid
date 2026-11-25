"""Assemble the Sites Worker and its bundled static assets."""
from base64 import b64encode
import json
import mimetypes
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
out = root / 'dist' / 'server'
out.mkdir(parents=True, exist_ok=True)
assets = {}
for path in sorted((root / 'web').rglob('*')):
    if not path.is_file():
        continue
    key = '/' + path.relative_to(root / 'web').as_posix()
    kind = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    binary = path.suffix not in ('.html', '.js', '.css', '.svg')
    body = b64encode(path.read_bytes()).decode() if binary else path.read_text()
    assets[key] = [kind if binary else kind + '; charset=utf-8', body, binary]
seeds = json.loads((root / 'shared' / 'seeds.json').read_text())
worker = (root / 'sites' / 'worker.mjs').read_text().split('\n', 1)[1]
(out / 'index.js').write_text(
    'const assets=' + json.dumps(assets, ensure_ascii=False) + ';\n' +
    'const seeds=' + json.dumps(seeds, ensure_ascii=False) + ';\n' + worker)
shutil.copytree(root / 'sites' / 'migrations', out / 'migrations', dirs_exist_ok=True)

(out / 'wrangler.json').write_text(json.dumps({
    'name': 'someonesaid', 'main': 'index.js', 'compatibility_date': '2025-04-01',
    'd1_databases': [{'binding': 'DB', 'database_name': 'someonesaid',
                      'database_id': '00000000-0000-0000-0000-000000000000',
                      'migrations_dir': 'drizzle'}],
}))
shutil.copytree(root / 'sites' / 'migrations', out / 'drizzle', dirs_exist_ok=True)
shutil.copytree(root / 'sites' / 'migrations', root / 'dist' / 'drizzle', dirs_exist_ok=True)
