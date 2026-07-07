'use strict';
/*
 * ZIM Reader — read offline ZIM archives (Kiwix / Wikipedia) inside Obsidian.
 * Plain-JS plugin: main.js is the source, there is no build step. Edit here,
 * run `node deploy.mjs`, reload Obsidian. Desktop only (needs fs + huge files).
 */
const obsidian = require('obsidian');
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, Platform, FileSystemAdapter } = obsidian;
const fs = require('fs');
const nodePath = require('path');

// Zstandard decompressor (fzstd 0.1.1, MIT — https://github.com/101arrowz/fzstd),
// inlined so the plugin ships as a single self-contained main.js.
const fzstd = (function () {
var exports = {};
"use strict";
// Some numerical data is initialized as -1 even when it doesn't need initialization to help the JIT infer types
// aliases for shorter compressed code (most minifers don't do this)
var ab = ArrayBuffer, u8 = Uint8Array, u16 = Uint16Array, i16 = Int16Array, u32 = Uint32Array, i32 = Int32Array;
var slc = function (v, s, e) {
    if (u8.prototype.slice)
        return u8.prototype.slice.call(v, s, e);
    if (s == null || s < 0)
        s = 0;
    if (e == null || e > v.length)
        e = v.length;
    var n = new u8(e - s);
    n.set(v.subarray(s, e));
    return n;
};
var fill = function (v, n, s, e) {
    if (u8.prototype.fill)
        return u8.prototype.fill.call(v, n, s, e);
    if (s == null || s < 0)
        s = 0;
    if (e == null || e > v.length)
        e = v.length;
    for (; s < e; ++s)
        v[s] = n;
    return v;
};
var cpw = function (v, t, s, e) {
    if (u8.prototype.copyWithin)
        return u8.prototype.copyWithin.call(v, t, s, e);
    if (s == null || s < 0)
        s = 0;
    if (e == null || e > v.length)
        e = v.length;
    while (s < e) {
        v[t++] = v[s++];
    }
};
/**
 * Codes for errors generated within this library
 */
exports.ZstdErrorCode = {
    InvalidData: 0,
    WindowSizeTooLarge: 1,
    InvalidBlockType: 2,
    FSEAccuracyTooHigh: 3,
    DistanceTooFarBack: 4,
    UnexpectedEOF: 5
};
// error codes
var ec = [
    'invalid zstd data',
    'window size too large (>2046MB)',
    'invalid block type',
    'FSE accuracy too high',
    'match distance too far back',
    'unexpected EOF'
];
var err = function (ind, msg, nt) {
    var e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace)
        Error.captureStackTrace(e, err);
    if (!nt)
        throw e;
    return e;
};
var rb = function (d, b, n) {
    var i = 0, o = 0;
    for (; i < n; ++i)
        o |= d[b++] << (i << 3);
    return o;
};
var b4 = function (d, b) { return (d[b] | (d[b + 1] << 8) | (d[b + 2] << 16) | (d[b + 3] << 24)) >>> 0; };
// read Zstandard frame header
var rzfh = function (dat, w) {
    var n3 = dat[0] | (dat[1] << 8) | (dat[2] << 16);
    if (n3 == 0x2FB528 && dat[3] == 253) {
        // Zstandard
        var flg = dat[4];
        //    single segment       checksum             dict flag     frame content flag
        var ss = (flg >> 5) & 1, cc = (flg >> 2) & 1, df = flg & 3, fcf = flg >> 6;
        if (flg & 8)
            err(0);
        // byte
        var bt = 6 - ss;
        // dict bytes
        var db = df == 3 ? 4 : df;
        // dictionary id
        var di = rb(dat, bt, db);
        bt += db;
        // frame size bytes
        var fsb = fcf ? (1 << fcf) : ss;
        // frame source size
        var fss = rb(dat, bt, fsb) + ((fcf == 1) && 256);
        // window size
        var ws = fss;
        if (!ss) {
            // window descriptor
            var wb = 1 << (10 + (dat[5] >> 3));
            ws = wb + (wb >> 3) * (dat[5] & 7);
        }
        if (ws > 2145386496)
            err(1);
        var buf = new u8((w == 1 ? (fss || ws) : w ? 0 : ws) + 12);
        buf[0] = 1, buf[4] = 4, buf[8] = 8;
        return {
            b: bt + fsb,
            y: 0,
            l: 0,
            d: di,
            w: (w && w != 1) ? w : buf.subarray(12),
            e: ws,
            o: new i32(buf.buffer, 0, 3),
            u: fss,
            c: cc,
            m: Math.min(131072, ws)
        };
    }
    else if (((n3 >> 4) | (dat[3] << 20)) == 0x184D2A5) {
        // skippable
        return b4(dat, 4) + 8;
    }
    err(0);
};
// most significant bit for nonzero
var msb = function (val) {
    var bits = 0;
    for (; (1 << bits) <= val; ++bits)
        ;
    return bits - 1;
};
// read finite state entropy
var rfse = function (dat, bt, mal) {
    // table pos
    var tpos = (bt << 3) + 4;
    // accuracy log
    var al = (dat[bt] & 15) + 5;
    if (al > mal)
        err(3);
    // size
    var sz = 1 << al;
    // probabilities symbols  repeat   index   high threshold
    var probs = sz, sym = -1, re = -1, i = -1, ht = sz;
    // optimization: single allocation is much faster
    var buf = new ab(512 + (sz << 2));
    var freq = new i16(buf, 0, 256);
    // same view as freq
    var dstate = new u16(buf, 0, 256);
    var nstate = new u16(buf, 512, sz);
    var bb1 = 512 + (sz << 1);
    var syms = new u8(buf, bb1, sz);
    var nbits = new u8(buf, bb1 + sz);
    while (sym < 255 && probs > 0) {
        var bits = msb(probs + 1);
        var cbt = tpos >> 3;
        // mask
        var msk = (1 << (bits + 1)) - 1;
        var val = ((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (tpos & 7)) & msk;
        // mask (1 fewer bit)
        var msk1fb = (1 << bits) - 1;
        // max small value
        var msv = msk - probs - 1;
        // small value
        var sval = val & msk1fb;
        if (sval < msv)
            tpos += bits, val = sval;
        else {
            tpos += bits + 1;
            if (val > msk1fb)
                val -= msv;
        }
        freq[++sym] = --val;
        if (val == -1) {
            probs += val;
            syms[--ht] = sym;
        }
        else
            probs -= val;
        if (!val) {
            do {
                // repeat byte
                var rbt = tpos >> 3;
                re = ((dat[rbt] | (dat[rbt + 1] << 8)) >> (tpos & 7)) & 3;
                tpos += 2;
                sym += re;
            } while (re == 3);
        }
    }
    if (sym > 255 || probs)
        err(0);
    var sympos = 0;
    // sym step (coprime with sz - formula from zstd source)
    var sstep = (sz >> 1) + (sz >> 3) + 3;
    // sym mask
    var smask = sz - 1;
    for (var s = 0; s <= sym; ++s) {
        var sf = freq[s];
        if (sf < 1) {
            dstate[s] = -sf;
            continue;
        }
        // This is split into two loops in zstd to avoid branching, but as JS is higher-level that is unnecessary
        for (i = 0; i < sf; ++i) {
            syms[sympos] = s;
            do {
                sympos = (sympos + sstep) & smask;
            } while (sympos >= ht);
        }
    }
    // After spreading symbols, should be zero again
    if (sympos)
        err(0);
    for (i = 0; i < sz; ++i) {
        // next state
        var ns = dstate[syms[i]]++;
        // num bits
        var nb = nbits[i] = al - msb(ns);
        nstate[i] = (ns << nb) - sz;
    }
    return [(tpos + 7) >> 3, {
            b: al,
            s: syms,
            n: nbits,
            t: nstate
        }];
};
// read huffman
var rhu = function (dat, bt) {
    //  index  weight count
    var i = 0, wc = -1;
    //    buffer             header byte
    var buf = new u8(292), hb = dat[bt];
    // huffman weights
    var hw = buf.subarray(0, 256);
    // rank count
    var rc = buf.subarray(256, 268);
    // rank index
    var ri = new u16(buf.buffer, 268);
    // NOTE: at this point bt is 1 less than expected
    if (hb < 128) {
        // end byte, fse decode table
        var _a = rfse(dat, bt + 1, 6), ebt = _a[0], fdt = _a[1];
        bt += hb;
        var epos = ebt << 3;
        // last byte
        var lb = dat[bt];
        if (!lb)
            err(0);
        //  state1   state2   state1 bits   state2 bits
        var st1 = 0, st2 = 0, btr1 = fdt.b, btr2 = btr1;
        // fse pos
        // pre-increment to account for original deficit of 1
        var fpos = (++bt << 3) - 8 + msb(lb);
        for (;;) {
            fpos -= btr1;
            if (fpos < epos)
                break;
            var cbt = fpos >> 3;
            st1 += ((dat[cbt] | (dat[cbt + 1] << 8)) >> (fpos & 7)) & ((1 << btr1) - 1);
            hw[++wc] = fdt.s[st1];
            fpos -= btr2;
            if (fpos < epos)
                break;
            cbt = fpos >> 3;
            st2 += ((dat[cbt] | (dat[cbt + 1] << 8)) >> (fpos & 7)) & ((1 << btr2) - 1);
            hw[++wc] = fdt.s[st2];
            btr1 = fdt.n[st1];
            st1 = fdt.t[st1];
            btr2 = fdt.n[st2];
            st2 = fdt.t[st2];
        }
        if (++wc > 255)
            err(0);
    }
    else {
        wc = hb - 127;
        for (; i < wc; i += 2) {
            var byte = dat[++bt];
            hw[i] = byte >> 4;
            hw[i + 1] = byte & 15;
        }
        ++bt;
    }
    // weight exponential sum
    var wes = 0;
    for (i = 0; i < wc; ++i) {
        var wt = hw[i];
        // bits must be at most 11, same as weight
        if (wt > 11)
            err(0);
        wes += wt && (1 << (wt - 1));
    }
    // max bits
    var mb = msb(wes) + 1;
    // table size
    var ts = 1 << mb;
    // remaining sum
    var rem = ts - wes;
    // must be power of 2
    if (rem & (rem - 1))
        err(0);
    hw[wc++] = msb(rem) + 1;
    for (i = 0; i < wc; ++i) {
        var wt = hw[i];
        ++rc[hw[i] = wt && (mb + 1 - wt)];
    }
    // huf buf
    var hbuf = new u8(ts << 1);
    //    symbols                      num bits
    var syms = hbuf.subarray(0, ts), nb = hbuf.subarray(ts);
    ri[mb] = 0;
    for (i = mb; i > 0; --i) {
        var pv = ri[i];
        fill(nb, i, pv, ri[i - 1] = pv + rc[i] * (1 << (mb - i)));
    }
    if (ri[0] != ts)
        err(0);
    for (i = 0; i < wc; ++i) {
        var bits = hw[i];
        if (bits) {
            var code = ri[bits];
            fill(syms, i, code, ri[bits] = code + (1 << (mb - bits)));
        }
    }
    return [bt, {
            n: nb,
            b: mb,
            s: syms
        }];
};
// Tables generated using this:
// https://gist.github.com/101arrowz/a979452d4355992cbf8f257cbffc9edd
// default literal length table
var dllt = /*#__PURE__*/ rfse(/*#__PURE__*/ new u8([
    81, 16, 99, 140, 49, 198, 24, 99, 12, 33, 196, 24, 99, 102, 102, 134, 70, 146, 4
]), 0, 6)[1];
// default match length table
var dmlt = /*#__PURE__*/ rfse(/*#__PURE__*/ new u8([
    33, 20, 196, 24, 99, 140, 33, 132, 16, 66, 8, 33, 132, 16, 66, 8, 33, 68, 68, 68, 68, 68, 68, 68, 68, 36, 9
]), 0, 6)[1];
// default offset code table
var doct = /*#__PURE__ */ rfse(/*#__PURE__*/ new u8([
    32, 132, 16, 66, 102, 70, 68, 68, 68, 68, 36, 73, 2
]), 0, 5)[1];
// bits to baseline
var b2bl = function (b, s) {
    var len = b.length, bl = new i32(len);
    for (var i = 0; i < len; ++i) {
        bl[i] = s;
        s += 1 << b[i];
    }
    return bl;
};
// literal length bits
var llb = /*#__PURE__ */ new u8(( /*#__PURE__ */new i32([
    0, 0, 0, 0, 16843009, 50528770, 134678020, 202050057, 269422093
])).buffer, 0, 36);
// literal length baseline
var llbl = /*#__PURE__ */ b2bl(llb, 0);
// match length bits
var mlb = /*#__PURE__ */ new u8(( /*#__PURE__ */new i32([
    0, 0, 0, 0, 0, 0, 0, 0, 16843009, 50528770, 117769220, 185207048, 252579084, 16
])).buffer, 0, 53);
// match length baseline
var mlbl = /*#__PURE__ */ b2bl(mlb, 3);
// decode huffman stream
var dhu = function (dat, out, hu) {
    var len = dat.length, ss = out.length, lb = dat[len - 1], msk = (1 << hu.b) - 1, eb = -hu.b;
    if (!lb)
        err(0);
    var st = 0, btr = hu.b, pos = (len << 3) - 8 + msb(lb) - btr, i = -1;
    for (; pos > eb && i < ss;) {
        var cbt = pos >> 3;
        var val = (dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (pos & 7);
        st = ((st << btr) | val) & msk;
        out[++i] = hu.s[st];
        pos -= (btr = hu.n[st]);
    }
    if (pos != eb || i + 1 != ss)
        err(0);
};
// decode huffman stream 4x
// TODO: use workers to parallelize
var dhu4 = function (dat, out, hu) {
    var bt = 6;
    var ss = out.length, sz1 = (ss + 3) >> 2, sz2 = sz1 << 1, sz3 = sz1 + sz2;
    dhu(dat.subarray(bt, bt += dat[0] | (dat[1] << 8)), out.subarray(0, sz1), hu);
    dhu(dat.subarray(bt, bt += dat[2] | (dat[3] << 8)), out.subarray(sz1, sz2), hu);
    dhu(dat.subarray(bt, bt += dat[4] | (dat[5] << 8)), out.subarray(sz2, sz3), hu);
    dhu(dat.subarray(bt), out.subarray(sz3), hu);
};
// read Zstandard block
var rzb = function (dat, st, out) {
    var _a;
    var bt = st.b;
    //    byte 0        block type
    var b0 = dat[bt], btype = (b0 >> 1) & 3;
    st.l = b0 & 1;
    var sz = (b0 >> 3) | (dat[bt + 1] << 5) | (dat[bt + 2] << 13);
    // end byte for block
    var ebt = (bt += 3) + sz;
    if (btype == 1) {
        if (bt >= dat.length)
            return;
        st.b = bt + 1;
        if (out) {
            fill(out, dat[bt], st.y, st.y += sz);
            return out;
        }
        return fill(new u8(sz), dat[bt]);
    }
    if (ebt > dat.length)
        return;
    if (btype == 0) {
        st.b = ebt;
        if (out) {
            out.set(dat.subarray(bt, ebt), st.y);
            st.y += sz;
            return out;
        }
        return slc(dat, bt, ebt);
    }
    if (btype == 2) {
        //    byte 3        lit btype     size format
        var b3 = dat[bt], lbt = b3 & 3, sf = (b3 >> 2) & 3;
        // lit src size  lit cmp sz 4 streams
        var lss = b3 >> 4, lcs = 0, s4 = 0;
        if (lbt < 2) {
            if (sf & 1)
                lss |= (dat[++bt] << 4) | ((sf & 2) && (dat[++bt] << 12));
            else
                lss = b3 >> 3;
        }
        else {
            s4 = sf;
            if (sf < 2)
                lss |= ((dat[++bt] & 63) << 4), lcs = (dat[bt] >> 6) | (dat[++bt] << 2);
            else if (sf == 2)
                lss |= (dat[++bt] << 4) | ((dat[++bt] & 3) << 12), lcs = (dat[bt] >> 2) | (dat[++bt] << 6);
            else
                lss |= (dat[++bt] << 4) | ((dat[++bt] & 63) << 12), lcs = (dat[bt] >> 6) | (dat[++bt] << 2) | (dat[++bt] << 10);
        }
        ++bt;
        // add literals to end - can never overlap with backreferences because unused literals always appended
        var buf = out ? out.subarray(st.y, st.y + st.m) : new u8(st.m);
        // starting point for literals
        var spl = buf.length - lss;
        if (lbt == 0)
            buf.set(dat.subarray(bt, bt += lss), spl);
        else if (lbt == 1)
            fill(buf, dat[bt++], spl);
        else {
            // huffman table
            var hu = st.h;
            if (lbt == 2) {
                var hud = rhu(dat, bt);
                // subtract description length
                lcs += bt - (bt = hud[0]);
                st.h = hu = hud[1];
            }
            else if (!hu)
                err(0);
            (s4 ? dhu4 : dhu)(dat.subarray(bt, bt += lcs), buf.subarray(spl), hu);
        }
        // num sequences
        var ns = dat[bt++];
        if (ns) {
            if (ns == 255)
                ns = (dat[bt++] | (dat[bt++] << 8)) + 0x7F00;
            else if (ns > 127)
                ns = ((ns - 128) << 8) | dat[bt++];
            // symbol compression modes
            var scm = dat[bt++];
            if (scm & 3)
                err(0);
            var dts = [dmlt, doct, dllt];
            for (var i = 2; i > -1; --i) {
                var md = (scm >> ((i << 1) + 2)) & 3;
                if (md == 1) {
                    // rle buf
                    var rbuf = new u8([0, 0, dat[bt++]]);
                    dts[i] = {
                        s: rbuf.subarray(2, 3),
                        n: rbuf.subarray(0, 1),
                        t: new u16(rbuf.buffer, 0, 1),
                        b: 0
                    };
                }
                else if (md == 2) {
                    // accuracy log 8 for offsets, 9 for others
                    _a = rfse(dat, bt, 9 - (i & 1)), bt = _a[0], dts[i] = _a[1];
                }
                else if (md == 3) {
                    if (!st.t)
                        err(0);
                    dts[i] = st.t[i];
                }
            }
            var _b = st.t = dts, mlt = _b[0], oct = _b[1], llt = _b[2];
            var lb = dat[ebt - 1];
            if (!lb)
                err(0);
            var spos = (ebt << 3) - 8 + msb(lb) - llt.b, cbt = spos >> 3, oubt = 0;
            var lst = ((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << llt.b) - 1);
            cbt = (spos -= oct.b) >> 3;
            var ost = ((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << oct.b) - 1);
            cbt = (spos -= mlt.b) >> 3;
            var mst = ((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << mlt.b) - 1);
            for (++ns; --ns;) {
                var llc = llt.s[lst];
                var lbtr = llt.n[lst];
                var mlc = mlt.s[mst];
                var mbtr = mlt.n[mst];
                var ofc = oct.s[ost];
                var obtr = oct.n[ost];
                cbt = (spos -= ofc) >> 3;
                var ofp = 1 << ofc;
                var off = ofp + (((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16) | (dat[cbt + 3] << 24)) >>> (spos & 7)) & (ofp - 1));
                cbt = (spos -= mlb[mlc]) >> 3;
                var ml = mlbl[mlc] + (((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (spos & 7)) & ((1 << mlb[mlc]) - 1));
                cbt = (spos -= llb[llc]) >> 3;
                var ll = llbl[llc] + (((dat[cbt] | (dat[cbt + 1] << 8) | (dat[cbt + 2] << 16)) >> (spos & 7)) & ((1 << llb[llc]) - 1));
                cbt = (spos -= lbtr) >> 3;
                lst = llt.t[lst] + (((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << lbtr) - 1));
                cbt = (spos -= mbtr) >> 3;
                mst = mlt.t[mst] + (((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << mbtr) - 1));
                cbt = (spos -= obtr) >> 3;
                ost = oct.t[ost] + (((dat[cbt] | (dat[cbt + 1] << 8)) >> (spos & 7)) & ((1 << obtr) - 1));
                if (off > 3) {
                    st.o[2] = st.o[1];
                    st.o[1] = st.o[0];
                    st.o[0] = off -= 3;
                }
                else {
                    var idx = off - (ll != 0);
                    if (idx) {
                        off = idx == 3 ? st.o[0] - 1 : st.o[idx];
                        if (idx > 1)
                            st.o[2] = st.o[1];
                        st.o[1] = st.o[0];
                        st.o[0] = off;
                    }
                    else
                        off = st.o[0];
                }
                for (var i = 0; i < ll; ++i) {
                    buf[oubt + i] = buf[spl + i];
                }
                oubt += ll, spl += ll;
                var stin = oubt - off;
                if (stin < 0) {
                    var len = -stin;
                    var bs = st.e + stin;
                    if (len > ml)
                        len = ml;
                    for (var i = 0; i < len; ++i) {
                        buf[oubt + i] = st.w[bs + i];
                    }
                    oubt += len, ml -= len, stin = 0;
                }
                for (var i = 0; i < ml; ++i) {
                    buf[oubt + i] = buf[stin + i];
                }
                oubt += ml;
            }
            if (oubt != spl) {
                while (spl < buf.length) {
                    buf[oubt++] = buf[spl++];
                }
            }
            else
                oubt = buf.length;
            if (out)
                st.y += oubt;
            else
                buf = slc(buf, 0, oubt);
        }
        else if (out) {
            st.y += lss;
            if (spl) {
                for (var i = 0; i < lss; ++i) {
                    buf[i] = buf[spl + i];
                }
            }
        }
        else if (spl)
            buf = slc(buf, spl);
        st.b = ebt;
        return buf;
    }
    err(2);
};
// concat
var cct = function (bufs, ol) {
    if (bufs.length == 1)
        return bufs[0];
    var buf = new u8(ol);
    for (var i = 0, b = 0; i < bufs.length; ++i) {
        var chk = bufs[i];
        buf.set(chk, b);
        b += chk.length;
    }
    return buf;
};
/**
 * Decompresses Zstandard data
 * @param dat The input data
 * @param buf The output buffer. If unspecified, the function will allocate
 *            exactly enough memory to fit the decompressed data. If your
 *            data has multiple frames and you know the output size, specifying
 *            it will yield better performance.
 * @returns The decompressed data
 */
function decompress(dat, buf) {
    var bufs = [], nb = +!buf;
    var bt = 0, ol = 0;
    for (; dat.length;) {
        var st = rzfh(dat, nb || buf);
        if (typeof st == 'object') {
            if (nb) {
                buf = null;
                if (st.w.length == st.u) {
                    bufs.push(buf = st.w);
                    ol += st.u;
                }
            }
            else {
                bufs.push(buf);
                st.e = 0;
            }
            for (; !st.l;) {
                var blk = rzb(dat, st, buf);
                if (!blk)
                    err(5);
                if (buf)
                    st.e = st.y;
                else {
                    bufs.push(blk);
                    ol += blk.length;
                    cpw(st.w, 0, blk.length);
                    st.w.set(blk, st.w.length - blk.length);
                }
            }
            bt = st.b + (st.c * 4);
        }
        else
            bt = st;
        dat = dat.subarray(bt);
    }
    return cct(bufs, ol);
}
exports.decompress = decompress;
/**
 * Decompressor for Zstandard streamed data
 */
var Decompress = /*#__PURE__*/ (function () {
    /**
     * Creates a Zstandard decompressor
     * @param ondata The handler for stream data
     */
    function Decompress(ondata) {
        this.ondata = ondata;
        this.c = [];
        this.l = 0;
        this.z = 0;
    }
    /**
     * Pushes data to be decompressed
     * @param chunk The chunk of data to push
     * @param final Whether or not this is the last chunk in the stream
     */
    Decompress.prototype.push = function (chunk, final) {
        if (typeof this.s == 'number') {
            var sub = Math.min(chunk.length, this.s);
            chunk = chunk.subarray(sub);
            this.s -= sub;
        }
        var sl = chunk.length;
        var ncs = sl + this.l;
        if (!this.s) {
            if (final) {
                if (!ncs) {
                    this.ondata(new u8(0), true);
                    return;
                }
                // min for frame + one block
                if (ncs < 5)
                    err(5);
            }
            else if (ncs < 18) {
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            if (this.l) {
                this.c.push(chunk);
                chunk = cct(this.c, ncs);
                this.c = [];
                this.l = 0;
            }
            if (typeof (this.s = rzfh(chunk)) == 'number')
                return this.push(chunk, final);
        }
        if (typeof this.s != 'number') {
            if (ncs < (this.z || 3)) {
                if (final)
                    err(5);
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            if (this.l) {
                this.c.push(chunk);
                chunk = cct(this.c, ncs);
                this.c = [];
                this.l = 0;
            }
            if (!this.z && ncs < (this.z = (chunk[this.s.b] & 2) ? 4 : 3 + ((chunk[this.s.b] >> 3) | (chunk[this.s.b + 1] << 5) | (chunk[this.s.b + 2] << 13)))) {
                if (final)
                    err(5);
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            else
                this.z = 0;
            for (;;) {
                var blk = rzb(chunk, this.s);
                if (!blk) {
                    if (final)
                        err(5);
                    var adc = chunk.subarray(this.s.b);
                    this.s.b = 0;
                    this.c.push(adc), this.l += adc.length;
                    return;
                }
                else {
                    this.ondata(blk, false);
                    cpw(this.s.w, 0, blk.length);
                    this.s.w.set(blk, this.s.w.length - blk.length);
                }
                if (this.s.l) {
                    var rest = chunk.subarray(this.s.b);
                    this.s = this.s.c * 4;
                    this.push(rest, final);
                    return;
                }
            }
        }
        else if (final)
            err(5);
    };
    return Decompress;
}());
exports.Decompress = Decompress;

return exports;
})();

const VIEW_TYPE_ZIM = 'zim-reader-view';

// Wikipedia-style serif "W" mark, drawn in the current theme colour.
const WIKI_ICON = '<text x="50" y="82" text-anchor="middle" font-family="Georgia,\'Times New Roman\',Times,serif" font-size="100" fill="currentColor">W</text>';
// 1x1 transparent GIF — placeholder that reserves an image's box before its
// real bytes are loaded, so swapping in the real image causes no reflow.
const ZIM_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/* ---------- i18n: English by default, Russian when Obsidian language is ru ---------- */
const RU = String(obsidian.moment.locale() || '').startsWith('ru');
const T = RU ? {
  displayName: 'Читалка ZIM',
  openReader: 'Открыть читалку ZIM',
  searchPlaceholder: 'Поиск по заголовку…',
  noFile: 'Библиотека пуста. Добавьте .zim-архив в настройках ZIM Reader.',
  cantOpen: 'Не удалось открыть ZIM: ',
  desktopOnly: 'ZIM Reader работает только на десктопе.',
  notFound: 'Статья не найдена: ',
  loading: 'Загрузка…',
  welcome: 'Начните вводить название статьи в поле поиска сверху.',
  random: 'Случайная статья',
  back: 'Назад', forward: 'Вперёд', home: 'Главная',
  settingsTitle: 'ZIM Reader',
  sPath: 'Путь к .zim-файлу',
  sPathDesc: 'Нажмите «Выбрать файл…» и укажите .zim-архив (или впишите путь вручную).',
  sBrowse: 'Выбрать файл…',
  libTitle: 'Библиотека архивов',
  libEmpty: 'Пока не добавлено ни одного .zim-архива. Нажмите «Выбрать файл…».',
  downloadHint: 'Где взять .zim-архивы (русскоязычные):',
  addArchive: 'Добавить архив',
  addArchiveDesc: 'Выберите .zim-файл (Википедия, Викисловарь, справочник и т.п.).',
  setActive: 'Сделать активным',
  removeLib: 'Удалить из библиотеки',
  switchArchive: 'Активный архив',
  alreadyAdded: 'Этот архив уже в библиотеке.',
  cantReadPath: 'Не удалось определить путь к файлу.',
  addToNotes: 'Добавить в заметки',
  noArticle: 'Сначала откройте статью.',
  saving: 'Сохраняю статью…',
  noteSaved: 'Сохранено: ',
  noteExists: 'Заметка уже есть — открываю.',
  saveFailed: 'Не удалось сохранить: ',
  sNotesFolder: 'Папка для заметок',
  sNotesFolderDesc: 'Куда сохранять статьи кнопкой «Добавить в заметки». Пусто — папка с названием архива.',
  sOpenExternal: 'Внешние ссылки в браузере',
  sOpenExternalDesc: 'Открывать http(s)-ссылки во внешнем браузере',
  sAutoload: 'Автозагрузка картинок',
  sAutoloadDesc: 'Выкл. — каждая картинка грузится по клику на неё. Вкл. — картинки подгружаются сами при прокрутке.',
  loadImages: 'Загрузить все картинки',
  imgClickHint: 'Нажмите, чтобы загрузить',
  sHideApparatus: 'Скрывать служебные разделы',
  sHideApparatusDesc: 'Убирать в конце статьи «Примечания», «Литература», «Ссылки» и инлайновые сноски [n].',
  fileEntry: 'Файл: ',
} : {
  displayName: 'ZIM Reader',
  openReader: 'Open ZIM Reader',
  searchPlaceholder: 'Search by title…',
  noFile: 'Library is empty. Add a .zim archive in ZIM Reader settings.',
  cantOpen: 'Could not open ZIM: ',
  desktopOnly: 'ZIM Reader is desktop-only.',
  notFound: 'Article not found: ',
  loading: 'Loading…',
  welcome: 'Start typing an article title in the search box above.',
  random: 'Random article',
  back: 'Back', forward: 'Forward', home: 'Home',
  settingsTitle: 'ZIM Reader',
  sPath: 'Path to .zim file',
  sPathDesc: 'Click "Browse…" and pick a .zim archive (or type the path manually).',
  sBrowse: 'Browse…',
  libTitle: 'Archive library',
  libEmpty: 'No .zim archives yet. Click "Browse…".',
  downloadHint: 'Where to get .zim archives (Russian):',
  addArchive: 'Add archive',
  addArchiveDesc: 'Pick a .zim file (Wikipedia, Wiktionary, a reference, etc.).',
  setActive: 'Set active',
  removeLib: 'Remove from library',
  switchArchive: 'Active archive',
  alreadyAdded: 'This archive is already in the library.',
  cantReadPath: 'Could not read the file path.',
  addToNotes: 'Add to notes',
  noArticle: 'Open an article first.',
  saving: 'Saving article…',
  noteSaved: 'Saved: ',
  noteExists: 'Note already exists — opening.',
  saveFailed: 'Could not save: ',
  sNotesFolder: 'Notes folder',
  sNotesFolderDesc: 'Where "Add to notes" saves articles. Empty = a folder named after the archive.',
  sOpenExternal: 'External links in browser',
  sOpenExternalDesc: 'Open http(s) links in the external browser',
  sAutoload: 'Auto-load images',
  sAutoloadDesc: 'Off: load each image on click. On: load images lazily while scrolling.',
  loadImages: 'Load all images',
  imgClickHint: 'Click to load',
  sHideApparatus: 'Hide apparatus sections',
  sHideApparatusDesc: 'Drop end-of-article References, Bibliography and External links sections plus inline [n] markers.',
  fileEntry: 'File: ',
};

const DEFAULT_SETTINGS = {
  libraries: [],        // [{ path, name }]
  activePath: '',
  openExternalInBrowser: true,
  autoloadImages: false,
  hideApparatus: true,
  notesFolder: '',      // empty = a folder named after the active archive
};

/* ============================================================================
 * ZimArchive — random-access reader for a ZIM file. Reads only what's needed:
 * header, pointer lists (binary search), and one decompressed cluster at a time.
 * ==========================================================================*/
class ZimArchive {
  constructor(filePath, fzstd) {
    this.fzstd = fzstd;
    this.fd = fs.openSync(filePath, 'r');
    this.fileSize = fs.fstatSync(this.fd).size;
    this.clusterCache = new Map();   // cn -> { body:Buffer, ext:bool }
    this.clusterCacheMax = 6;
    this.titleList = null;           // Buffer of u32 entry indices, sorted by title
    this.titleCount = 0;

    const h = this.readAt(0, 80);
    if (h.readUInt32LE(0) !== 72173914) throw new Error('not a ZIM file (bad magic)');
    this.header = {
      entryCount: h.readUInt32LE(24),
      clusterCount: h.readUInt32LE(28),
      urlPtrPos: this.u64(h, 32),
      titlePtrPos: this.u64(h, 40),
      clusterPtrPos: this.u64(h, 48),
      mimeListPos: this.u64(h, 56),
      mainPage: h.readUInt32LE(64),
      checksumPos: this.u64(h, 72),
    };
    this.mime = this.readMimeList();
  }

  close() {
    try { fs.closeSync(this.fd); } catch (e) { /* already closed */ }
    this.clusterCache.clear();
    this.titleList = null;
  }

  readAt(pos, len) {
    const b = Buffer.allocUnsafe(len);
    fs.readSync(this.fd, b, 0, len, pos);
    return b;
  }
  u64(buf, off) { return Number(buf.readBigUInt64LE(off)); }

  readMimeList() {
    const buf = this.readAt(this.header ? this.header.mimeListPos : 80, 8192);
    const parts = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0) {
        if (i === start) break;
        parts.push(buf.slice(start, i).toString('utf8'));
        start = i + 1;
      }
    }
    return parts;
  }

  urlPointer(i) { return this.u64(this.readAt(this.header.urlPtrPos + i * 8, 8), 0); }
  clusterOffset(i) { return this.u64(this.readAt(this.header.clusterPtrPos + i * 8, 8), 0); }

  parseDirEntry(pos) {
    const b = this.readAt(pos, 2048);
    const mimetype = b.readUInt16LE(0);
    const namespace = b[3];
    if (mimetype === 0xffff) {
      const redirectIndex = b.readUInt32LE(8);
      let i = 12; while (b[i] !== 0) i++;
      let j = i + 1; while (b[j] !== 0) j++;
      return { redirect: true, namespace, redirectIndex, url: b.slice(12, i), title: b.slice(i + 1, j) };
    }
    const cluster = b.readUInt32LE(8);
    const blob = b.readUInt32LE(12);
    let i = 16; while (b[i] !== 0) i++;
    let j = i + 1; while (b[j] !== 0) j++;
    return { redirect: false, mimetype, namespace, cluster, blob, url: b.slice(16, i), title: b.slice(i + 1, j) };
  }

  resolveEntry(index, depth = 0) {
    if (depth > 12) throw new Error('redirect loop');
    const e = this.parseDirEntry(this.urlPointer(index));
    return e.redirect ? this.resolveEntry(e.redirectIndex, depth + 1) : e;
  }

  getCluster(cn) {
    const cached = this.clusterCache.get(cn);
    if (cached) { this.clusterCache.delete(cn); this.clusterCache.set(cn, cached); return cached; }
    const start = this.clusterOffset(cn);
    const end = cn + 1 < this.header.clusterCount ? this.clusterOffset(cn + 1) : this.header.checksumPos;
    const raw = this.readAt(start, end - start);
    const info = raw[0];
    const compression = info & 0x0f;
    const ext = (info & 0x10) !== 0;
    let body;
    if (compression === 5) body = Buffer.from(this.fzstd.decompress(raw.subarray(1)));
    else if (compression === 1 || compression === 0) body = raw.subarray(1);
    else throw new Error('unsupported cluster compression: ' + compression);
    const rec = { body, ext };
    this.clusterCache.set(cn, rec);
    if (this.clusterCache.size > this.clusterCacheMax) {
      const oldest = this.clusterCache.keys().next().value;
      this.clusterCache.delete(oldest);
    }
    return rec;
  }

  readBlob(cn, bn) {
    const { body, ext } = this.getCluster(cn);
    const osz = ext ? 8 : 4;
    const ro = ext
      ? (k) => Number(body.readBigUInt64LE(k * osz))
      : (k) => body.readUInt32LE(k * osz);
    const first = ro(0);
    const count = first / osz - 1;
    if (bn >= count) throw new Error('blob out of range');
    return body.subarray(ro(bn), ro(bn + 1));
  }

  // binary search the url pointer list by (namespace char, url bytes)
  nsUrlAt(index) {
    const b = this.readAt(this.urlPointer(index), 1024);
    const mt = b.readUInt16LE(0);
    const ss = mt === 0xffff ? 12 : 16;
    let i = ss; while (b[i] !== 0) i++;
    return { namespace: b[3], url: b.slice(ss, i) };
  }
  findByUrl(nsChar, urlStr) {
    const tns = nsChar.charCodeAt(0);
    const turl = Buffer.from(urlStr, 'utf8');
    let lo = 0, hi = this.header.entryCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const { namespace, url } = this.nsUrlAt(mid);
      let c = namespace - tns;
      if (c === 0) c = Buffer.compare(url, turl);
      if (c < 0) lo = mid + 1; else hi = mid;
    }
    if (lo >= this.header.entryCount) return -1;
    const g = this.nsUrlAt(lo);
    return (g.namespace === tns && Buffer.compare(g.url, turl) === 0) ? lo : -1;
  }

  // { entry, data } after following redirects, or null
  getByUrl(nsChar, urlStr) {
    const idx = this.findByUrl(nsChar, urlStr);
    if (idx < 0) return null;
    const entry = this.resolveEntry(idx);
    return { entry, data: this.readBlob(entry.cluster, entry.blob) };
  }

  mainEntry() { return this.resolveEntry(this.header.mainPage); }

  /* ---- title index (lazy) ---- */
  ensureTitleIndex() {
    if (this.titleList) return;
    let r = this.getByUrl('X', 'listing/titleOrdered/v0');
    if (!r) r = this.getByUrl('X', 'listing/titleOrdered/v1');
    if (!r) throw new Error('no title listing in this ZIM');
    this.titleList = Buffer.from(r.data);   // own copy; cluster may be evicted
    this.titleCount = (this.titleList.length / 4) | 0;
  }
  titleEntryIndexAt(k) { return this.titleList.readUInt32LE(k * 4); }
  titleBufAt(k) {
    const e = this.parseDirEntry(this.urlPointer(this.titleEntryIndexAt(k)));
    return e.title.length ? e.title : e.url;
  }

  // prefix search; case-insensitive first letter. returns [{title, entryIndex}]
  searchTitles(prefix, limit) {
    this.ensureTitleIndex();
    if (!prefix) return [];
    const variants = new Set([prefix]);
    const chars = Array.from(prefix);
    variants.add(chars[0].toUpperCase() + chars.slice(1).join(''));
    variants.add(chars[0].toLowerCase() + chars.slice(1).join(''));
    const seen = new Set();
    let out = [];
    for (const v of variants) {
      const target = Buffer.from(v, 'utf8');
      let lo = 0, hi = this.titleCount;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (Buffer.compare(this.titleBufAt(mid), target) < 0) lo = mid + 1; else hi = mid;
      }
      for (let k = lo; k < this.titleCount && out.length < limit * variants.size; k++) {
        const t = this.titleBufAt(k);
        if (t.length < target.length || Buffer.compare(t.subarray(0, target.length), target) !== 0) break;
        const entryIndex = this.titleEntryIndexAt(k);
        if (seen.has(entryIndex)) continue;
        seen.add(entryIndex);
        out.push({ title: t.toString('utf8'), entryIndex });
      }
    }
    out.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    return out.slice(0, limit);
  }

  randomEntryIndex() {
    this.ensureTitleIndex();
    const k = Math.floor(Math.random() * this.titleCount);
    return this.titleEntryIndexAt(k);
  }
}

