# 图表选型与可复用代码

依赖：`https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`

## 一、选型表

| 要表达 | 用什么 | 不要用 |
|---|---|---|
| 单序列随时间变化 | 折线 | 柱状（柱状适合离散比较，不适合看趋势） |
| 多序列趋势对比 | 折线，多序列同图 | 堆叠面积（看不出单序列走势） |
| 构成（地区／业务占比） | **两张并排折线**：左绝对值、右占比 | **饼图**（只给静态切面，看不出五年演变） |
| 量级差异大的多指标同图 | **全部归一化到基准年 = 100 的单轴折线** | 双轴、部分归一化 |
| 从 A 推导到 B 的分步增减 | 桥式图（waterfall）＋连接线＋增减标签 | 普通柱状 |
| 某个数占各自外部市场的比重 | 扇形小倍数（一个市场一个环形图） | 一个饼装多个不同分母的份额；横向堆叠条 |
| 多主体单指标横向比较 | 横向条形（`indexAxis:'y'`） | 折线 |
| 多维度定性评分（护城河） | 雷达图，`r` 轴固定 0–5 | — |

## 二、五条红线

1. **饼图的前提是各扇区同属一个整体、合计 100%。**
   份额类指标的分母是**彼此独立的不同市场**，硬塞进一个饼里，读者会误以为「中国占 90%、美国占 12%」这种加总关系。
   正确做法是**一个市场一个饼**——每个饼的 100% 就是那个市场自己的规模，内部完全自洽，
   饼与饼之间注明不可加总。（「不能把多个不同分母的份额塞进同一个饼」和「不能用饼图」是两回事。）
2. **饼图无法表示负值。** 有负值的分项必须排除，并说明排除后基数与合计的差异。
3. **桥式图中间柱悬空是固有画法，不是 bug**——但**必须补连接线，否则一定会被当成渲染错误**。
   同一张图被追问过三次，原因是说明写在图**下面**、而读者只看图本身。
   **读法必须放在标题正下方、画布之前**（`.wfhint`），连接线画实线不画虚线。
4. **`tension` 一律为 0，所有折线，不只是归一化合并趋势图。**
   本文件原来只在「合并趋势图」那节写了这条，而下面 `L()` 的默认值却是 `.32`，
   结果照抄代码的三份报告全部带着假峰谷交付。腾讯那份的份额图被样条拉出一个根本不存在的
   FY2021→FY2022 圆顶、覆盖倍数图在 FY2022→FY2023 之间凸出到高于两端——**两个校验脚本都没拦住，
   是截图目视才发现的**。5–6 个点的折线没有任何理由用样条。
5. **绝对值流量指标不能把半年数和完整财年画在同一条线上。**
   收入、利润、现金流这类流量指标，`1H26` 只有六个月，画在五个完整财年后面末端必然腰斩，
   读者第一眼读到的是「业务萎缩」。腾讯那份的分部收入图初版就是这样，四条线在 FY2025 之后集体跳水。
   正解是换成**最近十二个月**（`FY2025 − 1H25 + 1H26`），与前五列同口径、可直接比高低，
   并在报告里给出这一列的来源表。<br/>
   存量指标（净现金、净资产、月活）和比率指标（毛利率、市盈率）没有这个问题，
   直接用 `1H26` 时点值即可。判断方法：**这个数乘以 2 才能和上一年比吗？** 要，就是流量，必须换口径。

## 三、合并趋势图：要么全部归一化，要么不要合并

历史病因不是「没归一化」，而是「只归一化了一半」：五条线是指数、PE／PB 是原始倍数挂在右轴。
后果是右轴被量级最大的序列撑满，而且**右轴序列的像素位置由右轴决定，读者却照着左轴读**——
海底捞 PB=4.58 被画在左轴 −50 附近，扫一眼就是「负的」。

规则：

