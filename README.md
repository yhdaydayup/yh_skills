# yh_skills

个人 Agent Skill 仓库。顶层每个目录是一个独立 skill，入口是该目录下的 `SKILL.md`；
`tools/` 下放不属于 skill 的独立工具。

## Skills

| Skill | 用途 |
|---|---|
| [`equity-research`](equity-research/) | 生成单只股票的独立投资分析报告（自包含 HTML 看板），含报告骨架与交付前双校验脚本 |

## 工具

| 工具 | 用途 |
|---|---|
| [`tools/page-comment`](tools/page-comment/) | Chrome 扩展：在网页上选中文字或点元素直接写批注，导出成带章节、选择器和原文的反馈清单。读长报告时逐条标问题用 |

`tools/` 里的东西不是 skill，Agent 不会自动加载，按各自 README 安装。

## 安装

Agent 只认 `.cursor/skills/<name>/SKILL.md` 这个路径，所以要把需要的 skill 目录挂到工作区下。

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

全部挂上：

```bash
git clone https://github.com/yhdaydayup/yh_skills.git ~/yh_skills
for d in ~/yh_skills/*/; do
  [ -f "$d/SKILL.md" ] && ln -sfn "$d" "<工作区>/.cursor/skills/$(basename "$d")"
done
```

## 新增 skill 的约定

- 一个 skill 一个顶层目录，目录名即 skill 名，用小写连字符。
- 必须有 `SKILL.md`，开头带 `name` 和 `description` 的 front matter——`description` 决定 Agent
  什么时候会选中它，要写清触发场景。
- `SKILL.md` 保持精简，只放工作流和硬规则；细则拆到 `references/`，可复用代码放 `assets/`，
  可执行的校验放 `scripts/`。
- 规则要可执行、可验证。能写成校验脚本的就不要只写成文字描述。
