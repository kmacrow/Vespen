/*
 * Simple example of use of vm86: launch a basic .com DOS executable
 */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <inttypes.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <signal.h>
#include <errno.h>
#include <ctype.h>

#include <sys/syscall.h>
#include <asm/vm86.h>

//#define SIGTEST
//#define DUMP_INT21

static inline int vm86(int func, struct vm86plus_struct *v86)
{
    return syscall(__NR_vm86, func, v86);
}

#define TF_MASK 		0x00000100
#define IF_MASK 		0x00000200
#define DF_MASK 		0x00000400
#define IOPL_MASK		0x00003000
#define NT_MASK	         	0x00004000
#define RF_MASK			0x00010000
#define VM_MASK			0x00020000
#define AC_MASK			0x00040000
#define VIF_MASK                0x00080000
#define VIP_MASK                0x00100000
#define ID_MASK                 0x00200000

void usage(void)
{
    printf("runcom version 0.2 (c) 2003-2011 Fabrice Bellard\n"
           "usage: runcom file.com [args...]\n"
           "Run simple .com DOS executables (linux vm86 test mode)\n");
    exit(1);
}

static inline void set_bit(uint8_t *a, unsigned int bit)
{
    a[bit / 8] |= (1 << (bit % 8));
}

static inline uint8_t *seg_to_linear(unsigned int seg, unsigned int reg)
{
    return (uint8_t *)((seg << 4) + (reg & 0xffff));
}

static inline void pushw(struct vm86_regs *r, int val)
{
    r->esp = (r->esp & ~0xffff) | ((r->esp - 2) & 0xffff);
    *(uint16_t *)seg_to_linear(r->ss, r->esp) = val;
}

void dump_regs(struct vm86_regs *r)
{
    fprintf(stderr,
            "EAX=%08lx EBX=%08lx ECX=%08lx EDX=%08lx\n"
            "ESI=%08lx EDI=%08lx EBP=%08lx ESP=%08lx\n"
            "EIP=%08lx EFL=%08lx\n"
            "CS=%04x DS=%04x ES=%04x SS=%04x FS=%04x GS=%04x\n",
            r->eax, r->ebx, r->ecx, r->edx, r->esi, r->edi, r->ebp, r->esp,
            r->eip, r->eflags,
            r->cs, r->ds, r->es, r->ss, r->fs, r->gs);
}

#ifdef SIGTEST
void alarm_handler(int sig)
{
    fprintf(stderr, "alarm signal=%d\n", sig);
    alarm(1);
}
#endif

#define DOS_FD_MAX 256
typedef struct {
    int fd; /* -1 means closed */
} DOSFile;

DOSFile dos_files[DOS_FD_MAX];
uint16_t cur_psp;

void dos_init(void)
{
    int i;
    for(i = 0; i < 3; i++)
        dos_files[i].fd = i;    
    for(i = 3; i < DOS_FD_MAX; i++)
        dos_files[i].fd = -1;
}

static inline void set_error(struct vm86_regs *r, int val)
{
    if (val) {
        r->eax = (r->eax & ~0xffff) | val;
        r->eflags |= 1;
    } else {
        r->eflags &= ~1;
    }
}
static DOSFile *get_file(int h)
{
    DOSFile *fh;

    if (h >= DOS_FD_MAX)
        return NULL;
    fh = &dos_files[h];
    if (fh->fd == -1)
        return NULL;
    return fh;
}

/* return -1 if error */
static int get_new_handle(void)
{
    DOSFile *fh;
    int i;

    for(i = 0; i < DOS_FD_MAX; i++) {
        fh = &dos_files[i];
        if (fh->fd == -1)
            return i;
    }
    return -1;
}

static char *get_filename1(struct vm86_regs *r, char *buf, int buf_size,
                           uint16_t seg, uint16_t offset)
{
    char *q;
    int c;
    q = buf;
    for(;;) {
        c = *seg_to_linear(seg, offset);
        if (c == 0)
            break;
        if (q >= buf + buf_size - 1)
            break;
        c = tolower(c);
        if (c == '\\')
            c = '/';
        *q++ = c;
        offset++;
    }
    *q = '\0';
    return buf;
} 

