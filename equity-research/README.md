# equity-research

生成单只股票的独立投资分析报告（自包含 HTML 看板）的 Agent Skill。

规则不是凭经验写的，每一条都对应一次真实评审打回：五年趋势而非两年对比、构成用折线而非饼图、
合并趋势图必须全部归一化、真实市盈率要扣净现金、派息必须给真实自由现金流覆盖倍数、
市占率分子分母口径全部写明、标题只写内容不写虚标题。

## 安装

本仓库存放多个 skill，所以这个 skill 是仓库下的一个子目录。Agent 只认
`.cursor/skills/<name>/SKILL.md` 这个路径，两种装法都可以。

软链（推荐，`git pull` 即更新）：

```bash
git clone https://github.com/yhdaydayup/yh_skills.git ~/yh_skills
ln -s ~/yh_skills/equity-research <工作区>/.cursor/skills/equity-research
```

直接拷贝（沙箱等一次性环境）：

```bash
git clone --depth 1 https://github.com/yhdaydayup/yh_skills.git /tmp/yh_skills
cp -r /tmp/yh_skills/equity-research <工作区>/.cursor/skills/equity-research
```

## 目录

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 入口：工作流、七条硬规则、措辞要点、评审反馈处理方式 |
| `references/report-structure.md` | 七区块骨架、篇幅配额、折叠策略、编号与交叉引用陷阱、终检 |
| `references/analysis-method.md` | 真实 PE／真实自由现金流／派息覆盖／SOTP／ROE 拆解，以及 9 个会计陷阱 |
| `references/market-share.md` | 市占率口径纪律（历史出错率最高，单独成篇） |
| `references/charting.md` | 图表选型表 + Chart.js 可复用代码（桥式图、归一化图、扇形小倍数） |
| `references/wording.md` | 措辞黑名单、病句五类、删留判断方法 |
| `assets/report-skeleton.html` | 报告骨架，起新报告一律复制它 |
| `scripts/validate_report.py` | 内容与规范校验，零 error 才能交付 |
| `scripts/render_check.js` | 浏览器渲染终检，零 FAIL 才能交付 |

## 交付前必须跑

```bash
python3 scripts/validate_report.py <报告.html>   # 零 error
node    scripts/render_check.js  <报告.html>     # 零 FAIL
```

`render_check.js` 需要 Playwright 的 chromium；环境里常只装了完整 chromium 而没有 headless shell，
脚本会自动从 `~/.cache/ms-playwright` 里找可执行文件。

这两个脚本不是形式检查。它们在已交付的三份报告上抓到过：报告缺少目录高亮脚本（`nav.toc` 的
HTML 在、脚本整段没写）、全文零折叠块、缺派息覆盖倍数、以及 19 处 `h3` 用 inline style 覆盖字号。

## 为什么有 `assets/report-skeleton.html`

前三份报告是逐份手工拼的，结构因此逐份漂移。骨架已经通过上面两个脚本，
结构、样式、图表原语、目录高亮、折叠块 `Chart.resize()` 都是对的，**只需替换内容，不要重搭结构**。
