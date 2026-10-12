---
title: Logisim挑战题 Fibonacci_2
date: 2026-10-12 15:30:00
description: 斐波那契挑战题的思路以及实现
tags:
  - 计组实验
categories:
  - 学习
---



# Logisim挑战题 Fibonacci_2
---
## 题目描述

使用 Logisim 搭建电路，使得只需要 **64** 个周期就能计算出 32 位无符号整数能表示的最大数位置上的斐波那契数的最后 32 bit。

输入序号 $x$，输出对应序号斐波那契数 $F_x$。

### 具体要求

- $F_0=0,\quad F_1=1,\quad F_n=F_{n-1}+F_{n-2}\quad(n\geq 2)$

- **输入：** $N$（32bit 无符号数）

- **输出：** $N_{\mathrm{th}}$（32bit 无符号数，表示第 $N$ 个斐波那契数）

- **文件内模块名：** `main`

- **HINT：** 矩阵乘法的快速幂

## 分析
N是32bit无符号数，能表示到$2^n$，一次一次加起来肯定是不行的。
斐波那契数列能用矩阵乘法的形式给出:
$$
\begin{bmatrix}
F_{n+1} \\F_n\end{bmatrix}=\begin{bmatrix}1 & 1 \\1 & 0\end{bmatrix}^{n}\cdot
\begin{bmatrix}
1 \\
0
\end{bmatrix}
$$

也就是能转化成矩阵的n次幂。

根据快速幂的思想，$2^(32)$次幂最多拆成32个数相乘，$每一个2^n(n<32)$次幂只需要$2^(n-1)$平方即可，只需要一个周期。

所以32次幂32个周期，可行。

## Logisim实现

### 矩阵乘法
模块名：matirx_mul
先给出一个通用的2x2矩阵乘法器
![](/img/posts/fibonacci/matrix_mul.png)


### 从输入数据中取出每一位的值
每一周期and1得到最低位并且使用逻辑右移将下一位变为最低位（1位->0位）
当32个周期完成之后flag输出1(数够了之后将使能端接0避免数过头重新数)
![](/img/posts/fibonacci/get_bit.png)

### 产出快速幂矩阵
初始化为1次方，之后每一次平方，若sel为1，输出结果，若sel为0，输出单位阵
![](/img/posts/fibonacci/gen_matrix.png)


### main电路
从N中一位一位取，产出对应快速幂矩阵或者单位阵，乘进去，进行三十二个周期。
注意三十二个周期运行完之前都是输出0,用MUX就行
用flag与上CLK在32次之后将CLK钳制成0
![](/img/posts/fibonacci/main.png)


### 问题与反思
- 计数器计数超过上限之后会重置，所以用一个一位寄存器来初始化

## debug
bug：在gen_matrix中由于初始化的原因（使用MUX进行初始化输入matrix_mul）但是右边的保存状态的寄存器没有初始化，所以这四个寄存器还都是0，但是矩阵指数为$2^(0)$的时候应该输出1110，也就是说在CLK转动0次的时候，$2^(0)$的状态没有传入寄存器，下一个上升沿来的时候直接进入$2^(1)$了，所以sel=1，clk转动0次的时候会输出错误，所以需要单独处理

repair：加入MUX选择

![](/img/posts/fibonacci/debug.png)

bug：数据小的时候输出正确数据大的时候输出不正确
显然是到了边界了，检查发现是comparator的31应该是32

repair：显然

