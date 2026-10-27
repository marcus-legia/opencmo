# App redesign frames (2026-10-27)

Source files of the Claude Design canvas https://claude.ai/artifact/QqAc6RuZi44osR3YAXAuNw, copied for the sessions
that build [`../2026-10-27-ui-build-plan.md`](../2026-10-27-ui-build-plan.md). They are design references, not app
code: read the exact sizes, colours and copy from them and rebuild the screens with the app's own components. Numbers in
them are sample data.

| Folder | What | Use it to |
|---|---|---|
| `*.dc.html`, `canvas.json` | the canvas source, one file per artboard | read exact values (styles are inline) |
| [`static/`](static/index.html) | plain HTML copies a browser opens directly, start at `static/index.html` | look at a screen; compare screenshots in U9 |
| `tools/` | `vals.js` + `build.py`, the export that makes `static/` | refresh `static/` after the canvas changes |

`static/` shows each frame at its initial state: live counters, approve clicks and tab switching do not run there (they
do on the canvas). The canvas is the live version; if they differ, the canvas wins and these copies get refreshed:

```bash
cd docs/plans/cmo/2026-10-27-app-redesign-frames
node tools/vals.js *.dc.html > /tmp/vals.json
python3 tools/build.py . static /tmp/vals.json
```
