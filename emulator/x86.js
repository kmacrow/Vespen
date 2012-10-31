/*
x86.js - An x86 CPU emulator in JavaScript
Copyright (C) 2012  Kalan MacRow <kalanwm at cs dot ubc dot ca>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>
*/

var x86;

// register memory
var reg = new Int32Array(16);

// RAM (32MB)
var mem = new Uint32Array(8388608);

// L1
var csh = {};
  

// gen. purpose registers
var eax = 0, ebx = 1, ecx = 2, edx = 3;

// indexes, stack, base, instr. pointers
var esi = 4, edi = 5, ebp = 6, iep = 7, esp = 8;

// seg. registers
var cs = 9, ds = 10, es = 11, fs = 12, gs = 13, ss = 14;

// error/indicator
var eflags = 15;


