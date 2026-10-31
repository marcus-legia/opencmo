// Runs each frame's renderVals() once, at its initial state, and prints the values as JSON.
const fs = require('fs'), vm = require('vm');
const out = {};
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const m = /<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/.exec(src);
  if (!m) continue;
  const ctx = { console, Math, String, Array, Object, JSON, Number };
  vm.createContext(ctx);
  vm.runInContext(`class DCLogic { constructor(p){ this.props = p || {}; this.state = {}; } setState(){} forceUpdate(){} }\n${m[1]}\nthis.__vals = new Component({}).renderVals();`, ctx);
  out[file.split('/').pop()] = JSON.parse(JSON.stringify(ctx.__vals));
}
console.log(JSON.stringify(out));