static char *get_filename(struct vm86_regs *r, char *buf, int buf_size)
{
    return get_filename1(r, buf, buf_size, r->ds, r->edx & 0xffff);
}

typedef struct __attribute__((packed)) {
    uint8_t drive_num;
    uint8_t file_name[8];
    uint8_t file_ext[3];
    uint16_t current_block;
    uint16_t logical_record_size;
    uint32_t file_size;
    uint16_t date;
    uint16_t time;
    uint8_t reserved[8];
    uint8_t record_in_block;
    uint32_t record_num;
} FCB;

typedef struct __attribute__((packed)) {
    uint16_t environ;
    uint16_t cmdtail_off;
    uint16_t cmdtail_seg;
    uint32_t fcb1;
    uint32_t fcb2;
    uint16_t sp, ss;
    uint16_t ip, cs;
} ExecParamBlock;

typedef struct MemBlock {
    struct MemBlock *next;
    uint16_t seg;
    uint16_t size; /* in paragraphs */
} MemBlock;

/* first allocated paragraph */
MemBlock *first_mem_block = NULL;

#define MEM_START 0x1000
#define MEM_END   0xa000

/* return -1 if error */
int mem_malloc(int size, int *pmax_size)
{
    MemBlock *m, **pm;
    int seg_free, seg;
    
    /* XXX: this is totally inefficient, but we have only 1 or 2
       blocks ! */
    seg_free = MEM_START;
    for(pm = &first_mem_block; *pm != NULL; pm = &(*pm)->next) {
        m = *pm;
        seg = m->seg + m->size;
        if (seg > seg_free)
            seg_free = seg;
    }
    if ((seg_free + size) > MEM_END)
        return -1;
    if (pmax_size)
        *pmax_size = MEM_END - seg_free;
    /* add at the end */
    m = malloc(sizeof(MemBlock));
    *pm = m;
    m->next = NULL;
    m->seg = seg_free;
    m->size = size;
#ifdef DUMP_INT21
    printf("mem_malloc size=0x%04x: 0x%04x\n", size, seg_free);
#endif
    return seg_free;
}

/* return -1 if error */
int mem_free(int seg)
{
    MemBlock *m, **pm;
    for(pm = &first_mem_block; *pm != NULL; pm = &(*pm)->next) {
        m = *pm;
        if (m->seg == seg) {
            *pm = m->next;
            free(m);
            return 0;
        }
    }
    return -1;
}

/* return -1 if error or the maxmium size */
int mem_resize(int seg, int new_size)
{
    MemBlock *m, **pm, *m1;
    int max_size;

    for(pm = &first_mem_block; *pm != NULL; pm = &(*pm)->next) {
        m = *pm;
        if (m->seg == seg) {
            m1 = m->next;
            if (!m1)
                max_size = MEM_END - m->seg;
            else
                max_size = m1->seg - m->seg;
            if (new_size > max_size)
                return -1;
            m->size = new_size;
            return max_size;
        }
    }
    return -1;
}

/* return the PSP or -1 if error */
int load_com(ExecParamBlock *blk, const char *filename, uint32_t *pfile_size,
             int initial_exec)
{
    int psp, fd, ret;

    /* load the MSDOS .com executable */
    fd = open(filename, O_RDONLY);
    if (fd < 0) {
        return -1;
    }
    psp = mem_malloc(65536 / 16, NULL);
    ret = read(fd, seg_to_linear(psp, 0x100), 65536 - 0x100);
    if (ret <= 0) {
        close(fd);
        mem_free(psp);
        return -1;
    }
    close(fd);
    
    /* reset the PSP */
    memset(seg_to_linear(psp, 0), 0, 0x100);

    *seg_to_linear(psp, 0) = 0xcd; /* int $0x20 */
    *seg_to_linear(psp, 1) = 0x20;
    /* address of last segment allocated */
    *(uint16_t *)seg_to_linear(psp, 2) = psp + 0xfff;

    /* push ax value */
    *(uint16_t *)seg_to_linear(psp, 0xfffc) = 0;
    /* push return address to 0 */
    *(uint16_t *)seg_to_linear(psp, 0xfffe) = 0;

    if (!initial_exec) {
        int len;
        /* copy the command line */
        len = *seg_to_linear(blk->cmdtail_seg, blk->cmdtail_off);
        memcpy(seg_to_linear(psp, 0x80), 
               seg_to_linear(blk->cmdtail_seg, blk->cmdtail_off), len + 2);
    }

    blk->sp = 0xfffc;
    blk->ip = 0x100;
    blk->cs = blk->ss = psp;
    if (pfile_size)
        *pfile_size = ret;
    return psp;
}


