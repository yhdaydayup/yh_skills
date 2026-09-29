#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""股票分析报告交付前校验。

用法：
    python3 validate_report.py <报告.html> [...]
    python3 validate_report.py --quiet <报告.html>      # 只输出 error

退出码：有 error 返回 1，只有 warn 返回 0。

每条规则都对应一次真实的评审打回，规则来源见 ../references/ 下同名章节。
"""

import argparse
import re
import sys
from collections import Counter

SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']

# 七区块升八区块的历史欠账标记。腾讯那份被评「通篇聚焦过去的总结，缺少对未来企业发展的判断」，
# 说明原来的七区块结构本身不含前瞻判断，于是新增「七、未来三年的判断」。
# 三份早于这次改版的报告还没补这一章：不静默豁免，降级成 WARN 并每次都报出来，
# 直到补完为止。报告里要显式写上这个标记，理由跟着标记走——不说就等于漏改。
LEGACY_7BLOCK = 'legacy-7block'

# references/wording.md 「黑话黑名单」
BLACKLIST = [
    (r'压着[一二三四五六七八九十\d]+家', '比喻代替事实：「压着 N 家公司」'),
    (r'[三四五]根(独立)?支柱', '比喻代替事实：「支柱」→「买入逻辑有三条」'),
    (r'彼此不依赖', '无信息量：删除，不要补充说明'),
    (r'不需要同时兑现', '无信息量：与「彼此不依赖」同义重复'),
    (r'白送', '比喻代替事实：改为「没有计入」'),
    (r'派家底', '比喻代替事实：改为「派的是账上存量现金」'),
    (r'天花板', '比喻代替事实：改为「回报上限」'),
    (r'击穿', '比喻代替事实：改为「不足以让集团整体转亏」'),
    (r'代价写在', '比喻代替事实：改为直说什么数在恶化，如「但自由现金流在倒退」'),
    # 英文术语混在中文里也算黑话。「代价写在现金流上」被用户批「这个就是黑话，谁看得懂」，
    # 同一轮里又自己写出 price in / agent / token——写时顺手，读时全是坎。
    (r'\bprice\s*(in|进)', '中英夹杂：改为「已经计入了一部分」'),
    (r'(?<![A-Za-z])token(?![A-Za-z])', '中英夹杂：改为「模型调用量」或按语境译出'),
    (r'(?<![A-Za-z])agent(?![A-Za-z])', '中英夹杂：改为「智能体」'),
    # 界面术语要写成读者能照做的动作。用户看到「原值在 tooltip 里」的反应是「tooltip 在哪？」
    (r'tooltip', '界面术语：读者不知道它指什么，改写成动作——'
                 '「把鼠标停在线上任意一个圆点，会浮出该点的原始数值」'),
    (r'(?<![A-Za-z])hover(?![A-Za-z])', '界面术语：改为「把鼠标停在……上」'),
    (r'一图看全貌', '虚标题：删掉'),
    (r'钱(到底)?是谁赚的', '口语化设问：改为「收入和利润分别来自哪里」'),
    (r'本质上(是|只是)', '虚化实词：删掉「本质上」，判断反而更硬'),
    (r'换句话说', '无功能连接词：删掉'),
    (r'值得注意的是', '无功能开场：删掉'),
    (r'不难看出', '无功能开场：删掉'),
    (r'需要公允地', '作者自评：读者要事实，不要表演中立'),
    (r'这一屏读完就能决策', '对读者的承诺：做到了不用说'),
    (r'这[张组](图|数据)(揭示|提供|说明)了', '元评论开场：直接说事实'),
    (r'(早前|上一?)版本(的差异|此前)', '草稿残留：读者不关心上一版'),
    (r'本表刻意', '编排说明：读者不关心编排意图'),
]

# references/report-structure.md 「折叠策略」
EMPTY_SUMMARY = [r'^详细数据', r'^更多(说明|数据|细节)', r'^补充说明$', r'^附录', r'^数据明细']

HEADING_LEVELS = ['h2', 'h3', 'h4', 'h5']


class Report:
    def __init__(self, path):
        self.path = path
        self.raw = open(path, encoding='utf-8').read()
        self.errors = []
        self.warns = []
        # 去掉 script / style，避免代码里的字符串被当正文
        self.body = re.sub(r'<(script|style)\b.*?</\1>', '', self.raw, flags=re.S | re.I)
        self.scripts = '\n'.join(re.findall(r'<script>(.*?)</script>', self.raw, re.S))

    def err(self, rule, msg):
        self.errors.append((rule, msg))

    def warn(self, rule, msg):
        self.warns.append((rule, msg))

    # ---------- 工具 ----------

    @staticmethod
    def text_of(html):
        t = re.sub(r'<[^>]+>', '', html)
        t = re.sub(r'&[a-z]+;|&#\d+;', '', t)
        return re.sub(r'\s+', '', t)

    def visible_text(self, html):
        """常态可见字数：剔除 details 内部。"""
        return self.text_of(re.sub(r'<details\b.*?</details>', '', html, flags=re.S | re.I))

    def blocks(self):
        """按 h2 切分出七个区块的 HTML。"""
        marks = [(m.group(1), m.start()) for m in re.finditer(r'<h2 id="([^"]+)"', self.body)]
        out = []
        for i, (sid, pos) in enumerate(marks):
            end = marks[i + 1][1] if i + 1 < len(marks) else len(self.body)
            out.append((sid, self.body[pos:end]))
        return out

    # ---------- 规则 ----------

    def check_skeleton(self):
        ids = [sid for sid, _ in self.blocks()]
        if ids != SECTIONS:
            legacy = re.search(LEGACY_7BLOCK + r'[：:]\s*([^\n>]*)', self.raw)
            if legacy and ids == SECTIONS[:6] + ['s7']:
                self.warn('骨架', f'仍是七区块，缺「未来判断」章节（欠账原因：{legacy.group(1).strip()}）。'
                                  f'这不是豁免，是待补项——补完后删掉 {LEGACY_7BLOCK} 标记')
            else:
                self.err('骨架', f'h2 的 id 必须是 {SECTIONS}，实际是 {ids}'
                                 f'（见 report-structure.md「八区块骨架」）')
        toc = re.findall(r'<a href="#(s\d)"', self.body)
        if toc and toc != ids:
            self.err('骨架', f'吸顶目录与区块不一致：目录 {toc} vs 区块 {ids}')
        if not re.search(r'class="toc"', self.body):
            self.warn('骨架', '缺少吸顶目录 nav.toc')

    def check_quota(self):
        blocks = self.blocks()
        if not blocks:
            return
        lens = {sid: len(self.visible_text(h)) for sid, h in blocks}
        total = sum(lens.values())
        if not total:
            return
        for sid, n in lens.items():
            share = n / total
            if share > 0.35:
                self.err('篇幅', f'{sid} 常态可见字数占 {share:.0%}，上限 35%'
                                 f'（{n}/{total} 字，先折叠考据再考虑删）')
        s1 = lens.get('s1', 0) / total
        if s1 < 0.05:
            self.err('篇幅', f'结论区块 s1 只占 {s1:.1%}，下限 5%——结论被论据淹没')
        if total > 16000:
            self.warn('篇幅', f'常态可见共 {total} 字，建议控制在 12,000–15,000')

    def check_folding(self):
        summaries = re.findall(r'<summary[^>]*>(.*?)</summary>', self.body, re.S)
        for s in summaries:
            t = self.text_of(s)
            for pat in EMPTY_SUMMARY:
                if re.search(pat, t):
                    self.err('折叠', f'折叠标题是空标签「{t[:30]}」，必须写成结论句')
        if not summaries:
            self.warn('折叠', '全文没有折叠块：考据类内容（分母出处、口径推导、逐年原始数列）应收进 details.fold')
        # details 内有图表时必须有 resize 处理
        has_canvas_in_details = any(
            '<canvas' in m.group(0)
            for m in re.finditer(r'<details\b.*?</details>', self.body, re.S | re.I))
        if has_canvas_in_details and 'resize()' not in self.scripts:
            self.err('折叠', 'details 内有 canvas 但缺少 toggle → Chart.resize()：'
                             '折叠态下画布尺寸为 0，Chart.js 不会自愈')

    def check_tag_balance(self):
        """标签配对。批量改 HTML 最容易在这里翻车，而且浏览器会静默兜住，眼睛看不出来。

        真实事故：用 `caliber.rstrip('<br/>')` 想去掉尾部换行标签，忘了 rstrip 是按
        **字符集**剥离，把段末的 `</b>` 一起吃掉了。页面照常渲染，两个校验脚本也全绿，
        只有手工数标签才发现。所以这条必须机器来数。
        """
        for tag in ('b', 'div', 'details', 'summary', 'table', 'tr', 'td', 'th', 'details'):
            op = len(re.findall(r'<%s\b' % tag, self.body, re.I))
            cl = len(re.findall(r'</%s>' % tag, self.body, re.I))
            if op != cl:
                self.err('标签', f'<{tag}> 开 {op} 个、闭 {cl} 个，差 {op - cl}——'
                                 f'批量替换很可能吃掉了闭合标签（rstrip 按字符集剥离是经典坑）')

    def check_headings(self):
        for lv in HEADING_LEVELS:
            hits = []
            for m in re.finditer(r'<%s\b([^>]*)>(.*?)</%s>' % (lv, lv), self.body, re.S):
                mm = re.search(r'font-size\s*:\s*([\d.]+px)', m.group(1))
                if mm:
                    hits.append(f'{self.text_of(m.group(2))[:24]}（{mm.group(1)}）')
            if hits:
                self.err('层级', f'{len(hits)} 处 {lv} 用 inline style 覆盖字号，'
                                 f'应改用层级样式类（如 h3.sub2）：{"、".join(hits[:4])}'
                                 + ('…' if len(hits) > 4 else ''))

    def check_section_heading_level(self):
        """小节标题（「N.M　」开头）必须带层级类，不能用裸 h3——那和图表标题同级，读者分不出来。"""
        bare = [self.text_of(m.group(1))
                for m in re.finditer(r'<h3>(\d\.\d\u3000[^<]*)</h3>', self.body)]
        if bare:
            self.err('层级', f'{len(bare)} 个小节标题用的是裸 h3，与图表标题同级不可区分，'
                             f'改成 h3.sub2 并补锚点：{"、".join(x[:20] for x in bare[:3])}'
                             + ('…' if len(bare) > 3 else ''))

    def check_numeral_corruption(self):
        """章节号全局替换（如 4.1 → 四、）会顺手改掉正文里的同形数字。

        判据：顿号与后面的单位之间留着空格。原文是「4.1 次/天」，替换后就成了「四、 次/天」，
        而正常的中文分条（「一、万洲的份额…」）顿号后面不会有空格。所以这里必须用保留空格的
        文本来判，不能用 text_of——它会把空格全吃掉，「一、万」就成了误报。
        """
        raw = re.sub(r'<[^>]+>', '', self.body)
        unit = r'(次/天|亿|万|元|%|倍|辆|头|吨|家|港元|美元|个|次|天)'
        for m in re.finditer(r'[一二三四五六七八九十]、[ \u00a0\t]+' + unit, raw):
            ctx = re.sub(r'\s+', ' ', raw[max(0, m.start() - 24):m.end() + 10])
            self.err('数字', f'「{m.group(0)}」像是章节重编号时把正文数字一起替换了'
                             f'（如 4.1 → 四、）。上下文：…{ctx}…')

    def check_wording(self):
        text = self.text_of(self.body)
        for pat, why in BLACKLIST:
            for m in re.finditer(pat, text):
                ctx = text[max(0, m.start() - 12):m.end() + 12]
                self.err('措辞', f'{why}　命中「{m.group(0)}」，上下文：…{ctx}…')

    def check_units(self):
        text = self.text_of(self.body)
        # 一份报告一个货币一个量级
        mags = [u for u in ['百万美元', '亿美元'] if u in text]
        if len(mags) > 1:
            self.err('单位', f'同一报告混用 {mags}——统一到一个量级（历史上一次返工换算了 144 个数字）')
        mags2 = [u for u in ['百万元', '亿元'] if u in text]
        if len(mags2) > 1:
            self.warn('单位', f'同时出现 {mags2}，确认是否混用了量级')
        # 表头声称整表同一单位（只有括号里确实是货币/量级时才算）
        unit_tok = r'(元|美元|港元|HK\$|美分|万头|万吨|万辆|百万|亿|千元)'
        for m in re.finditer(r'<th[^>]*>(.*?)</th>', self.body, re.S):
            t = self.text_of(m.group(1))
            mm = re.match(r'^(指标|项目|科目)（(.+)）$', t)
            if mm and re.search(unit_tok, mm.group(2)):
                self.err('单位', f'表头「{t}」声称整表同一单位，但表内通常混着倍数/百分比/报价货币；'
                                 f'改为单位跟着行标签走（span.uu）')

    def check_anchors(self):
        ids = set(re.findall(r'\bid="([^"]+)"', self.body))
        for href in set(re.findall(r'href="#([^"]+)"', self.body)):
            if href not in ids:
                self.err('锚点', f'死锚点 #{href}')
        # 裸章节号交叉引用
        for m in re.finditer(r'(见|详见|参见)(下文)?第[一二三四五六七八九十\d]+章', self.text_of(self.body)):
            self.warn('锚点', f'裸章节号交叉引用「{m.group(0)}」：重排后必定失效，改成锚点链接 a.xr')
        for m in re.finditer(r'(如下表|见下表|见上图|如上图)', self.text_of(self.body)):
            self.warn('锚点', f'相对位置引用「{m.group(0)}」：重排后必定失效')

    def check_charts(self):
        canvases = re.findall(r'<canvas id="([^"]+)"', self.body)
        dup = [k for k, v in Counter(canvases).items() if v > 1]
        if dup:
            self.err('图表', f'canvas id 重复：{dup}')
        for cid in canvases:
            if f"'{cid}'" not in self.scripts and f'"{cid}"' not in self.scripts:
                self.err('图表', f'canvas #{cid} 没有对应的 Chart 实例——会渲染成空白')
        if not canvases:
            self.warn('图表', '报告没有任何图表')

        # 归一化合并趋势图：禁止双轴
        for blk in self.split_charts():
            if '（指数）' not in blk:
                continue
            if "yAxisID:'y1'" in blk.replace(' ', '') or 'yAxisID:"y1"' in blk.replace(' ', ''):
                self.err('图表', '同一张图里既有「（指数）」序列又有 y1 右轴：'
                                 '要么全部归一化，要么不要合并（charting.md「合并趋势图」）')
            if 'logarithmic' in blk and re.search(r'data:\s*\[[^\]]*(?<![\d.])-\d', blk):
                self.err('图表', '对数刻度不能表示负值——改用线性轴并后移基准年')

        # 桥式图读法必须在画布之前
        if 'wfAid' in self.scripts:
            for m in re.finditer(r'<canvas id="(\w*[wW][fF]\w*|cEv\w*)"', self.body):
                head = self.body[max(0, m.start() - 700):m.start()]
                if 'wfhint' not in head:
                    self.err('图表', f'桥式图 #{m.group(1)} 的读法不在画布之前：'
                                     f'中间柱悬空必被当成 bug，说明要放在标题正下方')

        # 构成类不要用饼图
        for blk in self.split_charts():
            if "type:'doughnut'" not in blk.replace(' ', '') and "type:'pie'" not in blk.replace(' ', ''):
                continue
            if re.search(r'(构成|占比分布|收入结构|业务结构)', blk):
                self.warn('图表', '构成类用了饼图：改成「绝对值＋占比」两张并排折线，'
                                  '饼图只给静态切面（charting.md「选型表」）')

    def check_tension(self):
        """折线的 tension 必须为 0——所有折线，不只是归一化合并趋势图。

        原来这条只查带「（指数）」的那张图，而 charting.md 里被到处复制的 `L()` 默认值是 `.32`，
        于是三份报告的全部折线都带着样条假峰谷交付。腾讯那份的份额图被拉出一个不存在的圆顶、
        覆盖倍数图凸出到高于两端，**两个脚本当时都是全绿，是截图目视才发现的**。
        5–6 个点的折线没有任何理由用样条，所以这条升级为全局检查。
        """
        for m in re.finditer(r'tension:\s*([\d.]+)', self.scripts):
            if float(m.group(1)) != 0:
                ctx = re.sub(r'\s+', ' ', self.scripts[max(0, m.start() - 70):m.end()])[-70:]
                self.err('图表', f'tension = {m.group(1)}，必须为 0：'
                                 f'样条在 5–6 个点之间会造出不存在的峰谷。上下文：…{ctx}…')

    def check_halfyear_flow(self):
        """绝对值流量图不能把半年数和五个完整财年画在同一条线上。

        `1H26` 只有六个月，画在年度序列后面末端必然腰斩，读者第一眼读到「业务萎缩」。
        腾讯那份的分部收入图初版就是这样，四条线在 FY2025 之后集体跳水。
        正解是换成最近十二个月（FY2025 − 1H25 + 1H26）。
        存量（净现金、净资产、月活）和比率（毛利率、市盈率）没有这个问题。

        机器判不了「这个序列是流量还是存量」，所以查的是一个客观事实：
        **金额单位的折线，其标签数组最后一项是不是半年标签**。用对了 TTM 口径，
        最后一项自然是「最近12个月」，检查不会响；确属存量（净现金、净资产）就在调用前
        标一个 /*时点*/ 注释显式豁免——把口径写进源码本身，比脚本猜更可靠。

        注意不能扫 split_charts()：那个切的是 `new Chart(`，而绝大多数图由 trend() 辅助函数
        生成，26 张图只切得出 7 块，按块查等于漏掉全部。这里改扫辅助函数的**调用点**。
        """
        # 解析标签数组的定义，供把 Y6 这类标识符还原成实际标签
        # 抓任意 `标识符=[...]`，不要求前缀 const——`const Y5=[..],Y6=[..];` 里
        # Y6 是第二个声明符，只认 const 会把它整个漏掉
        labeldefs = dict(re.findall(r'\b(\w+)\s*=\s*(\[[^\]\n]*\])', self.scripts))
        HALF = re.compile(r"1H\d\d|上半年|H1\b")
        MONEY = re.compile(r'亿|万元|百万|美元|元\b')

        for m in re.finditer(r'\b(?:mk)?[Tt]rend\(\s*[\'"](\w+)[\'"]\s*,\s*([^,]+?)\s*,', self.scripts):
            cid, lab = m.group(1), m.group(2).strip()
            resolved = labeldefs.get(lab, lab)
            # 只看最后一项：中间出现 1H 是正常的季度序列，末项才决定末端会不会腰斩
            items = re.findall(r"'([^']*)'", resolved)
            if not items or not HALF.search(items[-1]):
                continue
            args = self.balanced(self.scripts, m.start())
            unit = re.findall(r"\]\s*,\s*'([^']*)'", args)
            if not unit or not MONEY.search(unit[0]):
                continue
            if re.search(r'时点|比率', self.scripts[max(0, m.start() - 160):m.start()]):
                continue
            self.warn('图表', f'图 #{cid} 是金额单位（{unit[0]}）而标签末项为「{items[-1]}」：'
                              f'流量指标请换成最近十二个月口径（FY − 1H上年 + 1H本年），'
                              f'否则末端腰斩会被读成业务萎缩；'
                              f'确属存量（净现金、净资产、月活）或比率（均价、单产）'
                              f'请在调用前加 /*时点*/ 或 /*比率*/ 注释豁免'
                              f'（charting.md「五条红线」第 5 条）')

    @staticmethod
    def balanced(s, start):
        """从 start 处的调用取到配对右括号为止的完整实参文本。"""
        i = s.find('(', start)
        d = 0
        for k in range(i, len(s)):
            if s[k] == '(':
                d += 1
            elif s[k] == ')':
                d -= 1
                if d == 0:
                    return s[i:k + 1]
        return s[i:i + 2000]

    def split_charts(self):
        """粗粒度切分每个 new Chart(...) 调用的源码。"""
        out, s = [], self.scripts
        for m in re.finditer(r'new Chart\(', s):
            i = s.find('{', m.end())
            if i < 0:
                continue
            d = 0
            for k in range(i, len(s)):
                if s[k] == '{':
                    d += 1
                elif s[k] == '}':
                    d -= 1
                    if d == 0:
                        out.append(s[m.start():k + 1])
                        break
        return out

    def check_five_years(self):
        fy = sorted(set(re.findall(r'FY20(\d\d)', self.raw)))
        if len(fy) < 5:
            self.err('五年', f'只出现了 {len(fy)} 个财年标签（{fy}）：'
                             f'所有趋势至少 5 个完整财年 + 最近中报')

    def check_pricing_basis(self):
        head = re.search(r'<header>(.*?)</header>', self.body, re.S)
        h = self.text_of(head.group(1)) if head else ''
        if not re.search(r'20\d\d-\d\d-\d\d', h):
            self.err('定价基准', '页首缺少取价日（YYYY-MM-DD）')
        if not re.search(r'(收盘|现价)', h):
            self.err('定价基准', '页首缺少现价／收盘价')
        if not re.search(r'(总股本|已发行股)', h):
            self.warn('定价基准', '页首缺少总股本，读者无法复算市值')
        if not re.search(r'(USD/|HKD/|/HKD|/CNY|汇率)', h):
            self.warn('定价基准', '页首缺少汇率，跨币种数字无法复核')

    def check_valuation(self):
        text = self.text_of(self.body)
        if '真实' not in text or not re.search(r'(市盈率|PE)', text):
            self.err('估值', '缺少真实市盈率口径（扣净现金或加回净负债），只给名义 PE 不合格')
        has_cover = re.search(r'(覆盖倍数|覆盖\s*[\d.]+\s*倍)', text)
        # 股息是论据之一时必须给覆盖倍数；派息可忽略的公司只提示
        if not has_cover:
            if re.search(r'(股息率|派息率)', text):
                self.err('现金流', '报告把股息作为论据但没给覆盖倍数——'
                                   '分母必须是还原租赁本金付款后的真实自由现金流')
            else:
                self.warn('现金流', '没有派息覆盖倍数：若派息对本案不重要请在正文说明')
        if re.search(r'(自由现金流|FCF)', text) and '租赁' not in text:
            self.warn('现金流', '提到自由现金流但全文未出现「租赁」：'
                                'IFRS 16 下租赁本金付款计入筹资活动，不还原会系统性高估')

    def check_market_share(self):
        text = self.text_of(self.body)
        if not re.search(r'(市占率|份额)', text):
            return
        if not re.search(r'(÷|/)', text):
            self.warn('份额', '份额没有给出「分子 ÷ 分母」，读者无法自行验算（market-share.md「分子分母必须同口径」）')
        if '吨' in text and '头' in text and not re.search(r'(头数口径|物理量口径|胴体重)', text):
            self.warn('份额', '同时出现吨与头但未声明口径：分子分母单位必须一致')
        # 份额留白由 check_share_blanks 单独负责；run() 会自动发现它，
        # 这里不要再显式调一次，否则同一处会报两遍。

    def check_share_blanks(self):
        """份额列留「—」且未说明原因：读者的第一反应是「为什么这家公司的份额看不到」。

        必须按列名判断。只要表里出现过「份额」二字就报，会把「年报自述」这类
        无关列的「—」和亏损年份的「不适用」一起误伤。
        已写明「未查到」「无可靠分母」等原因的行是合规做法，不报。
        """
        explained = r'(未查到|未披露|无可靠分母|无公开|不估算|不适用|n\.?a\.?|n\.?m\.?)'
        for tb in re.finditer(r'<table\b.*?</table>', self.body, re.S | re.I):
            t = tb.group(0)
            rows = re.findall(r'<tr\b.*?</tr>', t, re.S | re.I)
            if len(rows) < 2:
                continue
            heads = [self.text_of(h) for h in re.findall(r'<th\b.*?</th>', rows[0], re.S | re.I)]
            share_cols = {i for i, h in enumerate(heads) if re.search(r'(市占率|份额)', h)}
            if not share_cols:
                continue
            for row in rows[1:]:
                cells = re.findall(r'<t[dh]\b.*?</t[dh]>', row, re.S | re.I)
                if len(cells) != len(heads):
                    continue                        # 有 colspan/rowspan，列对不上就不猜
                if re.search(explained, self.text_of(row), re.I):
                    continue                        # 已说明原因，是合规做法
                for i in share_cols:
                    if re.fullmatch(r'\s*[—–-]\s*', self.text_of(cells[i]) or ''):
                        label = self.text_of(cells[0])[:20]
                        self.warn('份额', f'「{heads[i]}」列在「{label}」行留了「—」且未说明原因：'
                                          f'查不到现成数字要自己用产销量 ÷ 官方行业总量算，'
                                          f'算不出则写明原因'
                                          f'（market-share.md「查不到现成数字不等于可以留白」）')

    def check_color_reference(self):
        """不要用颜色指代序列：改配色即失效，打印与色觉障碍下不成立。"""
        text = self.text_of(self.body)
        for m in re.finditer(r'[（(](红|橙|黄|绿|青|蓝|紫|粉|灰|金)色[）)]', text):
            ctx = text[max(0, m.start() - 16):m.end() + 4]
            self.err('图注', f'用颜色指代序列「{m.group(0)}」，改写成序列名。'
                             f'上下文：…{ctx}…（曾把粉色写成绿色）')

    def check_term_definition(self):
        """年报附注的术语首次出现要给定义，否则读者会卡住。"""
        text = self.text_of(self.body)
        need = {
            '对外收入': r'(分部间|抵消|集团外部)',
            '经常性股息': r'(特别|一次性)',
            '真实自由现金流': r'租赁',
        }
        for term, ctx_pat in need.items():
            if term in text and not re.search(ctx_pat, text):
                self.warn('术语', f'用了「{term}」但全文没有解释它和常规口径的差别'
                                  f'（wording.md「专业术语首次出现必须给定义」）')

    def run(self):
        for name in dir(self):
            if name.startswith('check_'):
                getattr(self, name)()
        return self


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('paths', nargs='+')
    ap.add_argument('--quiet', action='store_true', help='只输出 error')
    a = ap.parse_args()

    bad = False
    for p in a.paths:
        r = Report(p).run()
        print(f'\n=== {p} ===')
        for rule, msg in r.errors:
            print(f'  ERROR [{rule}] {msg}')
        if not a.quiet:
            for rule, msg in r.warns:
                print(f'  WARN  [{rule}] {msg}')
        if r.errors:
            bad = True
            print(f'  → {len(r.errors)} error, {len(r.warns)} warn　未通过')
        else:
            print(f'  → 0 error, {len(r.warns)} warn　通过')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