/* ============================================================================
 * URL resolution — turn an href/src inside an article into a ZIM (ns, url).
 * All Kiwix content lives in namespace C. Paths are relative & percent-encoded.
 * ==========================================================================*/
function classifyHref(raw) {
  if (!raw) return { type: 'none' };
  if (raw.startsWith('#')) return { type: 'anchor', hash: raw.slice(1) };
  if (/^(https?|ftp):\/\//i.test(raw) || /^(mailto|tel|data|blob):/i.test(raw)) return { type: 'external', href: raw };
  if (raw.startsWith('//')) return { type: 'external', href: 'https:' + raw };
  return { type: 'zim', ...resolveZimPath(raw, this && this.currentUrl) };
}
function resolveZimPath(raw, currentUrl) {
  let hash = null;
  const hi = raw.indexOf('#');
  if (hi >= 0) { hash = raw.slice(hi + 1); raw = raw.slice(0, hi); }
  const base = (currentUrl && currentUrl.includes('/')) ? currentUrl.slice(0, currentUrl.lastIndexOf('/')).split('/') : [];
  const out = base.slice();
  for (const segEnc of raw.split('/')) {
    let seg;
    try { seg = decodeURIComponent(segEnc); } catch (e) { seg = segEnc; }
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (out.length) out.pop(); continue; }
    out.push(seg);
  }
  return { url: out.join('/'), hash };
}

