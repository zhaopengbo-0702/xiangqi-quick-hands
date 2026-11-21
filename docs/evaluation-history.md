# 本局评估走势的记录与平滑公式

自 v2.7.0 起，主面板用平滑曲线连接本局已计算局面的评估点。本页说明记录规则、统一视角、全部插值公式和 SVG 绘制关系，对应 [`extension/content.js`](../extension/content.js) 中的 `recordEvaluation`、`evaluationCurvePath` 与 `renderEvaluationHistory`。

## 实际记录了什么

每次成功计算记录一个点，横坐标是该次计算开始时棋盘的 `moveCount`。每一手表示一个单方步，开局局面记为第 0 手。同一手再次计算会更新原记录，然后按手数排序。鼠标指向曲线或用键盘聚焦记录点时，可查看对应手数和实际评估。

走势使用现有“开始自动”“走一步”“分析局面”的计算结果，不增加后台分析任务。仅连接真实记录的点，不补造未计算的手数；中途打开时，从第一次实际计算的局面开始。

暂停、收起面板和重新连接引擎会保留当前页面中的本局记录。切换对局、题目，或识别人机重新开局时清零。刷新页面后重新开始记录；当前版本不将走势写入浏览器存储。

## 输入点与固定红方视角

设记录点共有 $`n`$ 个，按横坐标严格递增排列：

```math
(t_i,v_i),\qquad i=0,\ldots,n-1,
\qquad t_i=\mathrm{moveCount}_i.
```

每次搜索的普通面板分数 $`s_i`$ 已完成原始评分的 tanh、PCHIP、上限限制和六位舍入，详细定义见 [评估转换与插值函数](evaluation-mapping.md)。这里不重新变换该分数，只统一双方的比较方向。令行棋方符号为：

```math
\sigma_i=
\begin{cases}
+1,&\text{该局面轮到红方},\\
-1,&\text{该局面轮到黑方}.
\end{cases}
```

普通评分与非零杀棋点分别转换为：

```math
\begin{aligned}
v_i&=\sigma_i s_i,
&&\text{普通评分},\\
v_i&=\sigma_i\,\mathrm{sgn}(m_i),
&&\text{非零杀棋评分 }m_i.
\end{aligned}
```

因此曲线正值表示红方有利，负值表示黑方有利。普通点满足 $`|v_i|\le0.999999`$；非零杀棋点绘于 $`+1`$ 或 $`-1`$，同时标注优势方及杀棋步数。`mate = 0` 跳过图表记录，数字评估仍按引擎结果显示“杀棋 0”。

## 相邻间距与割线斜率

对 $`n\ge2`$，每个区间定义：

```math
\begin{aligned}
h_i&=t_{i+1}-t_i>0,\\
\delta_i&=\frac{v_{i+1}-v_i}{h_i},
\qquad i=0,\ldots,n-2.
\end{aligned}
```

实际横坐标间距 $`h_i`$ 参与计算。两次记录相隔多手时，插值按实际手数连接，不将所有记录当作等间距点。

## 内部节点的一阶导数

令 $`d_i`$ 表示曲线在节点 $`t_i`$ 的导数。对 $`1\le i\le n-2`$，使用 Fritsch–Butland 加权调和平均：

```math
w_1=2h_i+h_{i-1},\qquad
w_2=h_i+2h_{i-1}.
```

```math
d_i=
\begin{cases}
0,&\delta_{i-1}\delta_i\le0,\\
\displaystyle\frac{w_1+w_2}
{w_1/\delta_{i-1}+w_2/\delta_i},
&\delta_{i-1}\delta_i>0.
\end{cases}
```

当相邻割线变号或其中一条为零时，节点导数取零，让曲线平滑转向或进入平段。

## 两端的单边斜率与限制规则

对 $`n\ge3`$，先定义端点计算函数 $`E`$。给定相邻间距 $`a,b`$ 与割线斜率 $`p,q`$，计算候选值：

```math
e=\frac{(2a+b)p-aq}{a+b}.
```

先校正方向：

```math
e^{\ast}=
\begin{cases}
0,&\mathrm{sgn}(e)\ne\mathrm{sgn}(p),\\
e,&\text{其他情况}.
\end{cases}
```

再限制转向区间的幅度：

