# -*- coding: utf-8 -*-
"""把扩展打包成一个自包含的安装页：内嵌全部源文件 + 浏览器端 ZIP 打包器。

上传通道只接受 .html/.md，所以不能直接发 zip；这个页面在用户浏览器里现场生成 zip。
"""
import base64, json, pathlib

SRC = pathlib.Path(__file__).parent
TEXT = ['manifest.json', 'content.js', 'background.js', 'README.md']
BIN = ['icons/16.png', 'icons/48.png', 'icons/128.png']

files = []
for n in TEXT:
    files.append({'name': f'page-comment/{n}', 'text': (SRC / n).read_text(encoding='utf-8')})
for n in BIN:
    files.append({'name': f'page-comment/{n}', 'b64': base64.b64encode((SRC / n).read_bytes()).decode()})

payload = json.dumps(files, ensure_ascii=False)
total = sum(len(f.get('text', '').encode()) or len(base64.b64decode(f['b64'])) for f in files)

HTML = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>页面批注 Page Comment — 安装</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--txt:#e6edf3;--dim:#8b949e;--c:#4aa8ff;--g:#3fb950}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:44px 22px 80px}
h1{font-size:27px;margin:0 0 6px}
.sub{color:var(--dim);font-size:14px;margin:0 0 30px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:18px 0}
h2{font-size:17px;margin:0 0 12px;padding-bottom:9px;border-bottom:1px solid var(--line)}
ol,ul{padding-left:22px;margin:10px 0}li{margin:7px 0}
code,kbd{background:#0d1117;border:1px solid var(--line);border-radius:4px;padding:1px 6px;
  font:13px ui-monospace,Menlo,monospace;color:var(--c)}
kbd{color:var(--txt)}
.dl{display:inline-flex;align-items:center;gap:9px;background:var(--g);color:#04260f;border:none;
  border-radius:9px;padding:13px 26px;font-size:15.5px;font-weight:700;cursor:pointer}
