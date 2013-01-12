/*
Fabrix - An annotated version of the original JSLinux which is Copyright (c) 2011 Fabrice Bellard

Serial Controller Emulator
*/

function Serial(Ng, mem8_loc, kh, lh) {
    this.divider = 0;
    this.rbr = 0;
    this.ier = 0;
    this.iir = 0x01;
    this.lcr = 0;
    this.mcr;
    this.lsr = 0x40 | 0x20;
    this.msr = 0;
    this.scr = 0;
    this.fcr = 0;
    this.set_irq_func = kh;
    this.write_func = lh;
    this.tx_fifo = "";
    this.rx_fifo = "";
    Ng.register_ioport_write(0x3f8, 8, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(0x3f8, 8, 1, this.ioport_read.bind(this));
}
Serial.prototype.update_irq = function() {
    if ((this.lsr & 0x01) && (this.ier & 0x01)) {
        this.iir = 0x04;
    } else if ((this.lsr & 0x20) && (this.ier & 0x02)) {
        this.iir = 0x02;
    } else {
        this.iir = 0x01;
    }
    if (this.iir != 0x01) {
        this.set_irq_func(1);
    } else {
        this.set_irq_func(0);
    }
};
Serial.prototype.write_tx_fifo = function() {
	if (this.tx_fifo != "") {
		this.write_func(this.tx_fifo);
		this.tx_fifo = "";
		this.lsr |= 0x20;
		this.lsr |= 0x40;
		this.update_irq();
	}
};
Serial.prototype.ioport_write = function(mem8_loc, x) {
    mem8_loc &= 7;
    switch (mem8_loc) {
        default:
        case 0:
            if (this.lcr & 0x80) {
                this.divider = (this.divider & 0xff00) | x;
            } else {
    			if (this.fcr & 0x01) {
    				this.tx_fifo += String.fromCharCode(x);
    				this.lsr &= ~0x20;
    				this.update_irq();
    				if (this.tx_fifo.length >= 16) {
    					this.write_tx_fifo();
    				}
    			} else {
    				this.lsr &= ~0x20;
    				this.update_irq();
    				this.write_func(String.fromCharCode(x));
    				this.lsr |= 0x20;
    				this.lsr |= 0x40;
    				this.update_irq();
    			}
            }
            break;
        case 1:
            if (this.lcr & 0x80) {
                this.divider = (this.divider & 0x00ff) | (x << 8);
            } else {
                this.ier = x;
                this.update_irq();
            }
            break;
        case 2:
    		if ((this.fcr ^ x) & 0x01) {
    			x |= 0x04 | 0x02;
    		}
    		if (x & 0x04)
    			this.tx_fifo = "";
    		if (x & 0x02)
    			this.rx_fifo = "";
    		this.fcr = x & 0x01;
            break;
        case 3:
            this.lcr = x;
            break;
        case 4:
            this.mcr = x;
            break;
        case 5:
            break;
        case 6:
            this.msr = x;
            break;
        case 7:
            this.scr = x;
            break;
    }
};
Serial.prototype.ioport_read = function(mem8_loc) {
    var Pg;
    mem8_loc &= 7;
    switch (mem8_loc) {
        default:
        case 0:
            if (this.lcr & 0x80) {
                Pg = this.divider & 0xff;
            } else {
                Pg = this.rbr;
                this.lsr &= ~(0x01 | 0x10);
                this.update_irq();
                this.send_char_from_fifo();
            }
            break;
        case 1:
            if (this.lcr & 0x80) {
                Pg = (this.divider >> 8) & 0xff;
            } else {
                Pg = this.ier;
            }
            break;
        case 2:
            Pg = this.iir;
    		if (this.fcr & 0x01)
    			Pg |= 0xC0;
            break;
        case 3:
            Pg = this.lcr;
            break;
        case 4:
            Pg = this.mcr;
            break;
        case 5:
            Pg = this.lsr;
            break;
        case 6:
            Pg = this.msr;
            break;
        case 7:
            Pg = this.scr;
            break;
    }
    return Pg;
};
Serial.prototype.send_break = function() {
    this.rbr = 0;
    this.lsr |= 0x10 | 0x01;
    this.update_irq();
};
Serial.prototype.send_char = function(mh) {
    this.rbr = mh;
    this.lsr |= 0x01;
    this.update_irq();
};
Serial.prototype.send_char_from_fifo = function() {
    var nh;
    nh = this.rx_fifo;
    if (nh != "" && !(this.lsr & 0x01)) {
        this.send_char(nh.charCodeAt(0));
        this.rx_fifo = nh.substr(1, nh.length - 1);
    }
};
Serial.prototype.send_chars = function(na) {
    this.rx_fifo += na;
    this.send_char_from_fifo();
};