- 全部换算成指数，**删掉右轴**，原值塞进 tooltip。
- `tension` 归零（这条已升级为全局红线，见「五条红线」第 4 条）。
- 加一条 `=100` 的基准虚线，「有没有回到起点」不用去数刻度。基准线画在数据下层，标签画在上层。
- **全部为正值时用对数刻度**：等距离即等涨跌幅，斜率才真的可比。
  有负值或 0 的（海底捞归母 −41.6 亿、股息 0）不能用对数，只能单一线性轴＋剔除异常点，基准年相应后移。
- **盈利近零时算出的 PE 不是估值信号而是除法产物**，按 `null` 留空（tooltip 里给原值和原因）。
  海底捞 FY2022 PE=81 倍（归母仅 13.7 亿）画进去会毁掉坐标轴。

## 四、可复用代码

### 4.1 全局常量与默认值

```js
const C='#4aa8ff',C2='#7aa2f7',DIM='#8b949e',LINE='#30363d',TXT='#e6edf3';
const GOOD='#3fb950',WARN='#d29922',BAD='#f85149',GOLD='#ffd93d',PUR='#bc8cff',CY='#39d0d8',PK='#f7768e';
Chart.defaults.color=DIM;
Chart.defaults.font.family='-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
Chart.defaults.font.size=11;
Chart.defaults.plugins.legend.labels.boxWidth=12;
Chart.defaults.plugins.legend.labels.usePointStyle=true;
Chart.defaults.maintainAspectRatio=false;          // 高度由 .cw 容器控制

const grid={grid:{color:LINE,drawBorder:false},ticks:{color:DIM}};
const gridNo={grid:{display:false},ticks:{color:DIM}};
const ax=(t)=>({...grid,title:{display:true,text:t,color:DIM}});
/* tension 必须为 0，见「二、五条红线」第 4 条。这里曾经默认 .32，
   于是照抄本文件的三份报告全都带上了假峰谷——规则写在文档里、代码没改，等于没改。 */
const L=(o)=>Object.assign({tension:0,pointRadius:4,borderWidth:2.5,fill:false},o);
const Y5=['FY2021','FY2022','FY2023','FY2024','FY2025'],Y6=[...Y5,'1H26'];
```

地区配色固定，便于跨图对读：中国 `GOLD`、北美／美国 `C`、欧洲 `PUR`。

### 4.2 通用趋势图

```js
function trend(id,labels,ds,unit,digits,opt){
  const d=digits==null?1:digits;
  new Chart(document.getElementById(id),{type:'line',
    data:{labels,datasets:ds.map(x=>L(x))},
    options:Object.assign({interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:TXT,padding:10}},
        tooltip:{callbacks:{label:c=>` ${c.dataset.label}: `+
          (c.parsed.y==null?'—':c.parsed.y.toFixed(d))+` ${unit}`}}},
      scales:{x:gridNo,y:ax(unit)}},opt||{})});
}
```

### 4.3 构成趋势（绝对值＋占比两张并排）

`pct=true` 时占比分母 = **当年各分项之和**（合计恒为 100%），不要外挂集团口径分母。

```js
function mkTrend(id,src,cols,pct,unit,digits,div){
  const ks=Object.keys(src), d=digits==null?1:digits, u=unit||'亿美元', k=div==null?100:div;
  const sc=v=>+(v/k).toFixed(d);
  const sum=Y5.map((_,j)=>ks.reduce((a,key)=>a+src[key][j],0));
  const fmt=v=>v.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
  new Chart(document.getElementById(id),{type:'line',
    data:{labels:Y5,datasets:ks.map((key,i)=>L({label:key,borderColor:cols[i],borderWidth:3,
      data:pct?src[key].map((v,j)=>+(v/sum[j]*100).toFixed(1)):src[key].map(sc)}))},
    options:{interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:TXT,boxWidth:12,padding:12}},
        tooltip:{callbacks:{label:c=>c.dataset.label+'：'+
          (pct?c.parsed.y+'%':fmt(c.parsed.y)+' '+u)}}},
      scales:{x:gridNo,y:{...grid,beginAtZero:true,
        ticks:{color:DIM,callback:v=>pct?v+'%':v.toLocaleString(undefined,{maximumFractionDigits:0})}}}}});
}
```

