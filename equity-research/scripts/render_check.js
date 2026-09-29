/**
 * 报告渲染终检。validate_report.py 过后跑这个。
 *
 *   node render_check.js <报告.html> [...]
 *
 * 检查项对应 references/report-structure.md「七、终检清单」：
 *   图表全部实例化、无零宽画布、无死锚点、无横向溢出、无 JS 报错、
 *   目录高亮可用、折叠块内画布展开后宽度非 0。
 *
 * 有问题返回退出码 1。
 */
const path = require('path');

function loadPlaywright() {
  const cands = [
    'playwright',
    '/opt/sdma-cli/node_modules/playwright',
    '/root/.npm/_npx/2334a3ea0ef73d73/node_modules/playwright',
  ];
  for (const c of cands) {
    try { return require(c); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 playwright，先 npx playwright install 或指向已安装路径');
}

// 环境里常只装了完整 chromium、没有 headless shell，需要显式指定可执行文件
function chromiumPath() {
  const fs = require('fs'), glob = '/root/.cache/ms-playwright';
  if (!fs.existsSync(glob)) return undefined;
  for (const d of fs.readdirSync(glob).filter(x => x.startsWith('chromium-'))) {
    const p = path.join(glob, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function check(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const jsErrors = [];
  page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.resolve(file), { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    return {
      canvas: cs.length,
      charts: window.Chart ? cs.filter(c => Chart.getChart(c)).length : -1,
      zeroWidth: cs.filter(c => c.getBoundingClientRect().width < 1).map(c => c.id),
      noChart: window.Chart ? cs.filter(c => !Chart.getChart(c)).map(c => c.id) : ['Chart 未加载'],
      dead: [...document.querySelectorAll('a[href^="#"]')]
        .map(a => a.getAttribute('href'))
        .filter(h => h.length > 1 && !document.querySelector(h)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h2: document.querySelectorAll('h2[id]').length,
    };
  });

  // 滚到中段看目录是否跟随高亮
  r.tocOn = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight / 2);
    await new Promise(r => setTimeout(r, 300));
    return document.querySelectorAll('.toc a.on').length;
  });

  // 折叠块内画布展开后必须有宽度
  r.foldedCanvas = await page.evaluate(async () => {
    const ds = [...document.querySelectorAll('details')];
    ds.forEach(d => { d.open = true; d.dispatchEvent(new Event('toggle')); });
    await new Promise(r => setTimeout(r, 500));
    return [...document.querySelectorAll('details canvas')]
      .map(c => ({ id: c.id, w: Math.round(c.getBoundingClientRect().width) }));
  });

  await page.close();

  const fails = [];
  if (r.charts !== r.canvas) fails.push(`${r.canvas - r.charts} 个 canvas 没有 Chart 实例：${r.noChart.join(', ')}`);
  if (r.zeroWidth.length) fails.push(`零宽画布：${r.zeroWidth.join(', ')}`);
  if (r.dead.length) fails.push(`死锚点：${r.dead.join(', ')}`);
  if (r.overflow > 0) fails.push(`横向溢出 ${r.overflow}px`);
  if (jsErrors.length) fails.push(`JS 报错 ${jsErrors.length} 条：${jsErrors[0]}`);
  if (r.h2 && r.tocOn !== 1) fails.push(`目录高亮异常：命中 ${r.tocOn} 项，应为 1`);
  const flat = r.foldedCanvas.filter(c => c.w < 1);
  if (flat.length) fails.push(`折叠块内画布展开后仍为零宽（缺 Chart.resize）：${flat.map(c => c.id).join(', ')}`);

  return { r, fails, jsErrors };
}

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('用法：node render_check.js <报告.html> [...]'); process.exit(2); }

  const { chromium } = loadPlaywright();
  const exe = chromiumPath();
  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  let bad = false;
  for (const f of files) {
    const { r, fails } = await check(browser, f);
    console.log(`\n=== ${path.basename(f)} ===`);
    console.log(`  画布 ${r.canvas} / 图表 ${r.charts}　h2 ${r.h2}　折叠内画布 ${r.foldedCanvas.length}`);
    if (fails.length) { bad = true; fails.forEach(x => console.log(`  FAIL  ${x}`)); }
    else console.log('  → 通过');
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