void do_int20(struct vm86_regs *r)
{
    /* terminate program */
    exit(0);
}

void do_int21(struct vm86_regs *r)
{
    uint8_t ah;
    
    ah = (r->eax >> 8) & 0xff;
    switch(ah) {
    case 0x00: /* exit */
        exit(0);
    case 0x02: /* write char */
        {
            uint8_t c = r->edx;
            write(1, &c, 1);
        }
        break;
    case 0x09: /* write string */
        {
            uint8_t c;
            int offset;
            offset = r->edx;
            for(;;) {
                c = *seg_to_linear(r->ds, offset & 0xffff);
                if (c == '$')
                    break;
                write(1, &c, 1);
                offset++;
            }
            r->eax = (r->eax & ~0xff) | '$';
        }
        break;
    case 0x0a: /* buffered input */
        {
            int max_len, cur_len, ret;
            uint8_t ch;
            uint16_t off;

            /* XXX: should use raw mode to avoid sending the CRLF to
               the terminal */
            off = r->edx & 0xffff;
            max_len = *seg_to_linear(r->ds, off);
            cur_len = 0;
            while (cur_len < max_len) {
                ret = read(0, &ch, 1);
                if (ret < 0) {
                    if (errno != EINTR && errno != EAGAIN)
                        break;
                } else if (ret == 0) {
                    break;
                } else {
                    if (ch == '\n')
                        break;
                }
                *seg_to_linear(r->ds, off + 2 + cur_len++) = ch;
            }
            *seg_to_linear(r->ds, off + 1) = cur_len;
            *seg_to_linear(r->ds, off + 2 + cur_len) = '\r';
        }
        break;
    case 0x25: /* set interrupt vector */
        {
            uint16_t *ptr;
            ptr = (uint16_t *)seg_to_linear(0, (r->eax & 0xff) * 4);
            ptr[0] = r->edx;
            ptr[1] = r->ds;
        }
        break;
    case 0x29: /* parse filename into FCB */
#if 0
        /* not really needed */
        {
            const uint8_t *p, *p_start;
            uint8_t file[8], ext[3]; 
            FCB *fcb;
            int file_len, ext_len, has_wildchars, c, drive_num;
            
            /* XXX: not complete at all */
            fcb = (FCB *)seg_to_linear(r->es, r->edi & 0xffff);
            printf("ds=0x%x si=0x%lx\n", r->ds, r->esi);
            p_start = (const uint8_t *)seg_to_linear(r->ds, r->esi & 0xffff);

            p = p_start;
            has_wildchars = 0;

            /* drive */
            if (isalpha(p[0]) && p[1] == ':') {
                drive_num = toupper(p[0]) - 'A' + 1;
                p += 2;
            } else {
                drive_num = 0;
            }

            /* filename */
            file_len = 0;
            for(;;) {
                c = *p;
                if (!(c >= 33 && c <= 126))
                    break;
                if (c == '.')
                    break;
                if (c == '*' || c == '?')
                    has_wildchars = 1;
                if (file_len < 8)
                    file[file_len++] = c;
            }
            memset(file + file_len, ' ', 8 - file_len);

            /* extension */
            ext_len = 0;
            if (*p == '.') {
                for(;;) {
                    c = *p;
                    if (!(c >= 33 && c <= 126))
                        break;
                    if (c == '*' || c == '?')
                        has_wildchars = 1;
                    ext[ext_len++] = c;
                    if (ext_len >= 3)
                        break;
                }
            }
            memset(ext + ext_len, ' ', 3 - ext_len);

#if 0
            {
                printf("drive=%d file=%8s ext=%3s\n",
                       drive_num, file, ext);
            }
#endif
            if (drive_num == 0 && r->eax & (1 << 1)) {
                /* keep drive */
            } else {
                fcb->drive_num = drive_num; /* default drive */
            }

            if (file_len == 0 && r->eax & (1 << 2)) {
                /* keep */
            } else {
                memcpy(fcb->file_name, file, 8);
            }

            if (ext_len == 0 && r->eax & (1 << 3)) {
                /* keep */
            } else {
                memcpy(fcb->file_ext, ext, 3);
            }
            r->eax = (r->eax & ~0xff) | has_wildchars;
            r->esi = (r->esi & ~0xffff) | ((r->esi + (p - p_start)) & 0xffff);
        }
#endif
        break;
    case 0x30: /* get dos version */
        {
            int major, minor, serial, oem;
            /* XXX: return correct value for FreeDOS */
            major = 0x03;
            minor = 0x31;
            serial = 0x123456;
            oem = 0x66;
            r->eax = (r->eax & ~0xffff) | major | (minor << 8);
            r->ecx = (r->ecx & ~0xffff) | (serial & 0xffff);
            r->ebx = (r->ebx & ~0xffff) | (serial & 0xff) | (0x66 << 8);
        }
        break;
    case 0x35: /* get interrupt vector */
        {
            uint16_t *ptr;
            ptr = (uint16_t *)seg_to_linear(0, (r->eax & 0xff) * 4);
            r->ebx = (r->ebx & ~0xffff) | ptr[0];
            r->es = ptr[1];
        }
        break;
    case 0x37: 
        {
            switch(r->eax & 0xff) {
            case 0x00: /* get switch char */
                r->eax = (r->eax & ~0xff) | 0x00;
                r->edx = (r->edx & ~0xff) | '/';
                break;
            default:
                goto unsupported;
            }
        }
        break;
    case 0x3c: /* create or truncate file */
        {
            char filename[1024];
            int fd, h, flags;

            h = get_new_handle();
            if (h < 0) {
                set_error(r, 0x04); /* too many open files */
            } else {
                get_filename(r, filename, sizeof(filename));
                if (r->ecx & 1)
                    flags = 0444; /* read-only */
                else
                    flags = 0777;
                fd = open(filename, O_RDWR | O_TRUNC | O_CREAT, flags);
#ifdef DUMP_INT21
                printf("int21: create: file='%s' cx=0x%04x ret=%d\n", 
                       filename, (int)(r->ecx & 0xffff), h);
#endif
                if (fd < 0) {
                    set_error(r, 0x03); /* path not found */
                } else {
                    dos_files[h].fd = fd;
                    set_error(r, 0);
                    r->eax = (r->eax & ~0xffff) | h;
                }
            }
        }
        break;
    case 0x3d: /* open file */
        {
            char filename[1024];
            int fd, h;

            h = get_new_handle();
            if (h < 0) {
                set_error(r, 0x04); /* too many open files */
            } else {
                get_filename(r, filename, sizeof(filename));
#ifdef DUMP_INT21
                printf("int21: open: file='%s' al=0x%02x ret=%d\n", 
                       filename, (int)(r->eax & 0xff), h);
#endif
                fd = open(filename, r->eax & 3);
                if (fd < 0) {
                    set_error(r, 0x02); /* file not found */
                } else {
                    dos_files[h].fd = fd;
                    set_error(r, 0);
                    r->eax = (r->eax & ~0xffff) | h;
                }
            }
        }
        break;
    case 0x3e: /* close file */
        {
            DOSFile *fh = get_file(r->ebx & 0xffff);
#ifdef DUMP_INT21
            printf("int21: close fd=%d\n", (int)(r->ebx & 0xffff));
#endif
            if (!fh) {
                set_error(r, 0x06); /* invalid handle */
            } else {
                close(fh->fd);
                fh->fd = -1;
                set_error(r, 0);
            }
        }
        break;
    case 0x3f: /* read */
        {
            DOSFile *fh = get_file(r->ebx & 0xffff);
            int n, ret;

            if (!fh) {
                set_error(r, 0x06); /* invalid handle */
            } else {
                n = r->ecx & 0xffff;
                for(;;) {
                    ret = read(fh->fd, 
                               seg_to_linear(r->ds, r->edx & 0xffff), n);
                    if (ret < 0) {
                        if (errno != EINTR && errno != EAGAIN)
                            break;
                    } else {
                        break;
                    }
                }
#ifdef DUMP_INT21
                printf("int21: read: fd=%d n=%d ret=%d\n", 
                       (int)(r->ebx & 0xffff), n, ret);
#endif
                if (ret < 0) {
                    set_error(r, 0x05); /* acces denied */
                } else {
                    r->eax = (r->eax & ~0xffff) | ret;
                    set_error(r, 0);
                }
            }
        }
        break;
    case 0x40: /* write */
        {
            DOSFile *fh = get_file(r->ebx & 0xffff);
            int n, ret, pos;
            
            if (!fh) {
                set_error(r, 0x06); /* invalid handle */
            } else {
                n = r->ecx & 0xffff;
                if (n == 0) {
                    /* truncate */
                    pos = lseek(fh->fd, 0, SEEK_CUR);
                    if (pos >= 0) {
                        ret = ftruncate(fh->fd, pos);
                    } else {
                        ret = -1;
                    }
                } else {
                    for(;;) {
                        ret = write(fh->fd, 
                                    seg_to_linear(r->ds, r->edx & 0xffff), n);
                        if (ret < 0) {
                            if (errno != EINTR && errno != EAGAIN)
                                break;
                        } else {
                            break;
                        }
                    }
                }
#ifdef DUMP_INT21
                printf("int21: write: fd=%d n=%d ret=%d\n", 
                       (int)(r->ebx & 0xffff), n, ret);
#endif
                if (ret < 0) {
                    set_error(r, 0x05); /* acces denied */
                } else {
                    r->eax = (r->eax & ~0xffff) | ret;
                    set_error(r, 0);
                }
            }
        }
        break;
    case 0x41: /* unlink */
        {
            char filename[1024];
            get_filename(r, filename, sizeof(filename));
            if (unlink(filename) < 0) {
                set_error(r, 0x02); /* file not found */
            } else {
                set_error(r, 0);
            }
        }
        break;
    case 0x42: /* lseek */
        {
            DOSFile *fh = get_file(r->ebx & 0xffff);
            int pos, ret;
            
            if (!fh) {
                set_error(r, 0x06); /* invalid handle */
            } else {
                pos = ((r->ecx & 0xffff) << 16) | (r->edx & 0xffff);
                ret = lseek(fh->fd, pos, r->eax & 0xff);
#ifdef DUMP_INT21
                printf("int21: lseek: fd=%d pos=%d whence=%d ret=%d\n", 
                       (int)(r->ebx & 0xffff), pos, (uint8_t)r->eax, ret);
#endif
                if (ret < 0) {
                    set_error(r, 0x01); /* function number invalid */
                } else {
                    r->edx = (r->edx & ~0xffff) | ((unsigned)ret >> 16);
                    r->eax = (r->eax & ~0xffff) | (ret & 0xffff);
                    set_error(r, 0);
                }
            }
        }
        break;
    case 0x44: /* ioctl */
        switch(r->eax & 0xff) {
        case 0x00: /* get device information */
            {
                DOSFile *fh = get_file(r->ebx & 0xffff);
                int ret;
                
                if (!fh) {
                    set_error(r, 0x06); /* invalid handle */
                } else {
                    ret = 0;
                    if (isatty(fh->fd)) {
                        ret |= 0x80;
                        if (fh->fd == 0)
                            ret |= (1 << 0);
                        else
                            ret |= (1 << 1);
                    }
                    r->edx = (r->edx & ~0xffff) | ret;
                    set_error(r, 0);
                }
            }
            break;
        default:
            goto unsupported;
        }
        break;
    case 0x48: /* allocate memory */
        {
            int ret, max_size;
#ifdef DUMP_INT21
            printf("int21: allocate memory: size=0x%04x\n", (uint16_t)r->ebx);
#endif
            ret = mem_malloc(r->ebx & 0xffff, &max_size);
            if (ret < 0) {
                set_error(r, 0x08); /* insufficient memory*/
            } else {
                r->eax = (r->eax & ~0xffff) | ret;
                r->ebx = (r->ebx & ~0xffff) | max_size;
                set_error(r, 0);
            }
        }
        break;
    case 0x49: /* free memory */
        {
#ifdef DUMP_INT21
            printf("int21: free memory: block=0x%04x\n", r->es);
#endif
            if (mem_free(r->es) < 0) {
                set_error(r, 0x09); /* memory block address invalid */
            } else {
                set_error(r, 0);
            }
        }
        break;
    case 0x4a: /* resize memory block */
        {
            int ret;
#ifdef DUMP_INT21
            printf("int21: resize memory block: block=0x%04x size=0x%04x\n", 
                   r->es, (uint16_t)r->ebx);
#endif
            ret = mem_resize(r->es, r->ebx & 0xffff);
            if (ret < 0) {
                set_error(r, 0x08); /* insufficient memory*/
            } else {
                r->ebx = (r->ebx & ~0xffff) | ret;
                set_error(r, 0);
            }
        }
        break;
    case 0x4b: /* load program */
        {
            char filename[1024];
            ExecParamBlock *blk;
            int ret;

            if ((r->eax & 0xff) != 0x01) /* only load */
                goto unsupported;
            get_filename(r, filename, sizeof(filename));
            blk = (ExecParamBlock *)seg_to_linear(r->es, r->ebx & 0xffff);
            ret = load_com(blk, filename, NULL, 0);
            if (ret < 0) {
                set_error(r, 0x02); /* file not found */
            } else {
                cur_psp = ret;
                set_error(r, 0);
            }
        }
        break;
    case 0x4c: /* exit with return code */
        exit(r->eax & 0xff);
        break;
    case 0x50: /* set PSP address */
#ifdef DUMP_INT21
        printf("int21: set PSP: 0x%04x\n", (uint16_t)r->ebx);
#endif
        cur_psp = r->ebx;
        break;
    case 0x51: /* get PSP address */
#ifdef DUMP_INT21
        printf("int21: get PSP: ret=0x%04x\n", cur_psp);
#endif
        r->ebx = (r->ebx & ~0xffff) | cur_psp;
        break;
    case 0x55: /* create child PSP */
        {
            uint8_t *psp_ptr;
#ifdef DUMP_INT21
            printf("int21: create child PSP: psp=0x%04x last_seg=0x%04x\n", 
                   (uint16_t)r->edx, (uint16_t)r->esi);
#endif
            psp_ptr = seg_to_linear(r->edx & 0xffff, 0);
            memset(psp_ptr, 0, 0x80);
            psp_ptr[0] = 0xcd; /* int $0x20 */
            psp_ptr[1] = 0x20;
            *(uint16_t *)(psp_ptr + 2) = r->esi;
            r->eax = (r->eax & ~0xff);
        }
        break;
    default:
    unsupported:
        fprintf(stderr, "int 0x%02x: unsupported function 0x%02x\n", 0x21, ah);
        dump_regs(r);
        set_error(r, 0x01); /* function number invalid */
        break;
    }
}
    
