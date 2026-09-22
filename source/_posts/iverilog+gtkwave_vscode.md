---
title: iverilog + gtkwave 仿真方法
date: 2026-09-22
categories:
  - 学习笔记
tags:
  - Hexo
  - 博客
---

# iverilog + gtkwave 仿真方法

本教程包含从安装到在 VS Code 中实现一键仿真的完整流程，适合使用 Icarus Verilog、vvp 和 GTKWave 完成 Verilog 编写、仿真与波形查看。

---


## 目录

- [第一节 安装](#section-install)
- [第二节 在 VS Code 中编写 v 文件](#section-vscode)
- [第三节 在 VS Code 中实现一键仿真](#section-simulation)
- [常见问题与排错](#section-troubleshooting)

<a id="section-install"></a>
## 第一节 安装

### 安装

#### Linux
```bash
sudo apt update
sudo apt install iverilog gtkwave
```

#### Windows

+ iverilog 下载地址:

	https://bleyer.org/icarus/

	下载后需要把安装目录下的 bin 文件添加到系统 Path （设置 > 系统 > 关于 > 高级系统设置 > 环境变量 > 系统变量 > Path）里，比如我这里装在了 `D:\Iverilog\`，那么添加的路径是 `D:\Iverilog\bin`。
	
+ gtkwave：安装 iverilog 的时候会顺带安装 gtkwave

在 gitbash 中运行下面的命令可以检测环境是否配置完成：

```bash
iverilog -V
gtkwave --version
```

<a id="section-vscode"></a>
## 第二节 在 VS Code 中编写 v 文件
```bash
code .
```

建议 VS Code 打开总目录：

```text
D:\verilog
```

这样后面可以让一个 `tasks.json` 配置服务于 `projects` 下的多个实验。

### 安装 VS Code 插件

按 `Ctrl + Shift + X` 打开扩展商店。

#### Verilog 语法与代码辅助

搜索并安装：

```text
Verilog-HDL/SystemVerilog
```

发布者为 `mshr-h`。这个插件主要负责 Verilog/SystemVerilog 的语法高亮、代码辅助以及基本检查。

#### Truecrab Verilog_Testbench

搜索：

```text
Verilog_Testbench
```

确认发布者为 `Truecrab` 后点击 **Install**。这个插件可以读取当前模块的端口，生成 Testbench 的基本框架，包括输入、输出声明和模块实例化。

安装完成后：

1. 打开需要测试的 `.v` 文件，例如 `ALU.v`，确保它是当前正在编辑的文件。
2. 按 `Ctrl + Shift + P` 打开命令面板。
3. 输入 `Testbench`。
4. 选择插件提供的 **Testbench** 命令，不要误选只生成实例化代码的 **Testbench Instance**。

这个插件主要生成“骨架”，并不知道你想测试哪些输入组合，所以生成后仍然要手动补充测试激励。

### 解决 Truecrab 插件的 Python 依赖

Truecrab 插件会调用自己的 Python 脚本生成 Testbench。如果出现：

```text
ModuleNotFoundError: No module named 'chardet'
```

说明当前插件调用的 Python 环境没有安装 `chardet`。在 VS Code 终端执行：

```powershell
python -m pip install chardet
```

安装后可以验证：

```powershell
python -c "import chardet; print(chardet.__version__)"
```

如果 `pip` 本身不可用，先执行：

```powershell
python -m ensurepip --upgrade
```

再重新安装 `chardet`。如果电脑上有多个 Python，要尽量使用插件实际调用的那个 Python 来安装依赖。

### 检查并修改自动生成的 Testbench

自动生成的模板可能会残留通用的 `clk`、`rst` 或 `rst_n` 代码。例如：

```verilog
initial begin
    forever #(PERIOD / 2) clk = ~clk;
end

initial begin
    #(PERIOD * 2) rst_n = 1;
end
```

如果当前设计模块没有时钟和复位端口，这些代码必须删除；否则会出现未声明信号或端口不匹配的编译错误。组合逻辑电路一般不需要 `clk` 和 `rst`，时序电路才需要保留并正确初始化它们。

生成后重点检查：

- `module` 名称是否和设计文件中的模块名一致。
- `reg` 是否用于设计模块的输入，`wire` 是否用于设计模块的输出。
- 实例化时的端口名称是否和设计模块完全一致。
- 是否补充了真正的输入激励，而不是生成后直接 `$finish`。
- 是否加入了 `$dumpfile`、`$dumpvars` 和 `$finish`。

下面是一个组合逻辑 ALU 的 Testbench 示例。端口名称必须按照自己的 `ALU.v` 修改：

```verilog
`timescale 1ns / 1ps

module tb_ALU;

reg  [3:0] inA = 0;
reg  [3:0] inB = 0;
reg  [1:0] op  = 0;
wire [3:0] ans;

ALU u_ALU (
    .inA(inA),
    .inB(inB),
    .op(op),
    .ans(ans)
);

initial begin
    // 生成 GTKWave 波形文件
    $dumpfile("wave.vcd");
    $dumpvars(0, tb_ALU);

    // 补充测试激励
    inA = 4'b1000;
    inB = 4'b0010;
    op  = 2'b00;
    #10;

    op = 2'b01;
    #10;
    op = 2'b10;
    #10;
    op = 2'b11;
    #10;

    // 没有 $finish，vvp 可能一直运行
    $finish;
end

endmodule
```

其中：

- `$dumpfile("wave.vcd")` 指定生成的波形文件名。
- `$dumpvars(0, tb_ALU)` 记录 Testbench 及其下层实例的信号。
- `#10` 等待一段仿真时间，让 GTKWave 能显示输入变化和输出响应。
- `$finish` 结束仿真，使 `vvp` 正常返回。

<a id="section-simulation"></a>
## 第三节 在 VS Code 中实现一键仿真

### 1. 设置 Windows 环境变量 PATH

下面以 Icarus Verilog 安装在以下目录为例；如果安装位置不同，请替换为自己的实际路径：

```text
D:\Iverilog\bin
D:\Iverilog\gtkwave\bin
```

在 Windows 搜索“环境变量”，打开“编辑系统环境变量” → “环境变量”。在“用户变量”或“系统变量”的 `Path` 中添加上面两项。

保存环境变量时要一路点击“确定”，不能只关闭编辑窗口。修改后重新打开 VS Code 和 PowerShell，使新设置生效。

### 2. 建立目录结构

按照当前目录规划，最终结构如下：

```text
D:\verilog
├── .vscode
│   └── tasks.json
├── projects
│   ├── ALU_1
│   │   ├── ALU.v
│   │   └── tb_ALU.v
│   └── 其他实验
└── tools
    └── run.bat
```

每个实验目录最好只放这个实验需要的设计文件和 Testbench，因为下面的脚本会编译当前目录下的全部 `*.v` 文件。

### 3. 编写 `tools\run.bat`

在下面的位置新建文件：

```text
D:\verilog\tools\run.bat
```

写入：

```bat
@echo off
setlocal

if "%~1"=="" (
    echo [ERROR] No project folder specified.
    exit /b 1
)

set "PROJECT=%~1"

if not exist "%PROJECT%\" (
    echo [ERROR] Project folder does not exist.
    exit /b 1
)

pushd "%PROJECT%"
if errorlevel 1 (
    echo [ERROR] Cannot open project folder.
    exit /b 1
)

echo.
echo ========================================
echo Verilog Auto Simulation
echo ========================================
echo Project: %PROJECT%
echo.

dir /b "*.v" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] No Verilog files found.
    popd
    exit /b 1
)

if exist sim.vvp del /q sim.vvp
if exist wave.vcd del /q wave.vcd

echo [1/3] Compile
iverilog -g2005 -o sim.vvp *.v
if errorlevel 1 (
    echo [ERROR] Compilation failed.
    popd
    exit /b 1
)

echo.
echo [2/3] Simulate
vvp sim.vvp
if errorlevel 1 (
    echo [ERROR] Simulation failed.
    popd
    exit /b 1
)

echo.
echo [3/3] Waveform
if not exist wave.vcd (
    echo [ERROR] wave.vcd was not generated.
    echo Check dumpfile and dumpvars in the Testbench.
    popd
    exit /b 1
)

where.exe gtkwave >nul 2>&1
if errorlevel 1 (
    echo [ERROR] GTKWave was not found in PATH.
    popd
    exit /b 1
)

echo Opening GTKWave...
start "" gtkwave wave.vcd
echo.
echo [SUCCESS] Simulation finished.

popd
exit /b 0
```

这个脚本接收第一个参数作为当前文件所在目录，执行：

```text
当前目录下所有 *.v
        ↓
iverilog 编译
        ↓
sim.vvp
        ↓
vvp 运行
        ↓
wave.vcd
        ↓
GTKWave
```

脚本中的 `if (...)` 块里不要直接写带括号的提示文本，例如 `$dumpfile("wave.vcd");`、`$dumpvars(0, your_testbench);`。批处理会把括号当成控制语法，可能导致任务明明已经编译和仿真成功，却以 `exit code: 1` 结束。需要提示时，像上面的脚本一样使用不含括号的普通文字。

### 4. 配置根目录 `.vscode\tasks.json`

在：

```text
D:\verilog
```

下建立 `.vscode` 文件夹，并在其中建立：

```text
D:\verilog\.vscode\tasks.json
```

写入：

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Verilog: Simulate Current Project",
            "type": "shell",
            "command": "${workspaceFolder}\\tools\\run.bat",
            "args": [
                "${fileDirname}"
            ],
            "options": {
                "cwd": "${workspaceFolder}"
            },
            "problemMatcher": [],
            "presentation": {
                "reveal": "always",
                "panel": "dedicated",
                "clear": true,
                "focus": false
            }
        }
    ]
}
```

这里最重要的是：

```json
"${fileDirname}"
```

它表示“当前正在编辑的文件所在目录”。例如当前打开的是：

```text
D:\verilog\projects\ALU_1\ALU.v
```

VS Code 会自动调用：

```bat
D:\verilog\tools\run.bat "D:\verilog\projects\ALU_1"
```

所以不需要为 `counting`、`FSM` 等每个实验复制一份 BAT 或 `tasks.json`。

### 5. 先用 Tasks: Run Task 测试

不要一开始就绑定快捷键。先确认 VS Code 能识别任务：

1. 用 VS Code 打开整个 `D:\verilog` 文件夹。
2. 打开某个实验中的 `.v` 文件。
3. 按 `Ctrl + Shift + P`。
4. 搜索并选择 **Tasks: Run Task**。
5. 选择 **Verilog: Simulate Current Project**。

终端中应依次看到编译、仿真和波形检查；目录中应生成 `sim.vvp` 和 `wave.vcd`，并自动启动 GTKWave。

### 6. 配置 F6 快捷键

确认任务可以正常运行后，按 `Ctrl + Shift + P`，搜索：

```text
Preferences: Open Keyboard Shortcuts (JSON)
```

要选择**用户 Keyboard Shortcuts JSON**，不要选择：

```text
Preferences: Open Default Keyboard Shortcuts (JSON)
```

后者是 VS Code 的默认快捷键文件，只读，不能用来保存自己的配置。

在用户快捷键文件最外层的 `[]` 中加入：

```json
{
    "key": "f6",
    "command": "workbench.action.tasks.runTask",
    "args": "Verilog: Simulate Current Project",
    "when": "editorLangId == verilog"
}
```

如果原来是空文件：

```json
[]
```

就改成：

```json
[
    {
        "key": "f6",
        "command": "workbench.action.tasks.runTask",
        "args": "Verilog: Simulate Current Project",
        "when": "editorLangId == verilog"
    }
]
```

保存后，打开任意实验目录中的 `.v` 文件，按 `F6` 即可执行：

```text
识别当前文件所在目录
    ↓
编译该目录下所有 *.v
    ↓
vvp 仿真
    ↓
生成 wave.vcd
    ↓
自动打开 GTKWave
```

### 7. GTKWave 基本使用

GTKWave 打开 `wave.vcd` 后，左上角会显示类似：

```text
SST
└── tb_ALU
```

如果右侧波形区是空的，不一定是仿真失败，通常只是信号还没有加入显示区：

1. 展开左侧的 `tb_ALU`。
2. 点击 `tb_ALU`，在中间 `Signals` 区域看到输入、输出和内部信号。
3. 选中需要观察的信号，可以按 `Ctrl + A` 全选。
4. 点击 **Append**，把信号加入右侧 `Waves` 区域。
5. 点击工具栏的 **Zoom Fit** 或 **Zoom Full**，让整个仿真时间范围铺满窗口。

手动执行时，完整流程仍然是：

```bash
iverilog -o sim *.v
vvp sim
gtkwave wave.vcd
```

其中 `wave.vcd` 的文件名必须和 Testbench 中 `$dumpfile` 的文件名一致。

仿真时，每个项目只需要两个文件：
项目本身的 verilog 代码（code.v）以及 testbench（code-tb.v），不需要像 ise 里面一大堆

在 `code-tb.v` 中需要额外加入下面的代码：

```verilog
initial begin
// 将仿真波形图输出到 wave.vcd：
	$dumpfile("wave.vcd");
// 记录 char, clk, out 的值
	$dumpvars(0, char, clk, out);

// 在一定的时间后结束仿真
    #10000 $finish;
end
```

运行下面的命令仿真：

```bash
# 生成仿真文件 sim：
# 或者 iverilog -o sim *.v
iverilog -o sim code.v code-tb.v
# 开始仿真（没加$finish会卡在这里）：
vvp sim
# 查看波形图
gtkwave wave.vcd
```

可以用下面的脚本一键执行：
```bash
iverilog -o sim *.v
vvp sim
gtkwave wave.vcd #这里的文件名以 code-tb.v 中 $dumpfile 中填写的为准
```


### 完整示例

```verilog
// code.v
`timescale 1ns / 1ps
module code(
    input Clk,
    input Reset,
    input Slt,
    input En,
    output [63:0] Output0,
    output [63:0] Output1
);
reg [63:0] val0;
reg [63:0] val1;
reg [1:0] phase;

always @(posedge Clk) begin
    if (Reset) begin
        val0 <= 64'b0;
        val1 <= 64'b0;
        phase <= 2'b00;
    end
    else if (En) begin
        if (Slt == 1'b0) val0 <= val0 + 64'b01;
        else begin
            if (phase == 2'b11) val1 <= val1 + 64'b01;
            phase <= phase + 2'b01;
        end
    end
end

assign Output0 = val0;
assign Output1 = val1;
endmodule
```

```verilog
// code_tb.v
`timescale 1ns / 1ps
module code_test;
	reg Clk;
	reg Reset;
	reg Slt;
	reg En;

	wire [63:0] Output0;
	wire [63:0] Output1;

	code uut (
		.Clk(Clk), 
		.Reset(Reset), 
		.Slt(Slt), 
		.En(En), 
		.Output0(Output0), 
		.Output1(Output1)
	);

	initial begin
		Clk = 0;
		Reset = 1;
		Slt = 0;
		En = 0;

		#10
		Reset = 0;
		En = 1;

		#40;
		Slt = 1;
	end
	always #5 Clk = ~Clk;
	
	// 使用 iverilog 需要添加下面的部分：
	initial begin
		$dumpfile("wave.vcd");
		$dumpvars(0, Clk, Reset, Slt, En, Output0, Output1);

		#10000;
		$finish;
	end
endmodule
```

<a id="section-troubleshooting"></a>
## 常见问题与排错

### 1. `iverilog`、`vvp` 或 `gtkwave` 找不到

先执行：

```powershell
where.exe iverilog
where.exe vvp
where.exe gtkwave
```

如果找不到命令，请回到第三节检查 PATH 中是否包含：

```text
D:\Iverilog\bin
D:\Iverilog\gtkwave\bin
```

保存后重新打开 VS Code 和 PowerShell，使新设置生效。

### 2. 新 PATH 已保存，但当前终端仍然无效

PowerShell 和 VS Code 会继承启动时的环境变量。修改 PATH 后，旧终端不会自动更新。完全关闭 VS Code，再重新打开；或者按照第三节的命令临时刷新当前 PowerShell 的 `$env:Path`。

### 3. Truecrab 插件提示缺少 `chardet`

这是插件调用的 Python 依赖缺失，不是 Verilog 语法错误。执行：

```powershell
python -m pip install chardet
```

安装完成后重新运行 `Testbench` 命令。

### 4. 自动生成的 Testbench 多了 `clk`、`rst` 或 `rst_n`

这是生成器的通用模板残留。若设计模块没有时钟和复位端口，就删除对应的声明、时钟翻转、复位初始化和端口连接；同时补充实际输入端口的测试激励。

### 5. BAT 已经编译、仿真成功，却显示 `exit code: 1`

检查 `run.bat` 的 `if (...)` 代码块。批处理中的括号是特殊字符，把带括号的 `$dumpfile(...)` 或 `$dumpvars(...)` 直接放进 `echo` 里，可能破坏 BAT 语法。不要在 `if` 块中这样输出提示，使用普通的不带括号的文字即可。

### 6. 已生成 `wave.vcd`，但 GTKWave 右侧没有波形

这通常不是仿真失败，而是信号还没有加入 GTKWave 的显示区。展开左侧 `tb`，选中 `Signals` 中的信号，点击 **Append**，最后点击 **Zoom Fit**。

### 7. `vvp` 一直运行不结束

检查 Testbench 是否包含 `$finish`。例如：

```verilog
#100;
$finish;
```

没有 `$finish` 时，含有时钟 `always` 或 `forever` 的仿真可能会一直运行，BAT 也就不会进入打开 GTKWave 的下一步。

### 8. 没有生成 `wave.vcd`

确认 Testbench 中同时存在：

```verilog
$dumpfile("wave.vcd");
$dumpvars(0, tb_ALU);
```

并且 `tb_ALU` 换成当前 Testbench 的实际模块名。还要确认 `run.bat` 编译和运行的确实是当前 `.v` 文件所在目录。

编者：yn国总统，Zacivowocky
