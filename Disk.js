Disk.prototype.identify = function() {
	function vh(wh, v) {
		xh[wh * 2] = v & 0xff;
		xh[wh * 2 + 1] = (v >> 8) & 0xff;
	}
	function yh(wh, na, rg) {
		var i, v;
		for (i = 0; i < rg; i++) {
			if (i < na.length) {
				v = na.charCodeAt(i) & 0xff;
			} else {
				v = 32;
			}
			xh[wh * 2 + (i ^ 1)] = v;
		}
	}
	var xh, i, zh;
	xh = this.io_buffer;
	for (i = 0; i < 512; i++)
		xh[i] = 0;
	vh(0, 0x0040);
	vh(1, this.cylinders);
	vh(3, this.heads);
	vh(4, 512 * this.sectors);
	vh(5, 512);
	vh(6, this.sectors);
	vh(20, 3);
	vh(21, 512);
	vh(22, 4);
	yh(27, "JSLinux HARDDISK", 40);
	vh(47, 0x8000 | 128);
	vh(48, 0);
	vh(49, 1 << 9);
	vh(51, 0x200);
	vh(52, 0x200);
	vh(54, this.cylinders);
	vh(55, this.heads);
	vh(56, this.sectors);
	zh = this.cylinders * this.heads * this.sectors;
	vh(57, zh);
	vh(58, zh >> 16);
	if (this.mult_sectors)
		vh(59, 0x100 | this.mult_sectors);
	vh(60, this.nb_sectors);
	vh(61, this.nb_sectors >> 16);
	vh(80, (1 << 1) | (1 << 2));
	vh(82, (1 << 14));
	vh(83, (1 << 14));
	vh(84, (1 << 14));
	vh(85, (1 << 14));
	vh(86, 0);
	vh(87, (1 << 14));
};
Disk.prototype.set_signature = function() {
	this.select &= 0xf0;
	this.nsector = 1;
	this.sector = 1;
	this.lcyl = 0;
	this.hcyl = 0;
};
Disk.prototype.abort_command = function() {
	this.status = 0x40 | 0x01;
	this.error = 0x04;
};
Disk.prototype.set_irq = function() {
	if (!(this.cmd & 0x02)) {
		this.ide_if.set_irq_func(1);
	}
};
Disk.prototype.transfer_start = function(cc, Ah) {
	this.end_transfer_func = Ah;
	this.data_index = 0;
	this.data_end = cc;
};
Disk.prototype.transfer_stop = function() {
	this.end_transfer_func = this.transfer_stop.bind(this);
	this.data_index = 0;
	this.data_end = 0;
};
Disk.prototype.get_sector = function() {
	var Bh;
	if (this.select & 0x40) {
		Bh = ((this.select & 0x0f) << 24) | (this.hcyl << 16)
				| (this.lcyl << 8) | this.sector;
	} else {
		Bh = ((this.hcyl << 8) | this.lcyl) * this.heads * this.sectors
				+ (this.select & 0x0f) * this.sectors + (this.sector - 1);
	}
	return Bh;
};
Disk.prototype.set_sector = function(Bh) {
	var Ch, r;
	if (this.select & 0x40) {
		this.select = (this.select & 0xf0) | ((Bh >> 24) & 0x0f);
		this.hcyl = (Bh >> 16) & 0xff;
		this.lcyl = (Bh >> 8) & 0xff;
		this.sector = Bh & 0xff;
	} else {
		Ch = Bh / (this.heads * this.sectors);
		r = Bh % (this.heads * this.sectors);
		this.hcyl = (Ch >> 8) & 0xff;
		this.lcyl = Ch & 0xff;
		this.select = (this.select & 0xf0) | ((r / this.sectors) & 0x0f);
		this.sector = (r % this.sectors) + 1;
	}
};
Disk.prototype.sector_read = function() {
	var Bh, n, Qg;
	Bh = this.get_sector();
	n = this.nsector;
	if (n == 0)
		n = 256;
	if (n > this.req_nb_sectors)
		n = this.req_nb_sectors;
	this.io_nb_sectors = n;
	Qg = this.bs.read_async(Bh, this.io_buffer, n, this.sector_read_cb
			.bind(this));
	if (Qg < 0) {
		this.abort_command();
		this.set_irq();
	} else if (Qg == 0) {
		this.sector_read_cb();
	} else {
		this.status = 0x40 | 0x10 | 0x80;
		this.error = 0;
	}
};
Disk.prototype.sector_read_cb = function() {
	var n, Dh;
	n = this.io_nb_sectors;
	this.set_sector(this.get_sector() + n);
	this.nsector = (this.nsector - n) & 0xff;
	if (this.nsector == 0)
		Dh = this.sector_read_cb_end.bind(this);
	else
		Dh = this.sector_read.bind(this);
	this.transfer_start(512 * n, Dh);
	this.set_irq();
	this.status = 0x40 | 0x10 | 0x08;
	this.error = 0;
};
Disk.prototype.sector_read_cb_end = function() {
	this.status = 0x40 | 0x10;
	this.error = 0;
	this.transfer_stop();
};
Disk.prototype.sector_write_cb1 = function() {
	var Bh, Qg;
	this.transfer_stop();
	Bh = this.get_sector();
	Qg = this.bs.write_async(Bh, this.io_buffer, this.io_nb_sectors,
			this.sector_write_cb2.bind(this));
	if (Qg < 0) {
		this.abort_command();
		this.set_irq();
	} else if (Qg == 0) {
		this.sector_write_cb2();
	} else {
		this.status = 0x40 | 0x10 | 0x80;
	}
};
Disk.prototype.sector_write_cb2 = function() {
	var n;
	n = this.io_nb_sectors;
	this.set_sector(this.get_sector() + n);
	this.nsector = (this.nsector - n) & 0xff;
	if (this.nsector == 0) {
		this.status = 0x40 | 0x10;
	} else {
		n = this.nsector;
		if (n > this.req_nb_sectors)
			n = this.req_nb_sectors;
		this.io_nb_sectors = n;
		this.transfer_start(512 * n, this.sector_write_cb1.bind(this));
		this.status = 0x40 | 0x10 | 0x08;
	}
	this.set_irq();
};
Disk.prototype.sector_write = function() {
	var n;
	n = this.nsector;
	if (n == 0)
		n = 256;
	if (n > this.req_nb_sectors)
		n = this.req_nb_sectors;
	this.io_nb_sectors = n;
	this.transfer_start(512 * n, this.sector_write_cb1.bind(this));
	this.status = 0x40 | 0x10 | 0x08;
};
Disk.prototype.identify_cb = function() {
	this.transfer_stop();
	this.status = 0x40;
};
Disk.prototype.exec_cmd = function(ga) {
	var n;
	switch (ga) {
	case 0xA1:
	case 0xEC:
		this.identify();
		this.status = 0x40 | 0x10 | 0x08;
		this.transfer_start(512, this.identify_cb.bind(this));
		this.set_irq();
		break;
	case 0x91:
	case 0x10:
		this.error = 0;
		this.status = 0x40 | 0x10;
		this.set_irq();
		break;
	case 0xC6:
		if (this.nsector > 128 || (this.nsector & (this.nsector - 1)) != 0) {
			this.abort_command();
		} else {
			this.mult_sectors = this.nsector;
			this.status = 0x40;
		}
		this.set_irq();
		break;
	case 0x20:
	case 0x21:
		this.req_nb_sectors = 1;
		this.sector_read();
		break;
	case 0x30:
	case 0x31:
		this.req_nb_sectors = 1;
		this.sector_write();
		break;
	case 0xC4:
		if (!this.mult_sectors) {
			this.abort_command();
			this.set_irq();
		} else {
			this.req_nb_sectors = this.mult_sectors;
			this.sector_read();
		}
		break;
	case 0xC5:
		if (!this.mult_sectors) {
			this.abort_command();
			this.set_irq();
		} else {
			this.req_nb_sectors = this.mult_sectors;
			this.sector_write();
		}
		break;
	case 0xF8:
		this.set_sector(this.nb_sectors - 1);
		this.status = 0x40;
		this.set_irq();
		break;
	default:
		this.abort_command();
		this.set_irq();
		break;
	}
};
IDE_if.prototype.ioport_write = function(fa, ga) {
	var s = this.cur_drive;
	var Fh;
	fa &= 7;
	switch (fa) {
	case 0:
		break;
	case 1:
		if (s) {
			s.feature = ga;
		}
		break;
	case 2:
		if (s) {
			s.nsector = ga;
		}
		break;
	case 3:
		if (s) {
			s.sector = ga;
		}
		break;
	case 4:
		if (s) {
			s.lcyl = ga;
		}
		break;
	case 5:
		if (s) {
			s.hcyl = ga;
		}
		break;
	case 6:
		s = this.cur_drive = this.drives[(ga >> 4) & 1];
		if (s) {
			s.select = ga;
		}
		break;
	default:
	case 7:
		if (s) {
			s.exec_cmd(ga);
		}
		break;
	}
};
IDE_if.prototype.ioport_read = function(fa) {
	var s = this.cur_drive;
	var Qg;
	fa &= 7;
	if (!s) {
		Qg = 0xff;
	} else {
		switch (fa) {
		case 0:
			Qg = 0xff;
			break;
		case 1:
			Qg = s.error;
			break;
		case 2:
			Qg = s.nsector;
			break;
		case 3:
			Qg = s.sector;
			break;
		case 4:
			Qg = s.lcyl;
			break;
		case 5:
			Qg = s.hcyl;
			break;
		case 6:
			Qg = s.select;
			break;
		default:
		case 7:
			Qg = s.status;
			this.set_irq_func(0);
			break;
		}
	}
	return Qg;
};
IDE_if.prototype.status_read = function(fa) {
	var s = this.cur_drive;
	var Qg;
	if (s) {
		Qg = s.status;
	} else {
		Qg = 0;
	}
	return Qg;
};
IDE_if.prototype.cmd_write = function(fa, ga) {
	var i, s;
	if (!(this.cmd & 0x04) && (ga & 0x04)) {
		for (i = 0; i < 2; i++) {
			s = this.drives[i];
			if (s) {
				s.status = 0x80 | 0x10;
				s.error = 0x01;
			}
		}
	} else if ((this.cmd & 0x04) && !(ga & 0x04)) {
		for (i = 0; i < 2; i++) {
			s = this.drives[i];
			if (s) {
				s.status = 0x40 | 0x10;
				s.set_signature();
			}
		}
	}
	for (i = 0; i < 2; i++) {
		s = this.drives[i];
		if (s) {
			s.cmd = ga;
		}
	}
};
IDE_if.prototype.data_writew = function(fa, ga) {
	var s = this.cur_drive;
	var p, xh;
	if (!s)
		return;
	p = s.data_index;
	xh = s.io_buffer;
	xh[p] = ga & 0xff;
	xh[p + 1] = (ga >> 8) & 0xff;
	p += 2;
	s.data_index = p;
	if (p >= s.data_end)
		s.end_transfer_func();
};
IDE_if.prototype.data_readw = function(fa) {
	var s = this.cur_drive;
	var p, Qg, xh;
	if (!s) {
		Qg = 0;
	} else {
		p = s.data_index;
		xh = s.io_buffer;
		Qg = xh[p] | (xh[p + 1] << 8);
		p += 2;
		s.data_index = p;
		if (p >= s.data_end)
			s.end_transfer_func();
	}
	return Qg;
};
IDE_if.prototype.data_writel = function(fa, ga) {
	var s = this.cur_drive;
	var p, xh;
	if (!s)
		return;
	p = s.data_index;
	xh = s.io_buffer;
	xh[p] = ga & 0xff;
	xh[p + 1] = (ga >> 8) & 0xff;
	xh[p + 2] = (ga >> 16) & 0xff;
	xh[p + 3] = (ga >> 24) & 0xff;
	p += 4;
	s.data_index = p;
	if (p >= s.data_end)
		s.end_transfer_func();
};
IDE_if.prototype.data_readl = function(fa) {
	var s = this.cur_drive;
	var p, Qg, xh;
	if (!s) {
		Qg = 0;
	} else {
		p = s.data_index;
		xh = s.io_buffer;
		Qg = xh[p] | (xh[p + 1] << 8) | (xh[p + 2] << 16) | (xh[p + 3] << 24);
		p += 4;
		s.data_index = p;
		if (p >= s.data_end)
			s.end_transfer_func();
	}
	return Qg;
};
function Disk(Gh, Hh) {
	var Ih, Jh;
	this.ide_if = Gh;
	this.bs = Hh;
	Jh = Hh.get_sector_count();
	Ih = Jh / (16 * 63);
	if (Ih > 16383)
		Ih = 16383;
	else if (Ih < 2)
		Ih = 2;
	this.cylinders = Ih;
	this.heads = 16;
	this.sectors = 63;
	this.nb_sectors = Jh;
	this.mult_sectors = 128;
	this.feature = 0;
	this.error = 0;
	this.nsector = 0;
	this.sector = 0;
	this.lcyl = 0;
	this.hcyl = 0;
	this.select = 0xa0;
	this.status = 0x40 | 0x10;
	this.cmd = 0;
	this.io_buffer = allocBuffer(128 * 512 + 4);
	this.data_index = 0;
	this.data_end = 0;
	this.end_transfer_func = this.transfer_stop.bind(this);
	this.req_nb_sectors = 0;
	this.io_nb_sectors = 0;
}
function IDE_if(Og, fa, Kh, lh, Lh) {
	var i, Mh;
	this.set_irq_func = lh;
	this.drives = [];
	for (i = 0; i < 2; i++) {
		if (Lh[i]) {
			Mh = new Disk(this, Lh[i]);
		} else {
			Mh = null;
		}
		this.drives[i] = Mh;
	}
	this.cur_drive = this.drives[0];
	Og.register_ioport_write(fa, 8, 1, this.ioport_write.bind(this));
	Og.register_ioport_read(fa, 8, 1, this.ioport_read.bind(this));
	if (Kh) {
		Og.register_ioport_read(Kh, 1, 1, this.status_read.bind(this));
		Og.register_ioport_write(Kh, 1, 1, this.cmd_write.bind(this));
	}
	Og.register_ioport_write(fa, 2, 2, this.data_writew.bind(this));
	Og.register_ioport_read(fa, 2, 2, this.data_readw.bind(this));
	Og.register_ioport_write(fa, 4, 4, this.data_writel.bind(this));
	Og.register_ioport_read(fa, 4, 4, this.data_readl.bind(this));
}

