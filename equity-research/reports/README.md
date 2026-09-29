# 已产出的分析报告

三份报告都是自包含单文件，直接用浏览器打开即可（图表依赖 Chart.js CDN，需要联网）。

| 文件 | 标的 | 定价基准 | 结论 |
|---|---|---|---|
| `whgroup-analysis.html` | 万洲国际 0288.HK | 2026-09-22 收盘 HK$6.55 | 可买，但降价买，中性仓位 |
| `haidilao-analysis.html` | 海底捞 6862.HK | 2026-09-22 收盘 HK$9.415 | 观望 |
| `byd-analysis.html` | 比亚迪股份 1211.HK | 2026-09-25 收盘 HK$78.10 | 观望 |

## 来源

2026-09-28 上传到附件存储的版本，2026-09-29 取回归档。取回时网关会注入一个
`tiktok_pns_storage_control` 脚本，归档前已剥离，内容与上传版本一致。

报告数据全部来自一手披露：港交所披露易年报及中期报告、SEC EDGAR 8-K、巨潮资讯网、
深交所年报及半年报；行业总量取国家统计局、USDA、Eurostat、中汽协、乘联分会。

## 已知待修缺陷

这三份是交付版本，按原样归档，未做修改。`../scripts/` 下的两个校验脚本在它们身上抓到：

| 报告 | 缺陷 | 抓到的脚本 |
|---|---|---|
| `byd-analysis.html` | `nav.toc` 的 HTML 在，但目录跟随高亮的脚本整段没写 | `render_check.js` |
| `byd-analysis.html` | 全文零折叠块，考据类内容全在常态可见层 | `validate_report.py` |
| `byd-analysis.html` | 正文用股息率作论据，但没给派息覆盖倍数 | `validate_report.py` |
| `byd-analysis.html` | 出口份额表里吉利、零跑两格留「—」且未说明原因，而用报告自己的分母 425.4 万辆可直接算出 11.1% 和 2.3% | `validate_report.py` |
| `haidilao-analysis.html` | 3 处用颜色指代序列（「翻台率（绿色）」「门店数（橙色）」「客单价（红色）」），改配色即失效 | `validate_report.py` |
| `whgroup-analysis.html` | 10 处 `h3` 用 inline style 覆盖字号，应改用 `h3.sub2` | `validate_report.py` |
| `haidilao-analysis.html` | 9 处同上，其中 3 处是 `15px` 真覆盖 | `validate_report.py` |

比亚迪前三条的根因是没有从 `../assets/report-skeleton.html` 起稿，而是手工拼装。
这也是骨架文件存在的理由。

两处**不是**缺陷、已确认为合规做法：万洲「欧洲」行与海底捞「呷哺呷哺／湊湊」行的份额留「—」，
但同行写明了「未查到」「无可靠分母，不估算」——这正是 `market-share.md` 要求的写法，校验器不报。

重修时注意：重新上传会换 URL，而浏览器批注按「域名＋路径」绑定，**先让读者导出批注再出新版本**。