.dl:hover{filter:brightness(1.1)}
.dl:disabled{opacity:.6;cursor:default}
.meta{color:var(--dim);font-size:12.5px;margin-top:10px}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 11px;text-align:left}
th{background:#0d1117;color:var(--dim);font-weight:600;width:170px}
pre{background:#0d1117;border:1px solid var(--line);border-radius:8px;padding:13px;overflow:auto;
  font:12.5px/1.65 ui-monospace,Menlo,monospace;color:#c9d1d9}
.warn{border-left:3px solid #d29922;padding-left:12px;color:var(--dim);font-size:13.5px}
.files{font:12.5px ui-monospace,Menlo,monospace;color:var(--dim)}
.files b{color:var(--txt);font-weight:400}
</style></head><body><div class="wrap">

<h1>页面批注 <span style="color:var(--dim);font-weight:400;font-size:19px">Page Comment</span></h1>
<p class="sub">在页面上选中文字或点击图表直接写评论，导出成带精确定位的反馈清单 —— 不用再描述「第三章那张图右边那条线」。</p>

<div class="card">
  <h2>① 下载</h2>
  <button class="dl" id="dl">⬇︎ 下载 page-comment.zip</button>
  <div class="meta" id="meta">共 __N__ 个文件 · 解压后约 __KB__ KB</div>
  <div class="files" id="list"></div>
</div>

<div class="card">
  <h2>② 安装到 Chrome</h2>
  <ol>
    <li>解压 zip，得到 <code>page-comment</code> 文件夹（<b>别放临时目录</b>，Chrome 要长期读它）</li>
    <li>地址栏打开 <code>chrome://extensions/</code></li>
    <li>右上角打开「<b>开发者模式</b>」</li>
    <li>点「<b>加载已解压的扩展程序</b>」，选中那个 <code>page-comment</code> 文件夹</li>
    <li class="warn">要批注本地 <code>file://</code> 打开的页面，还要在扩展详情页把「<b>允许访问文件网址</b>」打开</li>
  </ol>
</div>

<div class="card">
  <h2>③ 怎么用</h2>
  <table>
    <tr><th>给一段文字加批注</th><td>直接<b>选中文字</b>，旁边弹出「＋ 评论」</td></tr>
    <tr><th>给图表 / 图片加批注</th><td>点面板里的「<b>◎ 点元素</b>」，再点目标（<kbd>Esc</kbd> 退出）</td></tr>
    <tr><th>开关面板</th><td>点工具栏图标，或 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd></td></tr>
    <tr><th>直接进元素模式</th><td><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td></tr>
    <tr><th>保存</th><td><kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd></td></tr>
    <tr><th>导出</th><td>面板底部「<b>复制全部反馈</b>」，直接粘贴给我</td></tr>
  </table>
  <p style="color:var(--dim);font-size:13.5px;margin:12px 0 0">
  批注按「域名＋路径」分别存在浏览器本地，刷新和重开都还在，不上传任何数据。<br>
  快捷键没用更顺手的 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>，是因为实测 Chromium 里
  <code>Alt+Shift+A / C / P</code> 都已被占用、声明了也会被静默丢弃。想换组合去
  <code>chrome://extensions/shortcuts</code> 改。</p>
</div>

<div class="card">
  <h2>导出长这样</h2>
  <pre>页面批注 · 万洲国际 0288.HK — 独立投资分析
https://example.com/whgroup-analysis.html
2026-09-24 11:30 · 共 2 条

[1] 五、行业地位：万洲在各个市场分别占多少份额 › 生猪屠宰头数占比
    位置  正文文本 @ #s5
    原文  「美国份额在流失：25.13%（FY2021）→ 23.30%（FY2025）」
    意见  这段太长了，砍一半

[2] 一、投资结论 › 关联指标合并趋势图
    位置  canvas#cCore
    意见  图例挡住线了</pre>
  <p style="color:var(--dim);font-size:13.5px;margin:12px 0 0">
  <b>位置</b>和<b>原文</b>两栏是给我定位用的：<code>canvas#cCore</code> 直接对应源码里的图表 id，
  <b>原文</b>可以直接拿去全文检索。所以你只要写「这里太长了」就够了。</p>
</div>

<script>
const FILES = __PAYLOAD__;

/* ── 手写 store-only ZIP：不引任何 CDN，离线也能用 ── */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0; }
  return t;
})();
function crc32(b){ let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = (c >>> 8) ^ crcTable[(c ^ b[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0; }

function buildZip(entries){
  const enc = new TextEncoder(), local = [], central = [];
  let offset = 0, cdSize = 0;
  for (const e of entries){
    const name = enc.encode(e.name), crc = crc32(e.data), len = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);                 // UTF-8 文件名
    lh.setUint16(8, 0, true);                      // 不压缩
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, len, true); lh.setUint32(22, len, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    local.push(new Uint8Array(lh.buffer), name, e.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, len, true); cd.setUint32(24, len, true);
    cd.setUint16(28, name.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + len;
    cdSize += 46 + name.length;
  }
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true);
  return new Blob([...local, ...central, new Uint8Array(eo.buffer)], {type:'application/zip'});
}

function entries(){
  const enc = new TextEncoder();
  return FILES.map(f => ({
    name: f.name,
    data: 'text' in f ? enc.encode(f.text)
                      : Uint8Array.from(atob(f.b64), c => c.charCodeAt(0)),
  }));
}

document.getElementById('list').innerHTML =
  FILES.map(f => '<b>' + f.name + '</b>').join('　·　');

document.getElementById('dl').onclick = () => {
  const url = URL.createObjectURL(buildZip(entries()));
  const a = document.createElement('a');
  a.href = url; a.download = 'page-comment.zip'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

// 供自动化校验取回 zip 字节
window.__zipBase64 = async () => {
  const buf = new Uint8Array(await buildZip(entries()).arrayBuffer());
  let s = ''; for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
};
</script>
</div></body></html>
'''

html = (HTML.replace('__PAYLOAD__', payload)
            .replace('__N__', str(len(files)))
            .replace('__KB__', str(round(total / 1024, 1))))
out = SRC / 'dist' / 'page-comment-install.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out} · {len(html.encode())} 字节 · 内嵌 {len(files)} 个文件 / {total} 字节')