```math
E(a,b,p,q)=
\begin{cases}
3p,&\mathrm{sgn}(p)\ne\mathrm{sgn}(q)\ \text{且}\ |e^{\ast}|>3|p|,\\
e^{\ast},&\text{其他情况}.
\end{cases}
```

这两个顺序步骤与代码中先判断符号、再判断斜率上限的规则等价。左右端点分别为：

```math
\begin{aligned}
d_0&=E(h_0,h_1,\delta_0,\delta_1),\\
d_{n-1}&=E(h_{n-2},h_{n-3},\delta_{n-2},\delta_{n-3}).
\end{aligned}
```

若只有两个点，则直接取：

```math
d_0=d_1=\delta_0.
```

这时得到直线段。只有一个点时仅显示记录点，不构造连线；没有点时显示等待首次评估。

## 每一段的完整 Hermite 插值函数

在 $`t_i\le t\le t_{i+1}`$ 上，令局部变量：

```math
u=\frac{t-t_i}{h_i},\qquad0\le u\le1.
```

四个基函数为：

```math
\begin{aligned}
H_{00}(u)&=2u^3-3u^2+1,\\
H_{10}(u)&=u^3-2u^2+u,\\
H_{01}(u)&=-2u^3+3u^2,\\
H_{11}(u)&=u^3-u^2.
\end{aligned}
```

最终连线函数为：

```math
\begin{aligned}
F_i(t)={}&H_{00}(u)v_i+H_{10}(u)h_id_i\\
&+H_{01}(u)v_{i+1}+H_{11}(u)h_id_{i+1}.
\end{aligned}
```

它满足：

```math
\begin{aligned}
F_i(t_i)&=v_i,&F_i(t_{i+1})&=v_{i+1},\\
F_i'(t_i)&=d_i,&F_i'(t_{i+1})&=d_{i+1}.
\end{aligned}
```

相邻两段共享同一个节点值和导数，所以整体曲线一阶连续。上述保形斜率规则使每段满足：

```math
\min(v_i,v_{i+1})\le F_i(t)\le\max(v_i,v_{i+1}).
```

曲线平滑仅影响连线，实际评估点不变。真实评估相差很大时，曲线仍经过这两个端点，只把连接处画成连续转弯，不将急剧变化抹平为其他评分。两段间的二阶导数不要求连续。

## 转成 SVG 三次 Bézier 路径

每个 Hermite 区间可等价地写成三次 Bézier 曲线，四个控制点位于“手数—评估值”坐标中：

```math
\begin{aligned}
P_0&=(t_i,v_i),\\
P_1&=\left(t_i+\frac{h_i}{3},\ v_i+\frac{h_id_i}{3}\right),\\
P_2&=\left(t_{i+1}-\frac{h_i}{3},\ v_{i+1}-\frac{h_id_{i+1}}{3}\right),\\
P_3&=(t_{i+1},v_{i+1}).
\end{aligned}
```

其参数形式为：

```math
\begin{aligned}
B_i(u)={}&(1-u)^3P_0+3(1-u)^2uP_1\\
&+3(1-u)u^2P_2+u^3P_3.
\end{aligned}
```

由于横坐标控制点等间距，$`B_i(u)`$ 的横坐标恰为 $`t_i+h_iu`$，纵坐标恰为 $`F_i(t_i+h_iu)`$。

设当前横轴最大手数为 $`T`$，SVG 中的仿射坐标转换为：

```math
X(t)=32+288\frac{t}{T},\qquad
Y(v)=72-58v.
```

将四个控制点分别转换为 $`(X,Y)`$，即可使用 SVG 的 `M` 起点与 `C` 三次曲线命令绘制。纵轴 $`+1,0,-1`$ 分别对应 SVG 的 $`Y=14,72,130`$；横轴始于第 0 手，随最后一个记录点向右扩展。SVG 坐标输出保留六位小数，该舍入仅用于绘图坐标，不回写原评估值。

## 与评分映射的区别

[评分映射](evaluation-mapping.md) 用 PCHIP 将 tanh 后的数值重新标定为面板评分。此处用 PCHIP 将“不同手数上的实际评分点”连接成平滑走势。两处都使用保形分段三次 Hermite 方法，但自变量、节点、目标和计算时机不同：前者决定一个点的数值，后者只决定点之间怎样连线。