### 4.4 基准线插件

```js
function baseline(id,val,txt,side){return{id,
  beforeDatasetsDraw(c){                       // 线画在数据下层
    const ys=c.scales.y; if(!ys) return;
    const y=ys.getPixelForValue(val),{left,right}=c.chartArea,x=c.ctx;
    x.save();x.strokeStyle=DIM;x.lineWidth=1;x.setLineDash([3,3]);x.globalAlpha=.6;
    x.beginPath();x.moveTo(left,y);x.lineTo(right,y);x.stroke();x.restore();},
  afterDatasetsDraw(c){                        // 标签画在数据上层，否则被线压住
    const ys=c.scales.y; if(!ys) return;
    const y=ys.getPixelForValue(val),{left,right}=c.chartArea,x=c.ctx;
    x.save();x.font='500 9.5px -apple-system,"PingFang SC",sans-serif';
    const w=x.measureText(txt).width;
    // side='below'：右端基准线上方常被首条线占住，只有下方是空的
    const bx=side==='below'?right-w-8:left+3, by=side==='below'?y+1:y-14;
    x.fillStyle='#0d1117';x.fillRect(bx,by,w+5,13);
    x.globalAlpha=.85;x.fillStyle=DIM;x.textAlign='left';x.textBaseline='top';
    x.fillText(txt,bx+2,by+2);x.restore();}};}
const base100=baseline('base100',100,'FY2021 基准 = 100','below');
```

### 4.5 核心指标归一化合并趋势图

```js
const RAW ={'股价':[...],'营业收入':[...],'归母净利':[...],'每股股息':[...],'PE':[...],'PB':[...]};
const UNIT={'股价':'HK$','营业收入':'亿元','归母净利':'亿元','每股股息':'HK$','PE':'倍','PB':'倍'};
const DEC ={'每股股息':3,'PB':2,'股价':2};     // 各序列小数位不同，tooltip 要分别控制
const CORE=v=>Object.assign({tension:0,pointRadius:3.5,borderWidth:2.5,fill:false},v);

new Chart(document.getElementById('cCore'),{type:'line',
 data:{labels:Y5,datasets:[
  CORE({label:'股价（指数）',    data:[...],borderColor:C,   borderWidth:3.4}),
  CORE({label:'营业收入（指数）',data:[...],borderColor:CY}),
  CORE({label:'归母净利（指数）',data:[...],borderColor:GOLD}),
  CORE({label:'每股股息（指数）',data:[...],borderColor:PK,  borderWidth:3.4}),
  CORE({label:'PE（指数）',      data:[...],borderColor:PUR, borderDash:[6,4],borderWidth:2}),
  CORE({label:'PB（指数）',      data:[...],borderColor:BAD, borderDash:[6,4],borderWidth:2})]},
 options:{interaction:{mode:'index',intersect:false},
  plugins:{legend:{labels:{color:TXT,padding:9}},
   tooltip:{callbacks:{label:c=>{
     const n=c.dataset.label.replace('（指数）',''), r=RAW[n][c.dataIndex];
     const d=DEC[n]==null?1:DEC[n];
     return r===null? ` ${n}: n.m.`
                    : ` ${n}: ${r.toFixed(d)} ${UNIT[n]}　（指数 ${c.parsed.y}）`;}}}},
  // 全正值才可用对数刻度；含负值或 0 时去掉 type 与 afterBuildTicks
  //
  // 两个易错点：
  // 1. 自定义的 ticks 必须排在 ax() **之后**。ax() 自己带 ticks，Object.assign 后者覆盖前者，
  //    写在前面会被静默吃掉。腾讯那份初版就是这样，对数轴上六个刻度只显示出 100 和 330 两个。
  // 2. 对数轴默认只给「主刻度」加标签，即使 afterBuildTicks 塞了值也不会全部显示，
  //    所以要显式给 callback 并关掉 autoSkip。
  scales:{x:gridNo,y:Object.assign({},ax('指数（FY2021 = 100，对数刻度）'),
    {type:'logarithmic',min:50,max:350,
     afterBuildTicks:a=>{a.ticks=[50,70,100,150,200,300].map(v=>({value:v}));},
     ticks:{color:DIM,autoSkip:false,callback:v=>v}})}},
 plugins:[base100]});
```