// Hg: url format
// Oh: block size
// Ph: num blocks 
function XhrDiskBackend(Hg, Oh, Ph) {
    // Oh = 64, Ph = 48
	if (Hg.indexOf("%d") < 0)
		throw "Invalid URL";
	if (Ph <= 0 || Oh <= 0)
		throw "Invalid parameters";
	this.block_sectors = Oh * 2;
	this.nb_sectors = this.block_sectors * Ph;
	this.url = Hg;
	this.max_cache_size = Math.max(1, Math.ceil(2536 / Oh));
	this.cache = new Array();
	this.sector_num = 0;
	this.sector_index = 0;
	this.sector_count = 0;
	this.sector_buf = null;
	this.sector_cb = null;
}
XhrDiskBackend.prototype.get_sector_count = function() {
	return this.nb_sectors;
};
XhrDiskBackend.prototype.get_time = function() {
	return +new Date();
};
XhrDiskBackend.prototype.get_cached_block = function(Qh) {
	var Rh, i, Sh = this.cache;
	for (i = 0; i < Sh.length; i++) {
		Rh = Sh[i];
		if (Rh.block_num == Qh)
			return Rh;
	}
	return null;
};
XhrDiskBackend.prototype.new_cached_block = function(Qh) {
	var Rh, Th, i, j, Uh, Sh = this.cache;
	Rh = new Object();
	Rh.block_num = Qh;
	Rh.time = this.get_time();
	if (Sh.length < this.max_cache_size) {
		j = Sh.length;
	} else {
		for (i = 0; i < Sh.length; i++) {
			Th = Sh[i];
			if (i == 0 || Th.time < Uh) {
				Uh = Th.time;
				j = i;
			}
		}
	}
	Sh[j] = Rh;
	return Rh;
};
XhrDiskBackend.prototype.get_url = function(Hg, Qh) {
	var p, s;
	s = Qh.toString();
	while (s.length < 9)
		s = "0" + s;
	p = Hg.indexOf("%d");
	return Hg.substr(0, p) + s + Hg.substring(p + 2, Hg.length);
};
XhrDiskBackend.prototype.read_async_cb = function(Vh) {
	var Qh, l, ve, Rh, i, Wh, Xh, Yh, Zh;
	var ai, Hg;
	while (this.sector_index < this.sector_count) {
		Qh = Math.floor(this.sector_num / this.block_sectors);
		Rh = this.get_cached_block(Qh);
		if (Rh) {
			ve = this.sector_num - Qh * this.block_sectors;
			l = Math.min(this.sector_count - this.sector_index,
					this.block_sectors - ve);
			Wh = l * 512;
			Xh = this.sector_buf;
			Yh = this.sector_index * 512;
			Zh = Rh.buf;
			ai = ve * 512;
			for (i = 0; i < Wh; i++) {
				Xh[i + Yh] = Zh[i + ai];
			}
			this.sector_index += l;
			this.sector_num += l;
		} else {
			Hg = this.get_url(this.url, Qh);
			load_binary(Hg, this.read_async_cb2.bind(this));
			return;
		}
	}
	this.sector_buf = null;
	if (!Vh) {
		this.sector_cb(0);
	}
};
XhrDiskBackend.prototype.add_block = function(Qh, Kg, rg) {
	var Rh, bi, i;
	Rh = this.new_cached_block(Qh);
	bi = Rh.buf = allocBuffer(this.block_sectors * 512);
	if (typeof Kg == "string") {
		for (i = 0; i < rg; i++)
			bi[i] = Kg.charCodeAt(i) & 0xff;
	} else {
		for (i = 0; i < rg; i++)
			bi[i] = Kg[i];
	}
};
XhrDiskBackend.prototype.read_async_cb2 = function(Kg, rg) {
	var Qh;
	if (rg < 0 || rg != (this.block_sectors * 512)) {
		this.sector_cb(-1);
	} else {
		Qh = Math.floor(this.sector_num / this.block_sectors);
		// add_block(block_num, buf, size)
		this.add_block(Qh, Kg, rg);
		this.read_async_cb(false);
	}
};
XhrDiskBackend.prototype.read_async = function(Bh, bi, n, ci) {
    // in: Bh (sector num), n (sector count)
    //out: bi (buffer)
    
	if ((Bh + n) > this.nb_sectors)
		return -1;

	this.sector_num = Bh;  // sector num to start read at
	this.sector_buf = bi;
	this.sector_index = 0; // current sector
	this.sector_count = n; // how many sectors to read
	this.sector_cb = ci;
	this.read_async_cb(true);
	// i.e request lte 0 sectors be read
	if (this.sector_index >= this.sector_count) {
		return 0;
	} else {
		return 1;
	}
};
XhrDiskBackend.prototype.preload = function(xh, Ig) {
	var i, Hg, Qh;
	if (xh.length == 0) {
		setTimeout(Ig, 0);
	} else {
		this.preload_cb2 = Ig;
		this.preload_count = xh.length;
		for (i = 0; i < xh.length; i++) {
			Qh = xh[i];
			Hg = this.get_url(this.url, Qh);
			load_binary(Hg, this.preload_cb.bind(this, Qh));
		}
	}
};
XhrDiskBackend.prototype.preload_cb = function(Qh, Kg, rg) {
	if (rg < 0) {
	} else {
		this.add_block(Qh, Kg, rg);
		this.preload_count--;
		if (this.preload_count == 0) {
			this.preload_cb2(0);
		}
	}
};
XhrDiskBackend.prototype.write_async = function(Bh, bi, n, ci) {
    
    if ((Bh + n) > this.nb_sectors)
		return -1;
	
	if( !(bi instanceof ArrayBuffer) ) {
        console.log('write_async: req is not an arraybuffer');
        return -1;
    }
        
	this.sector_num = Bh;
    this.sector_buf = bi;
    this.sector_index = 0;
    this.sector_count = n;
    this.sector_cb = ci;
    this.write_async_cb(true);
    
    if (this.sector_index >= this.sector_count) {
    	return 0;
    } else {
    	return 1;
    }
    
};

