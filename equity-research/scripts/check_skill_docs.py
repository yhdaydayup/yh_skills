#!/usr/bin/env python3
"""skill 自身的一致性检查。改完 SKILL.md 或 references/ 跑一遍。

    python3 scripts/check_skill_docs.py

检查三件事：

1. 交叉引用能不能解析。本 skill 要求「引用写小节标题，不写编号」，但光写规则拦不住——
   曾经在 market-share.md 插入一节后，report-structure.md 里的「见 market-share.md 六」
   就指到了别的小节；这一轮给 report-structure.md 插入「批量改报告的纪律」，
   又把 render_check.js 里的「七、终检清单」顶歪了。所以必须机器来查。
2. references/ 下的每个文件都在 SKILL.md 的参考文件表里列着（新增文件容易忘记登记）。
3. 参考文件表里列的文件真的存在（改名后容易留下死引用）。

有问题返回退出码 1。
"""
import glob
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def headings(path):
    """一个文档里所有小节标题，去掉「一、」这类前缀，便于按标题引用。"""
    text = path.read_text(encoding='utf-8')
    return {re.sub(r'^[一二三四五六七八九十]+、', '', h).strip()
            for h in re.findall(r'^#{2,4}\s*(.+)$', text, re.M)}


def main():
    docs = {p.name: headings(p) for p in [ROOT / 'SKILL.md'] + sorted((ROOT / 'references').glob('*.md'))}
    problems = []

    # 1. 交叉引用
    scan = ([ROOT / 'SKILL.md'] + sorted((ROOT / 'references').glob('*.md'))
            + [p for p in sorted((ROOT / 'scripts').glob('*')) if p.is_file()])
    for p in scan:
        try:
            text = p.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        for m in re.finditer(r'([\w-]+\.md)\s*[「『]([^」』]+)[」』]', text):
            doc, sec = m.group(1), m.group(2)
            rel = p.relative_to(ROOT)
            if doc not in docs:
                problems.append(f'{rel}: 引用了不存在的文档 {doc}')
            elif not any(sec in h or h in sec for h in docs[doc]):
                problems.append(f'{rel}: {doc}「{sec}」找不到对应小节——'
                                f'插入或重命名小节后必须回头改引用')

    # 2/3. 参考文件表与实际文件互相对得上
    skill = (ROOT / 'SKILL.md').read_text(encoding='utf-8')
    listed = set(re.findall(r'`((?:references|scripts|assets)/[\w.-]+)`', skill))
    actual = {str(pathlib.Path(f).relative_to(ROOT))
              for f in glob.glob(str(ROOT / 'references' / '*'))
              + glob.glob(str(ROOT / 'scripts' / '*'))
              + glob.glob(str(ROOT / 'assets' / '*'))
              if pathlib.Path(f).is_file()}
    for f in sorted(actual - listed):
        problems.append(f'SKILL.md: {f} 没有登记在参考文件表里')
    for f in sorted(listed - actual):
        problems.append(f'SKILL.md: 参考文件表里的 {f} 不存在')

    for x in problems:
        print('  ERROR ' + x)
    print(f'  → {len(problems)} 个问题　' + ('通过' if not problems else '未通过'))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
