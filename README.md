x86.js
======

x86.js is a 32-bit x86 CPU emulator written in JavaScript. It is designed to run in an HTML5 browser. You can run multiple
instances of the emulator (using WebWorkers) to simulate SMP.

There is also a node.js server that can be used to build a NUMA machine out of several emulators running in different
browser instances, on different hosts.

At this time, the project is largely academic. I expect the emulator to be roughly 2 orders of magnitude (100x) slower
than a real CPU in the best case, and often much, much, worse.

The current prototype is a naive, sequential design. Future work on the pipeline is expected to improve performance,
but performance isn't the primary objective.