XhrDiskBackend.prototype.write_async_cb = function(Vh) {
    var Qh, l, ve, Rh, i, Wh, Xh, Yh, Zh;
	var ai, Hg;
	var wrbuf;
	while (this.sector_index < this.sector_count) {
	    
	    // determine which block we're writing now
		Qh = Math.floor(this.sector_num / this.block_sectors);
		// block relative sector num
		ve = this.sector_num - Qh * this.block_sectors;
		// length of write = remaining sectors in block, or whatever is left in the req
		l = Math.min(this.sector_count - this.sector_index,
				this.block_sectors - ve);
		
		// length in bytes of the write
		Wh = l * 512;
    	Xh = this.sector_buf;
    	// byte offset into the write at this iteration
    	Yh = this.sector_index * 512;
        // byte offset into the block
    	ai = ve * 512;
    			
		Rh = this.get_cached_block(Qh);
		
		if (Rh) {
		    // invalidate the entry for this block
		    Rh.buf = null;
		    Rh.time = 0;
		    Rh.block_num = -1;
	    }
	    
	    // extract a slice of the buffer to be written to this block
	    
	    if(Xh instanceof ArrayBuffer)
	        wrbuf = Xh.slice(Yh, Yh + Wh + 1);
	    else
	        wrbuf = Xh.subarray(Yh, Yh + Wh + 1);
	    
		this.sector_index += l;
		this.sector_num += l;
		
		// do the write
		Hg = this.get_url(this.url, Qh);
		write_binary('ide.py?block=' + Hg + '&offset=' + ai, wrbuf, this.write_async_cb2.bind(this));
		return;
		
	}

	this.sector_buf = null;
	if (!Vh) {
		this.sector_cb(0);
	}
};

XhrDiskBackend.prototype.write_async_cb2 = function(res){
    if(!res){
        this.sector_cb(-1);
    }else{
		this.write_async_cb(false);
    }
};