// Read the absolute path of a picked file. Electron ≥32 removed File.path;
// webUtils.getPathForFile() is the replacement. Fall back to .path on older builds.
function getPickedPath(file) {
  if (!file) return '';
  try {
    const electron = require('electron');
    if (electron && electron.webUtils && typeof electron.webUtils.getPathForFile === 'function') {
      const p = electron.webUtils.getPathForFile(file);
      if (p) return p;
    }
  } catch (e) { /* not electron, or no webUtils */ }
  return file.path || '';
}

/* ============================================================================
 * The reader view
 * ==========================================================================*/
class ZimReaderView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf, plugin.app);
    this.plugin = plugin;
    this.history = [];
    this.histPos = -1;
    this.objectUrls = [];
    this.imgObserver = null;
    this.searchSeq = 0;
    this.activeSuggestion = -1;
    this.backBtn = this.fwdBtn = this.homeBtn = this.randBtn = null;
    this._renderGen = 0;
    this.imgQueue = [];
    this.imgPumping = false;
    this._onImgClick = (e) => this.onImageClick(e);
  }
  getViewType() { return VIEW_TYPE_ZIM; }
  getDisplayText() { return T.displayName; }
  getIcon() { return 'zim-wikipedia'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('zim-reader-view');

    // toolbar
    const bar = root.createDiv('zim-toolbar');
    const nav = bar.createDiv('zim-nav');
    this.backBtn = nav.createEl('button', { cls: 'zim-btn', attr: { 'aria-label': T.back } });
    obsidian.setIcon(this.backBtn, 'arrow-left');
    this.fwdBtn = nav.createEl('button', { cls: 'zim-btn', attr: { 'aria-label': T.forward } });
    obsidian.setIcon(this.fwdBtn, 'arrow-right');
    this.homeBtn = nav.createEl('button', { cls: 'zim-btn', attr: { 'aria-label': T.home } });
    obsidian.setIcon(this.homeBtn, 'home');
    this.randBtn = nav.createEl('button', { cls: 'zim-btn', attr: { 'aria-label': T.random } });
    obsidian.setIcon(this.randBtn, 'shuffle');
    this.imgBtn = nav.createEl('button', { cls: 'zim-btn', attr: { 'aria-label': T.loadImages } });
    obsidian.setIcon(this.imgBtn, 'image');
    this.saveBtn = nav.createEl('button', { cls: 'zim-btn', attr: { 'aria-label': T.addToNotes } });
    obsidian.setIcon(this.saveBtn, 'save');

    const searchWrap = bar.createDiv('zim-search-wrap');
    this.searchInput = searchWrap.createEl('input', { cls: 'zim-search', attr: { type: 'text', placeholder: T.searchPlaceholder } });
    this.suggestions = searchWrap.createDiv('zim-suggestions');
    this.suggestions.hide();

    this.libSelect = bar.createEl('select', { cls: 'zim-lib-select', attr: { 'aria-label': T.switchArchive } });
    this.buildLibrarySelect();
    this.libSelect.onchange = () => this.plugin.setActive(this.libSelect.value);

    // content
    this.scrollEl = root.createDiv('zim-scroll');
    this.articleEl = this.scrollEl.createDiv('zim-article');
    this.showWelcome();

    // events
    this.backBtn.onclick = () => this.go(-1);
    this.fwdBtn.onclick = () => this.go(1);
    this.homeBtn.onclick = () => this.openMain();
    this.randBtn.onclick = () => this.openRandom();
    this.imgBtn.onclick = () => this.loadAllImages();
    this.saveBtn.onclick = () => this.saveToNote();
    this.searchInput.addEventListener('input', () => this.onSearchInput());
    this.searchInput.addEventListener('keydown', (e) => this.onSearchKey(e));
    this.registerDomEvent(document, 'click', (e) => {
      if (!searchWrap.contains(e.target)) this.hideSuggestions();
    });

    this.refreshNav();
  }

  async onClose() { this.revokeUrls(); if (this.imgObserver) this.imgObserver.disconnect(); }

  showWelcome() {
    this.articleEl.empty();
    const w = this.articleEl.createDiv('zim-welcome');
    const has = this.plugin.settings.activePath || (this.plugin.settings.libraries || []).length;
    w.setText(has ? T.welcome : T.noFile);
  }

  buildLibrarySelect() {
    const sel = this.libSelect;
    if (!sel) return;
    sel.empty();
    const libs = this.plugin.settings.libraries || [];
    if (libs.length < 2) { sel.hide(); return; }  // a one-item dropdown is pointless
    sel.show();
    for (const lib of libs) sel.createEl('option', { value: lib.path, text: lib.name || lib.path });
    sel.value = this.plugin.getActivePath();
  }

  // called by the plugin whenever the library list or the active archive changes
  onLibraryChanged(reset) {
    this.buildLibrarySelect();
    if (reset) {
      this.history = [];
      this.histPos = -1;
      if (this.searchInput) this.searchInput.value = '';
      this.hideSuggestions();
      this.revokeUrls();
      this.showWelcome();
      this.refreshNav();
    }
  }

  /* ---- search ---- */
  onSearchInput() {
    const q = this.searchInput.value.trim();
    const seq = ++this.searchSeq;
    if (!q) { this.hideSuggestions(); return; }
    // debounce via microtask timer
    window.clearTimeout(this._searchTimer);
    this._searchTimer = window.setTimeout(() => {
      if (seq !== this.searchSeq) return;
      let archive;
      try { archive = this.plugin.getArchive(); } catch (e) { new Notice(T.cantOpen + e.message); return; }
      let results = [];
      try { results = archive.searchTitles(q, 25); } catch (e) { console.error(e); }
      if (seq !== this.searchSeq) return;
      this.renderSuggestions(results);
    }, 110);
  }
  renderSuggestions(results) {
    this.suggestions.empty();
    this.activeSuggestion = -1;
    if (!results.length) { this.hideSuggestions(); return; }
    results.forEach((r, i) => {
      const item = this.suggestions.createDiv('zim-suggestion');
      item.setText(r.title);
      item.onclick = () => { this.hideSuggestions(); this.searchInput.value = r.title; this.openIndex(r.entryIndex); };
      item.onmouseenter = () => this.highlightSuggestion(i);
      item._entryIndex = r.entryIndex;
    });
    this.suggestions.show();
  }
  highlightSuggestion(i) {
    const items = Array.from(this.suggestions.children);
    items.forEach((el, idx) => el.toggleClass('is-active', idx === i));
    this.activeSuggestion = i;
  }
  hideSuggestions() { this.suggestions.hide(); this.suggestions.empty(); this.activeSuggestion = -1; }
  onSearchKey(e) {
    const items = Array.from(this.suggestions.children);
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) this.highlightSuggestion(Math.min(this.activeSuggestion + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) this.highlightSuggestion(Math.max(this.activeSuggestion - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = items[this.activeSuggestion] || items[0];
      if (pick) { this.hideSuggestions(); this.searchInput.value = pick.textContent; this.openIndex(pick._entryIndex); }
    } else if (e.key === 'Escape') { this.hideSuggestions(); }
  }

  /* ---- navigation ---- */
  openMain() {
    let archive; try { archive = this.plugin.getArchive(); } catch (e) { new Notice(T.cantOpen + e.message); return; }
    try { const entry = archive.mainEntry(); this.display(entry, null, true); } catch (e) { new Notice(T.cantOpen + e.message); }
  }
  openRandom() {
    let archive; try { archive = this.plugin.getArchive(); } catch (e) { new Notice(T.cantOpen + e.message); return; }
    try { this.openIndex(archive.randomEntryIndex()); } catch (e) { new Notice(e.message); }
  }
  openIndex(entryIndex) {
    let archive; try { archive = this.plugin.getArchive(); } catch (e) { new Notice(T.cantOpen + e.message); return; }
    try { const entry = archive.resolveEntry(entryIndex); this.display(entry, null, true); }
    catch (e) { new Notice(e.message); }
  }
  openUrl(url, hash, push) {
    let archive; try { archive = this.plugin.getArchive(); } catch (e) { new Notice(T.cantOpen + e.message); return; }
    const idx = archive.findByUrl('C', url);
    if (idx < 0) { new Notice(T.notFound + url); return; }
    const entry = archive.resolveEntry(idx);
    this.display(entry, hash, push);
  }
  go(delta) {
    const pos = this.histPos + delta;
    if (pos < 0 || pos >= this.history.length) return;
    this.histPos = pos;
    const h = this.history[pos];
    this.renderCurrent(h);
    this.refreshNav();
  }
  refreshNav() {
    if (!this.backBtn || !this.fwdBtn) return;
    this.backBtn.disabled = this.histPos <= 0;
    this.fwdBtn.disabled = this.histPos >= this.history.length - 1;
  }

  // entry: resolved content dir-entry. push: add to history
  display(entry, hash, push) {
    const url = entry.url.toString('utf8');
    const title = (entry.title.length ? entry.title : entry.url).toString('utf8');
    if (push) {
      this.history = this.history.slice(0, this.histPos + 1);
      this.history.push({ url, title, hash });
      this.histPos = this.history.length - 1;
    }
    this.renderCurrent({ url, title, hash });
    this.refreshNav();
  }
  renderCurrent(h) {
    let archive; try { archive = this.plugin.getArchive(); } catch (e) { new Notice(T.cantOpen + e.message); return; }
    const r = archive.getByUrl('C', h.url);
    if (!r) { new Notice(T.notFound + h.url); return; }
    const mime = archive.mime[r.entry.mimetype] || '';
    if (!mime.startsWith('text/html')) { new Notice(T.fileEntry + h.url); return; }
    this.renderArticle(r.entry, r.data, h.hash);
  }

  /* ---- rendering ---- */
  revokeUrls() { for (const u of this.objectUrls) URL.revokeObjectURL(u); this.objectUrls = []; }

  renderArticle(entry, data, hash) {
    const gen = ++this._renderGen;
    this.revokeUrls();
    if (this.imgObserver) { this.imgObserver.disconnect(); this.imgObserver = null; }
    this.imgQueue = [];
    this.imgPumping = false;
    const currentUrl = entry.url.toString('utf8');
    this.currentUrl = currentUrl;

    const html = data.toString('utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    body.querySelectorAll('script, link, style, meta, noscript, .zim-footer, .navbox, .mw-editsection, .noprint, .printfooter, .mw-jump-link, .catlinks, .mw-hidden-catlinks').forEach((n) => n.remove());

    this.articleEl.empty();
    const titleText = (entry.title.length ? entry.title : entry.url).toString('utf8');
    this.articleEl.createEl('h1', { cls: 'zim-title', text: titleText });
    const container = this.articleEl.createDiv('zim-content');
    while (body.firstChild) container.appendChild(container.ownerDocument.adoptNode(body.firstChild));

    if (this.plugin.settings.hideApparatus) this.stripApparatus(container);
    this.layoutInfoboxes(container);

    this.processLinks(container, currentUrl);
    this.processImages(container, currentUrl, gen);

    // scroll to top or anchor
    this.scrollEl.scrollTop = 0;
    if (hash) {
      const target = container.querySelector('#' + CSS.escape(hash)) || container.querySelector('[name="' + hash + '"]');
      if (target) target.scrollIntoView();
    }
  }

  // Remove end-of-article apparatus sections (references, bibliography, links).
  // Layout is flat: a heading block <div class="mw-heading mw-heading2"><h2>…</h2></div>
  // followed by its content as siblings, up to the next level-2 heading.
  stripApparatus(container) {
    const TITLES = new Set([
      'примечания', 'примечания и комментарии', 'примечания и ссылки', 'сноски',
      'комментарии', 'источники', 'литература', 'библиография',
      'ссылки', 'внешние ссылки',
    ]);
    const norm = (s) => (s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const h2s = Array.from(container.querySelectorAll('h2'));
    const startOf = (h2) => h2.closest('div.mw-heading2') || h2;
    const starts = h2s.map(startOf);
    for (let i = 0; i < h2s.length; i++) {
      const h2 = h2s[i];
      if (!(TITLES.has(norm(h2.id)) || TITLES.has(norm(h2.textContent)))) continue;
      const stop = starts[i + 1] || null;
      let node = starts[i];
      while (node && node !== stop) {
        const next = node.nextElementSibling;
        node.remove();
        node = next;
      }
    }
    container.classList.add('zim-hide-refs'); // also hide inline [n] footnote markers
  }

  // Wrap each infobox in a floated block so its width survives theme table CSS
  // (themes that force `table { width:100% }` otherwise blow the infobox full-width).
  layoutInfoboxes(container) {
    container.querySelectorAll('table.infobox').forEach((ib) => {
      const p = ib.parentElement;
      if (p && p.classList.contains('zim-ibx')) return;
      const wrap = container.ownerDocument.createElement('div');
      wrap.className = 'zim-ibx';
      ib.parentNode.insertBefore(wrap, ib);
      wrap.appendChild(ib);
    });
  }

  processLinks(container, currentUrl) {
    const anchors = container.querySelectorAll('a[href]');
    anchors.forEach((a) => {
      const raw = a.getAttribute('href');
      const info = classifyHref.call({ currentUrl }, raw);
      if (info.type === 'external') {
        a.classList.add('zim-external');
        a.onclick = (e) => {
          e.preventDefault();
          if (this.plugin.settings.openExternalInBrowser) window.open(info.href, '_blank');
        };
      } else if (info.type === 'anchor') {
        a.onclick = (e) => {
          e.preventDefault();
          const t = container.querySelector('#' + CSS.escape(info.hash)) || container.querySelector('[name="' + info.hash + '"]');
          if (t) t.scrollIntoView({ behavior: 'smooth' });
        };
      } else if (info.type === 'zim') {
        a.classList.add('zim-link');
        a.onclick = (e) => {
          e.preventDefault();
          this.openUrl(info.url, info.hash, true);
        };
      }
    });
  }

  processImages(container, currentUrl, gen) {
    const imgs = Array.from(container.querySelectorAll('img'));
    const autoload = this.plugin.settings.autoloadImages;
    if (autoload) {
      this.imgObserver = new IntersectionObserver((entries, obs) => {
        let added = false;
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          obs.unobserve(en.target);
          this.imgQueue.push(en.target);
          added = true;
        }
        if (added) this.pumpImages(gen);
      }, { root: this.scrollEl, rootMargin: '500px 0px' });
    }

    imgs.forEach((img) => {
      const raw = img.getAttribute('src');
      img.removeAttribute('srcset');
      if (!raw) return;
      const info = classifyHref.call({ currentUrl }, raw);
      if (info.type !== 'zim') { img.removeAttribute('src'); return; }
      img._zimUrl = info.url;
      // Reserve the final box up-front. A transparent placeholder keeps the
      // <img> a replaced element that honours its width/height, so swapping in
      // the real image later triggers no reflow — this is what made big
      // articles (hundreds of images) freeze while re-laying-out on each load.
      const w = img.getAttribute('width'), h = img.getAttribute('height');
      if (w && h) img.style.aspectRatio = w + ' / ' + h;
      img.classList.add('zim-img-pending');
      img.setAttribute('src', ZIM_IMG_PLACEHOLDER);
      if (autoload) {
        this.imgObserver.observe(img);
      } else {
        // click-to-load mode (default): each image loads only when tapped
        img.classList.add('zim-img-clickable');
        img.setAttribute('title', T.imgClickHint);
        img.addEventListener('click', this._onImgClick);
      }
    });
  }

  // Load queued images a few per frame so a burst of zstd decompressions never
  // blocks the UI thread. Tied to the render generation so a navigation cancels
  // any in-flight pumping from the previous article.
  pumpImages(gen) {
    if (this.imgPumping) return;
    this.imgPumping = true;
    const step = () => {
      if (gen !== this._renderGen) { this.imgPumping = false; return; }
      const start = performance.now();
      while (this.imgQueue.length && performance.now() - start < 6) {
        this.loadImage(this.imgQueue.shift());
      }
      if (this.imgQueue.length) window.requestAnimationFrame(step);
      else this.imgPumping = false;
    };
    window.requestAnimationFrame(step);
  }

  loadImage(img) {
    if (!img || !img._zimUrl) return;
    let archive; try { archive = this.plugin.getArchive(); } catch (e) { return; }
    try {
      const r = archive.getByUrl('C', img._zimUrl);
      if (!r) { img.classList.remove('zim-img-pending'); img.classList.add('zim-img-missing'); return; }
      const mime = archive.mime[r.entry.mimetype] || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([r.data], { type: mime }));
      this.objectUrls.push(url);
      img.addEventListener('load', () => img.classList.remove('zim-img-pending'), { once: true });
      img.setAttribute('src', url);
    } catch (e) {
      img.classList.remove('zim-img-pending');
      img.classList.add('zim-img-missing');
    }
  }

  // click-to-load mode: load just this image, and stop the click from also
  // triggering the surrounding wiki link.
  onImageClick(e) {
    const img = e.currentTarget;
    if (!img || !img._zimUrl) return;
    e.preventDefault();
    e.stopPropagation();
    img.removeEventListener('click', this._onImgClick);
    img.classList.remove('zim-img-clickable');
    img.removeAttribute('title');
    this.loadImage(img);
  }

  // toolbar "load all images" — pull every still-unloaded image through the
  // throttled queue so a bulk load never blocks the UI.
  loadAllImages() {
    const pending = this.articleEl.querySelectorAll('img.zim-img-clickable');
    pending.forEach((img) => {
      img.removeEventListener('click', this._onImgClick);
      img.classList.remove('zim-img-clickable');
      img.removeAttribute('title');
      this.imgQueue.push(img);
    });
    if (pending.length) this.pumpImages(this._renderGen);
  }

  sanitizeName(s) {
    return (s || '').replace(/[\\/:*?"<>|#^\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Save the current article into the vault as a Markdown note (with images).
  async saveToNote() {
    const app = this.plugin.app;
    let archive;
    try { archive = this.plugin.getArchive(); } catch (e) { new Notice(T.cantOpen + e.message); return; }
    if (!this.currentUrl) { new Notice(T.noArticle); return; }
    const r = archive.getByUrl('C', this.currentUrl);
    if (!r || !(archive.mime[r.entry.mimetype] || '').startsWith('text/html')) { new Notice(T.noArticle); return; }
    const title = (r.entry.title.length ? r.entry.title : r.entry.url).toString('utf8');
    const source = this.plugin.getActiveName();

    let folder = (this.plugin.settings.notesFolder || '').trim().replace(/^[\/\\]+|[\/\\]+$/g, '');
    folder = folder ? folder.replace(/[:*?"<>|#^\[\]]+/g, ' ').replace(/\s+/g, ' ').trim() : this.sanitizeName(source);

    const doc = new DOMParser().parseFromString(r.data.toString('utf8'), 'text/html');
    const body = doc.body;
    body.querySelectorAll('script, style, link, meta, noscript, .navbox, .zim-footer, .mw-editsection, .noprint, .reference, .mw-jump-link, .catlinks').forEach((n) => n.remove());
    if (this.plugin.settings.hideApparatus) this.stripApparatus(body);

    const fileName = this.sanitizeName(title) || 'article';
    const notePath = (folder ? folder + '/' : '') + fileName + '.md';

    new Notice(T.saving);
    try {
      if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
      await this.exportImages(archive, body, folder, app);
    } catch (e) { console.error('ZIM Reader: image export failed', e); }

    const md = (typeof obsidian.htmlToMarkdown === 'function') ? obsidian.htmlToMarkdown(body.innerHTML) : (body.textContent || '');
    const content = '---\nsource: "' + source.replace(/"/g, '') + '"\n---\n\n# ' + title + '\n\n' + md + '\n';

    let file = app.vault.getAbstractFileByPath(notePath);
    try {
      if (file) new Notice(T.noteExists);
      else file = await app.vault.create(notePath, content);
    } catch (e) { new Notice(T.saveFailed + e.message); return; }
    await app.workspace.getLeaf('tab').openFile(file);
    new Notice(T.noteSaved + notePath);
  }

  // Extract every <img> from the ZIM into a _resources subfolder inside the
  // note's own folder, and rewrite its src to that vault path so htmlToMarkdown
  // yields a working ![](…) embed.
  async exportImages(archive, body, folder, app) {
    const imgs = Array.from(body.querySelectorAll('img'));
    if (!imgs.length) return;
    const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/apng': 'png', 'image/bmp': 'bmp' };
    // images live next to the article, in <note-folder>/_resources
    const attachDir = folder ? folder + '/_resources' : '_resources';
    let ensured = false;
    const seen = new Map(); // dedupe repeated images within this article
    for (const img of imgs) {
      const raw = img.getAttribute('src');
      const info = raw ? classifyHref.call({ currentUrl: this.currentUrl }, raw) : { type: 'none' };
      if (info.type !== 'zim') { img.remove(); continue; }
      if (seen.has(info.url)) { img.removeAttribute('srcset'); img.setAttribute('src', seen.get(info.url)); continue; }
      let ir = null;
      try { ir = archive.getByUrl('C', info.url); } catch (e) { ir = null; }
      const mime = ir ? (archive.mime[ir.entry.mimetype] || '') : '';
      if (!ir || !mime.startsWith('image/')) { img.remove(); continue; }
      // safe, encode-stable filename: strip the original ext, keep only word chars
      let base = (info.url.split('/').pop() || 'image').replace(/\.(png|jpe?g|gif|webp|svg|avif|apng|bmp)$/i, '');
      base = base.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[_.]+|[_.]+$/g, '') || 'image';
      const fname = base + '.' + (EXT[mime] || 'img');
      const vpath = attachDir ? attachDir + '/' + fname : fname;
      if (!ensured && attachDir) { try { if (!app.vault.getAbstractFileByPath(attachDir)) await app.vault.createFolder(attachDir); } catch (e) { /* exists */ } ensured = true; }
      if (!app.vault.getAbstractFileByPath(vpath)) {
        const d = ir.data;
        const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
        try { await app.vault.createBinary(vpath, ab); } catch (e) { /* concurrent create */ }
      }
      seen.set(info.url, vpath);
      img.removeAttribute('srcset');
      img.removeAttribute('width');
      img.removeAttribute('height');
      img.setAttribute('src', vpath);
    }
  }
}

/* ============================================================================
 * Plugin
 * ==========================================================================*/
class ZimReaderPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.archive = null;
    this.archivePath = null;
    this.fzstd = null;

    if (Platform.isMobileApp) {
      // Desktop-only; manifest also sets isDesktopOnly, this is a safety net.
      return;
    }

    obsidian.addIcon('zim-wikipedia', WIKI_ICON);
    this.registerView(VIEW_TYPE_ZIM, (leaf) => new ZimReaderView(leaf, this));
    this.addRibbonIcon('zim-wikipedia', T.openReader, () => this.activateView());
    this.addCommand({ id: 'open-zim-reader', name: T.openReader, callback: () => this.activateView() });
    this.addSettingTab(new ZimReaderSettingTab(this.app, this));
  }

  onunload() {
    if (this.archive) { this.archive.close(); this.archive = null; }
  }

  loadFzstd() { return fzstd; }

  getActivePath() {
    const libs = this.settings.libraries || [];
    if (this.settings.activePath && libs.some((l) => l.path === this.settings.activePath)) return this.settings.activePath;
    return libs.length ? libs[0].path : '';
  }

  getActiveName() {
    const p = this.getActivePath();
    const lib = (this.settings.libraries || []).find((l) => l.path === p);
    return (lib && lib.name) || 'ZIM';
  }

  getArchive() {
    const path = this.getActivePath();
    if (!path) throw new Error(T.noFile);
    if (this.archive && this.archivePath === path) return this.archive;
    if (this.archive) { this.archive.close(); this.archive = null; }
    if (!fs.existsSync(path)) throw new Error(T.notFound + path);
    const fzstd = this.loadFzstd();
    this.archive = new ZimArchive(path, fzstd);
    this.archivePath = path;
    return this.archive;
  }

  // best-effort human name from the ZIM's M/Title metadata, else the filename
  readArchiveName(path) {
    try {
      const a = new ZimArchive(path, this.loadFzstd());
      let name = '';
      try { const r = a.getByUrl('M', 'Title'); if (r && r.data) name = r.data.toString('utf8').trim(); } catch (e) { /* no title */ }
      a.close();
      return name || nodePath.basename(path).replace(/\.zim$/i, '');
    } catch (e) {
      return nodePath.basename(path).replace(/\.zim$/i, '');
    }
  }

  async addLibrary(path) {
    if (!path) return;
    const libs = this.settings.libraries || (this.settings.libraries = []);
    if (libs.some((l) => l.path === path)) { new Notice(T.alreadyAdded); return; }
    if (!fs.existsSync(path)) { new Notice(T.notFound + path); return; }
    const name = this.readArchiveName(path);
    libs.push({ path, name });
    const activeChanged = !this.settings.activePath;
    if (activeChanged) this.settings.activePath = path;
    await this.saveSettings();
    this.refreshViews(activeChanged);
  }

  async removeLibrary(path) {
    const libs = this.settings.libraries || [];
    const i = libs.findIndex((l) => l.path === path);
    if (i < 0) return;
    libs.splice(i, 1);
    let activeChanged = false;
    if (this.settings.activePath === path) {
      this.settings.activePath = libs.length ? libs[0].path : '';
      if (this.archive) { this.archive.close(); this.archive = null; this.archivePath = null; }
      activeChanged = true;
    }
    await this.saveSettings();
    this.refreshViews(activeChanged);
  }

  async setActive(path) {
    if (this.settings.activePath === path) return;
    this.settings.activePath = path;
    if (this.archive && this.archivePath !== path) { this.archive.close(); this.archive = null; this.archivePath = null; }
    await this.saveSettings();
    this.refreshViews(true);
  }

  refreshViews(reset) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ZIM)) {
      const v = leaf.view;
      if (v && typeof v.onLibraryChanged === 'function') v.onLibraryChanged(reset);
    }
  }

  async activateView() {
    if (Platform.isMobileApp) { new Notice(T.desktopOnly); return; }
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_ZIM)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_ZIM, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.libraries)) this.settings.libraries = [];
    // migrate the old single-path setting into the library list
    if (this.settings.zimPath) {
      if (!this.settings.libraries.some((l) => l.path === this.settings.zimPath)) {
        this.settings.libraries.push({ path: this.settings.zimPath, name: this.readArchiveName(this.settings.zimPath) });
      }
      if (!this.settings.activePath) this.settings.activePath = this.settings.zimPath;
      delete this.settings.zimPath;
      await this.saveSettings();
    }
  }
  async saveSettings() { await this.saveData(this.settings); }
}

class ZimReaderSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h3', { text: T.libTitle });
    const dl = containerEl.createEl('div', { cls: 'setting-item-description zim-dl-hint' });
    dl.appendText(T.downloadHint + ' ');
    dl.createEl('a', {
      text: 'browse.library.kiwix.org',
      href: 'https://browse.library.kiwix.org/#lang=rus',
      attr: { target: '_blank', rel: 'noopener' },
    });
    const libs = this.plugin.settings.libraries || [];
    if (!libs.length) containerEl.createEl('div', { cls: 'setting-item-description', text: T.libEmpty });
    const activePath = this.plugin.getActivePath();
    for (const lib of libs) {
      const isActive = lib.path === activePath;
      const s = new Setting(containerEl)
        .setName((isActive ? '● ' : '') + (lib.name || lib.path))
        .setDesc(lib.path);
      if (!isActive) {
        s.addButton((b) => b.setButtonText(T.setActive)
          .onClick(async () => { await this.plugin.setActive(lib.path); this.display(); }));
      }
      s.addExtraButton((b) => b.setIcon('trash-2').setTooltip(T.removeLib)
        .onClick(async () => { await this.plugin.removeLibrary(lib.path); this.display(); }));
    }
    // add-archive row: native file picker via <label> wrapping a hidden input.
    // A plain button + input.click()/showPicker() doesn't reliably open the
    // dialog in Obsidian, but clicking a label that contains the input does.
    const addSetting = new Setting(containerEl).setName(T.addArchive).setDesc(T.addArchiveDesc);
    const browse = addSetting.controlEl.createEl('label', { cls: 'zim-browse-btn', text: T.sBrowse });
    const fileInput = browse.createEl('input', { cls: 'zim-file-hidden', attr: { type: 'file', accept: '.zim' } });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      const p = getPickedPath(f);
      if (!p) { new Notice(T.cantReadPath); return; }
      await this.plugin.addLibrary(p);
      this.display();
    });

    new Setting(containerEl)
      .setName(T.sOpenExternal)
      .setDesc(T.sOpenExternalDesc)
      .addToggle((t) => t
        .setValue(this.plugin.settings.openExternalInBrowser)
        .onChange(async (v) => { this.plugin.settings.openExternalInBrowser = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName(T.sAutoload)
      .setDesc(T.sAutoloadDesc)
      .addToggle((t) => t
        .setValue(this.plugin.settings.autoloadImages)
        .onChange(async (v) => { this.plugin.settings.autoloadImages = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName(T.sHideApparatus)
      .setDesc(T.sHideApparatusDesc)
      .addToggle((t) => t
        .setValue(this.plugin.settings.hideApparatus)
        .onChange(async (v) => { this.plugin.settings.hideApparatus = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName(T.sNotesFolder)
      .setDesc(T.sNotesFolderDesc)
      .addText((t) => t
        .setPlaceholder(this.plugin.getActiveName())
        .setValue(this.plugin.settings.notesFolder)
        .onChange(async (v) => { this.plugin.settings.notesFolder = v; await this.plugin.saveSettings(); }));
  }
}

module.exports = ZimReaderPlugin;
