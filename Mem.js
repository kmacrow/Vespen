//physical memory and eventually MMIO, etc..
//TODO: MTRR, etc.. to mark cacheable regions, cache directory, ...
//TODO: need to make this per-cpu (except the physical memory) so e.g.: APIC can be per-cpu
//TODO: APIC FFFE0000H to FFFE0FFFH
function Mem(mem_size) {
    this.mem_size = mem_size;
    mem_size += ((15 + 3) & ~3);
    this.phys_mem   = new ArrayBuffer(mem_size);
    this.phys_mem8  = new Uint8Array(this.phys_mem, 0, mem_size);
    this.phys_mem16 = new Uint16Array(this.phys_mem, 0, mem_size / 2);
    this.phys_mem32 = new Int32Array(this.phys_mem, 0, mem_size / 4);

/* Raw, low level memory access routines to alter the host-stored memory, these are called by the higher-level
memory access emulation routines */
    var _this = this;
    this.ld8_phys8   = function(mem8_loc)    { return _this.phys_mem8[mem8_loc]; };
    this.st8_phys8   = function(mem8_loc, x) {          _this.phys_mem8[mem8_loc] = x; };

    this.ld16_phys8  = function(mem8_loc)    { return _this.phys_mem16[mem8_loc >> 1]; };
    this.st16_phys8  = function(mem8_loc, x) {        _this.phys_mem16[mem8_loc >> 1] = x; };
    this.ld16_phys16  = function(mem16_loc)    { return _this.phys_mem16[mem16_loc]; };
    this.st16_phys16  = function(mem16_loc, x) {        _this.phys_mem16[mem16_loc] = x; };

    this.ld32_phys8  = function(mem8_loc)    { return _this.phys_mem32[mem8_loc >> 2]; };
    this.st32_phys8  = function(mem8_loc, x) {        _this.phys_mem32[mem8_loc >> 2] = x; };
    this.ld32_phys32  = function(mem32_loc)    { return _this.phys_mem32[mem32_loc]; };
    this.st32_phys32  = function(mem32_loc, x) {        _this.phys_mem32[mem32_loc] = x; };
}