### 4.6 桥式图（连接线 + 增减标签）

```js
/* 方向无法从数据数组推断（减法条与加法条都写成 [低,高]），故由「上一步累计值」推导起点 */
function wfMeta(d){let r=null;return d.map(v=>{
  if(v[0]===0){r=v[1];return{tot:true,lv:v[1],delta:v[1]};}
  const s=(v[0]===r)?v[0]:v[1],e=(v[0]===r)?v[1]:v[0];r=e;
  return{tot:false,lv:e,delta:e-s};});}

const wfAid={id:'wfAid',afterDatasetsDraw(c,_a,o){
  const m=c.getDatasetMeta(0),d=c.data.datasets[0].data,M=wfMeta(d),ys=c.scales.y,x=c.ctx;
  x.save();
  /* 衔接线要画实：虚线 + 高透明会让中间柱看起来是「悬空的 bug」，阶梯关系必须一眼可见 */
  x.strokeStyle=TXT;x.lineWidth=1.4;x.globalAlpha=.5;
  x.font='500 9.5px -apple-system,"PingFang SC",sans-serif';x.textBaseline='bottom';
  for(let i=0;i<d.length-1;i++){
    const B=d[i+1],lv=M[i].lv;
    if(lv!==B[0]&&lv!==B[1])continue;          // 不相接（独立对比条）则不画线
    const dup=M[i].tot||M[i+1].tot;            // 首尾落点与总计柱自身标签重复，只画线不标数
    const a=m.data[i],b=m.data[i+1],yy=ys.getPixelForValue(lv);
    const x1=a.x+(a.width||0)/2,x2=b.x-(b.width||0)/2;
    x.beginPath();x.moveTo(x1,yy);x.lineTo(x2,yy);x.stroke();
    x.globalAlpha=.75;x.fillStyle=DIM;x.textAlign='center';
    if(!dup) x.fillText(lv.toFixed(1),(x1+x2)/2,yy-3);   // 标出落点，算式才闭合
    x.globalAlpha=.5;
  }
  x.globalAlpha=1;x.textAlign='center';x.textBaseline='bottom';
  x.font='600 10.5px -apple-system,"PingFang SC",sans-serif';
  M.forEach((s,i)=>{const el=m.data[i];
    x.fillStyle=s.tot?TXT:(s.delta>0?BAD:GOOD);
    x.fillText((s.tot?'':(s.delta>0?'+':'−'))+o.fmt(Math.abs(s.delta)),el.x,Math.min(el.y,el.base)-4);});
  x.restore();}};

const wfTip=u=>({callbacks:{label:c=>{
  const M=wfMeta(c.chart.data.datasets[0].data)[c.dataIndex];
  return M.tot?` ${M.delta.toFixed(1)} ${u}`
   :` 该步 ${M.delta>0?'+':'−'}${Math.abs(M.delta).toFixed(1)} ${u}　→ 累计 ${M.lv.toFixed(1)}`;}}});
```

配套的读法必须写在画布**之前**：

```html
<h3>企业价值桥式图</h3>
<p class="wfhint">首尾两根柱是<b>绝对金额</b>，中间三根表示<b>增减量</b>，
  每根从上一根的终点起跳，因此不落地。算式：107.1 − 37.6 + 44.1 + 5.0 = 118.6</p>
<div class="cw"><canvas id="cEv"></canvas></div>
```