void do_int29(struct vm86_regs *r)
{
    uint8_t c = r->eax;
    write(1, &c, 1);
}

int main(int argc, char **argv)
{
    uint8_t *vm86_mem;
    const char *filename;
    int ret;
    uint32_t file_size;
    struct vm86plus_struct ctx;
    struct vm86_regs *r;
    ExecParamBlock blk1, *blk = &blk1;

    if (argc < 2)
        usage();
    filename = argv[1];

    vm86_mem = mmap((void *)0x00000000, 0x110000,
                    PROT_WRITE | PROT_READ | PROT_EXEC,
                    MAP_FIXED | MAP_ANON | MAP_PRIVATE, -1, 0);
    if (vm86_mem == MAP_FAILED) {
        perror("mmap");
        exit(1);
    }
#ifdef SIGTEST
    {
        struct sigaction act;

        act.sa_handler = alarm_handler;
        sigemptyset(&act.sa_mask);
        act.sa_flags = 0;
        sigaction(SIGALRM, &act, NULL);
        alarm(1);
    }
#endif

    memset(&ctx, 0, sizeof(ctx));
    r = &ctx.regs;
    set_bit((uint8_t *)&ctx.int_revectored, 0x20);
    set_bit((uint8_t *)&ctx.int_revectored, 0x21);
    set_bit((uint8_t *)&ctx.int_revectored, 0x29);

    dos_init();

    ret = load_com(blk, filename, &file_size, 1);
    if (ret < 0) {
        perror(filename);
        exit(1);
    }
    cur_psp = ret;

    /* init basic registers */
    r->eip = blk->ip;
    r->esp = blk->sp + 2; /* pop ax value */
    r->cs = cur_psp;
    r->ss = blk->ss;
    r->ds = cur_psp;
    r->es = cur_psp;
    r->eflags = VIF_MASK;
    
    /* set the command line */
    {
        int i, p;
        char *s;

        p = 0x81;
        for(i = 2; i < argc; i++) {
            if (p >= 0xff)
                break;
            *seg_to_linear(cur_psp, p++) = ' ';
            s = argv[i];
            while (*s) {
                if (p >= 0xff)
                    break;
                *seg_to_linear(cur_psp, p++) = *s++;
            }
        }
        *seg_to_linear(cur_psp, p) = '\r';
        *seg_to_linear(cur_psp, 0x80) = p - 0x81;
    }

    /* the value of these registers seem to be assumed by pi_10.com */
    r->esi = 0x100;
#if 0
    r->ebx = file_size >> 16;
    r->ecx = file_size & 0xffff;
#else
    r->ecx = 0xff;
#endif
    r->ebp = 0x0900;
    r->edi = 0xfffe;

    for(;;) {
        ret = vm86(VM86_ENTER, &ctx);
        switch(VM86_TYPE(ret)) {
        case VM86_INTx:
            {
                int int_num;

                int_num = VM86_ARG(ret);
                switch(int_num) {
                case 0x20:
                    do_int20(r);
                    break;
                case 0x21:
                    do_int21(r);
                    break;
                case 0x29:
                    do_int29(r);
                    break;
                default:
                    fprintf(stderr, "unsupported int 0x%02x\n", int_num);
                    dump_regs(&ctx.regs);
                    break;
                }
            }
            break;
        case VM86_SIGNAL:
            /* a signal came, we just ignore that */
            break;
        case VM86_STI:
            break;
        case VM86_TRAP:
            /* just executes the interruption */
            {
                uint16_t *int_vector;
                uint32_t eflags;
                
                eflags = r->eflags & ~IF_MASK;
                if (r->eflags & VIF_MASK)
                    eflags |= IF_MASK;
                pushw(r, eflags);
                pushw(r, r->cs);
                pushw(r, r->eip);
                int_vector = (uint16_t *)seg_to_linear(0, VM86_ARG(ret) * 4);
                r->eip = int_vector[0];
                r->cs = int_vector[1];
                r->eflags &= ~(VIF_MASK | TF_MASK | AC_MASK);
            }
            break;
        default:
            fprintf(stderr, "unhandled vm86 return code (0x%x)\n", ret);
            dump_regs(&ctx.regs);
            exit(1);
        }
    }
}
