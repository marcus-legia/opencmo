"""Turns the canvas frames (.dc.html) into plain HTML files a browser opens without the design runtime.

Holes ({{a.b}}), <sc-for> and <sc-if> are expanded with each frame's renderVals() at its initial state
(vals.json from vals.js); event handlers are dropped, links between frames point at the static copies.
"""
import html, json, re, sys
from pathlib import Path

src_dir, out_dir, vals_file = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
VALS = json.loads(vals_file.read_text())
canvas = json.loads((src_dir / 'canvas.json').read_text())

def lookup(path, scope):
    path = path.strip()
    if path in ('true', 'false'):
        return path == 'true'
    cur = scope
    for part in path.split('.'):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur

def text(v):
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)

def fill(s, scope):
    # Handler attributes have no meaning in a static page.
    s = re.sub(r'\s+on[A-Z]\w*="\{\{[^}]*\}\}"', '', s)
    s = re.sub(r'\s+hint-[\w-]+="[^"]*"', '', s)
    return re.sub(r'\{\{\s*([^}]+?)\s*\}\}', lambda m: html.escape(text(lookup(m.group(1), scope)), quote=True), s)

TAG = re.compile(r'<(/?)(sc-for|sc-if)\b([^>]*)>')

def expand(s, scope):
    out, i = [], 0
    while True:
        m = TAG.search(s, i)
        if not m:
            out.append(fill(s[i:], scope)); break
        out.append(fill(s[i:m.start()], scope))
        name, attrs = m.group(2), m.group(3)
        depth, j = 1, m.end()
        while depth:
            n = TAG.search(s, j)
            if n.group(2) == name:
                depth += -1 if n.group(1) else 1
            j = n.end()
        inner = s[m.end():n.start()]
        attr = dict(re.findall(r'([\w-]+)="([^"]*)"', attrs))
        if name == 'sc-if':
            if lookup(re.sub(r'[{}\s]', '', attr.get('value', '')), scope):
                out.append(expand(inner, scope))
        else:
            items = lookup(re.sub(r'[{}\s]', '', attr.get('list', '')), scope) or []
            alias = attr.get('as', 'item')
            for k, item in enumerate(items):
                out.append(expand(inner, {**scope, alias: item, '$index': k}))
        i = j
    return ''.join(out)

titles = {k: v.get('title', k) for k, v in canvas['boards'].items()}
out_dir.mkdir(parents=True, exist_ok=True)
for name in canvas['order']:
    raw = (src_dir / name).read_text()
    title = re.search(r'<title>(.*?)</title>', raw).group(1)
    helmet = re.search(r'<helmet>([\s\S]*?)</helmet>', raw).group(1).strip()
    body = re.search(r'<x-dc>([\s\S]*?)</x-dc>', raw).group(1)
    body = re.sub(r'<helmet>[\s\S]*?</helmet>', '', body).strip()
    body = expand(body, VALS.get(name, {}))
    body = re.sub(r'href="([A-Za-z0-9_-]+)\.dc\.html', r'href="\1.html', body)
    page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · OpenCMO redesign</title>
<!-- Static export of {name} from the design canvas, initial state only. Source of truth: the canvas and the .dc.html file. -->
{helmet}
</head>
<body>
{body}
</body>
</html>
'''
    (out_dir / name.replace('.dc.html', '.html')).write_text(page)
    leftover = re.findall(r'\{\{[^}]*\}\}|<sc-|<x-dc|<helmet', page)
    print(name, 'leftover:', leftover[:3])

rows = '\n'.join(
    f'<li><a href="{n.replace(".dc.html", ".html")}">{html.escape(titles[n])}</a>'
    f'<span>{canvas["boards"][n]["w"]} × {canvas["boards"][n]["h"]}</span></li>' for n in canvas['order'])
(out_dir / 'index.html').write_text(f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenCMO redesign frames</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Source+Code+Pro:wght@500&amp;display=swap">
<style>
body{{margin:0;background:#f3f3ee;color:#2b2723;font:14px/1.5 Inter,system-ui,sans-serif}}
main{{max-width:760px;margin:0 auto;padding:48px 16px;display:flex;flex-direction:column;gap:16px}}
h1{{margin:0;font-size:40px;line-height:1;font-weight:500;letter-spacing:-.045em}}
p{{margin:0;color:#69695d}}
ul{{list-style:none;margin:0;padding:0;border:1px solid #d6d6c9;border-radius:4px;background:#fafaf8}}
li{{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid #e8e8de}}
li:first-child{{border-top:0}}
a{{color:#c93a0f;font-weight:500;text-decoration:none}}a:hover{{color:#2b2723}}
span{{font:500 12px "Source Code Pro",monospace;color:#69695d}}
</style>
</head>
<body>
<main>
<h1>OpenCMO redesign frames</h1>
<p>Static copies of the design canvas, one page per frame, at their initial state (live counters and clicks do not run here). Numbers are sample data. The canvas and the .dc.html files beside this folder are the source of truth.</p>
<ul>
{rows}
</ul>
</main>
</body>
</html>
''')
