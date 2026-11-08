---
title: P4 单周期 CPU 设计文档（Verilog）
date: 2026-11-04 15:05:28
updated: 2026-11-08
permalink: 2026/11/04/co-p4-single-cycle-cpu/
description: 以 Controller 为核心的 Verilog 单周期 CPU，集中表达指令动作，附模块接口、处理流程、测试方案与课程思考题。
tags:
  - 计组实验
  - Verilog
  - MIPS
categories:
  - 学习
---

> 本文重点是 Controller 单元。设计草稿见总体数据通路和模块接口，测试方案见第六章，课程思考题见第九章。

>本工程最终实现将加指令步骤简化为两步（目前能想到的最轮椅的方法）：
>1.在def.v中给出opcode和funct对应宏
>2.在controller.v中新增一个分支，不需要改动其他端口

<!-- more -->

## 目录

- [开篇：Controller——本设计的重点](#controller-focus)
  - [接口：能读什么、能做什么](#controller-interfaces)
  - [统一默认值与组合逻辑](#controller-defaults)
  - [具名译码与公共计算](#controller-decode)
  - [movz、sb、lw、jal 重点代码](#controller-examples)
  - [集中添加指令的方法与资源边界](#controller-extension)
- [一、CPU 设计方案综述](#section-1)
- [二、指令格式与 RTL](#section-2)
- [三、总体数据通路与统一处理流程](#section-3)
- [四、模块接口与内部设计](#section-4)
  - [4.1 mips：顶层连接](#section-4-1)
  - [4.2 IFU：取指与 PC 更新](#section-4-2)
  - [4.3 Controller：译码与指令动作](#section-4-3)
  - [4.4 GRF：三读一写寄存器堆](#section-4-4)
  - [4.5 DM：数据存储器](#section-4-5)
  - [4.6 EXT：立即数扩展](#section-4-6)
- [五、各指令的处理流程与动作表](#section-5)
  - [5.1 指令处理总览](#section-5-1)
  - [5.2 寄存器与立即数运算](#section-5-2)
  - [5.3 lw：整字加载](#section-5-3)
  - [5.4 sw、sb：整字与字节存储](#section-5-4)
  - [5.5 beq、j、jal、jr：分支与跳转](#section-5-5)
  - [5.6 movz：条件传送](#section-5-6)
  - [5.7 完整动作表](#section-5-7)
- [六、测试方案与验证记录](#section-6)
- [七、新增指令与调试方法](#section-7)
- [八、工程文件与使用约定](#section-8)
- [九、思考题](#section-9)
  - [9.1 DM 的地址来源与位段](#question-1)
  - [9.2 两种控制器译码方式](#question-2)
  - [9.3 同步复位与异步复位](#question-3)
  - [9.4 忽略溢出时的加法指令](#question-4)

<a id="controller-focus"></a>

## 开篇：Controller——本设计的重点

### 设计目标：让一条指令的 RTL 对应一个分支

本次设计最想解决的问题，是加一条指令时，相关修改散落在不同模块和不同选择表中：读寄存器要改一处，运算选择要改一处，访存宽度又要改一处，最后还要确认写回和跳转控制没有遗漏。

因此，本工程把**指令识别、计算和最终动作集中到 Controller**。阅读某条指令时，先找到它的分支，就能看到它要写哪个寄存器、访问什么内存、是否改变下一条地址。模块之间传递的是实际地址、数据和使能。

例如，`regWriteAddr` 直接表示最终写入的寄存器编号；`regWriteData` 直接表示写入值；`pcTarget` 直接表示转移目标。新增指令可以用现有输入计算这些值，无须先给特殊结果额外安排一套全局选择编号。

![以 Controller 为中心的总体数据通路](/img/posts/co-p4-single-cycle-cpu/datapath.png)

Controller 自己不保存架构状态，也没有时钟端口。它根据当前指令和旧数据生成动作；GRF、DM、IFU 分别负责在上升沿执行写寄存器、写内存和更新 PC。同步复位的优先级也由这些状态部件处理。

> 开头所说的“两步加指令”，指复用现有接口和硬件能力时的设计修改：在 def.v 写编码，在 Controller 完成具名识别和一个动作分支。测试用例与参考模型仍要同步补充；若指令需要新的存储状态或更多写口，则还需扩展对应部件。

<a id="controller-interfaces"></a>

### 一、先约定“能读什么、能做什么”

Controller 的输入包括当前指令和地址上下文、三个寄存器旧值，以及内存读回数据。输出按用途分成四类：

| 接口类别 | 关注的问题 | 主要信号 |
|---|---|---|
| 寄存器读取 | 本条指令需要读谁？ | rsAddr、rtAddr、rdAddr |
| 寄存器写回 | 是否写，写谁，写什么？ | regWriteEnable、regWriteAddr、regWriteData |
| 内存访问 | 是否访存，访问哪里，按什么宽度？ | memReadEnable、memWriteEnable、memAddr、memWriteData、memSize、loadUnsigned |
| PC 更新 | 是否转移，转到哪里？ | pcRedirect、pcTarget |

下面是与当前源码一致的完整接口规格，方向均相对于 Controller：

| 信号 | 方向 | 位宽 | 规格 |
|---|---|---:|---|
| pc | I | 32 | 当前指令地址，保留为后续地址相关指令的上下文；当前分支未使用 |
| instr | I | 32 | 当前机器指令 |
| pcPlus4 | I | 32 | 顺序地址，也是 jal 的返回地址 |
| branchTarget | I | 32 | beq 成立时的目标地址 |
| jumpTarget | I | 32 | j、jal 的目标地址 |
| rsData | I | 32 | GRF 根据 rsAddr 输出的旧寄存器值 |
| rtData | I | 32 | GRF 根据 rtAddr 输出的旧寄存器值 |
| rdData | I | 32 | GRF 根据 rdAddr 输出的旧寄存器值；当前预留 |
| memReadData | I | 32 | DM 组合读回数据，当前用于 lw 写回 |
| rsAddr | O | 5 | 默认 `instr[25:21]`，可在新指令分支覆盖读地址 |
| rtAddr | O | 5 | 默认 `instr[20:16]` |
| rdAddr | O | 5 | 默认 `instr[15:11]` |
| regWriteEnable | O | 1 | 1 请求写 GRF；0 不写，目标寄存器保持原值 |
| regWriteAddr | O | 5 | 最终写寄存器编号，仅写使能为 1 时有写入意义 |
| regWriteData | O | 32 | 最终写入值，仅写使能为 1 时有写入意义 |
| memReadEnable | O | 1 | 1 请求 DM 组合读取；0 时 DM 返回 0 |
| memWriteEnable | O | 1 | 1 请求在上升沿写 DM；还须满足地址与宽度合法 |
| memAddr | O | 32 | 完整字节地址，不在顶层截成数组下标 |
| memWriteData | O | 32 | 原始存储数据；sb 由 DM 取低 8 位 |
| memSize | O | 2 | 00 字节、01 半字、10 整字、11 保留 |
| loadUnsigned | O | 1 | 0 符号扩展、1 零扩展；仅字节/半字加载有区别 |
| pcRedirect | O | 1 | 1 请求采用 pcTarget；0 使用 PC+4 |
| pcTarget | O | 32 | 完整转移地址，仅 pcRedirect=1 时被选择 |

三个读口的名字与指令字段相对应。`rsData/rtData/rdData` 都是读取出的寄存器旧值；`regWriteData` 才是本条指令准备写入的新值。读 rd 的能力已接好，当前 movz 并不需要使用 rdData，因为条件失败时可以直接关闭写使能。

<a id="controller-defaults"></a>

### 二、组合块先统一给默认值

下面摘录自 Controller 的 `always @(*)` 开头。这些语句在每次组合计算中执行：

```verilog
    rsAddr = instr[25:21];
    rtAddr = instr[20:16];
    rdAddr = instr[15:11];
    regWriteEnable = 1'b0;
    regWriteAddr = `REG_zero;
    regWriteData = 32'b0;
    memReadEnable = 1'b0;
    memWriteEnable = 1'b0;
    memAddr = 32'b0;
    memWriteData = 32'b0;
    memSize = `MemSize_byte;
    loadUnsigned = `LoadUnsigned_sign;
    pcRedirect = 1'b0;
    pcTarget = 32'b0;
```

随后进入当前指令的分支，只覆盖该指令需要的动作。比如 movz 条件失败时没有覆盖 regWriteEnable，它就保持 0；sb 没有设置寄存器写回和跳转，相关使能也自然保持关闭。

这里的默认赋值不修改 GRF、DM 或 PC，也不占一个额外周期。它描述组合电路的默认选择，并保证输出在每条路径上都有确定值，避免推断锁存器。`output reg` 允许过程赋值，并不意味着这些输出一定是物理寄存器。

| 输出 | 每次组合计算的默认值 | 含义 |
|---|---|---|
| rsAddr、rtAddr、rdAddr | 对应机器码字段 | 同时发出三路读地址 |
| regWriteEnable | 0 | 不写 GRF |
| regWriteAddr | 0 | 关闭写入时的确定占位值 |
| regWriteData | 0 | 关闭写入时的确定占位值 |
| memReadEnable | 0 | 不读取 DM |
| memWriteEnable | 0 | 不写入 DM |
| memAddr | 0 | 无访存时的确定占位值 |
| memWriteData | 0 | 无写入时的确定占位值 |
| memSize | 00 | 默认字节宽度；不表示正在访问内存 |
| loadUnsigned | 0 | 默认符号扩展；当前整字读取不受它影响 |
| pcRedirect | 0 | 默认顺序执行 |
| pcTarget | 0 | 不转移时的确定占位值 |

这些输出在 `always @(*)` 中使用阻塞赋值。每条指令只覆盖自己的动作，其余保持默认。输出声明为 reg 只表示过程赋值变量，不意味着综合出寄存器；组合逻辑完整赋值时不需要存储。

![统一默认值与指令动作的处理流程](/img/posts/co-p4-single-cycle-cpu/execution-flow.png)

<a id="controller-decode"></a>

### 三、机器码识别与公共数值分开表达

具名识别负责回答“当前是什么指令”。下面是原代码中的 movz 识别：

```verilog
reg [5:0] opCode;
reg [5:0] funct;
reg isR;
reg ismovz;

always @(*) begin
    opCode = instr[31:26];
    funct = instr[5:0];
    isR = (opCode == `OPCODE_R);
    ismovz = isR && (funct == `FUNCT_movz);
end
```

对应的宏集中在 def.v：

```verilog
`define OPCODE_R    6'h00
`define FUNCT_movz  6'h0a
```

公共计算负责提供多个指令都会使用的值。例如访存地址统一使用：

```verilog
wire [31:0] zeroImm;
wire [31:0] signImm;
reg [31:0] effectiveAddr;
EXT zeroExt(.imm16(imm16), .extOp(`EXT_zero), .result(zeroImm));
EXT signExt(.imm16(imm16), .extOp(`EXT_sign), .result(signImm));
always @(*) begin
    effectiveAddr = rsData + signImm;
end
```

这些计算即使在当前指令不使用时，也可以持续存在。是否产生有效操作由对应指令分支的使能决定。无需为了让一个表达式只在特定指令下“才计算”，再增加时序状态。

当前内部信号如下：

| 信号 | 位宽 | 规格 |
|---|---:|---|
| opCode | 6 | instr[31:26] |
| funct | 6 | instr[5:0] |
| imm16 | 16 | instr[15:0] |
| isR | 1 | opCode 等于 R 型主操作码 |
| isAdd、isSub、isJr、ismovz | 各 1 | isR 与对应 funct 同时匹配 |
| isOri、isLui、isLw、isSw、isSb、isBeq、isJ、isJal | 各 1 | 对应 opcode 匹配；互相独立的具名识别结果 |
| zeroImm | 32 | EXT 零扩展结果 |
| signImm | 32 | EXT 符号扩展结果 |
| effectiveAddr | 32 | `rsData + signImm`，用于 lw/sw/sb |

<a id="controller-examples"></a>

### 四、用四条实际指令理解这种写法

以下均摘取当前 Controller 的对应分支，省略相邻指令；说明中出现的“写入”指上升沿执行的状态更新请求。

#### 1. movz：把条件与写回放在一起

```verilog
end else if(ismovz) begin
    if(rtData == 32'b0) begin
        regWriteEnable = 1'b1;
        regWriteAddr = rdAddr;
        regWriteData = rsData;
    end
end
```

这一小段直接对应 RTL：当 rt 的旧值为 0 时，将 rs 的旧值写入 rd。条件不成立时没有写回动作，目标寄存器保持原值。即使 rd=rt，判断仍发生在写入之前，不会把本周期准备写入的结果当成判断输入。

新增这类条件写回指令时，条件就在分支里控制 regWriteEnable，不必再给 GRF 新增“movz 模式”。GRF 只认识一般的写入请求。

#### 2. sb：把访存的全部需求放在一起

```verilog
end else if (isSb) begin
    // DM选择地址对应的字节，只写rtData[7:0]。
    memWriteEnable = 1'b1;
    memAddr = effectiveAddr;
    memWriteData = rtData;
    memSize = `MemSize_byte;
end
```

在同一个分支中可以读出四件事：需要写内存、写到有效地址、数据来自 rt、宽度为字节。字节选择和局部写入由 DM 完成。寄存器写使能、内存读使能、PC 转移使能全部沿用关闭的默认值。

这也是已有部件能力对扩展的帮助：DM 已支持字节写入，所以加入 sb 时不必修改 DM 内部结构。

#### 3. lw：请求与写回在一起，数据依赖仍有先后

```verilog
end else if (isLw) begin
    // 同一周期：发出读取请求，DM组合读回，结果写入rt。
    memReadEnable = 1'b1;
    memAddr = effectiveAddr;
    memSize = `MemSize_word;
    regWriteEnable = 1'b1;
    regWriteAddr = rtAddr;
    regWriteData = memReadData;
end
```

该分支同时表达“我要读取内存”和“读到后写 rt”。实际组合依赖是：

```text
instr、rsData → effectiveAddr → DM组合读出 → memReadData → regWriteData
```

memReadData 改变时，组合块会重新计算，使写回数据稳定。这里没有多等一个周期。后续添加条件加载时，也可以在读回值确定后再决定是否写寄存器，但本次读取地址和读使能不能反过来依赖自己的读回结果。

同理，三路读地址若需要在新指令中覆盖，应由指令字段或其他独立上下文决定；不能让某个读口的地址依赖它自己当前读出的值，形成组合环路。

#### 4. jal：同一指令可以同时提出多个动作

```verilog
end else if (isJal) begin
    regWriteEnable = 1'b1;
    regWriteAddr = `REG_ra;
    regWriteData = pcPlus4;
    pcRedirect = 1'b1;
    pcTarget = jumpTarget;
end
```

jal 在一个分支中同时表达写返回地址与跳转。GRF 和 IFU 接收各自的动作，在同一个上升沿更新。普通算术指令只设置写回，sw/sb 只设置存储，beq 只按条件请求跳转；已有接口可以按指令语义组合使用。

当前没有一个“只有某类指令才允许输出某种动作”的额外模式号。因此，只要硬件资源足够，自定义指令也可以在一个分支里同时设置寄存器写入、内存写入与 PC 转移。

<a id="controller-extension"></a>

### 五、加指令时，主要改动集中在哪里

| 步骤 | 要做的事 | 现有代码示例 |
|---|---|---|
| def.v 中给出编码 | 明确 opcode；需要时再给出 funct 等字段编码 | FUNCT_movz、OPCODE_sb |
| Controller 中完成指令逻辑 | 增加具名识别，并在一个分支内写全需求和结果 | ismovz 分支、isSb 分支 |

实际动手前，先将题面写成“读什么、算什么、写哪里、下一条去哪里”的 RTL。然后只在该指令分支中回答下面几个问题：

```text
需要修改读地址吗？       → rsAddr / rtAddr / rdAddr
是否写寄存器？写什么？   → regWriteEnable / Addr / Data
是否访存？怎样访存？     → memReadEnable / memWriteEnable / Addr / Data / Size
是否跳转？跳到哪里？     → pcRedirect / pcTarget
```

没有涉及的动作不写，沿用默认值。完成后补充定向测试，特别检查条件不成立、源目的寄存器重合，以及新增功能是否影响旧指令。

这种集中组织有明确的资源边界：当前最多同时读取三个通用寄存器、写一个通用寄存器、使用一个 DM 访问地址。若题目要求双寄存器写回、双地址访存、新控制寄存器或异常处理，仍需增加硬件资源或状态；不能只靠新增一个分支完成。

---

<a id="section-1"></a>

## 一、CPU 设计方案综述

### 1.1 总体设计

本工程将 P3 的 Logisim 单周期 CPU 移植为 Verilog HDL，采用 32 位数据通路，指令存储器和数据存储器分离。每条指令在一个周期内完成取指、译码、计算、访存和写回所需的组合计算，在周期末的上升沿更新状态。

当前已实现：

```text
add、sub、ori、lui、lw、sw、sb、beq、j、jal、jr、movz、nop
```

不考虑延迟槽；`add/sub` 按模 `2^32` 运算，保留结果低 32 位，不产生溢出异常。`sb`、`movz`、`j` 是当前保留的扩展指令。

| 项目 | 规格 |
|---|---|
| 指令长度 | 32 位 |
| 通用寄存器 | 32 × 32 bit，三路组合读、一路同步写 |
| 零号寄存器 | 读取恒为 0，写请求不改变其值 |
| IM | 4096 × 32 bit，16 KiB |
| DM | 3072 × 32 bit，12 KiB，小端序 |
| PC 初始地址 | `0x00003000` |
| 复位 | 高有效、同步复位；在上升沿将 PC 设为初始地址，将 GRF、DM 清零 |
| 顺序地址 | PC+4 |
| 链接地址 | PC+4，无延迟槽 |
| 外部端口 | 仅 `clk`、`reset` 两个输入 |

### 1.2 当前模块划分

```text
mips
├─ IFU             保存 PC、读取指令、计算候选转移地址
├─ Controller         具名译码；每条指令集中表达计算与最终动作
│  ├─ EXT zeroExt  提供 zeroImm
│  └─ EXT signExt  提供 signImm
├─ GRF             rs、rt、rd 三路组合读取，一路同步写入
└─ DM              组合读取、同步写入，支持局部字节/半字写入
```

Controller 开头统一给输出默认值，再由匹配的指令分支覆盖所需输出。算术、逻辑和分支条件直接写在该指令分支中。最终写入由 IFU、GRF、DM 自己的时序逻辑完成。

本文只描述当前实际接入的单元，EXT 仍保留为 Controller 的两个子模块。DM 的半字加载、字节加载等属于部件能力，当前整机并未译码 `lb/lbu/lh/lhu/sh`。

<a id="section-2"></a>

## 二、指令格式与 RTL

### 2.1 指令字段与书写顺序

| 字段 | 位段 | 位宽 | 含义 |
|---|---|---:|---|
| opCode | `instr[31:26]` | 6 | 主操作码 |
| rsAddr | `instr[25:21]` | 5 | rs 读地址 |
| rtAddr | `instr[20:16]` | 5 | rt 读地址；部分指令的写入目标 |
| rdAddr | `instr[15:11]` | 5 | rd 读地址；部分 R 型指令的写入目标 |
| shamt | `instr[10:6]` | 5 | 固定移位量字段，当前指令执行未使用 |
| funct | `instr[5:0]` | 6 | R 型功能码 |
| imm16 | `instr[15:0]` | 16 | I 型立即数 |
| imm26 | `instr[25:0]` | 26 | J 型目标索引 |

| 类型 | 从高位到低位的机器码布局 |
|---|---|
| R 型 | `opcode[6] · rs[5] · rt[5] · rd[5] · shamt[5] · funct[6]` |
| I 型 | `opcode[6] · rs[5] · rt[5] · imm16[16]` |
| J 型 | `opcode[6] · imm26[26]` |

例如汇编写法是 `movz rd, rs, rt`，但机器码中字段仍按 `rs、rt、rd` 排列。I 型指令的 `[15:11]` 是立即数的一部分，虽然 GRF 也会根据这个位段读出 rdData，但当前这类指令不使用它。

### 2.2 RTL 记号与指令语义

`GPR[n]` 表示第 n 个寄存器；`M32[A]` 表示字节地址 A 开始的整字；`M8[A]` 表示地址 A 的一个字节。`SE/ZE` 分别表示扩展到 32 位的符号扩展、零扩展。下表操作码和功能码均为十六进制。

| 指令 | opcode | funct | RTL |
|---|---|---|---|
| `add rd, rs, rt` | `00` | `20` | `GPR[rd] ← (GPR[rs] + GPR[rt]) mod 2^32` |
| `sub rd, rs, rt` | `00` | `22` | `GPR[rd] ← (GPR[rs] - GPR[rt]) mod 2^32` |
| `ori rt, rs, imm` | `0d` | — | `GPR[rt] ← GPR[rs] OR ZE(imm16)` |
| `lui rt, imm` | `0f` | — | `GPR[rt] ← {imm16, 16'b0}` |
| `lw rt, offset(rs)` | `23` | — | `GPR[rt] ← M32[GPR[rs] + SE(imm16)]` |
| `sw rt, offset(rs)` | `2b` | — | `M32[GPR[rs] + SE(imm16)] ← GPR[rt]` |
| `sb rt, offset(rs)` | `28` | — | `M8[GPR[rs] + SE(imm16)] ← GPR[rt][7:0]` |
| `beq rs, rt, offset` | `04` | — | 相等时 `PC ← PC+4+(SE(imm16)<<2)`，否则 PC+4 |
| `j target` | `02` | — | `PC ← {(PC+4)[31:28], imm26, 2'b00}` |
| `jal target` | `03` | — | `GPR[31] ← PC+4`；PC 跳到 J 型目标 |
| `jr rs` | `00` | `08` | `PC ← GPR[rs]` |
| `movz rd, rs, rt` | `00` | `0a` | 若 `GPR[rt]==0`，则 `GPR[rd] ← GPR[rs]` |
| `nop` | 全零机器码 | — | 不修改 GRF、DM，PC+4 |

除表中明确请求转移的情形外，下一条地址均为 PC+4。所有写寄存器动作都受 GRF 的零号寄存器保护。

<a id="section-3"></a>

## 三、总体数据通路与统一处理流程

### 3.1 总体数据通路

总体连接见[开篇的数据通路图](#controller-focus)。

IFU 向 Controller 提供指令、PC 和候选地址。Controller 输出三个读地址，GRF 同时返回三个寄存器旧值；Controller 根据当前指令直接形成寄存器写入、内存访问和 PC 转移动作。

顶层只是连接这些接口，不保存额外架构状态。`rdData` 已接到 Controller，供以后需要读取目标寄存器旧值的指令使用；当前已实现指令没有使用它。

### 3.2 每个周期的处理流程

统一处理流程见[开篇的默认值与动作流程图](#controller-defaults)。

这里的取指、译码、计算和访存是同一周期内的组合依赖，不是多周期状态机。`always @(*)` 会在它所读取的输入变化时重新计算，因此新指令、GRF 读出值或 DM 返回值变化均可能触发一次计算。

所谓“统一初始化”实际是**每次组合计算先给默认值**，不是 `initial`，也不是清空实际寄存器或内存。该指令未覆盖的输出保持默认，防止沿用上一条指令的动作。

对于 lw，依赖关系为：

```text
指令 + rsData → effectiveAddr → DM 组合读取 → memReadData → regWriteData
```

读取地址和读取使能不能依赖本次 memReadData。虽然当前都写在同一个组合块中，数值依赖仍应保持这个方向。

<a id="section-4"></a>

## 四、模块接口与内部设计

以下方向均相对于当前表格所属模块；所有多位数据都按实际位宽传递。除特别说明外，接口值来自组合逻辑，存储更新在上升沿完成。

<a id="section-4-1"></a>

### 4.1 mips：顶层连接

```verilog
module mips(input clk, input reset);
```

| 信号 | 方向 | 位宽 | 规格 |
|---|---|---:|---|
| clk | I | 1 | 上升沿驱动 IFU、GRF、DM 的状态更新 |
| reset | I | 1 | 高有效同步复位，上升沿优先执行复位 |

顶层内部连接如下，表中的前缀为实例名。

| 顶层信号 | 位宽 | 来源 → 去向 |
|---|---:|---|
| pc | 32 | ifu.pc → controller.pc、grf.writePc、dm.pc |
| pcPlus4 | 32 | ifu.pcPlus4 → controller.pcPlus4 |
| instr | 32 | ifu.instr → controller.instr |
| branchTarget | 32 | ifu.branchTarget → controller.branchTarget |
| jumpTarget | 32 | ifu.jumpTarget → controller.jumpTarget |
| fetchValid | 1 | ifu.fetchValid → 顶层观察线，无下游状态更新控制 |
| rsAddr | 5 | controller.rsAddr → grf.rsAddr |
| rtAddr | 5 | controller.rtAddr → grf.rtAddr |
| rdAddr | 5 | controller.rdAddr → grf.rdAddr |
| rsData | 32 | grf.rsData → controller.rsData |
| rtData | 32 | grf.rtData → controller.rtData |
| rdData | 32 | grf.rdData → controller.rdData |
| regWriteEnable | 1 | controller.regWriteEnable → grf.writeEnable |
| regWriteAddr | 5 | controller.regWriteAddr → grf.writeAddr |
| regWriteData | 32 | controller.regWriteData → grf.writeData |
| memReadEnable | 1 | controller.memReadEnable → dm.readEnable |
| memWriteEnable | 1 | controller.memWriteEnable → dm.writeEnable |
| memAddr | 32 | controller.memAddr → dm.addr |
| memWriteData | 32 | controller.memWriteData → dm.writeData |
| memReadData | 32 | dm.readData → controller.memReadData |
| memSize | 2 | controller.memSize → dm.memSize |
| loadUnsigned | 1 | controller.loadUnsigned → dm.loadUnsigned |
| pcRedirect | 1 | controller.pcRedirect → ifu.pcRedirect |
| pcTarget | 32 | controller.pcTarget → ifu.pcTarget |

<a id="section-4-2"></a>

### 4.2 IFU：取指与 PC 更新

IFU 将 PC、下一地址选择和指令存储器放在一个模块内。

| 信号 | 方向 | 位宽 | 功能与有效条件 |
|---|---|---:|---|
| clk | I | 1 | PC 在上升沿更新 |
| reset | I | 1 | 上升沿为 1 时 PC 置为 `0x3000`，优先于转移 |
| pcRedirect | I | 1 | 0：顺序执行；1：下一地址取 pcTarget |
| pcTarget | I | 32 | 最终转移目标，仅 pcRedirect=1 时被选择 |
| pc | O | 32 | 当前 PC 寄存器值，字节地址 |
| pcPlus4 | O | 32 | 当前 pc+4，保留低 32 位 |
| instr | O | 32 | 合法地址对应的机器指令，否则返回全零 nop |
| branchTarget | O | 32 | PC+4 加上符号扩展的分支字节偏移 |
| jumpTarget | O | 32 | PC+4 的高 4 位与 imm26、低两位 00 拼接 |
| fetchValid | O | 1 | 地址在 IM 范围内且四字节对齐时为 1；仅用于观察 |

| 内部信号或存储 | 位宽 / 深度 | 规格 |
|---|---|---|
| pcReg | 32 | 同步复位、同步更新的 PC 状态 |
| instrMem | 4096 × 32 | 固定程序数组，仿真开始填 nop 并加载 code.txt |
| wordAddr | 32 | `(pc - IM_BASE) >> 2` |
| branchOffset | 32 | `{{14{instr[15]}}, instr[15:0], 2'b00}` |
| nextPc | 32 | `pcRedirect ? pcTarget : pcPlus4` |

```verilog
always @(*) begin
    pcPlus4 = pc + 32'd4;
    branchOffset = {{14{instr[15]}}, instr[15:0], 2'b00};
    branchTarget = pcPlus4 + branchOffset;
    jumpTarget = {pcPlus4[31:28], instr[25:0], 2'b00};
end
```

IM 从 `0x3000` 开始，合法指令起始地址到 `0x6ffc` 为止。低两位必须为 00。分支偏移的低两位也拼 00，表示立即数按指令字数计量；J 型高四位取自 PC+4。

指令数组通过 `$readmemh` 从 code.txt 加载，复位不重载程序。当前非法取指返回 nop，没有实现异常跳转机制。PC 未在 initial 中设初值，运行前必须先经过同步复位。

<a id="section-4-3"></a>

### 4.3 Controller：译码与指令动作

Controller 是本设计的重点，其完整接口表、默认赋值、译码、公共计算及 movz/sb/lw/jal 代码已经移到[开篇专章](#controller-focus)。本节不重复展开。

<a id="section-4-4"></a>

### 4.4 GRF：三读一写寄存器堆

| 信号 | 方向 | 位宽 | 规格 |
|---|---|---:|---|
| clk | I | 1 | 在上升沿复位或写入 |
| reset | I | 1 | 高有效同步复位；清零全部寄存器，优先于写入 |
| rsAddr | I | 5 | rs 读口地址，0～31 |
| rtAddr | I | 5 | rt 读口地址，0～31 |
| rdAddr | I | 5 | rd 读口地址，0～31 |
| rsData | O | 32 | rsAddr 对应寄存器的组合读出值 |
| rtData | O | 32 | rtAddr 对应寄存器的组合读出值 |
| rdData | O | 32 | rdAddr 对应寄存器的组合读出值 |
| writeEnable | I | 1 | 非复位时为 1 则产生写入请求 |
| writeAddr | I | 5 | 任意写入目标，不固定为 rd |
| writeData | I | 32 | 待写入数据 |
| writePc | I | 32 | 产生本次写入的当前指令地址，仅供日志使用 |

内部数组为 `reg [31:0] register[0:31]`。三个读口独立、同时有效，可以读同一个地址，也可以读不同地址；不需要增加周期。

```verilog
always @(*) begin
    rsData = (rsAddr == 0) ? 32'b0 : register[rsAddr];
    rtData = (rtAddr == 0) ? 32'b0 : register[rtAddr];
    rdData = (rdAddr == 0) ? 32'b0 : register[rdAddr];
end
```

三个读口都保护零号寄存器。写入采用非阻塞赋值；上升沿之前读到旧值，上升沿写入生效后组合读口反映新值，没有另外设计写入前的旁路。`rdData` 表示读出的旧数据，与 `regWriteData` 是两个不同概念。

写口独立命名，是因为 add/sub/movz 写 rd，ori/lui/lw 写 rt，jal 写 31。即使需要三个读数，当前仍只能在一个上升沿写一个寄存器。

非复位且 writeEnable=1 时记录：

```verilog
$display("@%h: $%d <= %h", writePc, writeAddr, writeData);
```

当前会记录写零号寄存器的请求，但不改变其存储值。reset=1 时不输出普通写入日志。

<a id="section-4-5"></a>

### 4.5 DM：数据存储器

| 信号 | 方向 | 位宽 | 规格 |
|---|---|---:|---|
| clk | I | 1 | 在上升沿复位或写入 |
| reset | I | 1 | 高有效同步复位，清空全部数据，优先于写入 |
| pc | I | 32 | 当前存储指令地址，仅供日志使用 |
| readEnable | I | 1 | 1 允许组合读取；0 则 readData=0 |
| writeEnable | I | 1 | 1 请求写入，实际还需 accessValid=1 |
| addr | I | 32 | 完整字节地址 |
| writeData | I | 32 | 原始输入数据，局部存储只取低 8/16 位 |
| memSize | I | 2 | 00 字节、01 半字、10 整字、11 保留 |
| loadUnsigned | I | 1 | 0 符号扩展、1 零扩展；存储操作忽略它 |
| readData | O | 32 | 按宽度选择并扩展后的数据；关闭或非法读取返回 0 |

| 内部信号或存储 | 位宽 / 深度 | 规格 |
|---|---|---|
| mem | 3072 × 32 | 数据数组，复位清零 |
| wordAddr | 30 | addr[31:2]，字下标 |
| byteOffset | 2 | addr[1:0]，字内字节偏移 |
| addrValid | 1 | wordAddr < 3072 |
| accessValid | 1 | 范围合法、访问宽度合法并满足该宽度对齐要求 |
| readWord | 32 | 允许且合法读取时的内存字，否则为 0 |
| readByte | 8 | readWord 中 byteOffset 对应字节 |
| readHalf | 16 | readWord 中 byteOffset[1] 对应半字 |
| byteData | 32 | readByte 的符号扩展或零扩展结果 |
| halfData | 32 | readHalf 的符号扩展或零扩展结果 |

| memSize | 访问宽度 | 地址要求 | 写入内容 | 读取结果 |
|---|---|---|---|---|
| 00 | 1 字节 | 无字内对齐限制 | writeData[7:0] | 选中字节，扩展到 32 位 |
| 01 | 2 字节 | addr[0]=0 | writeData[15:0] | 选中半字，扩展到 32 位 |
| 10 | 4 字节 | addr[1:0]=00 | writeData[31:0] | 完整 32 位字 |
| 11 | 保留 | 不允许 | 不写 | 返回 0 |

有效字节范围为 `0x00000000～0x00002fff`，整字起始地址最大为 `0x2ffc`。越界、未对齐或保留宽度访问均读 0、不写，不产生异常。

小端序下，字内偏移 0、1、2、3 分别对应位段 `[7:0]`、`[15:8]`、`[23:16]`、`[31:24]`。

```verilog
readByte = readWord[byteOffset * 8 +: 8];
readHalf = readWord[byteOffset[1] * 16 +: 16];
```

写入同样选择对应切片，其余字节保持原值。`readEnable` 与 `writeEnable` 独立，写内存不要求读使能为 1。

合法且非复位的写操作记录：

```verilog
$display("@%h: *%h <= %h", pc, addr, writeData);
```

日志使用完整字节地址和原始输入 writeData。因此 sb 日志也可能显示一个 32 位数，实际只写它的低 8 位。

<a id="section-4-6"></a>

### 4.6 EXT：立即数扩展

| 信号 | 方向 | 位宽 | 规格 |
|---|---|---:|---|
| imm16 | I | 16 | 原始立即数 |
| extOp | I | 1 | 0 零扩展；1 符号扩展 |
| result | O | 32 | 组合扩展结果 |

| extOp | 结果 | 用途 |
|---|---|---|
| 0 | `{16'b0, imm16}` | zeroExt 实例输出 zeroImm，供 ori 使用 |
| 1 | `{{16{imm16[15]}}, imm16}` | signExt 实例输出 signImm，供访存地址计算使用 |

Controller 同时实例化两种扩展，使用固定的 extOp。当前 lui 直接拼接 `{imm16,16'b0}`；IFU 的分支偏移单独在 IFU 内计算。

<a id="section-5"></a>

## 五、各指令的处理流程与动作表

<a id="section-5-1"></a>

### 5.1 指令处理总览

![各类指令的处理路径](/img/posts/co-p4-single-cycle-cpu/instruction-actions.png)

图中各路径最终都在同一个上升沿提交所需更新。计算结果和请求值在周期内先稳定，不能把图中的每个框理解为一个独立时钟周期。

<a id="section-5-2"></a>

### 5.2 寄存器与立即数运算

| 指令 | 读取与计算 | 写回动作 | PC 更新 |
|---|---|---|---|
| add | rsData + rtData | 使能写 rdAddr | PC+4 |
| sub | rsData - rtData | 使能写 rdAddr | PC+4 |
| ori | rsData OR zeroImm | 使能写 rtAddr | PC+4 |
| lui | `{imm16,16'b0}` | 使能写 rtAddr | PC+4 |

各指令只设置自己的计算结果和写回请求，代码组织方式见[开篇示例](#controller-examples)。

其余默认输出保持关闭，因此不会误写 DM 或请求跳转。lui 不依赖 rsData，不会在低 16 位残留原寄存器数据。

<a id="section-5-3"></a>

### 5.3 lw：整字加载

```text
提取 rs、rt、imm16
  → GRF 读 rsData；EXT 产生 signImm
  → effectiveAddr = rsData + signImm
  → memReadEnable=1，memAddr=effectiveAddr，memSize=10
  → DM 返回完整内存字 memReadData
  → regWriteEnable=1，regWriteAddr=rtAddr，regWriteData=memReadData
  → 上升沿写 rt，PC 更新为 PC+4
```

不需要额外等待一个周期。新指令扩展时，不要让 effectiveAddr 反过来依赖本次加载结果。

<a id="section-5-4"></a>

### 5.4 sw、sb：整字与字节存储

两者的公共流程为：读 rs 作基址、rt 作存储数据，计算 `rsData+signImm`，使能写内存，关闭寄存器写入；PC 顺序更新。区别只在 memSize。

| 指令 | memSize | DM 的实际写入 |
|---|---|---|
| sw | 10 | 完整 rtData 写入整字 |
| sb | 00 | rtData[7:0] 写入目标字节，其余字节保持 |

![sb 小端序局部写入](/img/posts/co-p4-single-cycle-cpu/sb-byte-write.png)

sb 分支仍传递完整 rtData，由 DM 统一负责截取和局部写入。地址低两位决定写哪个字节，不决定截取 rtData 的哪个字节。

<a id="section-5-5"></a>

### 5.5 beq、j、jal、jr：分支与跳转

| 指令 | 转移条件 | pcTarget | 额外动作 |
|---|---|---|---|
| beq | rsData == rtData | branchTarget | 无 |
| j | 恒成立 | jumpTarget | 无 |
| jal | 恒成立 | jumpTarget | 写 31 号寄存器，数据为 PC+4 |
| jr | 恒成立 | rsData | 无 |

beq 条件失败时 `pcRedirect=0`，IFU 使用 PC+4；此时 pcTarget 即使有分支目标也不会被选择。j/jal/jr 自己将 pcRedirect 置 1，不受 beq 条件限制。

jal 在同一个上升沿更新返回地址寄存器和 PC。jr 读取由 rsAddr 指定的寄存器，不固定读取 31 号；`jr $ra` 只是常见用法。

<a id="section-5-6"></a>

### 5.6 movz：条件传送

![movz 的条件与写回流程](/img/posts/co-p4-single-cycle-cpu/movz-flow.png)

对应代码见[开篇的 movz 示例](#controller-examples)。

条件失败时不需要把 rdData 重新写回，只需保持默认的 regWriteEnable=0，原值自然保留。即使 rd 与 rs 或 rt 重合，条件判断和待传送的数据仍取自上升沿之前的旧状态。

<a id="section-5-7"></a>

### 5.7 完整动作表

记 `EA=rsData+signImm`。表中“—”表示不产生该项有效动作，对应使能为 0；不是高阻 Z。

| 指令 | 写 GRF 条件 | 写地址 | 写数据 | 读 DM | 写 DM | memAddr | memSize | 转移条件 / 目标 |
|---|---|---|---|---:|---:|---|---|---|
| add | 恒成立 | rdAddr | rsData+rtData | 0 | 0 | — | — | 无 |
| sub | 恒成立 | rdAddr | rsData-rtData | 0 | 0 | — | — | 无 |
| ori | 恒成立 | rtAddr | rsData OR zeroImm | 0 | 0 | — | — | 无 |
| lui | 恒成立 | rtAddr | imm16 左移 16 位 | 0 | 0 | — | — | 无 |
| lw | 恒成立 | rtAddr | memReadData | 1 | 0 | EA | 10 | 无 |
| sw | 不写 | — | — | 0 | 1 | EA | 10 | 无 |
| sb | 不写 | — | — | 0 | 1 | EA | 00 | 无 |
| beq | 不写 | — | — | 0 | 0 | — | — | rsData==rtData / branchTarget |
| j | 不写 | — | — | 0 | 0 | — | — | 恒成立 / jumpTarget |
| jal | 恒成立 | 31 | pcPlus4 | 0 | 0 | — | — | 恒成立 / jumpTarget |
| jr | 不写 | — | — | 0 | 0 | — | — | 恒成立 / rsData |
| movz | rtData==0 | rdAddr | rsData | 0 | 0 | — | — | 无 |
| nop | 不写 | — | — | 0 | 0 | — | — | 无 |

sw/sb 的 memWriteData 均为 rtData；其他指令默认 0。loadUnsigned 当前所有分支均保持 0，因为当前加载指令只有 lw。复位和存储地址有效性仍由对应状态部件优先处理。

<a id="section-6"></a>

## 六、测试方案与验证记录

### 6.1 测试方案与覆盖目标

测试分为历史部件检查、固定程序检查和整机对拍。当前整机对拍使用扩展版 MARS 产生参考写入记录，由 COT 编译运行 CPU 并比较结果。下表列出覆盖目标；逐周期检查全部架构状态属于历史独立模型的检查范围，COT 主要比较可见写入事件。

| 检查时机 | 检查内容 |
|---|---|
| 上升沿之前 | PC、指令、三路读地址与旧值、写回动作、访存请求、访问格式、转移目标 |
| 上升沿之后 | 下一 PC、全部 32 个寄存器、本次写入的内存字 |
| 程序结束 | 全部 3072 个内存字 |
| 日志 | 写入数量、顺序、PC、地址、数据和格式；复位期间没有普通写入日志 |

| 类别 | 覆盖重点 |
|---|---|
| add/sub | 零、最高位为 1、全 1、回绕、借位、源目的重合 |
| ori/lui | 立即数高位、零扩展、低 16 位清零 |
| lw/sw | 首末地址、非零基址、负偏移、覆盖写、加载后使用 |
| sb | 四个字内偏移、只取低 8 位、相邻字节保留、负偏移、末字节 |
| beq | 成立、不成立、前跳、后跳、偏移 0 |
| j/jal/jr | 转移、返回地址、任意 rs、无延迟槽、嵌套调用 |
| movz | 成立/不成立、rd=rs、rd=rt、零号寄存器、最高位为 1 的数据 |
| GRF 三读口 | 全部 32³ 种地址组合、零号保护、写入前旧值与写入后新值 |
| 复位 | 沿间短脉冲、上升沿清零、持续复位、复位后重执行 |
| 随机混合 | 不同指令交替执行，与独立模型逐周期比较 |

### 6.2 历史版本的本地验证

2026-11-04，在工程副本上加入 movz 参考语义和专项测试，使用 Icarus Verilog 的 Verilog-2005 模式验证。被测版本包含三读口 GRF、sb 和 movz。

| 项目 | 结果 |
|---|---|
| 整机程序 | 24 组通过 |
| 总模拟周期 | 4410 |
| 整机检查点 | 549428 |
| 写入日志事件 | 2265 |
| 部件测试 | 5 组通过，合计 242683 个检查点 |
| movz 额外执行测试 | 1024 组随机输入，包含在 Controller 部件检查中 |

| 部件 | 检查点 |
|---|---:|
| EXT | 131072 |
| GRF | 98604 |
| Controller | 5121 |
| IFU | 414 |
| DM | 7472 |

此次结果针对当时保存的源码。验证报告位于 `backups/movz_check_20261104/build/verification/report.json`，记录了源码散列值；修改代码后需重新验证。未将本地通过表述为在线评测或 ISE 综合通过。

### 6.3 固定测试与波形观察

本地最小测试程序先用 ori 准备 5 和 3，add 得到 8，sw 存入地址 0，lw 再读回，最后 beq 自循环。应观察到 `$t2=$t3=8`，DM 地址 0 的整字为 8，PC 最后保持在自循环指令地址 `0x3014`。

观察顺序：先看 pc/instr，再看 rsData/rtData/rdData，然后看写回、访存、转移接口，最后确认上升沿后的状态。只有使能为 1 的请求才代表有效写入，不能把无使能时的占位数据当成操作。

新增指令后，需要让参考模型支持相同的编码与语义，再补定向测试。旧 tests/unit_checks.py 仍会实例化已经移除的 BranchControl，当前不能把它的执行结果当作完整部件回归。

### 6.4 当前版本的 COT 对拍

2026-11-07，将源码中的连续组合赋值改为 always @(*) 后，使用 COT、扩展版 MARS v0.7.0 与 ISE 14.7 的 fuse/ISim 重新进行整机验证。固定程序还使用 Icarus Verilog 运行并比较参考记录。

| 测试 | 已运行结果 | 范围 |
|---|---|---|
| 固定程序对拍 | 通过，13 条写入事件一致 | 十条基础指令、分支两种结果、jal/jr 返回、无延迟槽 |
| COT 功能测试 | 五组通过 | set、arth、mem、branch、jump |
| COT 随机测试 | 一组通过 | 配置的十条基础指令混合程序 |
| ISE testbench 检查 | 编译和仿真通过 | 时钟、同步复位、基础程序，在 2016 ns 结束 |
| 旧部件脚本 | 未完整运行 | EXT 检查通过后，因缺少旧 BranchControl 模块停止 |

接入 COT 时曾独立解析五组功能测试和一组随机测试的日志，分别核对了 13505 条与 2118 条写入事件。该数字属于当次接入验证；后续随机程序会变化，不能作为每次运行的固定数量。组合逻辑改写后的 COT 回归再次通过。

当前 COT 指令集合为 add、sub、ori、lui、lw、sw、beq、jal、jr、nop。sb、movz、j 的历史专项记录见 6.2，当前基础回归不能替代它们的专项测试。COT 比较寄存器和内存写入记录，并过滤写 $0 的请求；它不证明每个内部信号或所有输入组合都正确，也不等于在线评测通过。

### 6.5 本地对拍的运行方法

在本机 PowerShell 启动已配置的环境。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\co\p4\tools\start_cot.ps1
```

先选 1（with Mars），再选 1（随机）、2（功能）或 3（自定义）。COT/configs/file_config.json 中 flow=false、exc=false、tb=1，随机测试数量由 test_times 指定。扩展版 MARS 使用 CompactLargeText、coL1 和 ig，关闭 db。成功测试保留时间戳目录，失败时查看具体用例及差异日志。课下工具位于 p4/tools，工程携带包内以 ISE 本地运行方式为主。

| 文件或目录 | 内容 |
|---|---|
| 测试目录中的 stdout/ | MARS 参考记录 |
| log/ | CPU 写入记录 |
| hex/ | 对应机器码 |
| unit/、random/、self/ | 测试汇编 |
| 差异日志 | 第一处不一致附近的指令和写入信息 |

参考工具包括 [COT](https://github.com/Kie-Chi/COT)、[扩展版 MARS](https://github.com/Toby-Shi-cloud/Mars-with-BUAA-CO-extension) 和 [DASM](https://github.com/roife/dasm)。本地 COT 已调整 MARS 参数，并增加零测试/无 CPU 检查，以防空跑被当成通过。

### 6.6 课上新增指令与 ISE 调试

1. 按题面写出指令 RTL，修改 def.v 和 Controller.v。
2. 在课程 MARS 中加载提供的 class，核对汇编格式和机器码位段。写最短定向程序，准备操作数、执行新指令，再用 sw 保存结果。
3. 导出 Hexadecimal Text 格式的 code.txt，放在 .xise 所在工程根目录。
4. 在 ISE 切换 Simulation → Behavioral，选中 mips_tb，运行 Simulate Behavioral Model。
5. 先比较 Console 中的写入记录，找到第一处差异对应的 PC，再检查该周期的输入和输出。
6. 增加条件失败、边界值、源目的重合、写 $0 等用例，通过后回归基础指令。

| 波形信号 | 观察目的 |
|---|---|
| pc、instr | 当前 PC 和指令编码 |
| rsData、rtData、rdData | 当前指令读取的旧值 |
| regWriteEnable、regWriteAddr、regWriteData | 寄存器写入请求 |
| memReadEnable、memWriteEnable、memAddr、memWriteData、memReadData | 访存请求与读回数据 |
| pcRedirect、pcTarget | 是否跳转及目标地址 |

写入发生在上升沿，检查上升沿前的控制和数据，再检查上升沿后的状态。当前 sim/mips_tb.v 使用 10 ns 时钟、两个周期同步复位、200 个执行周期；ISE 默认运行 2100 ns。长程序要同时增大 RUN_CYCLES 和 ISE 运行时间。更换代码或 code.txt 后保存并 Re-launch，重新执行 readmemh。首次添加信号后可保存 wcfg，当前工程尚无已保存配置。

DASM 可用于本地 testbench 的 ASCII 汇编显示，新增指令需要补相应反汇编规则。仅有 class 不会自动使 DASM 识别新编码。当前 COT 也尚未配置加载额外 class 的 cl 参数，新增自定义指令后需同步设置参考执行命令。

<a id="section-7"></a>

## 七、新增指令与调试方法

新增指令先写 RTL，再在 def.v 增加需要的编码、在 Controller 增加具名译码，最后在该指令分支集中设置动作。公共计算只保留可复用数值，不再建立分散的全局控制表。

| 从 RTL 提取的问题 | 对应接口 |
|---|---|
| 读哪些旧寄存器值？ | rsAddr/rtAddr/rdAddr 与 rsData/rtData/rdData |
| 是否写寄存器，写谁，写什么？ | regWriteEnable、regWriteAddr、regWriteData |
| 是否读/写内存，地址和数据是什么？ | memReadEnable、memWriteEnable、memAddr、memWriteData |
| 访问多少字节，如何扩展加载结果？ | memSize、loadUnsigned |
| 是否转移，目标是什么？ | pcRedirect、pcTarget |

统一默认值使没有用到的动作自动关闭。不要为了“保持 rd 不变”无条件读 rd 再写回；关闭写使能即可。

当前支持三个读口、一个寄存器写口和一个 DM 访问地址。若新指令需要同时写两个不同寄存器、访问两个不同内存地址，或保存新的控制状态，仍需扩展实际硬件资源。

| 易错点 | 检查方式 |
|---|---|
| rs、rt、rd 与汇编书写顺序混淆 | 以机器码位段为准：25:21、20:16、15:11 |
| sw/sb 写数据接成地址结果 | 地址用 effectiveAddr，写数据用 rtData |
| sb 改错字节或写入高字节 | 选择目标位置依赖 addr[1:0]，写入值始终取 rtData[7:0] |
| movz 条件失败仍写寄存器 | 检查该周期 regWriteEnable 是否为 0 |
| 分支条件影响 j/jr | 逐条指令独立设置 pcRedirect，避免额外全局门控 |
| jal 写回当前 PC | 必须写 pcPlus4 |
| 立即数扩展错误 | ori 取 zeroImm，访存偏移取 signImm |
| 异步方式触发同步复位 | reset 必须在有效上升沿被采样才会清状态 |

<a id="section-8"></a>

## 八、工程文件与使用约定

```text
p4/
├─ P4单周期CPU设计文档.md
├─ images/P4设计文档/           本文流程图及课程 DM 示例图
└─ single_cycle_CPU/
   ├─ mips.v                   顶层连接
   ├─ IFU.v                    PC、IM 和候选地址
   ├─ Controller.v                具名译码与指令动作
   ├─ GRF.v                    三读一写寄存器堆
   ├─ DM.v                     小端序数据存储器
   ├─ EXT.v                    立即数扩展
   ├─ def.v                    宏定义
   ├─ code.txt                 机器码
   ├─ single_cycle_CPU.xise     ISE 工程
   ├─ sim/mips_tb.v             时钟、复位和波形测试平台
   └─ tests/                   历史验证脚本，部分接口待适配
```

宏统一放在 def.v，模块接口使用驼峰命名。所有 RTL 组合过程使用 always @(*) 和阻塞赋值 =，时序更新使用 always @(posedge clk) 和非阻塞赋值 <=。过程赋值输出声明为 reg，顶层模块间连线仍声明为 wire。

仿真使用 mips_tb：时钟周期 10 ns，复位跨过两个上升沿，再在下降沿撤销，随后执行程序。机器码从仿真工作目录的 code.txt 读取，每行一个 32 位十六进制字。使用 ISE 时应确认所有实际设计源文件已加入工程、顶层为 mips、仿真顶层为 mips_tb。




### 提交前核对

| 项目 | 当前情况 |
|---|---|
| 顶层与端口 | mips，仅 clk、reset |
| 延迟槽与返回地址 | 无延迟槽，jal 写 PC+4 |
| 同步复位 | IFU、GRF、DM 中 reset 优先 |
| IM 文件读取 | 通过 readmemh 读取工程运行目录中的 code.txt |
| IM 初始化待核对 | IFU 目前仍先循环填入 nop，再读取文件。按题面“不要直接对 IM 的内容赋值”的要求，提交前需修正这一初始化实现 |
| 携带包 | 包含 ISE 工程、TB、当前机器码、文档和配图 |
| CPU 源码提交包 | 根目录七个 .v，不包含本地 TB 和机器码 |



<a id="section-9"></a>

## 九、思考题

<a id="question-1"></a>

### 9.1 DM 的 addr 从哪里来，为什么写成 [11:2]

![课程给出的 4 KiB DM 接口](/img/posts/co-p4-single-cycle-cpu/dm-address-example.png)

对于 lw/sw，先从 GRF 读取基址寄存器 rs，再对 imm16 做符号扩展，计算有效字节地址。

```text
有效字节地址 = GPR[rs] + sign_extend(imm16)
```

本工程由 Controller 计算 effectiveAddr，经 memAddr 送入 DM.addr。示例中 DM 为 4 KiB，即 1024 个 32 位字。选中 1024 个字需要 10 位，但 MIPS 地址按字节编号，一个字占 4 字节，因此地址低两位表示字内位置，整字索引取有效地址的 [11:2]。

| 字节地址 | [11:2] 对应的字索引 | [1:0] |
|---|---:|---|
| 0x000 | 0 | 00 |
| 0x004 | 1 | 00 |
| 0x008 | 2 | 00 |
| 0xFFC | 1023 | 00 |

`input [11:2] addr` 本身仍是 10 位信号，范围编号表达了它来自字节地址的哪个位段。写成 `[9:0]` 并接入已经右移两位的字索引，也能正确选择 1024 个字。若直接把原始字节地址的 `[9:0]` 当作字索引，就会丢失原地址 [11:10]，并把字内偏移混进索引。

当前工程的 DM 为 12 KiB，接口接收完整的 32 位字节地址，内部计算 `wordAddr = addr[31:2]`，同时用 `addr[1:0]` 选择字节或半字。越界和对齐由 accessValid 判断，不能将课程 4 KiB 示例的 `[11:2]` 直接套用到当前容量。

<a id="question-2"></a>

### 9.2 两种控制器译码方式及优劣

这里按逻辑表达式译码与 case 行为描述两种常见方式对比。示例均表示 add、ori、lw、sw 的部分控制行为，信号名与输出选择仅用于说明。

第一种先产生具名的指令识别信号，再用逻辑表达式生成控制信号。下面用组合过程表达同一组逻辑。

```verilog
always @(*) begin
    isAdd = (opCode == 6'h00) && (funct == 6'h20);
    isOri = (opCode == 6'h0d);
    isLw  = (opCode == 6'h23);
    isSw  = (opCode == 6'h2b);

    regWriteEnable = isAdd | isOri | isLw;
    memWriteEnable = isSw;
    aluUseImmediate = isOri | isLw | isSw;
end
```

这种方式能直观看到哪些指令共享某个控制信号，适合控制规律相近的指令集合。新增一条指令时，需要逐个检查相关控制表达式，容易漏改写使能、操作数来源或目标选择。

第二种先统一赋默认值，再按 opcode、funct 集中描述指令的控制需求。

```verilog
always @(*) begin
    regWriteEnable = 1'b0;
    memWriteEnable = 1'b0;
    aluUseImmediate = 1'b0;

    case (opCode)
        6'h00: begin
            case (funct)
                6'h20: regWriteEnable = 1'b1;
                default: begin end
            endcase
        end
        6'h0d, 6'h23: begin
            regWriteEnable = 1'b1;
            aluUseImmediate = 1'b1;
        end
        6'h2b: begin
            memWriteEnable = 1'b1;
            aluUseImmediate = 1'b1;
        end
        default: begin end
    endcase
end
```

这种方式把一条指令的相关输出放在相邻位置，适合按题面 RTL 增加指令。默认值必须覆盖全部输出，否则组合逻辑可能推断出锁存器；opcode 相同的 R 型指令还需要检查 funct。

| 比较项 | 逻辑表达式译码 | case 集中描述 |
|---|---|---|
| 阅读一个控制信号 | 容易看出参与的指令集合 | 需要查看多个指令分支 |
| 阅读一条指令 | 需要收集多个表达式 | 可在一个分支查看所需控制 |
| 新增指令 | 补识别信号，并更新有关表达式 | 补识别和对应分支的输出 |
| 常见遗漏 | 漏加某个指令到控制集合 | 漏赋默认值或分支输出 |
| 硬件结果 | 由综合器优化表达式 | 由综合器优化行为描述 |

本工程结合两者，先生成 isAdd、isLw 等具名信号，再在统一默认值后的 if/else 分支中表达寄存器、访存、跳转动作。新增指令主要修改 def.v 和 Controller.v。case 与 if/else 选择是写法差异，不决定是否采用集中式或分布式译码；流水线可以在不同级重复实例化同一译码模块。

<a id="question-3"></a>

### 9.3 同步复位与异步复位中的 reset 和 clk

同步复位只在有效时钟沿采样 reset。下面即使 reset 在两个上升沿之间变成 1，q 也要等到下一个上升沿才清零。

```verilog
always @(posedge clk) begin
    if (reset)
        q <= 32'b0;
    else if (writeEnable)
        q <= writeData;
end
```

异步复位把 reset 的有效边沿也放入敏感列表。reset 上升时，无需等待时钟即可将 q 清零。

```verilog
always @(posedge clk or posedge reset) begin
    if (reset)
        q <= 32'b0;
    else if (writeEnable)
        q <= writeData;
end
```

| 情况 | 同步复位 | 异步复位 |
|---|---|---|
| reset 在两个时钟沿之间拉高 | 状态暂时保持 | 立即复位 |
| reset=1 时到达上升沿 | 执行复位 | 执行复位 |
| reset 脉冲未覆盖有效时钟沿 | 不保证被采到 | 有效脉冲能触发复位 |
| reset 与写使能同时有效 | if(reset) 优先，取消写入 | if(reset) 优先，取消写入 |

同步复位依赖 clk 提供采样时刻，在这个时刻 reset 优先于正常控制。异步复位可以独立触发状态更新。不能简单把同步复位解释为“时钟优先所以复位无效”。本工程 IFU、GRF、DM 均用同步复位；testbench 让 reset 覆盖两个上升沿，再在下降沿撤销，以避开与状态更新同一时刻改变输入。

<a id="question-4"></a>

### 9.4 为什么忽略溢出后 addi/addiu、add/addu 等价

MIPS32 指令手册中，这两对指令的加法数据路径相同，区别在于是否在有符号溢出时触发 Integer Overflow 异常。忽略该异常并只保存结果低 32 位后，它们得到相同的寄存器结果。[MIPS32 指令手册，ADDI、ADDIU、ADD、ADDU](https://pages.hmc.edu/harris/class/e155/11/MIPS32InstructionSet.pdf)

| 指令 | 操作数与结果 | 标准指令的溢出行为 |
|---|---|---|
| add | GPR[rs] 与 GPR[rt] 相加 | 有符号溢出时触发异常 |
| addu | 同一组寄存器相加，保留低 32 位 | 不触发溢出异常 |
| addi | GPR[rs] 加上符号扩展后的 imm16 | 有符号溢出时触发异常 |
| addiu | 同样对 imm16 做符号扩展，再执行加法 | 不触发溢出异常 |

在本实验忽略溢出的约定下，两组运算分别为模 2^32 加法。

```text
add / addu   → (GPR[rs] + GPR[rt]) mod 2^32
addi / addiu → (GPR[rs] + sign_extend(imm16)) mod 2^32
```

例如 `0x7fffffff + 1`，低 32 位都是 `0x80000000`。标准 add/addi 会检查有符号溢出，addu/addiu 直接写入低 32 位。本实验的 add/sub 不做溢出异常处理，因此保留该低 32 位结果。

`addiu` 名字中的 unsigned 不表示立即数零扩展。例如 rs 为 5、imm16 为 `0xffff` 时，符号扩展得到 -1，两种立即数加法都得到 4。该说明针对指令语义，当前 CPU 尚未译码 addi/addiu。

题干关于 C 的概括需要区分有符号与无符号。C 的无符号整数运算按模计算，而有符号整数溢出属于未定义行为，不能据此假设标准 C 保证有符号运算回绕。上面对 MIPS 的结论来自本实验“忽略溢出”的明确约定。[C11 草案 N1570，6.2.5 与 6.5](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf)