### 4.7 扇形小倍数（区域市占率）

```js
const ctrTxt={id:'ctrTxt',afterDraw(c,a,o){
  const{ctx,chartArea:{left,right,top,bottom}}=c;
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=o.color;ctx.font='600 15px -apple-system,"PingFang SC",sans-serif';
  ctx.fillText(o.text,(left+right)/2,(top+bottom)/2);ctx.restore();}};

function sharePie(id,share,color,label,note){
  new Chart(document.getElementById(id),{type:'doughnut',
    data:{labels:['本公司','该市场其余部分'],
      datasets:[{data:[share,100-share],backgroundColor:[color,'#1c2128'],
        borderColor:'#0d1117',borderWidth:1.5}]},
    options:{cutout:'64%',plugins:{legend:{display:false},
      ctrTxt:{text:label,color},
      tooltip:{callbacks:{label:c=>c.dataIndex===0
        ? ` 本公司：${label}${note||''}` : ` 其余：${(100-share).toFixed(1)}%`}}}},
    plugins:[ctrTxt]});
}
```

配 `.pgrid` / `.pcell` 栅格横向排开，中心直接标份额数字，下方注明**各饼之间不能加总**。

### 4.8 折叠块画布

```js
/* details 关闭时 canvas 尺寸为 0，Chart.js 不会自愈，展开必须重算 */
document.querySelectorAll('details.fold').forEach(d=>d.addEventListener('toggle',()=>{
  if(!d.open) return;
  d.querySelectorAll('canvas').forEach(c=>{const ch=Chart.getChart(c); if(ch) ch.resize();});
}));
```

### 4.9 吸顶目录跟随高亮

```js
(function(){
  const links=[...document.querySelectorAll('.toc a')];
  const secs=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if(secs.length!==links.length) return;                 // 有死锚点就不启用，避免错位高亮
  const mark=()=>{let i=0;secs.forEach((s,k)=>{if(s.getBoundingClientRect().top<=90)i=k;});
    links.forEach((a,k)=>a.classList.toggle('on',k===i));};
  mark(); addEventListener('scroll',mark,{passive:true});
})();
```

## 五、图注写法

- 位置：**图表说明写在标题正下方、画布之前**；只有算式走查、数据出处这类可以放图下 `.note`。
- 内容：**不重复图上看得见的东西**。「营收是一条平线：指数 100→104」这种删掉，
  只留「为什么会这样、意味着什么」。曾有一段 380 字的图注按此压到 190 字。
- 过期风险：改了图形要同步改图注。曾出现注释仍写「虚线即衔接位置」而线已改成实线。
- **不要用颜色指代序列。** 写「每股股息（绿色）」有三个问题：改配色就失效（实际那条是粉色，
  已经错过一次）、打印和色觉障碍下不成立、读者还得先在图例里找颜色。直接写序列名。
  校验器会拦正文里的「（绿色）」「（蓝色）」这类写法。

## 六、改同类图表必须全文检索

历史上被追问「不是让你改成趋势图吗」，原因是只改了第四章、漏了第二章的三张构成饼。
被指出一类图表问题后，**不要只改被圈的那一处**，按下面的顺序走：

```bash
# 1. 统计全文该类型还剩多少
grep -o "type:'\(pie\|doughnut\)'" 报告.html | wc -l
# 2. 列出每一处的上下文，逐个判断是该改还是该留
grep -n -B12 "type:'doughnut'" 报告.html | grep -E "canvas id|/\* ----|type:"
```

**确实要保留一部分时，必须在报告里说明为什么保留**，否则读者会认为是漏改。
真实例子：屠宰市占率 4 张改成趋势图、肉制品市占率 5 张保留扇形图——
因为后者各机构同年数据相差 36 倍、做不了趋势。这句话不写，看起来就是改了一半。
