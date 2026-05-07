(function () {
    'use strict';

    /* ── 保存原始引用，防止被后续代码覆盖 ───────────────── */
    const _log = console.log.bind(console);
    const _group = console.group.bind(console);
    const _groupEnd = console.groupEnd.bind(console);
    const _warn = console.warn.bind(console);
    const _push = Array.prototype.push.bind([]);
    const _rApply = Reflect.apply;
    const _rGet = Reflect.get;
    const _rSet = Reflect.set;
    const _rHas = Reflect.has;
    const _rDelete = Reflect.deleteProperty;
    const _rConstruct = Reflect.construct;
    const _ownDesc = Object.getOwnPropertyDescriptor;
    const _ownDescs = Object.getOwnPropertyDescriptors;
    const _getProto = Object.getPrototypeOf;
    const _setProto = Object.setPrototypeOf;
    const _defProp = Object.defineProperty;
    const _defProps = Object.defineProperties;
    const _objKeys = Object.keys;
    const _objValues = Object.values;
    const _objEntries = Object.entries;
    const _objAssign = Object.assign;
    const _objCreate = Object.create;
    const _objFreeze = Object.freeze;
    const _ownNames = Object.getOwnPropertyNames;
    const _ownSymbols = Object.getOwnPropertySymbols;
    const _fnToStr = Function.prototype.toString;
    const _fnBind = Function.prototype.bind;
    const _arrSlice = Array.prototype.slice;
    const _errStack = () => { try { throw new Error(); } catch (e) { return e.stack || ''; } };

    const records = (window.__envHook = window.__envHook || []);
    let _recording = false;

    /* ── 跳过列表 ─────────────────────────────────────── */
    const SKIP_KEYS = new Set([
        'Object', 'Array', 'Function', 'String', 'Number', 'Boolean',
        'Symbol', 'BigInt', 'RegExp', 'Date', 'Math', 'JSON',
        'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',
        'Promise', 'Proxy', 'Reflect',
        'Error', 'TypeError', 'RangeError', 'SyntaxError',
        'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
        'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
        'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
        'Float64Array', 'BigInt64Array', 'BigUint64Array',
        'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics',
        'globalThis', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'eval',
        'console', 'log', 'warn', 'error', 'info', 'debug', 'table', 'dir',
        'mousemove', 'mousedown', 'mouseup', 'mouseover', 'mouseout',
        'mouseenter', 'mouseleave', 'scroll', 'pointermove',
        'touchmove', 'touchstart', 'touchend', 'pointerrawupdate',
        'keydown', 'keyup', 'keypress', 'resize', 'focus', 'blur', 'input', 'change',
        'then', 'catch', 'finally', 'constructor', 'prototype', '__proto__',
        '__esModule', 'default', 'clearStale', '__isEnvProxy',
        'length', 'size', 'name', 'message', 'arguments', 'caller',
    ]);

    const STACK_SKIP = ['envHook', 'at new Proxy', 'at Proxy.'];

    // webkit/moz/ms 前缀中，需要监控的指纹相关白名单（不跳过）
    const VENDOR_PREFIX_ALLOWLIST = new Set([
        // Storage
        'webkitTemporaryStorage', 'webkitPersistentStorage',
        // AudioContext
        'webkitAudioContext',
        // 全屏
        'webkitRequestFullscreen', 'webkitExitFullscreen',
        'webkitFullscreenElement', 'webkitFullscreenEnabled',
        'mozRequestFullScreen', 'mozCancelFullScreen',
        'msRequestFullscreen', 'msExitFullscreen',
        'msFullscreenElement', 'msFullscreenEnabled',
        // 指针锁
        'webkitPointerLockElement', 'mozPointerLockElement',
        // 媒体
        'webkitGetUserMedia', 'mozGetUserMedia',
        'webkitGetGamepads',
        // 触摸 / 力度
        'webkitForce', 'webkitMovementX', 'webkitMovementY',
        // IndexedDB (旧)
        'webkitIndexedDB', 'mozIndexedDB', 'msIndexedDB',
        // 电池
        'webkitBattery',
        // Speech
        'webkitSpeechRecognition', 'mozSpeechRecognition',
        // GPU / 渲染
        'webkitOfflineAudioContext',
        // CSS 动画（Webkit 指纹）
        'webkitRequestAnimationFrame', 'mozRequestAnimationFrame',
    ]);

    function shouldSkip(k) {
        if (typeof k !== 'string') return true;
        if (SKIP_KEYS.has(k)) return true;
        if (k.startsWith('on') && k.length > 2) return true;
        // vendor 前缀：只跳过不在白名单里的
        if (k.startsWith('webkit') || k.startsWith('moz') || k.startsWith('ms')) {
            return !VENDOR_PREFIX_ALLOWLIST.has(k);
        }
        return false;
    }

    /* ── 调用栈提取 ─────────────────────────────────────── */
    function captureStack(skip = 3) {
        try {
            const raw = _errStack();
            const lines = raw.split('\n').slice(skip).filter(l =>
                l.trim() && !STACK_SKIP.some(s => l.includes(s))
            );
            return lines.slice(0, 6).map(l => l.trim());
        } catch (_) { return []; }
    }

    /* ── 类型 & 值工具 ───────────────────────────────── */
    function typeTag(v) {
        if (v === null) return 'null';
        if (Array.isArray(v)) return 'array';
        return typeof v;
    }

    function shortVal(v) {
        try {
            if (v === null) return 'null';
            if (v === undefined) return 'undefined';
            const t = typeof v;
            if (t === 'function') return 'ƒ ' + (v.name || '(anonymous)');
            if (t === 'object') {
                try { return '[' + (v.constructor?.name || 'Object') + ']'; }
                catch (_) { return '[Object]'; }
            }
            const s = String(v);
            return s.length > 200 ? s.slice(0, 200) + '…' : s;
        } catch (_) { return '(err)'; }
    }

    /* ── record 核心 ─────────────────────────────────── */
    function record(op, path, key, val, returnVal, extraMeta) {
        if (_recording) return;
        const k = String(key);
        if (shouldSkip(k)) return;
        _recording = true;
        try {
            const fullPath = path + ' → ' + k;
            const result = returnVal !== undefined ? returnVal : val;
            const entry = {
                op, path: fullPath, key: k,
                type: typeTag(result), val: shortVal(result),
                ts: Date.now(), ...(extraMeta || {}),
            };
            _rApply(_push, records, [entry]);

            const styles = {
                get:          ['#185FA5', '#185FA5'],
                call:         ['#854F0B', '#854F0B'],
                set:          ['#3B6D11', '#3B6D11'],
                new:          ['#993556', '#993556'],
                proto:        ['#5B3EA8', '#5B3EA8'],
                toString:     ['#7A1F1F', '#7A1F1F'],
                objMeta:      ['#2D6B6B', '#2D6B6B'],
                stackRead:    ['#B8000A', '#B8000A'],
                mouseCapture: ['#7800B8', '#7800B8'],
            };
            const [bg, fg] = styles[op] || ['#444', '#444'];

            if (op === 'call' || op === 'new') {
                _group(`%c ${op} %c ${fullPath}`,
                    `color:#fff;background:${bg};padding:1px 5px;border-radius:3px`,
                    `color:${fg}`);
                _log('%c args   ', 'color:#888', val);
                _log('%c result ', 'color:#888', result);
                _groupEnd();
            } else if (op === 'objMeta' || op === 'proto') {
                _group(`%c ${op} %c ${fullPath}`,
                    `color:#fff;background:${bg};padding:1px 5px;border-radius:3px`,
                    `color:${fg}`);
                // val 是原始入参 target，result 是返回值
                if (entry.targetVal !== undefined) _log('%c target ', 'color:#888', entry.targetVal);
                if (entry.targetType)              _log('%c type   ', 'color:#aaa', entry.targetType);
                if (entry.key)                     _log('%c key    ', 'color:#aaa', entry.key);
                _log('%c result ', 'color:#888', result);
                _groupEnd();
            } else if (op === 'stackRead') {
                _group(`%c stackRead %c ${fullPath}  %c← 目标代码在读取堆栈！`,
                    `color:#fff;background:${bg};padding:2px 6px;border-radius:3px;font-weight:bold`,
                    `color:${fg};font-weight:bold`, `color:${fg}`);
                _log('%c caller stack ', 'color:#aaa;font-size:11px', entry.callerStack);
                _groupEnd();
            } else if (op === 'mouseCapture') {
                _group(`%c mouseCapture %c ${fullPath}  %c← 注册了鼠标轨迹采集`,
                    `color:#fff;background:${bg};padding:2px 6px;border-radius:3px;font-weight:bold`,
                    `color:${fg};font-weight:bold`, `color:${fg}`);
                _log('%c event    ', 'color:#888', entry.eventType);
                _log('%c handler  ', 'color:#888', entry.handler);
                _log('%c register stack ', 'color:#aaa;font-size:11px', entry.registerStack);
                _groupEnd();
            } else {
                _log(`%c ${op} %c ${fullPath}`,
                    `color:#fff;background:${bg};padding:1px 5px;border-radius:3px`,
                    `color:${fg}`, result);
            }

            if (window.__envHookCb) window.__envHookCb(entry);
        } finally { _recording = false; }
    }

    /* ── Proxy 缓存 ──────────────────────────────────── */
    const proxyToRaw = new WeakMap();
    const rawToProxy = new WeakMap();

    function unwrap(v) {
        let cur = v, n = 10;
        while (cur !== null && cur !== undefined && proxyToRaw.has(cur) && n-- > 0)
            cur = proxyToRaw.get(cur);
        return cur;
    }

    function unwrapArgs(args) {
        return _rApply(Array.prototype.map, args, [a => {
            if (a === null || a === undefined) return a;
            if (typeof a === 'object' || typeof a === 'function') return unwrap(a);
            return a;
        }]);
    }

    function safeGet(target, key) {
        try {
            const d = _ownDesc(target, key);
            if (d) {
                if ('value' in d) return d.value;
                if (d.get) return _rApply(d.get, target, []);
            }
        } catch (_) {}
        const proto = _getProto(target);
        if (proto) {
            try {
                const d = _ownDesc(proto, key);
                if (d) {
                    if ('value' in d) return d.value;
                    if (d.get) return _rApply(d.get, target, []);
                }
            } catch (_) {}
        }
        try { return _rGet(target, key, target); }
        catch (_) { return undefined; }
    }

    /* ── makeProxy ───────────────────────────────────── */
    function makeProxy(obj, path) {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj !== 'object' && typeof obj !== 'function') return obj;
        if (obj === console) return obj;
        if (rawToProxy.has(obj)) return rawToProxy.get(obj);

        const proxy = new Proxy(obj, {
            get(target, key, _receiver) {
                if (key === '__isEnvProxy') return true;
                try {
                    const d = _ownDesc(target, key);
                    if (d && !d.configurable && !d.writable) return d.value;
                } catch (_) {}
                const val = safeGet(target, key);
                if (typeof key !== 'symbol') record('get', path, key, val);
                if (val !== null && val !== undefined && val !== console
                    && (typeof val === 'object' || typeof val === 'function'))
                    return makeProxy(val, path + '.' + String(key));
                return val;
            },
            set(target, key, value, _receiver) {
                if (typeof key !== 'symbol') record('set', path, key, value);
                const rawVal = (value && (typeof value === 'object' || typeof value === 'function'))
                    ? unwrap(value) : value;
                return _rSet(target, key, rawVal, target);
            },
            has(target, key) {
                if (typeof key !== 'symbol') record('has', path, key, undefined);
                return _rHas(target, key);
            },
            deleteProperty(target, key) {
                if (typeof key !== 'symbol') record('del', path, key, undefined);
                return _rDelete(target, key);
            },
            apply(target, thisArg, args) {
                const rawThis = unwrap(thisArg);
                const rawArgs = unwrapArgs(args);
                let ret, ok = false;
                for (const t of [rawThis, thisArg, target, null]) {
                    try { ret = _rApply(target, t, rawArgs); ok = true; break; } catch (_) {}
                }
                if (!ok) {
                    for (const t of [rawThis, thisArg, target, null]) {
                        try { ret = _rApply(target, t, args); ok = true; break; } catch (_) {}
                    }
                }
                record('call', path, '()', args, ret);
                return ret;
            },
            construct(target, args, newTarget) {
                const rawArgs = unwrapArgs(args);
                const ret = _rConstruct(target, rawArgs, newTarget);
                patchDynamicObject(ret, path + '.new()');
                record('new', path, '()', args, ret);
                return ret;
            },
            getPrototypeOf(target) {
                const proto = _getProto(target);
                record('proto', path, '[[Prototype]]', proto);
                return proto;
            },
            getOwnPropertyDescriptor(target, key) {
                const d = _ownDesc(target, key);
                if (typeof key !== 'symbol') record('get', path + '.[[Desc]]', key, d);
                return d;
            },
        });

        proxyToRaw.set(proxy, obj);
        rawToProxy.set(obj, proxy);
        return proxy;
    }

    /* ══════════════════════════════════════════════════
       动态对象打补丁
    ══════════════════════════════════════════════════ */
    const _patched = new WeakSet();

    function patchDynamicObject(obj, pathHint) {
        if (!obj || typeof obj !== 'object') return;
        if (_patched.has(obj)) return;
        _patched.add(obj);
        const objPath = pathHint || obj.constructor?.name || 'Object';
        _patchCanvasElement(obj, objPath);
        _patchRenderingContext(obj, objPath);
        _patchAudioContext(obj, objPath);
        _patchFontFace(obj, objPath);
    }

    /* ── canvas ─────────────────────────────────────── */
    const CANVAS_METHODS = [
        'toDataURL',            // (type?: string, quality?: number) → string
        'toBlob',               // (callback: BlobCallback, type?: string, quality?: number) → void
        'getContext',           // (contextId: '2d'|'webgl'|'webgl2'|'bitmaprenderer', options?) → ctx|null
        'captureStream',        // (frameRate?: number) → MediaStream
        'transferControlToOffscreen', // () → OffscreenCanvas
    ];
    const CANVAS_PROPS = ['width', 'height'];

    function _patchCanvasElement(el, basePath) {
        if (!el || el.nodeName !== 'CANVAS') return;
        CANVAS_METHODS.forEach(m => {
            const orig = el[m];
            if (typeof orig !== 'function') return;
            el[m] = function (...args) {
                const ret = _rApply(orig, el, args);
                record('call', basePath, m, args, ret);
                if (m === 'getContext' && ret) patchDynamicObject(ret, basePath + '.getContext(' + args[0] + ')');
                return ret;
            };
        });
        CANVAS_PROPS.forEach(p => {
            const desc = _ownDesc(el, p) || _ownDesc(_getProto(el), p);
            if (!desc) return;
            _defProp(el, p, {
                get() { const v = desc.get ? _rApply(desc.get, el, []) : el['_' + p]; record('get', basePath, p, v); return v; },
                set(v) { record('set', basePath, p, v); if (desc.set) _rApply(desc.set, el, [v]); },
                configurable: true,
            });
        });
    }

    /* ── WebGL / 2D / WebGPU context ─────────────────── */
    const WEBGL_METHODS = [
        // ── WebGL1 / WebGL2 核心 ──
        'getParameter',               // (pname: GLenum) → any
        'getExtension',               // (name: string) → object|null
        'getSupportedExtensions',     // () → string[]
        'getShaderPrecisionFormat',   // (shaderType, precisionType) → WebGLShaderPrecisionFormat
        'getContextAttributes',       // () → WebGLContextAttributes
        'getError',                   // () → GLenum
        'getActiveAttrib',            // (program, index) → WebGLActiveInfo
        'getActiveUniform',           // (program, index) → WebGLActiveInfo
        'getAttribLocation',          // (program, name) → GLint
        'getUniformLocation',         // (program, name) → WebGLUniformLocation
        'getVertexAttrib',            // (index, pname) → any
        'getProgramParameter',        // (program, pname) → any
        'getProgramInfoLog',          // (program) → string
        'getShaderParameter',         // (shader, pname) → any
        'getShaderInfoLog',           // (shader) → string
        'getShaderSource',            // (shader) → string
        'getRenderbufferParameter',   // (target, pname) → any
        'getFramebufferAttachmentParameter', // (target, attachment, pname) → any
        'getBufferParameter',         // (target, pname) → any
        'getTexParameter',            // (target, pname) → any
        'readPixels',                 // (x,y,w,h,format,type,pixels) → void
        'isContextLost',              // () → boolean
        // ── 2D Canvas ──
        'fillText',                   // (text, x, y, maxWidth?) → void
        'strokeText',                 // (text, x, y, maxWidth?) → void
        'measureText',                // (text) → TextMetrics
        'getImageData',               // (sx, sy, sw, sh, settings?) → ImageData
        'putImageData',               // (imageData, dx, dy, ...cropParams) → void
        'drawImage',                  // (image, dx, dy, dw?, dh?, sx?, sy?, sw?, sh?) → void
        'createLinearGradient',       // (x0, y0, x1, y1) → CanvasGradient
        'createRadialGradient',       // (x0, y0, r0, x1, y1, r1) → CanvasGradient
        'createConicGradient',        // (startAngle, x, y) → CanvasGradient
        'createPattern',              // (image, repetition) → CanvasPattern
        'arc',                        // (x, y, radius, startAngle, endAngle, ccw?) → void
        'arcTo',                      // (x1, y1, x2, y2, radius) → void
        'bezierCurveTo',              // (cp1x,cp1y,cp2x,cp2y,x,y) → void
        'quadraticCurveTo',           // (cpx, cpy, x, y) → void
        'fill',                       // (fillRule?) | (path, fillRule?) → void
        'stroke',                     // (path?) → void
        'clip',                       // (fillRule?) | (path, fillRule?) → void
        'beginPath',                  // () → void
        'closePath',                  // () → void
        'moveTo',                     // (x, y) → void
        'lineTo',                     // (x, y) → void
        'rect',                       // (x, y, w, h) → void
        'roundRect',                  // (x, y, w, h, radii) → void
        'clearRect',                  // (x, y, w, h) → void
        'fillRect',                   // (x, y, w, h) → void
        'strokeRect',                 // (x, y, w, h) → void
        'setTransform',               // (a,b,c,d,e,f) | (matrix) → void
        'getTransform',               // () → DOMMatrix
        'transform',                  // (a,b,c,d,e,f) → void
        'translate',                  // (x, y) → void
        'scale',                      // (x, y) → void
        'rotate',                     // (angle) → void
        'save',                       // () → void
        'restore',                    // () → void
        'isPointInPath',              // (x, y, fillRule?) → boolean
        'isPointInStroke',            // (x, y) → boolean
        'createImageData',            // (sw, sh) | (imagedata) → ImageData
        // ── WebGPU ──
        'requestAdapter',             // (options?) → Promise<GPUAdapter>
    ];

    const WEBGL_PROPS_READ = [
        // 2D context props（均为可读写）
        'font', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin',
        'globalAlpha', 'globalCompositeOperation', 'shadowBlur', 'shadowColor',
        'shadowOffsetX', 'shadowOffsetY', 'textAlign', 'textBaseline',
        'direction', 'imageSmoothingEnabled', 'imageSmoothingQuality',
        'miterLimit', 'lineDashOffset',
        // WebGL context props
        'drawingBufferWidth', 'drawingBufferHeight',
        'drawingBufferColorSpace', 'unpackColorSpace',
    ];

    function _patchRenderingContext(ctx, basePath) {
        if (!ctx) return;
        const ctorName = ctx.constructor?.name || '';
        if (!/WebGL|Rendering|2D|GPU/i.test(ctorName) &&
            typeof ctx.getParameter !== 'function' &&
            typeof ctx.fillText !== 'function') return;

        WEBGL_METHODS.forEach(m => {
            const orig = ctx[m];
            if (typeof orig !== 'function') return;
            ctx[m] = function (...args) {
                const ret = _rApply(orig, ctx, args);
                record('call', basePath, m, args, ret);
                return ret;
            };
        });

        // getParameter 十六进制增强
        if (typeof ctx.getParameter === 'function') {
            const origGet = ctx.getParameter.bind(ctx);
            ctx.getParameter = function (pname) {
                const ret = origGet(pname);
                record('call', basePath, 'getParameter', [pname, '0x' + (pname >>> 0).toString(16)], ret);
                return ret;
            };
        }

        // 拦截可读写属性
        WEBGL_PROPS_READ.forEach(p => {
            try {
                let d, proto = ctx;
                while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                if (!d) return;
                const origGet = d.get, origSet = d.set;
                _defProp(ctx, p, {
                    get() {
                        const v = origGet ? _rApply(origGet, ctx, []) : undefined;
                        record('get', basePath, p, v);
                        return v;
                    },
                    set(v) {
                        record('set', basePath, p, v);
                        if (origSet) _rApply(origSet, ctx, [v]);
                    },
                    configurable: true,
                });
            } catch (_) {}
        });
    }

    /* ── AudioContext / OfflineAudioContext ───────────── */
    const AUDIO_METHODS = [
        'createOscillator',          // () → OscillatorNode
        'createDynamicsCompressor',  // () → DynamicsCompressorNode
        'createBiquadFilter',        // () → BiquadFilterNode
        'createBuffer',              // (numChannels, length, sampleRate) → AudioBuffer
        'createBufferSource',        // () → AudioBufferSourceNode
        'createAnalyser',            // () → AnalyserNode
        'createGain',                // () → GainNode
        'createChannelMerger',       // (numberOfInputs?) → ChannelMergerNode
        'createChannelSplitter',     // (numberOfOutputs?) → ChannelSplitterNode
        'createConvolver',           // () → ConvolverNode
        'createDelay',               // (maxDelayTime?) → DelayNode
        'createScriptProcessor',     // (bufferSize, inputChannels, outputChannels) → ScriptProcessorNode
        'createWaveShaper',          // () → WaveShaperNode
        'createStereoPanner',        // () → StereoPannerNode
        'createPanner',              // () → PannerNode
        'createIIRFilter',           // (feedforward, feedback) → IIRFilterNode
        'createPeriodicWave',        // (real, imag, constraints?) → PeriodicWave
        'createMediaElementSource',  // (mediaElement) → MediaElementAudioSourceNode
        'createMediaStreamSource',   // (mediaStream) → MediaStreamAudioSourceNode
        'createMediaStreamDestination', // () → MediaStreamAudioDestinationNode
        'decodeAudioData',           // (arrayBuffer, successCb?, errorCb?) → Promise<AudioBuffer>
        'suspend',                   // () → Promise<void>
        'resume',                    // () → Promise<void>
        'close',                     // () → Promise<void>
        'startRendering',            // () → Promise<AudioBuffer>  (OfflineAudioContext)
    ];
    const AUDIO_PROPS = [
        'sampleRate',       // number (readonly)
        'state',            // AudioContextState (readonly)
        'currentTime',      // number (readonly)
        'destination',      // AudioDestinationNode (readonly)
        'listener',         // AudioListener (readonly)
        'baseLatency',      // number (readonly)
        'outputLatency',    // number (readonly)
        'audioWorklet',     // AudioWorklet (readonly)
    ];

    function _patchAudioContext(ctx, basePath) {
        if (!ctx) return;
        const ctorName = ctx.constructor?.name || '';
        if (!/AudioContext/i.test(ctorName)) return;
        AUDIO_METHODS.forEach(m => {
            const orig = ctx[m];
            if (typeof orig !== 'function') return;
            ctx[m] = function (...args) {
                const ret = _rApply(orig, ctx, args);
                record('call', basePath, m, args, ret);
                return ret;
            };
        });
        AUDIO_PROPS.forEach(p => {
            let proto = ctx, d;
            while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
            if (!d?.get) return;
            const g = d.get;
            _defProp(ctx, p, {
                get() { const v = _rApply(g, ctx, []); record('get', basePath, p, v); return v; },
                configurable: true,
            });
        });
    }

    /* ── FontFace / FontFaceSet ───────────────────────── */
    function _patchFontFace(obj, basePath) {
        if (!obj) return;
        const ctorName = obj.constructor?.name || '';
        if (ctorName !== 'FontFace' && ctorName !== 'FontFaceSet') return;
        // FontFace: load() → Promise<FontFace>
        // FontFaceSet: load(font,text?), check(font,text?), add(font), delete(font), clear()
        ['load', 'check', 'add', 'delete', 'clear'].forEach(m => {
            const orig = obj[m];
            if (typeof orig !== 'function') return;
            obj[m] = function (...args) {
                const ret = _rApply(orig, obj, args);
                record('call', basePath, m, args, ret);
                return ret;
            };
        });
        // 属性
        ['status', 'loaded', 'size'].forEach(p => {
            let d, proto = obj;
            while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
            if (!d?.get) return;
            const g = d.get;
            _defProp(obj, p, {
                get() { const v = _rApply(g, obj, []); record('get', basePath, p, v); return v; },
                configurable: true,
            });
        });
    }

    /* ══════════════════════════════════════════════════
       document.createElement / createElementNS 拦截
    ══════════════════════════════════════════════════ */
    (function patchDocument() {
        const doc = document;

        ['createElement', 'createElementNS'].forEach(m => {
            const orig = doc[m].bind(doc);
            doc[m] = function (...args) {
                const el = orig(...args);
                record('call', 'window.document', m, args, el);
                patchDynamicObject(el, 'document.' + m + '(' + args.join(',') + ')');
                return el;
            };
        });

        const DOM_METHODS = [
            'querySelector',           // (selectors) → Element|null
            'querySelectorAll',        // (selectors) → NodeList
            'getElementById',         // (id) → Element|null
            'getElementsByClassName', // (names) → HTMLCollection
            'getElementsByTagName',   // (qualifiedName) → HTMLCollection
            'getElementsByName',      // (elementName) → NodeList
            'createTextNode',         // (data) → Text
            'createDocumentFragment', // () → DocumentFragment
            'createEvent',            // (eventInterface) → Event
            'createComment',          // (data) → Comment
            'createRange',            // () → Range
            'createTreeWalker',       // (root, whatToShow?, filter?) → TreeWalker
            'createNodeIterator',     // (root, whatToShow?, filter?) → NodeIterator
            'importNode',             // (node, deep?) → Node
            'adoptNode',              // (externalNode) → Node
            'addEventListener',       // (type, listener, options?) → void
            'removeEventListener',    // (type, listener, options?) → void
            'dispatchEvent',          // (event) → boolean
            'appendChild',            // (node) → Node
            'removeChild',            // (child) → Node
            'insertBefore',           // (newNode, refNode) → Node
            'replaceChild',           // (newChild, oldChild) → Node
            'write',                  // (...text) → void
            'writeln',                // (...text) → void
            'hasFocus',               // () → boolean
            'elementFromPoint',       // (x, y) → Element|null
            'elementsFromPoint',      // (x, y) → Element[]
            'getSelection',           // () → Selection|null
            'execCommand',            // (commandId, showUI?, value?) → boolean (deprecated)
            'caretRangeFromPoint',    // (x, y) → Range|null
            'getAnimations',          // (options?) → Animation[]
            'getElementsFromPoint',   // (x, y) → Element[] (alias)
            'open',                   // (url?, name?, features?) → Window|null
            'close',                  // () → void
        ];
        DOM_METHODS.forEach(m => {
            const orig = doc[m];
            if (typeof orig !== 'function') return;
            try {
                doc[m] = function (...args) {
                    const rawArgs = unwrapArgs(args);
                    const ret = _rApply(orig, doc, rawArgs);
                    record('call', 'window.document', m, args, ret);
                    return ret;
                };
            } catch (e) { _log('[EnvHook] ✗ doc.' + m, e.message); }
        });

        /* document 属性 */
        const HIGH_FREQ_PROPS = new Set(['body', 'documentElement', 'head']);
        const _propThrottle = Object.create(null);
        const THROTTLE_MS = 100;

        const ELEMENT_MEASURE_METHODS = [
            'getBoundingClientRect',  // () → DOMRect
            'getClientRects',         // () → DOMRectList
            'addEventListener',
            'removeEventListener',
            'getAttribute',           // (name) → string|null
            'setAttribute',           // (name, value) → void
            'removeAttribute',        // (name) → void
            'hasAttribute',           // (name) → boolean
            'getAttributeNames',      // () → string[]
            'querySelector',
            'querySelectorAll',
            'appendChild',
            'removeChild',
            'insertBefore',
            'replaceWith',            // (...nodes) → void
            'replaceChildren',        // (...nodes) → void
            'dispatchEvent',
            'contains',               // (other) → boolean
            'closest',                // (selectors) → Element|null
            'matches',                // (selectors) → boolean
            'before',                 // (...nodes) → void
            'after',                  // (...nodes) → void
            'prepend',                // (...nodes) → void
            'append',                 // (...nodes) → void
            'remove',                 // () → void
            'cloneNode',              // (deep?) → Node
            'insertAdjacentHTML',     // (position, text) → void
            'insertAdjacentElement',  // (position, element) → Element|null
            'insertAdjacentText',     // (position, data) → void
            'animate',                // (keyframes, options?) → Animation
            'getAnimations',          // (options?) → Animation[]
            'setPointerCapture',      // (pointerId) → void
            'releasePointerCapture',  // (pointerId) → void
            'requestFullscreen',      // (options?) → Promise<void>
            'requestPointerLock',     // () → void
            'scrollIntoView',         // (arg?) → void
            'scrollTo',               // (x, y) | (options) → void
            'scroll',                 // alias
            'scrollBy',               // (x, y) | (options) → void
            'focus',                  // (options?) → void
            'blur',                   // () → void
            'click',                  // () → void
        ];
        const ELEMENT_MEASURE_PROPS = [
            'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent',
            'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft',
            'clientWidth', 'clientHeight', 'clientTop', 'clientLeft',
            'innerText', 'innerHTML', 'outerHTML', 'textContent',
            'style', 'className', 'classList', 'id', 'tagName', 'nodeName',
            'children', 'childNodes', 'childElementCount',
            'parentElement', 'parentNode', 'nextSibling', 'previousSibling',
            'nextElementSibling', 'previousElementSibling',
            'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild',
            'tabIndex', 'hidden', 'draggable', 'contentEditable',
            'dataset', 'part', 'slot', 'role',
        ];

        function wrapElement(el, elPath) {
            if (!el || typeof el !== 'object') return el;
            if (el.__isEnvProxy) return el;
            if (rawToProxy.has(el)) return rawToProxy.get(el);
            ELEMENT_MEASURE_METHODS.forEach(m => {
                const orig = el[m];
                if (typeof orig !== 'function') return;
                try {
                    el[m] = function (...args) {
                        const ret = _rApply(orig, el, args);
                        record('call', elPath, m, args, ret);
                        return ret;
                    };
                } catch (_) {}
            });
            ELEMENT_MEASURE_PROPS.forEach(p => {
                try {
                    let d, proto = el;
                    while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                    if (!d?.get) return;
                    const g = d.get;
                    _defProp(el, p, {
                        get() { const v = _rApply(g, el, []); record('get', elPath, p, v); return v; },
                        set: d.set ? function (v) { _rApply(d.set, el, [v]); } : undefined,
                        configurable: true,
                    });
                } catch (_) {}
            });
            return el;
        }

        // document 属性完整列表
        [
            'cookie',           // string (r/w)
            'domain',           // string (r/w)
            'referrer',         // string (readonly)
            'title',            // string (r/w)
            'URL',              // string (readonly)
            'documentURI',      // string (readonly)
            'readyState',       // DocumentReadyState (readonly)
            'visibilityState',  // VisibilityState (readonly)
            'hidden',           // boolean (readonly)
            'body',             // HTMLElement (r/w)
            'head',             // HTMLHeadElement (readonly)
            'documentElement',  // HTMLHtmlElement (readonly)
            'location',         // Location (readonly)
            'baseURI',          // string (readonly)
            'characterSet',     // string (readonly)
            'charset',          // string (deprecated alias)
            'contentType',      // string (readonly)
            'lastModified',     // string (readonly)
            'compatMode',       // string (readonly)
            'designMode',       // string (r/w)
            'dir',              // string (r/w)
            'defaultView',      // WindowProxy|null (readonly)
            'activeElement',    // Element|null (readonly)
            'fullscreenElement',// Element|null (readonly)
            'fullscreenEnabled',// boolean (readonly)
            'pointerLockElement', // Element|null (readonly)
            'pictureInPictureElement', // Element|null
            'pictureInPictureEnabled', // boolean
            'fonts',            // FontFaceSet (readonly)
            'images',           // HTMLCollection (readonly)
            'links',            // HTMLCollection (readonly)
            'forms',            // HTMLCollection (readonly)
            'scripts',          // HTMLCollection (readonly)
            'styleSheets',      // StyleSheetList (readonly)
            'adoptedStyleSheets', // CSSStyleSheet[] (r/w)
            'children',         // HTMLCollection (readonly)
            'childElementCount',// number (readonly)
        ].forEach(p => {
            try {
                let d, proto = doc;
                while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                if (!d?.get) return;
                const g = d.get;
                if (HIGH_FREQ_PROPS.has(p)) {
                    _defProp(doc, p, {
                        get() {
                            const v = _rApply(g, doc, []);
                            if (!_recording) {
                                const now = Date.now();
                                const last = _propThrottle[p] || 0;
                                if (now - last >= THROTTLE_MS) {
                                    _propThrottle[p] = now;
                                    _recording = true;
                                    try {
                                        const stack = captureStack(3);
                                        const entry = { op: 'get', path: 'window.document → ' + p, key: p, type: typeTag(v), val: shortVal(v), stack, ts: now };
                                        _rApply(_push, records, [entry]);
                                        _group('%c get %c window.document → ' + p,
                                            'color:#fff;background:#185FA5;padding:1px 5px;border-radius:3px',
                                            'color:#185FA5;font-weight:bold');
                                        _log('%c value  ', 'color:#888', v);
                                        if (stack.length) _log('%c stack  ', 'color:#aaa;font-size:11px', '\n' + stack.join('\n'));
                                        _groupEnd();
                                        if (window.__envHookCb) window.__envHookCb(entry);
                                    } finally { _recording = false; }
                                }
                                wrapElement(v, 'document.' + p);
                            }
                            return v;
                        },
                        configurable: true,
                    });
                } else {
                    _defProp(doc, p, {
                        get() { const v = _rApply(g, doc, []); record('get', 'window.document', p, v); return v; },
                        configurable: true,
                    });
                }
            } catch (e) { _log('[EnvHook] ✗ doc.' + p, e.message); }
        });
    })();

    /* ══════════════════════════════════════════════════
       Object 静态方法拦截
       ─────────────────────────────────────────────────
       核心修复：
       1. 每次调用都完整打印「入参 target」和「返回值」
       2. 对 getOwnPropertyNames / getOwnPropertyDescriptor /
          hasOwnProperty 类操作，标注 key 来源：
            own       — 属性在对象自身上（Object.getOwnPropertyDescriptor 能找到）
            proto:N   — 属性在第 N 层原型上
            absent    — 整条原型链上都不存在
       3. 对 getPrototypeOf 追踪完整原型链，打印每一层构造器名
    ══════════════════════════════════════════════════ */
    (function patchObjectStatics() {
        const O = Object;

        /* ── 工具：判断 target 是否值得记录 ── */
        function isInteresting(target) {
            if (target === null || target === undefined) return false;
            const t = typeof target;
            if (t !== 'object' && t !== 'function') return false;
            // 跳过极小的普通字面量（键数 < 3 且构造器是 Object）
            try {
                const n = target.constructor?.name || '';
                if (n === 'Object' && _ownNames(target).length < 3) return false;
            } catch (_) {}
            return true;
        }

        /* ── 工具：找 key 在原型链上的位置 ──
           返回 { location: 'own'|'proto:N'|'absent', depth: number,
                  ownerType: string }
        */
        function findKeyLocation(target, key) {
            if (target === null || target === undefined) return { location: 'absent', depth: -1, ownerType: '' };
            try {
                // 先检查 own
                if (_rHas(target, key) || _ownDesc(target, key)) {
                    return { location: 'own', depth: 0, ownerType: target.constructor?.name || 'Object' };
                }
                // 沿原型链向上
                let depth = 1, proto = _getProto(target);
                while (proto !== null && proto !== undefined) {
                    if (_ownDesc(proto, key)) {
                        return {
                            location: 'proto:' + depth,
                            depth,
                            ownerType: proto.constructor?.name || proto[Symbol.toStringTag] || 'Object',
                        };
                    }
                    proto = _getProto(proto);
                    depth++;
                    if (depth > 10) break;  // 防止无限循环
                }
            } catch (_) {}
            return { location: 'absent', depth: -1, ownerType: '' };
        }

        /* ── 工具：收集完整原型链（用于 getPrototypeOf 展示）── */
        function collectProtoChain(obj) {
            const chain = [];
            let cur = obj, depth = 0;
            while (cur !== null && cur !== undefined && depth < 12) {
                try {
                    chain.push({
                        depth,
                        ctor: cur.constructor?.name || cur[Symbol.toStringTag] || '(anonymous)',
                        tag:  Object.prototype.toString.call(cur),
                    });
                    cur = _getProto(cur);
                    depth++;
                } catch (_) { break; }
            }
            return chain;
        }

        /* ── 专用打印函数（不走通用 record，避免 shouldSkip 误判方法名）── */
        function printObjMeta(methodName, target, extraLines, result) {
            if (_recording) return;
            _recording = true;
            try {
                const targetType = (() => {
                    try { return target?.constructor?.name || typeof target; } catch (_) { return typeof target; }
                })();
                const fullPath = 'Object → ' + methodName;

                const entry = {
                    op: methodName === 'getPrototypeOf' || methodName === 'setPrototypeOf'
                        ? 'proto' : 'objMeta',
                    path: fullPath,
                    key: methodName,
                    targetType,
                    type: typeTag(result),
                    val: shortVal(result),
                    ts: Date.now(),
                    ...extraLines,
                };
                _rApply(_push, records, [entry]);

                const isProto  = entry.op === 'proto';
                const bg       = isProto ? '#5B3EA8' : '#2D6B6B';
                const label    = isProto ? 'proto' : 'objMeta';

                _group(
                    `%c ${label} %c Object.${methodName}(…)`,
                    `color:#fff;background:${bg};padding:1px 5px;border-radius:3px;font-weight:bold`,
                    `color:${bg};font-weight:bold`
                );

                // ① 打印 target（入参）
                _log('%c target      ', 'color:#888;font-weight:bold', target);
                _log('%c targetType  ', 'color:#aaa', targetType);

                // ② 打印各个额外信息行
                for (const [label2, val2] of _objEntries(extraLines)) {
                    if (val2 === undefined || val2 === null) continue;
                    _log(`%c ${label2.padEnd(12)}`, 'color:#aaa', val2);
                }

                // ③ 打印返回值
                _log('%c result      ', 'color:#888;font-weight:bold', result);
                _groupEnd();

                if (window.__envHookCb) window.__envHookCb(entry);
            } finally {
                _recording = false;
            }
        }

        /* ══ 各方法包装 ══ */

        // getOwnPropertyNames(target) → string[]
        // 同时标注每个返回的 key 属于 own 还是某层 proto（getOwnPropertyNames 自身只返回 own，
        // 但调用者真正想问的是"我能拿到哪些键"，所以额外报告 proto 上的键数作为参考）
        const _origGOPN = O.getOwnPropertyNames;
        O.getOwnPropertyNames = function (target) {
            const ret = _rApply(_origGOPN, O, [target]);
            if (!isInteresting(target)) return ret;
            // 统计 proto 链上还有多少键（调用者可能后续会访问它们）
            let protoKeyCount = 0;
            try {
                let p = _getProto(target);
                while (p && p !== Object.prototype) {
                    protoKeyCount += _rApply(_origGOPN, O, [p]).length;
                    p = _getProto(p);
                }
            } catch (_) {}
            printObjMeta('getOwnPropertyNames', target, {
                'ownKeys':        ret,                          // 返回的 own key 列表
                'ownKeyCount':    ret.length,
                'protoKeyCount':  protoKeyCount,                // 原型链上还有多少键（供参考）
            }, ret);
            return ret;
        };

        // getOwnPropertyDescriptor(target, key) → descriptor | undefined
        // 重点：标注 key 在 own / proto:N / absent
        const _origGOPD = O.getOwnPropertyDescriptor;
        O.getOwnPropertyDescriptor = function (target, key) {
            const ret = _rApply(_origGOPD, O, [target, key]);
            if (!isInteresting(target)) return ret;
            const loc = findKeyLocation(target, key);
            printObjMeta('getOwnPropertyDescriptor', target, {
                'queriedKey':  key,
                'location':    loc.location,    // own | proto:N | absent
                'ownerType':   loc.ownerType,   // 属性真实所属的构造器名
                'found(own)':  ret !== undefined ? 'yes (own descriptor)' : 'no (not own)',
            }, ret);
            return ret;
        };

        // getOwnPropertyDescriptors(target) → { [key]: descriptor }
        const _origGOPDS = O.getOwnPropertyDescriptors;
        O.getOwnPropertyDescriptors = function (target) {
            const ret = _rApply(_origGOPDS, O, [target]);
            if (!isInteresting(target)) return ret;
            printObjMeta('getOwnPropertyDescriptors', target, {
                'ownKeyCount': _objKeys(ret).length,
                'ownKeys':     _objKeys(ret),
            }, ret);
            return ret;
        };

        // getOwnPropertySymbols(target) → symbol[]
        const _origGOPS = O.getOwnPropertySymbols;
        O.getOwnPropertySymbols = function (target) {
            const ret = _rApply(_origGOPS, O, [target]);
            if (!isInteresting(target)) return ret;
            printObjMeta('getOwnPropertySymbols', target, {
                'symbolCount': ret.length,
                'symbols':     ret.map(s => s.toString()),
            }, ret);
            return ret;
        };

        // getPrototypeOf(target) → prototype
        // 同时展示完整原型链
        const _origGPO = O.getPrototypeOf;
        O.getPrototypeOf = function (target) {
            const ret = _rApply(_origGPO, O, [target]);
            if (!isInteresting(target)) return ret;
            const chain = collectProtoChain(target);
            printObjMeta('getPrototypeOf', target, {
                'directProto':  ret?.constructor?.name || String(ret),
                'protoChain':   chain.map(c => `[${c.depth}] ${c.ctor}  ${c.tag}`),
            }, ret);
            return ret;
        };

        // setPrototypeOf(target, proto) → target
        const _origSPO = O.setPrototypeOf;
        O.setPrototypeOf = function (target, proto) {
            const ret = _rApply(_origSPO, O, [target, proto]);
            if (!isInteresting(target)) return ret;
            printObjMeta('setPrototypeOf', target, {
                'newProto':    proto?.constructor?.name || String(proto),
            }, ret);
            return ret;
        };

        // keys(target) → string[]
        const _origKeys = O.keys;
        O.keys = function (target) {
            const ret = _rApply(_origKeys, O, [target]);
            if (!isInteresting(target)) return ret;
            // 标注 own 可枚举 key 列表，与 getOwnPropertyNames 对比
            let nonEnumCount = 0;
            try {
                const allOwn = _rApply(_origGOPN, O, [target]);
                nonEnumCount = allOwn.length - ret.length;  // own 但不可枚举的数量
            } catch (_) {}
            printObjMeta('keys', target, {
                'enumKeys':         ret,
                'enumKeyCount':     ret.length,
                'nonEnumOwnCount':  nonEnumCount,  // own 里有多少是不可枚举的
            }, ret);
            return ret;
        };

        // values / entries
        const _origValues = O.values;
        O.values = function (target) {
            const ret = _rApply(_origValues, O, [target]);
            if (!isInteresting(target)) return ret;
            printObjMeta('values', target, { 'count': ret.length }, ret);
            return ret;
        };

        const _origEntries = O.entries;
        O.entries = function (target) {
            const ret = _rApply(_origEntries, O, [target]);
            if (!isInteresting(target)) return ret;
            printObjMeta('entries', target, {
                'count':  ret.length,
                'keys':   ret.map(([k]) => k),
            }, ret);
            return ret;
        };

        // defineProperty(target, key, descriptor)
        const _origDP = O.defineProperty;
        O.defineProperty = function (target, key, descriptor) {
            const ret = _rApply(_origDP, O, [target, key, descriptor]);
            if (!isInteresting(target)) return ret;
            const loc = findKeyLocation(ret, key);   // 定义后再查位置
            printObjMeta('defineProperty', target, {
                'key':         key,
                'location':    loc.location,
                'descriptor':  {
                    writable:     descriptor?.writable,
                    enumerable:   descriptor?.enumerable,
                    configurable: descriptor?.configurable,
                    hasGet:       typeof descriptor?.get === 'function',
                    hasSet:       typeof descriptor?.set === 'function',
                    value:        shortVal(descriptor?.value),
                },
            }, ret);
            return ret;
        };

        // defineProperties
        const _origDPS = O.defineProperties;
        O.defineProperties = function (target, props) {
            const ret = _rApply(_origDPS, O, [target, props]);
            if (!isInteresting(target)) return ret;
            printObjMeta('defineProperties', target, {
                'keys': _objKeys(props),
            }, ret);
            return ret;
        };

        // assign(target, ...sources)
        const _origAssign = O.assign;
        O.assign = function (target, ...sources) {
            const ret = _rApply(_origAssign, O, [target, ...sources]);
            if (!isInteresting(target)) return ret;
            const copiedKeys = sources.flatMap(s => {
                try { return _rApply(_origKeys, O, [s || {}]); } catch (_) { return []; }
            });
            printObjMeta('assign', target, {
                'sourceCount': sources.length,
                'copiedKeys':  copiedKeys,
            }, ret);
            return ret;
        };

        // freeze / seal / preventExtensions（影响对象可变性，指纹库常用）
        for (const [name, orig] of [
            ['freeze',            O.freeze],
            ['seal',              O.seal],
            ['preventExtensions', O.preventExtensions],
        ]) {
            const _orig = orig;
            O[name] = function (target) {
                const ret = _rApply(_orig, O, [target]);
                if (!isInteresting(target)) return ret;
                printObjMeta(name, target, {}, ret);
                return ret;
            };
        }

        // isFrozen / isSealed / isExtensible（状态查询）
        for (const [name, orig] of [
            ['isFrozen',    O.isFrozen],
            ['isSealed',    O.isSealed],
            ['isExtensible',O.isExtensible],
        ]) {
            const _orig = orig;
            O[name] = function (target) {
                const ret = _rApply(_orig, O, [target]);
                if (!isInteresting(target)) return ret;
                printObjMeta(name, target, { 'result': ret }, ret);
                return ret;
            };
        }

        // create(proto, propertiesObject?)
        const _origCreate = O.create;
        O.create = function (proto, props) {
            const ret = _rApply(_origCreate, O, [proto, props]);
            // 对 proto 本身感兴趣
            if (proto && proto !== Object.prototype) {
                const chain = collectProtoChain(ret);
                printObjMeta('create', proto, {
                    'newObjKeys':  props ? _objKeys(props) : [],
                    'protoChain':  chain.map(c => `[${c.depth}] ${c.ctor}`),
                }, ret);
            }
            return ret;
        };
    })();

    /* ══════════════════════════════════════════════════
       Function.prototype.toString 拦截
    ══════════════════════════════════════════════════ */
    (function patchFunctionToString() {
        const origToStr = Function.prototype.toString;
        const NATIVE_FAKES = new WeakSet();
        Function.prototype.toString = function () {
            const ret = _rApply(origToStr, this, []);
            const isNative = ret.includes('[native code]');
            const name = this.name || '(anonymous)';
            if (isNative || NATIVE_FAKES.has(this)) record('toString', 'Function.prototype', 'toString[' + name + ']', ret);
            return ret;
        };
        _defProp(Function.prototype.toString, 'toString', {
            value: function () { return 'function toString() { [native code] }'; },
            configurable: true,
        });
        window.__envHookRegisterNative = fn => NATIVE_FAKES.add(fn);
    })();

    /* ══════════════════════════════════════════════════
       原型链访问检测
    ══════════════════════════════════════════════════ */
    (function patchPrototypeAccess() {
        /* ── Reflect.getPrototypeOf ──
           同样展示完整原型链（复用 patchObjectStatics 里已定义的 collectProtoChain 不行，
           因为作用域不同；这里内联一份轻量版）
        */
        const origRGP = Reflect.getPrototypeOf;
        Reflect.getPrototypeOf = function (target) {
            const ret = origRGP(target);
            if (_recording) return ret;
            try {
                const ctorName = target?.constructor?.name;
                // 过滤噪音
                if (!ctorName || ctorName === 'Object' || ctorName === 'Array' || ctorName === 'Function') return ret;

                _recording = true;
                try {
                    // 构造原型链描述
                    const chain = [];
                    let cur = target, depth = 0;
                    while (cur !== null && cur !== undefined && depth < 10) {
                        try {
                            chain.push('[' + depth + '] ' + (cur.constructor?.name || '?'));
                            cur = origRGP(cur);
                            depth++;
                        } catch (_) { break; }
                    }

                    const entry = {
                        op: 'proto',
                        path: 'Reflect → getPrototypeOf',
                        key: 'getPrototypeOf',
                        targetType: ctorName,
                        directProto: ret?.constructor?.name || String(ret),
                        protoChain: chain,
                        type: typeTag(ret),
                        val: shortVal(ret),
                        ts: Date.now(),
                    };
                    _rApply(_push, records, [entry]);

                    _group(
                        '%c proto %c Reflect.getPrototypeOf(…)',
                        'color:#fff;background:#5B3EA8;padding:1px 5px;border-radius:3px;font-weight:bold',
                        'color:#5B3EA8;font-weight:bold'
                    );
                    _log('%c target      ', 'color:#888;font-weight:bold', target);
                    _log('%c targetType  ', 'color:#aaa', ctorName);
                    _log('%c directProto ', 'color:#aaa', entry.directProto);
                    _log('%c protoChain  ', 'color:#aaa', chain);
                    _log('%c result      ', 'color:#888;font-weight:bold', ret);
                    _groupEnd();

                    if (window.__envHookCb) window.__envHookCb(entry);
                } finally {
                    _recording = false;
                }
            } catch (_) {}
            return ret;
        };

        /* ── Reflect.setPrototypeOf ── */
        const origRSP = Reflect.setPrototypeOf;
        Reflect.setPrototypeOf = function (target, proto) {
            if (!_recording) {
                _recording = true;
                try {
                    const entry = {
                        op: 'proto',
                        path: 'Reflect → setPrototypeOf',
                        key: 'setPrototypeOf',
                        targetType: target?.constructor?.name,
                        newProto: proto?.constructor?.name || String(proto),
                        type: typeTag(proto),
                        val: shortVal(proto),
                        ts: Date.now(),
                    };
                    _rApply(_push, records, [entry]);
                    _group('%c proto %c Reflect.setPrototypeOf(…)',
                        'color:#fff;background:#5B3EA8;padding:1px 5px;border-radius:3px;font-weight:bold',
                        'color:#5B3EA8;font-weight:bold');
                    _log('%c target   ', 'color:#888;font-weight:bold', target);
                    _log('%c newProto ', 'color:#aaa', entry.newProto);
                    _groupEnd();
                    if (window.__envHookCb) window.__envHookCb(entry);
                } finally {
                    _recording = false;
                }
            }
            return origRSP(target, proto);
        };

        // Object.setPrototypeOf 和 Object.create 已在 patchObjectStatics 中完整处理，这里不重复注册
    })();

    /* ══════════════════════════════════════════════════
       AudioContext 构造拦截
    ══════════════════════════════════════════════════ */
    (function patchAudioContextCtor() {
        ['AudioContext', 'OfflineAudioContext', 'webkitAudioContext'].forEach(name => {
            const Ctor = window[name];
            if (typeof Ctor !== 'function') return;
            window[name] = new Proxy(Ctor, {
                construct(target, args, newTarget) {
                    const instance = _rConstruct(target, args, newTarget);
                    record('new', 'window', name, args, instance);
                    patchDynamicObject(instance, name + '()');
                    return instance;
                },
                apply(target, thisArg, args) { return _rApply(target, thisArg, args); },
                get(target, key, recv) { return _rGet(target, key, recv); },
            });
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：screen 对象属性
    ══════════════════════════════════════════════════ */
    (function patchScreen() {
        const scr = screen;
        [
            'width',          // number - 屏幕总宽度
            'height',         // number - 屏幕总高度
            'availWidth',     // number - 可用宽度（扣除任务栏）
            'availHeight',    // number - 可用高度
            'availLeft',      // number - 可用区域左偏移
            'availTop',       // number - 可用区域上偏移
            'colorDepth',     // number - 颜色深度（位）
            'pixelDepth',     // number - 像素深度（通常等于 colorDepth）
            'orientation',    // ScreenOrientation 对象
        ].forEach(p => {
            try {
                let d, proto = scr;
                while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                if (!d?.get) return;
                const g = d.get;
                _defProp(scr, p, {
                    get() { const v = _rApply(g, scr, []); record('get', 'window.screen', p, v); return v; },
                    configurable: true,
                });
            } catch (_) {}
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：performance 对象
    ══════════════════════════════════════════════════ */
    (function patchPerformance() {
        const perf = performance;
        // 属性
        [
            'timeOrigin',           // DOMHighResTimeStamp - 页面初始化时间戳
            'navigation',           // PerformanceNavigation (deprecated)
            'timing',               // PerformanceTiming (deprecated)
            'eventCounts',          // EventCounts map
            'interactionCount',     // number
        ].forEach(p => {
            try {
                let d, proto = perf;
                while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                if (!d?.get) return;
                const g = d.get;
                _defProp(perf, p, {
                    get() { const v = _rApply(g, perf, []); record('get', 'window.performance', p, v); return v; },
                    configurable: true,
                });
            } catch (_) {}
        });
        // 方法
        [
            ['now',              '() → DOMHighResTimeStamp'],          // 高精度时间戳（指纹核心！）
            ['getEntries',       '(options?) → PerformanceEntry[]'],   // 所有性能条目
            ['getEntriesByType', '(type) → PerformanceEntry[]'],       // 按类型过滤
            ['getEntriesByName', '(name, type?) → PerformanceEntry[]'],// 按名称过滤
            ['mark',             '(name, options?) → PerformanceMark'],
            ['measure',          '(name, start?, end?) → PerformanceMeasure'],
            ['clearMarks',       '(name?) → void'],
            ['clearMeasures',    '(name?) → void'],
            ['clearResourceTimings', '() → void'],
            ['setResourceTimingBufferSize', '(maxSize) → void'],
            ['toJSON',           '() → object'],
        ].forEach(([m]) => {
            const orig = perf[m];
            if (typeof orig !== 'function') return;
            perf[m] = function (...args) {
                const ret = _rApply(orig, perf, args);
                record('call', 'window.performance', m, args, ret);
                return ret;
            };
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：localStorage / sessionStorage
    ══════════════════════════════════════════════════ */
    (function patchStorage() {
        ['localStorage', 'sessionStorage'].forEach(storeName => {
            try {
                const store = window[storeName];
                if (!store) return;
                const basePath = 'window.' + storeName;
                // 方法
                [
                    ['getItem',     '(key) → string|null'],
                    ['setItem',     '(key, value) → void'],
                    ['removeItem',  '(key) → void'],
                    ['clear',       '() → void'],
                    ['key',         '(index) → string|null'],
                ].forEach(([m]) => {
                    const orig = store[m];
                    if (typeof orig !== 'function') return;
                    store[m] = function (...args) {
                        const ret = _rApply(orig, store, args);
                        record('call', basePath, m, args, ret);
                        return ret;
                    };
                });
                // length
                let d, proto = store;
                while (proto) { d = _ownDesc(proto, 'length'); if (d) break; proto = _getProto(proto); }
                if (d?.get) {
                    const g = d.get;
                    _defProp(store, 'length', {
                        get() { const v = _rApply(g, store, []); record('get', basePath, 'length', v); return v; },
                        configurable: true,
                    });
                }
            } catch (e) { _log('[EnvHook] ✗ ' + storeName, e.message); }
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：indexedDB
    ══════════════════════════════════════════════════ */
    (function patchIndexedDB() {
        try {
            const idb = window.indexedDB;
            if (!idb) return;
            [
                ['open',        '(name, version?) → IDBOpenDBRequest'],
                ['deleteDatabase', '(name) → IDBOpenDBRequest'],
                ['cmp',         '(first, second) → number'],
                ['databases',   '() → Promise<IDBDatabaseInfo[]>'],
            ].forEach(([m]) => {
                const orig = idb[m];
                if (typeof orig !== 'function') return;
                idb[m] = function (...args) {
                    const ret = _rApply(orig, idb, args);
                    record('call', 'window.indexedDB', m, args, ret);
                    return ret;
                };
            });
        } catch (_) {}
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：WebSocket
    ══════════════════════════════════════════════════ */
    (function patchWebSocket() {
        const OrigWS = window.WebSocket;
        if (typeof OrigWS !== 'function') return;
        window.WebSocket = new Proxy(OrigWS, {
            construct(target, args, newTarget) {
                // new WebSocket(url: string, protocols?: string|string[])
                const instance = _rConstruct(target, args, newTarget);
                record('new', 'window', 'WebSocket', args, instance);
                // 拦截实例方法
                [
                    ['send',  '(data: string|Blob|ArrayBuffer|ArrayBufferView) → void'],
                    ['close', '(code?: number, reason?: string) → void'],
                ].forEach(([m]) => {
                    const orig = instance[m];
                    if (typeof orig !== 'function') return;
                    instance[m] = function (...a) {
                        const ret = _rApply(orig, instance, a);
                        record('call', 'WebSocket', m, a, ret);
                        return ret;
                    };
                });
                // 拦截实例属性
                [
                    'url', 'readyState', 'bufferedAmount',
                    'extensions', 'protocol', 'binaryType',
                ].forEach(p => {
                    try {
                        let d, proto = instance;
                        while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                        if (!d?.get) return;
                        const g = d.get;
                        _defProp(instance, p, {
                            get() { const v = _rApply(g, instance, []); record('get', 'WebSocket', p, v); return v; },
                            set: d.set ? function (v) { record('set', 'WebSocket', p, v); _rApply(d.set, instance, [v]); } : undefined,
                            configurable: true,
                        });
                    } catch (_) {}
                });
                return instance;
            },
            get(target, key, recv) { return _rGet(target, key, recv); },
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：Worker / SharedWorker
    ══════════════════════════════════════════════════ */
    (function patchWorkers() {
        ['Worker', 'SharedWorker'].forEach(name => {
            const Ctor = window[name];
            if (typeof Ctor !== 'function') return;
            window[name] = new Proxy(Ctor, {
                construct(target, args, newTarget) {
                    // new Worker(scriptURL: string|URL, options?: WorkerOptions)
                    // new SharedWorker(scriptURL: string|URL, options?: WorkerOptions|string)
                    const instance = _rConstruct(target, args, newTarget);
                    record('new', 'window', name, args, instance);
                    // Worker: postMessage(message, transfer?), terminate()
                    // SharedWorker: 通过 .port 访问
                    ['postMessage', 'terminate'].forEach(m => {
                        const orig = instance[m];
                        if (typeof orig !== 'function') return;
                        instance[m] = function (...a) {
                            const ret = _rApply(orig, instance, a);
                            record('call', name, m, a, ret);
                            return ret;
                        };
                    });
                    return instance;
                },
                get(target, key, recv) { return _rGet(target, key, recv); },
            });
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：crypto / SubtleCrypto
    ══════════════════════════════════════════════════ */
    (function patchCrypto() {
        try {
            const cry = window.crypto;
            if (!cry) return;

            // crypto.getRandomValues(typedArray) → typedArray  ← 高频指纹
            const origGRV = cry.getRandomValues;
            if (typeof origGRV === 'function') {
                cry.getRandomValues = function (typedArray) {
                    const ret = _rApply(origGRV, cry, [typedArray]);
                    record('call', 'window.crypto', 'getRandomValues',
                        [typedArray?.constructor?.name + '[' + typedArray?.length + ']'], ret);
                    return ret;
                };
            }

            // crypto.randomUUID() → string (UUID v4)
            const origRU = cry.randomUUID;
            if (typeof origRU === 'function') {
                cry.randomUUID = function () {
                    const ret = _rApply(origRU, cry, []);
                    record('call', 'window.crypto', 'randomUUID', [], ret);
                    return ret;
                };
            }

            // SubtleCrypto
            const subtle = cry.subtle;
            if (subtle) {
                [
                    // (algorithm, key, data) → Promise<ArrayBuffer>
                    ['encrypt',    '(algorithm, key, data) → Promise<ArrayBuffer>'],
                    ['decrypt',    '(algorithm, key, data) → Promise<ArrayBuffer>'],
                    // (algorithm, key, data) → Promise<ArrayBuffer>
                    ['sign',       '(algorithm, key, data) → Promise<ArrayBuffer>'],
                    // (algorithm, key, signature, data) → Promise<boolean>
                    ['verify',     '(algorithm, key, signature, data) → Promise<boolean>'],
                    // (algorithm, data) → Promise<ArrayBuffer>
                    ['digest',     '(algorithm, data) → Promise<ArrayBuffer>'],
                    // (algorithm, extractable, keyUsages) → Promise<CryptoKey>
                    ['generateKey','(algorithm, extractable, keyUsages) → Promise<CryptoKey|CryptoKeyPair>'],
                    // (format, keyData, algorithm, extractable, keyUsages) → Promise<CryptoKey>
                    ['importKey',  '(format, keyData, algorithm, extractable, keyUsages) → Promise<CryptoKey>'],
                    // (format, key) → Promise<ArrayBuffer>
                    ['exportKey',  '(format, key) → Promise<ArrayBuffer|JsonWebKey>'],
                    // (format, wrappingKey, key, wrapAlgorithm) → Promise<ArrayBuffer>
                    ['wrapKey',    '(format, key, wrappingKey, wrapAlgorithm) → Promise<ArrayBuffer>'],
                    ['unwrapKey',  '(format, wrappedKey, unwrappingKey, unwrapAlgorithm, unwrappedKeyAlgorithm, extractable, keyUsages) → Promise<CryptoKey>'],
                    // (algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) → Promise<CryptoKey>
                    ['deriveKey',  '(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) → Promise<CryptoKey>'],
                    // (algorithm, baseKey, length) → Promise<ArrayBuffer>
                    ['deriveBits', '(algorithm, baseKey, length) → Promise<ArrayBuffer>'],
                ].forEach(([m]) => {
                    const orig = subtle[m];
                    if (typeof orig !== 'function') return;
                    subtle[m] = function (...args) {
                        const ret = _rApply(orig, subtle, args);
                        record('call', 'window.crypto.subtle', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：Intl 国际化对象（时区 / 语言 / 日历指纹）
    ══════════════════════════════════════════════════ */
    (function patchIntl() {
        const intlClasses = [
            // [className, constructorArgs注释]
            ['DateTimeFormat',  '(locales?, options?) → Intl.DateTimeFormat'],
            ['NumberFormat',    '(locales?, options?) → Intl.NumberFormat'],
            ['Collator',        '(locales?, options?) → Intl.Collator'],
            ['RelativeTimeFormat', '(locales?, options?) → Intl.RelativeTimeFormat'],
            ['PluralRules',     '(locales?, options?) → Intl.PluralRules'],
            ['ListFormat',      '(locales?, options?) → Intl.ListFormat'],
            ['Segmenter',       '(locales?, options?) → Intl.Segmenter'],
            ['DisplayNames',    '(locales, options) → Intl.DisplayNames'],
        ];

        intlClasses.forEach(([name]) => {
            const Ctor = Intl[name];
            if (typeof Ctor !== 'function') return;
            Intl[name] = new Proxy(Ctor, {
                construct(target, args, newTarget) {
                    const instance = _rConstruct(target, args, newTarget);
                    record('new', 'Intl', name, args, instance);
                    // 拦截实例方法（format, resolvedOptions 等均为指纹面）
                    ['format', 'formatToParts', 'formatRange', 'formatRangeToParts',
                     'compare', 'select', 'resolvedOptions', 'segment'].forEach(m => {
                        const orig = instance[m];
                        if (typeof orig !== 'function') return;
                        instance[m] = function (...a) {
                            const ret = _rApply(orig, instance, a);
                            record('call', 'Intl.' + name, m, a, ret);
                            return ret;
                        };
                    });
                    return instance;
                },
                apply(target, thisArg, args) { return _rApply(target, thisArg, args); },
                get(target, key, recv) { return _rGet(target, key, recv); },
            });
        });

        // Intl 静态方法
        ['getCanonicalLocales', 'supportedValuesOf'].forEach(m => {
            const orig = Intl[m];
            if (typeof orig !== 'function') return;
            Intl[m] = function (...args) {
                const ret = _rApply(orig, Intl, args);
                record('call', 'Intl', m, args, ret);
                return ret;
            };
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：navigator 方法（原版只有属性）
    ══════════════════════════════════════════════════ */
    (function patchNavigatorFull() {
        const nav = navigator;

        // ── 属性（完整版，覆盖原版未捕获项）──
        [
            'userAgent',            // string - UA 字符串
            'userAgentData',        // NavigatorUAData (UA-CH 接口)
            'appVersion',           // string (deprecated)
            'appName',              // string (deprecated, always 'Netscape')
            'appCodeName',          // string (deprecated, always 'Mozilla')
            'platform',             // string - 平台标识（指纹核心）
            'vendor',               // string - 供应商（'Google Inc.' etc.）
            'vendorSub',            // string (deprecated, always '')
            'product',              // string (deprecated, always 'Gecko')
            'productSub',           // string ('20030107' etc.)
            'language',             // string - 主语言
            'languages',            // string[] - 语言列表（顺序即指纹）
            'onLine',               // boolean
            'cookieEnabled',        // boolean
            'javaEnabled',          // function → boolean (deprecated)
            'hardwareConcurrency',  // number - 逻辑 CPU 核数
            'deviceMemory',         // number - RAM（GB，取整到最近 2 次方）
            'maxTouchPoints',       // number
            'doNotTrack',           // string|null
            'globalPrivacyControl', // boolean|undefined
            'plugins',              // PluginArray
            'mimeTypes',            // MimeTypeArray
            'pdfViewerEnabled',     // boolean
            'webdriver',            // boolean - 自动化标记（反爬虫重点！）
            'connection',           // NetworkInformation
            'permissions',          // Permissions
            'mediaDevices',         // MediaDevices
            'mediaCapabilities',    // MediaCapabilities
            'mediaSession',         // MediaSession
            'credentials',          // CredentialsContainer
            'geolocation',          // Geolocation
            'clipboard',            // Clipboard
            'share',                // function (deprecated)
            'canShare',             // function
            'storage',              // StorageManager
            'locks',                // LockManager
            'usb',                  // USB
            'bluetooth',            // Bluetooth
            'serial',               // Serial
            'hid',                  // HID
            'xr',                   // XR (WebXR)
            'wakeLock',             // WakeLock
            'userActivation',       // UserActivation
            'keyboard',             // Keyboard
            'gpu',                  // GPU (WebGPU)
            'ink',                  // Ink
        ].forEach(p => {
            try {
                let d, proto = nav;
                while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                if (!d?.get && typeof nav[p] === 'undefined') return;
                if (d?.get) {
                    const g = d.get;
                    _defProp(nav, p, {
                        get() { const v = _rApply(g, nav, []); record('get', 'window.navigator', p, v); return v; },
                        configurable: true,
                    });
                }
            } catch (_) {}
        });

        // ── 方法 ──
        [
            ['sendBeacon',          '(url, data?) → boolean'],
            ['vibrate',             '(pattern: number|number[]) → boolean'],
            ['requestMediaKeySystemAccess', '(keySystem, configs) → Promise<MediaKeySystemAccess>'],
            ['registerProtocolHandler', '(scheme, url) → void'],
            ['unregisterProtocolHandler', '(scheme, url) → void'],
            ['getGamepads',         '() → Gamepad[]'],
            ['getBattery',          '() → Promise<BatteryManager>'],  // 电池指纹！
            ['javaEnabled',         '() → boolean (deprecated)'],
            ['taintEnabled',        '() → boolean (deprecated)'],
        ].forEach(([m]) => {
            const orig = nav[m];
            if (typeof orig !== 'function') return;
            nav[m] = function (...args) {
                const ret = _rApply(orig, nav, args);
                record('call', 'window.navigator', m, args, ret);
                return ret;
            };
        });

        // ── navigator.userAgentData 方法（UA-CH / Sec-CH-UA 接口）──
        try {
            const uaData = nav.userAgentData;
            if (uaData) {
                // getHighEntropyValues(hints: string[]) → Promise<UADataValues>
                const origGHEV = uaData.getHighEntropyValues;
                if (typeof origGHEV === 'function') {
                    uaData.getHighEntropyValues = function (hints) {
                        const ret = _rApply(origGHEV, uaData, [hints]);
                        record('call', 'navigator.userAgentData', 'getHighEntropyValues', [hints], ret);
                        return ret;
                    };
                }
                // toJSON() → object
                const origToJSON = uaData.toJSON;
                if (typeof origToJSON === 'function') {
                    uaData.toJSON = function () {
                        const ret = _rApply(origToJSON, uaData, []);
                        record('call', 'navigator.userAgentData', 'toJSON', [], ret);
                        return ret;
                    };
                }
                ['brands', 'mobile', 'platform'].forEach(p => {
                    try {
                        let d, proto = uaData;
                        while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                        if (!d?.get) return;
                        const g = d.get;
                        _defProp(uaData, p, {
                            get() { const v = _rApply(g, uaData, []); record('get', 'navigator.userAgentData', p, v); return v; },
                            configurable: true,
                        });
                    } catch (_) {}
                });
            }
        } catch (_) {}

        // ── navigator.mediaDevices ──
        try {
            const md = nav.mediaDevices;
            if (md) {
                [
                    ['enumerateDevices', '() → Promise<MediaDeviceInfo[]>'],  // 麦克风/摄像头列表指纹
                    ['getUserMedia',     '(constraints) → Promise<MediaStream>'],
                    ['getDisplayMedia',  '(options?) → Promise<MediaStream>'],
                    ['getSupportedConstraints', '() → MediaTrackSupportedConstraints'],
                    ['selectAudioOutput','(options?) → Promise<MediaDeviceInfo>'],
                ].forEach(([m]) => {
                    const orig = md[m];
                    if (typeof orig !== 'function') return;
                    md[m] = function (...args) {
                        const ret = _rApply(orig, md, args);
                        record('call', 'navigator.mediaDevices', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.permissions ──
        try {
            const perms = nav.permissions;
            if (perms) {
                // query(descriptor: PermissionDescriptor) → Promise<PermissionStatus>
                const origQuery = perms.query;
                if (typeof origQuery === 'function') {
                    perms.query = function (descriptor) {
                        const ret = _rApply(origQuery, perms, [descriptor]);
                        record('call', 'navigator.permissions', 'query', [descriptor], ret);
                        return ret;
                    };
                }
                // revoke(descriptor) (deprecated)
                const origRevoke = perms.revoke;
                if (typeof origRevoke === 'function') {
                    perms.revoke = function (descriptor) {
                        const ret = _rApply(origRevoke, perms, [descriptor]);
                        record('call', 'navigator.permissions', 'revoke', [descriptor], ret);
                        return ret;
                    };
                }
            }
        } catch (_) {}

        // ── navigator.clipboard ──
        try {
            const cb = nav.clipboard;
            if (cb) {
                [
                    ['readText',   '() → Promise<string>'],
                    ['writeText',  '(data: string) → Promise<void>'],
                    ['read',       '() → Promise<ClipboardItems>'],
                    ['write',      '(data: ClipboardItems) → Promise<void>'],
                ].forEach(([m]) => {
                    const orig = cb[m];
                    if (typeof orig !== 'function') return;
                    cb[m] = function (...args) {
                        const ret = _rApply(orig, cb, args);
                        record('call', 'navigator.clipboard', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.geolocation ──
        try {
            const geo = nav.geolocation;
            if (geo) {
                [
                    ['getCurrentPosition', '(success, error?, options?) → void'],
                    ['watchPosition',      '(success, error?, options?) → number'],
                    ['clearWatch',         '(id: number) → void'],
                ].forEach(([m]) => {
                    const orig = geo[m];
                    if (typeof orig !== 'function') return;
                    geo[m] = function (...args) {
                        const ret = _rApply(orig, geo, args);
                        record('call', 'navigator.geolocation', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.connection (NetworkInformation) ──
        try {
            const conn = nav.connection;
            if (conn) {
                ['effectiveType', 'downlink', 'downlinkMax', 'rtt', 'saveData', 'type'].forEach(p => {
                    try {
                        let d, proto = conn;
                        while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                        if (!d?.get) return;
                        const g = d.get;
                        _defProp(conn, p, {
                            get() { const v = _rApply(g, conn, []); record('get', 'navigator.connection', p, v); return v; },
                            configurable: true,
                        });
                    } catch (_) {}
                });
            }
        } catch (_) {}

        // ── navigator.webkitTemporaryStorage / webkitPersistentStorage ──
        // Chrome 私有 API，被部分指纹库用于探测配额 / 浏览器类型
        ['webkitTemporaryStorage', 'webkitPersistentStorage'].forEach(storageProp => {
            try {
                // 先尝试从 navigator 自身或原型链上找 getter
                let d, proto = nav;
                while (proto) { d = _ownDesc(proto, storageProp); if (d) break; proto = _getProto(proto); }

                const getStore = () => {
                    if (d?.get) return _rApply(d.get, nav, []);
                    return nav[storageProp];   // fallback 直接读
                };

                // 覆盖属性 getter
                _defProp(nav, storageProp, {
                    get() {
                        const store = getStore();
                        record('get', 'window.navigator', storageProp, store);
                        if (!store) return store;
                        // 拦截 DeprecatedStorageQuota 方法
                        // queryUsageAndQuota(successCb, errorCb?) → void
                        // requestQuota(newQuotaInBytes, successCb?, errorCb?) → void
                        ['queryUsageAndQuota', 'requestQuota'].forEach(m => {
                            const orig = store[m];
                            if (typeof orig !== 'function' || store[`__hooked_${m}`]) return;
                            store[`__hooked_${m}`] = true;
                            store[m] = function (...args) {
                                const ret = _rApply(orig, store, args);
                                record('call', `navigator.${storageProp}`, m, args, ret);
                                return ret;
                            };
                        });
                        return store;
                    },
                    configurable: true,
                });
            } catch (_) {}
        });

        // ── navigator.storage (StorageManager，标准版) ──
        try {
            const sm = nav.storage;
            if (sm) {
                [
                    ['estimate',   '() → Promise<StorageEstimate>'],   // { usage, quota }
                    ['persist',    '() → Promise<boolean>'],
                    ['persisted',  '() → Promise<boolean>'],
                    ['getDirectory','() → Promise<FileSystemDirectoryHandle>'],
                ].forEach(([m]) => {
                    const orig = sm[m];
                    if (typeof orig !== 'function') return;
                    sm[m] = function (...args) {
                        const ret = _rApply(orig, sm, args);
                        record('call', 'navigator.storage', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.locks (LockManager) ──
        try {
            const lm = nav.locks;
            if (lm) {
                [
                    ['request', '(name, options?, callback) → Promise<any>'],
                    ['query',   '() → Promise<LockManagerSnapshot>'],
                ].forEach(([m]) => {
                    const orig = lm[m];
                    if (typeof orig !== 'function') return;
                    lm[m] = function (...args) {
                        const ret = _rApply(orig, lm, args);
                        record('call', 'navigator.locks', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.usb (WebUSB) ──
        try {
            const usb = nav.usb;
            if (usb) {
                [
                    ['getDevices',      '() → Promise<USBDevice[]>'],
                    ['requestDevice',   '(options: USBDeviceRequestOptions) → Promise<USBDevice>'],
                ].forEach(([m]) => {
                    const orig = usb[m];
                    if (typeof orig !== 'function') return;
                    usb[m] = function (...args) {
                        const ret = _rApply(orig, usb, args);
                        record('call', 'navigator.usb', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.bluetooth ──
        try {
            const bt = nav.bluetooth;
            if (bt) {
                [
                    ['getAvailability',   '() → Promise<boolean>'],
                    ['getDevices',        '() → Promise<BluetoothDevice[]>'],
                    ['requestDevice',     '(options?) → Promise<BluetoothDevice>'],
                    ['requestLEScan',     '(options?) → Promise<BluetoothLEScan>'],
                ].forEach(([m]) => {
                    const orig = bt[m];
                    if (typeof orig !== 'function') return;
                    bt[m] = function (...args) {
                        const ret = _rApply(orig, bt, args);
                        record('call', 'navigator.bluetooth', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.xr (WebXR) ──
        try {
            const xr = nav.xr;
            if (xr) {
                [
                    ['isSessionSupported', '(mode: XRSessionMode) → Promise<boolean>'],
                    ['requestSession',     '(mode, options?) → Promise<XRSession>'],
                ].forEach(([m]) => {
                    const orig = xr[m];
                    if (typeof orig !== 'function') return;
                    xr[m] = function (...args) {
                        const ret = _rApply(orig, xr, args);
                        record('call', 'navigator.xr', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}

        // ── navigator.gpu (WebGPU adapter 入口) ──
        try {
            const gpu = nav.gpu;
            if (gpu) {
                // requestAdapter(options?) → Promise<GPUAdapter|null>
                const origRA = gpu.requestAdapter;
                if (typeof origRA === 'function') {
                    gpu.requestAdapter = function (options) {
                        const ret = _rApply(origRA, gpu, [options]);
                        record('call', 'navigator.gpu', 'requestAdapter', [options], ret);
                        return ret;
                    };
                }
                // getPreferredCanvasFormat() → GPUTextureFormat
                const origGPCF = gpu.getPreferredCanvasFormat;
                if (typeof origGPCF === 'function') {
                    gpu.getPreferredCanvasFormat = function () {
                        const ret = _rApply(origGPCF, gpu, []);
                        record('call', 'navigator.gpu', 'getPreferredCanvasFormat', [], ret);
                        return ret;
                    };
                }
                // wgslLanguageFeatures (属性)
                ['wgslLanguageFeatures'].forEach(p => {
                    try {
                        let d, proto = gpu;
                        while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                        if (!d?.get) return;
                        const g = d.get;
                        _defProp(gpu, p, {
                            get() { const v = _rApply(g, gpu, []); record('get', 'navigator.gpu', p, v); return v; },
                            configurable: true,
                        });
                    } catch (_) {}
                });
            }
        } catch (_) {}

        // ── navigator.mediaCapabilities ──
        try {
            const mc = nav.mediaCapabilities;
            if (mc) {
                [
                    ['decodingInfo',  '(config: MediaDecodingConfiguration) → Promise<MediaCapabilitiesDecodingInfo>'],
                    ['encodingInfo',  '(config: MediaEncodingConfiguration) → Promise<MediaCapabilitiesInfo>'],
                ].forEach(([m]) => {
                    const orig = mc[m];
                    if (typeof orig !== 'function') return;
                    mc[m] = function (...args) {
                        const ret = _rApply(orig, mc, args);
                        record('call', 'navigator.mediaCapabilities', m, args, ret);
                        return ret;
                    };
                });
            }
        } catch (_) {}
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：window 级别补充属性
    ══════════════════════════════════════════════════ */
    (function patchWindowExtra() {
        // visualViewport（移动端 / 缩放场景指纹）
        try {
            const vvp = window.visualViewport;
            if (vvp) {
                ['width', 'height', 'offsetLeft', 'offsetTop',
                 'pageLeft', 'pageTop', 'scale'].forEach(p => {
                    try {
                        let d, proto = vvp;
                        while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                        if (!d?.get) return;
                        const g = d.get;
                        _defProp(vvp, p, {
                            get() { const v = _rApply(g, vvp, []); record('get', 'window.visualViewport', p, v); return v; },
                            configurable: true,
                        });
                    } catch (_) {}
                });
            }
        } catch (_) {}

        // matchMedia  (prefers-color-scheme / prefers-reduced-motion 等查询)
        try {
            const origMM = window.matchMedia;
            if (typeof origMM === 'function') {
                window.matchMedia = function (query) {
                    // matchMedia(query: string) → MediaQueryList
                    const ret = _rApply(origMM, window, [query]);
                    record('call', 'window', 'matchMedia', [query], ret);
                    return ret;
                };
            }
        } catch (_) {}

        // getComputedStyle  (字体、样式探测)
        try {
            const origGCS = window.getComputedStyle;
            if (typeof origGCS === 'function') {
                window.getComputedStyle = function (elt, pseudoElt) {
                    // (element: Element, pseudoElement?: string|null) → CSSStyleDeclaration
                    const ret = _rApply(origGCS, window, [elt, pseudoElt]);
                    record('call', 'window', 'getComputedStyle', [elt, pseudoElt], ret);
                    return ret;
                };
            }
        } catch (_) {}

        // requestAnimationFrame / cancelAnimationFrame
        try {
            const origRAF = window.requestAnimationFrame;
            if (typeof origRAF === 'function') {
                window.requestAnimationFrame = function (callback) {
                    const ret = _rApply(origRAF, window, [callback]);
                    record('call', 'window', 'requestAnimationFrame', ['ƒ ' + (callback?.name || 'cb')], ret);
                    return ret;
                };
            }
            const origCAF = window.cancelAnimationFrame;
            if (typeof origCAF === 'function') {
                window.cancelAnimationFrame = function (id) {
                    record('call', 'window', 'cancelAnimationFrame', [id], undefined);
                    return _rApply(origCAF, window, [id]);
                };
            }
        } catch (_) {}

        // requestIdleCallback
        try {
            const origRIC = window.requestIdleCallback;
            if (typeof origRIC === 'function') {
                window.requestIdleCallback = function (callback, options) {
                    // (callback: IdleRequestCallback, options?: IdleRequestOptions) → number
                    const ret = _rApply(origRIC, window, [callback, options]);
                    record('call', 'window', 'requestIdleCallback', ['ƒ ' + (callback?.name || 'cb'), options], ret);
                    return ret;
                };
            }
        } catch (_) {}

        // postMessage
        try {
            const origPM = window.postMessage;
            if (typeof origPM === 'function') {
                window.postMessage = function (message, targetOrigin, transfer) {
                    // (message, targetOrigin: string|'*', transfer?: Transferable[]) → void
                    record('call', 'window', 'postMessage', [message, targetOrigin], undefined);
                    return _rApply(origPM, window, [message, targetOrigin, transfer]);
                };
            }
        } catch (_) {}
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：CSS / CSSStyleDeclaration 探测
         getPropertyValue / setProperty 是字体回退 / 样式探测核心
    ══════════════════════════════════════════════════ */
    (function patchCSS() {
        // CSSStyleDeclaration.prototype
        const CSSProto = CSSStyleDeclaration?.prototype;
        if (!CSSProto) return;
        [
            ['getPropertyValue',  '(property: string) → string'],
            ['setProperty',       '(property, value, priority?) → void'],
            ['removeProperty',    '(property: string) → string'],
            ['getPropertyPriority', '(property: string) → string'],
            ['item',              '(index: number) → string'],
        ].forEach(([m]) => {
            const orig = CSSProto[m];
            if (typeof orig !== 'function') return;
            CSSProto[m] = function (...args) {
                const ret = _rApply(orig, this, args);
                record('call', 'CSSStyleDeclaration', m, args, ret);
                return ret;
            };
        });

        // CSS 静态方法（CSS.supports / CSS.escape）
        if (typeof CSS !== 'undefined') {
            ['supports', 'escape', 'px', 'em', 'rem', 'vh', 'vw'].forEach(m => {
                const orig = CSS[m];
                if (typeof orig !== 'function') return;
                CSS[m] = function (...args) {
                    const ret = _rApply(orig, CSS, args);
                    record('call', 'CSS', m, args, ret);
                    return ret;
                };
            });
        }
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：Notification / Web Push 探测
    ══════════════════════════════════════════════════ */
    (function patchNotification() {
        const Notif = window.Notification;
        if (typeof Notif !== 'function') return;

        // Notification.requestPermission() → Promise<NotificationPermission>
        const origRP = Notif.requestPermission;
        if (typeof origRP === 'function') {
            Notif.requestPermission = function (callback) {
                const ret = _rApply(origRP, Notif, [callback]);
                record('call', 'Notification', 'requestPermission', [callback ? 'ƒcb' : undefined], ret);
                return ret;
            };
        }

        // Notification.permission (getter)
        try {
            let d, proto = Notif;
            while (proto) { d = _ownDesc(proto, 'permission'); if (d) break; proto = _getProto(proto); }
            if (d?.get) {
                const g = d.get;
                _defProp(Notif, 'permission', {
                    get() { const v = _rApply(g, Notif, []); record('get', 'Notification', 'permission', v); return v; },
                    configurable: true,
                });
            }
        } catch (_) {}

        // new Notification(title, options?)
        window.Notification = new Proxy(Notif, {
            construct(target, args, newTarget) {
                const instance = _rConstruct(target, args, newTarget);
                record('new', 'window', 'Notification', args, instance);
                return instance;
            },
            get(target, key, recv) { return _rGet(target, key, recv); },
        });
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：Pointer Lock / Fullscreen / WakeLock 接口
    ══════════════════════════════════════════════════ */
    (function patchPointerAndFullscreen() {
        // Element.prototype 扩展（请求指针锁 / 全屏）
        const EP = Element.prototype;
        ['requestPointerLock', 'requestFullscreen', 'webkitRequestFullscreen',
         'mozRequestFullScreen', 'msRequestFullscreen'].forEach(m => {
            const orig = EP[m];
            if (typeof orig !== 'function') return;
            EP[m] = function (...args) {
                const ret = _rApply(orig, this, args);
                record('call', 'Element', m, args, ret);
                return ret;
            };
        });

        // document 退出指针锁 / 全屏
        ['exitPointerLock', 'exitFullscreen', 'webkitExitFullscreen',
         'mozCancelFullScreen', 'msExitFullscreen'].forEach(m => {
            const orig = document[m];
            if (typeof orig !== 'function') return;
            document[m] = function (...args) {
                const ret = _rApply(orig, document, args);
                record('call', 'document', m, args, ret);
                return ret;
            };
        });

        // WakeLock API
        try {
            const wl = navigator.wakeLock;
            if (wl) {
                // wakeLock.request(type: 'screen') → Promise<WakeLockSentinel>
                const origReq = wl.request;
                if (typeof origReq === 'function') {
                    wl.request = function (type) {
                        const ret = _rApply(origReq, wl, [type]);
                        record('call', 'navigator.wakeLock', 'request', [type], ret);
                        return ret;
                    };
                }
            }
        } catch (_) {}
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：History / Location API
    ══════════════════════════════════════════════════ */
    (function patchHistoryLocation() {
        // History
        const hist = window.history;
        if (hist) {
            [
                ['pushState',    '(state, unused, url?) → void'],
                ['replaceState', '(state, unused, url?) → void'],
                ['go',           '(delta?) → void'],
                ['back',         '() → void'],
                ['forward',      '() → void'],
            ].forEach(([m]) => {
                const orig = hist[m];
                if (typeof orig !== 'function') return;
                hist[m] = function (...args) {
                    const ret = _rApply(orig, hist, args);
                    record('call', 'window.history', m, args, ret);
                    return ret;
                };
            });
            ['length', 'scrollRestoration', 'state'].forEach(p => {
                try {
                    let d, proto = hist;
                    while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                    if (!d?.get) return;
                    const g = d.get;
                    _defProp(hist, p, {
                        get() { const v = _rApply(g, hist, []); record('get', 'window.history', p, v); return v; },
                        set: d.set ? function (v) { record('set', 'window.history', p, v); _rApply(d.set, hist, [v]); } : undefined,
                        configurable: true,
                    });
                } catch (_) {}
            });
        }

        // Location
        const loc = window.location;
        if (loc) {
            [
                ['assign',   '(url: string) → void'],
                ['replace',  '(url: string) → void'],
                ['reload',   '(forceReload?: boolean) → void'],
                ['toString', '() → string'],
            ].forEach(([m]) => {
                try {
                    const orig = loc[m];
                    if (typeof orig !== 'function') return;
                    loc[m] = function (...args) {
                        const ret = _rApply(orig, loc, args);
                        record('call', 'window.location', m, args, ret);
                        return ret;
                    };
                } catch (_) {}
            });
            ['href', 'protocol', 'host', 'hostname', 'port', 'pathname',
             'search', 'hash', 'origin'].forEach(p => {
                try {
                    let d, proto = loc;
                    while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                    if (!d?.get) return;
                    const g = d.get;
                    _defProp(loc, p, {
                        get() { const v = _rApply(g, loc, []); record('get', 'window.location', p, v); return v; },
                        set: d.set ? function (v) { record('set', 'window.location', p, v); _rApply(d.set, loc, [v]); } : undefined,
                        configurable: true,
                    });
                } catch (_) {}
            });
        }
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：fetch / XHR / Beacon / EventSource 完整参数
    ══════════════════════════════════════════════════ */
    (function patchNetwork() {
        // fetch(input: RequestInfo|URL, init?: RequestInit) → Promise<Response>
        const origFetch = window.fetch;
        if (typeof origFetch === 'function') {
            window.fetch = function (input, init) {
                record('call', 'window', 'fetch', [input, init], undefined);
                return _rApply(origFetch, window, [input, init]);
            };
        }

        // XMLHttpRequest
        const XHRP = XMLHttpRequest.prototype;
        [
            ['open',               '(method, url, async?, user?, password?) → void'],
            ['send',               '(body?: Document|XMLHttpRequestBodyInit|null) → void'],
            ['abort',              '() → void'],
            ['setRequestHeader',   '(name: string, value: string) → void'],
            ['getResponseHeader',  '(name: string) → string|null'],
            ['getAllResponseHeaders', '() → string'],
            ['overrideMimeType',   '(mime: string) → void'],
        ].forEach(([m]) => {
            const orig = XHRP[m];
            if (typeof orig !== 'function') return;
            XHRP[m] = function (...args) {
                const ret = _rApply(orig, this, args);
                record('call', 'XMLHttpRequest', m, args, ret);
                return ret;
            };
        });

        // XHR 属性
        ['readyState', 'status', 'statusText', 'responseURL',
         'responseType', 'response', 'responseText', 'responseXML',
         'timeout', 'withCredentials', 'upload'].forEach(p => {
            try {
                let d, proto = XHRP;
                while (proto) { d = _ownDesc(proto, p); if (d) break; proto = _getProto(proto); }
                if (!d?.get) return;
                const g = d.get;
                _defProp(XHRP, p, {
                    get() { const v = _rApply(g, this, []); record('get', 'XMLHttpRequest', p, v); return v; },
                    set: d.set ? function (v) { record('set', 'XMLHttpRequest', p, v); _rApply(d.set, this, [v]); } : undefined,
                    configurable: true,
                });
            } catch (_) {}
        });

        // sendBeacon(url, data?) → boolean
        try {
            const origSB = navigator.sendBeacon;
            if (typeof origSB === 'function') {
                navigator.sendBeacon = function (url, data) {
                    const ret = _rApply(origSB, navigator, [url, data]);
                    record('call', 'navigator', 'sendBeacon', [url, data], ret);
                    return ret;
                };
            }
        } catch (_) {}

        // EventSource
        try {
            const OrigES = window.EventSource;
            if (typeof OrigES === 'function') {
                window.EventSource = new Proxy(OrigES, {
                    construct(target, args, newTarget) {
                        // new EventSource(url: string, options?: EventSourceInit)
                        const instance = _rConstruct(target, args, newTarget);
                        record('new', 'window', 'EventSource', args, instance);
                        ['close'].forEach(m => {
                            const orig = instance[m];
                            if (typeof orig !== 'function') return;
                            instance[m] = function (...a) {
                                record('call', 'EventSource', m, a, undefined);
                                return _rApply(orig, instance, a);
                            };
                        });
                        return instance;
                    },
                    get(target, key, recv) { return _rGet(target, key, recv); },
                });
            }
        } catch (_) {}
    })();

    /* ══════════════════════════════════════════════════
       ★ 新增：MutationObserver / ResizeObserver / IntersectionObserver
         这几个接口常被指纹库用于检测 DOM 结构变化
    ══════════════════════════════════════════════════ */
    (function patchObservers() {
        ['MutationObserver', 'ResizeObserver', 'IntersectionObserver',
         'PerformanceObserver'].forEach(name => {
            const Ctor = window[name];
            if (typeof Ctor !== 'function') return;
            window[name] = new Proxy(Ctor, {
                construct(target, args, newTarget) {
                    // new XxxObserver(callback) → XxxObserver
                    const instance = _rConstruct(target, args, newTarget);
                    record('new', 'window', name, ['ƒ ' + (args[0]?.name || 'cb')], instance);
                    ['observe', 'unobserve', 'disconnect', 'takeRecords'].forEach(m => {
                        const orig = instance[m];
                        if (typeof orig !== 'function') return;
                        instance[m] = function (...a) {
                            const ret = _rApply(orig, instance, a);
                            record('call', name, m, a, ret);
                            return ret;
                        };
                    });
                    return instance;
                },
                get(target, key, recv) { return _rGet(target, key, recv); },
            });
        });
    })();

    /* ══════════════════════════════════════════════════
       Error.stack 读取检测
    ══════════════════════════════════════════════════ */
    const _OrigError = Error;

    (function patchErrorStack() {
        let stackDesc, _p = _OrigError.prototype;
        while (_p) { stackDesc = _ownDesc(_p, 'stack'); if (stackDesc) break; _p = _getProto(_p); }
        if (!stackDesc || !stackDesc.get) return;
        const origStackGetter = stackDesc.get;
        _defProp(_OrigError.prototype, 'stack', {
            get() {
                const stackVal = _rApply(origStackGetter, this, []);
                if (_recording) return stackVal;
                _recording = true;
                try {
                    const callerStack = (() => {
                        try {
                            const e = new _OrigError();
                            const raw = _rApply(origStackGetter, e, []) || '';
                            return raw.split('\n').slice(3)
                                .filter(l => l.trim() && !l.includes('patchErrorStack') && !l.includes('envHook'))
                                .slice(0, 8).map(l => l.trim());
                        } catch (_) { return []; }
                    })();
                    if (callerStack.length > 0) {
                        const entry = { op: 'stackRead', path: 'Error.prototype → stack', key: 'stack', type: 'string', val: shortVal(stackVal), callerStack, ts: Date.now() };
                        _rApply(_push, records, [entry]);
                        _group('%c stackRead %c Error.prototype → stack  %c← 目标代码在读取调用堆栈！',
                            'color:#fff;background:#B8000A;padding:2px 6px;border-radius:3px;font-weight:bold',
                            'color:#B8000A;font-weight:bold', 'color:#B8000A');
                        _log('%c caller stack', 'color:#aaa;font-size:11px', '\n' + callerStack.join('\n'));
                        _log('%c stack value ', 'color:#555;font-size:10px',
                            (stackVal || '').slice(0, 300) + (stackVal && stackVal.length > 300 ? '…' : ''));
                        _groupEnd();
                        if (window.__envHookCb) window.__envHookCb(entry);
                    }
                } finally { _recording = false; }
                return stackVal;
            },
            set(v) { _defProp(this, 'stack', { value: v, writable: true, configurable: true }); },
            configurable: true,
        });
    })();

    /* ══════════════════════════════════════════════════
       鼠标轨迹采集注册溯源
    ══════════════════════════════════════════════════ */
    (function patchMouseCapture() {
        const TRACK_EVENTS = new Set([
            'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
            'mousedown', 'mouseup', 'pointermove', 'pointerrawupdate',
            'touchmove', 'touchstart', 'touchend', 'scroll', 'wheel',
        ]);
        const _seenHandlers = new WeakSet();

        function wrapAEL(target, targetName) {
            const origAEL = target.addEventListener;
            if (!origAEL || origAEL.__envHookPatched) return;
            target.addEventListener = function (type, handler, options) {
                const ret = _rApply(origAEL, this, [type, handler, options]);
                if (!_recording && TRACK_EVENTS.has(String(type).toLowerCase())) {
                    const isFn = typeof handler === 'function';
                    if (!isFn || !_seenHandlers.has(handler)) {
                        if (isFn) _seenHandlers.add(handler);
                        _recording = true;
                        try {
                            const registerStack = (() => {
                                try {
                                    const e = new _OrigError();
                                    const origGet = _ownDesc(_OrigError.prototype, 'stack')?.get
                                        || _ownDesc(_getProto(_OrigError.prototype), 'stack')?.get;
                                    const raw = origGet ? _rApply(origGet, e, []) : (e.stack || '');
                                    return raw.split('\n').slice(2)
                                        .filter(l => l.trim() && !l.includes('wrapAEL') && !l.includes('envHook'))
                                        .slice(0, 10).map(l => l.trim());
                                } catch (_) { return []; }
                            })();
                            const handlerPreview = isFn
                                ? ('ƒ ' + (handler.name || '(anonymous)') + '  ' +
                                    _rApply(_fnToStr, handler, []).replace(/\s+/g, ' ').slice(0, 150))
                                : String(handler);
                            const entry = { op: 'mouseCapture', path: targetName + ' → addEventListener', key: 'addEventListener', type: 'function', val: type, eventType: type, handler: handlerPreview, options, registerStack, ts: Date.now() };
                            _rApply(_push, records, [entry]);
                            _group('%c mouseCapture %c ' + targetName + '.addEventListener("' + type + '")  %c← 注册轨迹采集',
                                'color:#fff;background:#7800B8;padding:2px 6px;border-radius:3px;font-weight:bold',
                                'color:#7800B8;font-weight:bold', 'color:#7800B8');
                            _log('%c handler  ', 'color:#888', handlerPreview);
                            _log('%c options  ', 'color:#888', options);
                            _log('%c register stack', 'color:#aaa;font-size:11px', '\n' + registerStack.join('\n'));
                            _groupEnd();
                            if (window.__envHookCb) window.__envHookCb(entry);
                        } finally { _recording = false; }
                    }
                }
                return ret;
            };
            target.addEventListener.__envHookPatched = true;
        }

        wrapAEL(EventTarget.prototype, 'EventTarget');
        wrapAEL(window, 'window');
        wrapAEL(document, 'document');

        const origREL = EventTarget.prototype.removeEventListener;
        if (origREL && !origREL.__envHookPatched) {
            EventTarget.prototype.removeEventListener = function (type, handler, options) {
                if (!_recording && TRACK_EVENTS.has(String(type).toLowerCase()))
                    _log('%c mouseCapture %c removeEventListener("' + type + '")  %c← 注销轨迹采集',
                        'color:#fff;background:#555;padding:2px 4px;border-radius:3px', 'color:#555', 'color:#999');
                return _rApply(origREL, this, [type, handler, options]);
            };
            EventTarget.prototype.removeEventListener.__envHookPatched = true;
        }
    })();

    /* ── TOP_KEYS 挂载（window 级代理）────────────────── */
    const TOP_KEYS = [
        // ── window 自身引用（跨 frame 检测核心）──
        'self',             // WindowProxy → 自身（与 window 等价，但 iframe 里不同）
        'top',              // WindowProxy → 最顶层 frame
        'parent',           // WindowProxy → 直接父 frame
        'opener',           // WindowProxy|null → window.open() 的来源窗口
        'frameElement',     // Element|null → 宿主 <iframe>/<frame>/<object> 元素
        'frames',           // WindowProxy → frames 集合（与 window 等价但常被检测）
        'length',           // number → frames 数量（iframe 计数指纹）
        // ── 常规 ──
        'navigator', 'screen', 'location', 'history',
        'performance', 'crypto', 'devicePixelRatio',
        'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
        'screenX', 'screenY', 'screenLeft', 'screenTop',
        'pageXOffset', 'pageYOffset', 'scrollX', 'scrollY',
        'localStorage', 'sessionStorage', 'indexedDB', 'caches',
        'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
        'Worker', 'SharedWorker', 'Notification',
        'speechSynthesis', 'visualViewport',
        'matchMedia', 'getComputedStyle',
        'requestAnimationFrame', 'cancelAnimationFrame',
        'requestIdleCallback', 'cancelIdleCallback',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'queueMicrotask',
        'open', 'close', 'alert', 'confirm', 'prompt', 'print', 'postMessage',
        'document', 'Intl', 'CSS',
        'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver',
    ];

    // self/top/parent/frames/opener/frameElement 是 WindowProxy，descriptor 为 non-configurable
    // 无法用 defineProperty 覆盖，改为读取时拦截：用 Proxy 包一层 window 自身
    const WINDOW_PROXY_KEYS = new Set(['self', 'top', 'parent', 'frames', 'opener', 'frameElement', 'length']);

    // 对 window 对象套一层 Proxy 来捕获 WindowProxy 属性访问
    // 注意：只对读取做 record，不影响返回值（直接返回真实值，不套 makeProxy，避免跨域报错）
    (function patchWindowProxyKeys() {
        const origGet = _rGet;
        // 拦截 EventTarget.prototype 上触发的 window[prop] 读取已覆盖，这里用
        // Object.defineProperty 对 window 的可配置属性做拦截；
        // 对真正不可配置的 WindowProxy 属性，我们在 TOP_KEYS.forEach 里跳过它们，
        // 改为在 makeProxy(window) 的 get trap 里捕获——但 window 不经过 makeProxy。
        // 最实用做法：直接在访问点 wrap 一个读取代理挂到全局。
        WINDOW_PROXY_KEYS.forEach(k => {
            try {
                const desc = _ownDesc(window, k);
                // 如果真的 non-configurable，只能用 try/catch 包读取时打印
                // 在这里注册一个全局 Proxy window 替代品太危险，改为 MutationObserver 式轮询
                // 实际可行方案：覆盖 window 上 configurable 的同名属性 shadow 它
                if (!desc || desc.configurable) {
                    _defProp(window, k, {
                        get() {
                            // 直接读原始值，不套 Proxy（WindowProxy 套 Proxy 会抛 cross-origin 错误）
                            const v = desc?.get ? _rApply(desc.get, window, []) : desc?.value;
                            record('get', 'window', k, v);
                            return v;
                        },
                        configurable: true, enumerable: true,
                    });
                } else if (desc?.get) {
                    // non-configurable but has getter：Chrome 允许用同名可配置 getter shadow 原型链上的
                    // window 自身 non-configurable 属性无法 redefine，改用 with(proxy) 在脚本层面拦截（不实用）
                    // 退而求其次：在 Reflect 层面无法拦截，记录一条 "无法拦截" 警告
                    _log(`%c[EnvHook] ⚠ window.${k} non-configurable，采用读取时记录（Proxy 模式）`,
                        'color:#B8000A;font-size:11px');
                    // 对于 top/parent/self，它们每次被访问都走 [[Get]] on Window，
                    // makeProxy 包 window 不现实；但可以通过拦截所有调用入口的 with-proxy 方式
                    // 实际上 Chrome 89+ 允许 shadow：尝试用一个可配置属性覆盖
                    try {
                        _defProp(window, k, {
                            get() {
                                const v = _rApply(desc.get, window, []);
                                record('get', 'window', k, v);
                                return v;
                            },
                            configurable: true, enumerable: true,
                        });
                    } catch (_) {
                        // 真的无法覆盖，跳过
                    }
                }
            } catch (e) { _log('[EnvHook] ✗ WindowProxy patch', k, e.message); }
        });
    })();

    // 常规 TOP_KEYS（排除 WindowProxy 属性）
    TOP_KEYS.filter(k => !WINDOW_PROXY_KEYS.has(k)).forEach(k => {
        try {
            const orig = window[k];
            if (orig == null || orig === console) return;
            const desc = _ownDesc(window, k);
            if (desc && !desc.configurable) return;
            _defProp(window, k, {
                get() { record('get', 'window', k, orig); return makeProxy(orig, 'window.' + k); },
                configurable: true, enumerable: true,
            });
        } catch (e) { _log('[EnvHook] ✗', k, e.message); }
    });

    /* ══════════════════════════════════════════════════
       堆栈分析辅助 —— 高危操作自动标记
    ══════════════════════════════════════════════════ */
    window.__envHookCb = function (entry) {
        const FINGERPRINT_SIGNALS = [
            // Canvas
            'toDataURL', 'getContext', 'getImageData', 'fillText', 'measureText',
            // WebGL
            'getParameter', 'getExtension', 'getSupportedExtensions', 'getShaderPrecisionFormat',
            // Audio
            'AudioContext', 'createOscillator', 'startRendering', 'createDynamicsCompressor',
            // Navigator
            'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'webdriver',
            'plugins', 'languages', 'platform', 'userAgent', 'userAgentData',
            'getHighEntropyValues', 'enumerateDevices', 'getBattery',
            // Screen
            'colorDepth', 'pixelDepth',
            // Timing
            'performance.now', 'timeOrigin',
            // Crypto
            'getRandomValues', 'randomUUID',
            // Intl（时区 / 语言探测）
            'Intl.DateTimeFormat', 'Intl.NumberFormat', 'supportedValuesOf',
            // Object 反检测
            'getOwnPropertyNames', 'getPrototypeOf', 'toString[',
            // Font
            'FontFace', 'check[', 'load[',
            // CSS
            'getPropertyValue', 'getComputedStyle',
        ];
        const isFP = FINGERPRINT_SIGNALS.some(s => entry.path.includes(s) || entry.key.includes(s));
        if (isFP) {
            entry.fingerprint = true;
            _warn('%c🔍 FINGERPRINT %c' + entry.path,
                'color:#fff;background:#B8000A;padding:2px 6px;border-radius:3px;font-weight:bold',
                'color:#B8000A;font-weight:bold');
        }
    };

    /* ── 辅助 API ─────────────────────────────────────── */
    window.__envHookQuery   = kw => records.filter(r =>
        r.path.toLowerCase().includes(kw.toLowerCase()) ||
        r.key.toLowerCase().includes(kw.toLowerCase()));
    window.__envHookExport  = () => JSON.stringify(records, null, 2);
    window.__envHookClear   = () => { records.length = 0; _log('[EnvHook] cleared'); };
    window.__envHookFP      = () => records.filter(r => r.fingerprint);
    window.__envHookStats   = () => {
        const f = {};
        records.forEach(r => { f[r.path] = (f[r.path] || 0) + 1; });
        return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 30);
    };
    window.__envHookStackReads = () => {
        const hits = records.filter(r => r.op === 'stackRead');
        if (!hits.length) { _log('[EnvHook] 未检测到 Error.stack 读取'); return []; }
        hits.forEach((r, i) => {
            _group('%c stackRead #' + i + ' %c ' + new Date(r.ts).toISOString(),
                'color:#fff;background:#B8000A;padding:1px 5px;border-radius:3px', 'color:#B8000A');
            _log(r.callerStack.join('\n'));
            _groupEnd();
        });
        return hits;
    };
    window.__envHookMouseCapture = () => {
        const hits = records.filter(r => r.op === 'mouseCapture');
        if (!hits.length) { _log('[EnvHook] 未检测到鼠标轨迹采集注册'); return []; }
        hits.forEach((r, i) => {
            _group('%c mouseCapture #' + i + '  %c' + r.eventType + '  %c' + new Date(r.ts).toISOString(),
                'color:#fff;background:#7800B8;padding:1px 5px;border-radius:3px',
                'color:#7800B8;font-weight:bold', 'color:#aaa');
            _log('handler:', r.handler);
            _log('options:', r.options);
            _log('register stack:\n' + r.registerStack.join('\n'));
            _groupEnd();
        });
        return hits;
    };
    // ★ 按类别汇总指纹命中
    window.__envHookFPByCategory = () => {
        const cats = {
            canvas:    records.filter(r => r.fingerprint && /toDataURL|getContext|fillText|measureText|getImageData/.test(r.path)),
            webgl:     records.filter(r => r.fingerprint && /getParameter|getExtension|ShaderPrecision/.test(r.path)),
            audio:     records.filter(r => r.fingerprint && /AudioContext|Oscillator|Compressor/.test(r.path)),
            navigator: records.filter(r => r.fingerprint && /navigator/.test(r.path)),
            screen:    records.filter(r => r.fingerprint && /screen/.test(r.path)),
            timing:    records.filter(r => r.fingerprint && /performance|timeOrigin/.test(r.path)),
            font:      records.filter(r => r.fingerprint && /font|Font|getComputedStyle/.test(r.path)),
            intl:      records.filter(r => r.fingerprint && /Intl/.test(r.path)),
            crypto:    records.filter(r => r.fingerprint && /crypto|Random/.test(r.path)),
            proto:     records.filter(r => r.fingerprint && /getOwnProperty|getPrototype|toString/.test(r.path)),
        };
        Object.entries(cats).forEach(([k, v]) => {
            if (v.length) _log(`%c[FP] ${k} (${v.length}次)`,
                'color:#fff;background:#B8000A;padding:1px 4px;border-radius:3px', v);
        });
        return cats;
    };

    /* ══════════════════════════════════════════════════
       ★ 新增：iframe 环境自动注入
       ─────────────────────────────────────────────────
       策略：
       1. 对已存在的 same-origin iframe，直接把本脚本文本
          注入到其 contentWindow（通过 eval 或 script 标签）
       2. 拦截 document.createElement('iframe') +
          HTMLIFrameElement.prototype.contentWindow getter，
          在 load 时自动对新 iframe 注入
       3. 跨域 iframe 无法注入（SecurityError），自动跳过并标记

       注意：注入后，iframe 内的 records 是独立的；
       通过 __envHookGetIframeRecords() 可汇总所有 frame 的记录。
    ══════════════════════════════════════════════════ */
    (function patchIframes() {
        // 获取本脚本的完整源码（闭包自引用）
        // 通过 document.currentScript 或 __envHookSrc 获取
        // 最可靠方式：在脚本顶部把自身序列化存起来
        // 这里改用"重新执行主 IIFE"的方式：把 window.__envHookSrc 作为注入源
        const HOOK_SRC = window.__envHookSrc;   // 由外部在注入前设置；若无则动态抓

        // iframe 注入函数
        function injectIntoFrame(iframe) {
            if (!iframe) return;
            // 标记防重复注入
            if (iframe.__envHookInjected) return;
            iframe.__envHookInjected = true;

            const doInject = () => {
                try {
                    const cw = iframe.contentWindow;
                    if (!cw) return;

                    // 同源检测
                    try { void cw.location.href; } catch (e) {
                        // cross-origin，无法注入
                        record('get', 'iframe', 'contentWindow[cross-origin]',
                            iframe.src || iframe.srcdoc || '(unknown)', undefined,
                            { crossOrigin: true, src: iframe.src });
                        return;
                    }

                    // 已注入过
                    if (cw.__envHook) {
                        // 复用父页面的 records 数组，让 iframe 日志汇入主页面
                        cw.__envHook = records;
                        return;
                    }

                    // 让 iframe 的 records 指向父窗口同一数组（日志统一）
                    cw.__envHook = records;
                    cw.__envHookSrc = HOOK_SRC;

                    // 方法一：直接 eval（最快，无需额外请求）
                    if (HOOK_SRC) {
                        try {
                            cw.eval(HOOK_SRC);
                            record('call', 'iframe', 'inject[eval]',
                                [iframe.src || '(inline)'], '[ok]');
                            return;
                        } catch (e) {
                            _log('[EnvHook] iframe eval failed, trying script tag', e.message);
                        }
                    }

                    // 方法二：script 标签注入（HOOK_SRC 为空时的后备）
                    try {
                        const doc = cw.document;
                        const s = doc.createElement('script');
                        if (HOOK_SRC) {
                            s.textContent = HOOK_SRC;
                        } else {
                            // 最后后备：重新执行当前已序列化的 IIFE
                            // 把自身通过 blob URL 注入（需要 same-origin）
                            const selfSrc = (() => {
                                try {
                                    return _rApply(_fnToStr, arguments.callee, []);
                                } catch (_) { return null; }
                            })();
                            if (!selfSrc) {
                                _log('[EnvHook] ⚠ iframe injection skipped: no source available');
                                return;
                            }
                            s.textContent = selfSrc + '\n//# sourceURL=envHook-iframe.js';
                        }
                        doc.head ? doc.head.insertBefore(s, doc.head.firstChild)
                                 : doc.documentElement.insertBefore(s, doc.documentElement.firstChild);
                        record('call', 'iframe', 'inject[scriptTag]',
                            [iframe.src || '(inline)'], '[ok]');
                    } catch (e2) {
                        _log('[EnvHook] ✗ iframe injection failed:', e2.message);
                    }
                } catch (e) {
                    _log('[EnvHook] ✗ injectIntoFrame error:', e.message);
                }
            };

            // 如果 iframe 已加载完毕直接执行，否则监听 load
            try {
                const cw = iframe.contentWindow;
                const state = cw?.document?.readyState;
                if (state && state !== 'uninitialized') {
                    doInject();
                } else {
                    iframe.addEventListener('load', doInject, { once: true });
                }
            } catch (_) {
                // 跨域：只能监听 load，实际 inject 时再判断
                iframe.addEventListener('load', doInject, { once: true });
            }
        }

        // ── 1. 注入已存在的 iframe ──
        try {
            document.querySelectorAll('iframe, frame').forEach(f => injectIntoFrame(f));
        } catch (_) {}

        // ── 2. 拦截 createElement('iframe'|'frame') ──
        //   （document.createElement 已在 patchDocument 中被 hook，
        //    这里在其 hook 后再挂一个后处理器）
        const _origCreateElement = document.createElement.bind(document);
        const _hookedCreateElement = document.createElement;   // 已是 hook 版
        // 在已有 hook 基础上再包一层，追加 iframe 注入逻辑
        document.createElement = function (tagName, options) {
            const el = _rApply(_hookedCreateElement, document, [tagName, options]);
            if (typeof tagName === 'string' &&
                (tagName.toLowerCase() === 'iframe' || tagName.toLowerCase() === 'frame')) {
                // 等元素插入 DOM 后再注入（此时还没有 contentWindow）
                // 用 MutationObserver 或 load 事件兜底
                injectIntoFrame(el);
            }
            return el;
        };

        // ── 3. 拦截 contentWindow / contentDocument getter ──
        //   部分代码会 createElement + 手动设置 src 后读取 contentWindow，
        //   在这里拦截 getter 确保访问时 record
        try {
            const IFP = HTMLIFrameElement.prototype;
            const origCWDesc = _ownDesc(IFP, 'contentWindow');
            if (origCWDesc?.get) {
                _defProp(IFP, 'contentWindow', {
                    get() {
                        const cw = _rApply(origCWDesc.get, this, []);
                        record('get', 'HTMLIFrameElement', 'contentWindow',
                            this.src || this.srcdoc || '(no-src)', cw);
                        // 访问时顺便尝试注入
                        injectIntoFrame(this);
                        return cw;
                    },
                    configurable: true,
                });
            }
            const origCDDesc = _ownDesc(IFP, 'contentDocument');
            if (origCDDesc?.get) {
                _defProp(IFP, 'contentDocument', {
                    get() {
                        const cd = _rApply(origCDDesc.get, this, []);
                        record('get', 'HTMLIFrameElement', 'contentDocument',
                            this.src || '(no-src)', cd);
                        return cd;
                    },
                    configurable: true,
                });
            }
        } catch (_) {}

        // ── 4. MutationObserver 兜底：捕获动态插入 DOM 的 iframe ──
        try {
            const iframeMO = new MutationObserver(muts => {
                muts.forEach(mut => {
                    mut.addedNodes.forEach(node => {
                        if (node.nodeType !== 1) return;
                        // 直接是 iframe/frame
                        if (/^i?frame$/i.test(node.tagName)) injectIntoFrame(node);
                        // 子树里还有
                        node.querySelectorAll?.('iframe, frame').forEach(f => injectIntoFrame(f));
                    });
                });
            });
            iframeMO.observe(document.documentElement, { childList: true, subtree: true });
        } catch (_) {}

        // ── 5. 查询所有 frame 的记录（统一汇入 records，此函数用于手动检查）──
        window.__envHookGetIframeRecords = () => {
            const frames = [];
            try {
                document.querySelectorAll('iframe, frame').forEach((f, i) => {
                    try {
                        const cw = f.contentWindow;
                        frames.push({
                            index: i,
                            src: f.src || '(inline)',
                            recordCount: cw?.__envHook?.length ?? 'N/A (cross-origin)',
                            records: cw?.__envHook === records ? '← 已合并到主页面' : cw?.__envHook,
                        });
                    } catch (_) {
                        frames.push({ index: i, src: f.src, error: 'cross-origin' });
                    }
                });
            } catch (_) {}
            _log('%c[EnvHook] iframe 状态', 'color:#0f6e56;font-weight:bold', frames);
            return frames;
        };

        _log('%c[EnvHook] ✅ iframe 自动注入已激活', 'color:#0f6e56;font-size:11px');
    })();

    _log('%c[EnvHook] ✅ 已激活 (v3 完整版)', 'color:#0f6e56;font-weight:bold;font-size:14px');
    _log(
        '%c[EnvHook] 覆盖面：\n' +
        '  Canvas · WebGL/2D (全方法+属性) · AudioContext · FontFace\n' +
        '  navigator (全属性+方法+webkit子接口+gpu/bluetooth/xr) · screen · performance\n' +
        '  localStorage · sessionStorage · indexedDB · StorageManager\n' +
        '  WebSocket · Worker · SharedWorker · EventSource\n' +
        '  crypto · SubtleCrypto · Intl (全类) · CSS\n' +
        '  Notification · WakeLock · PointerLock · Fullscreen\n' +
        '  History · Location · fetch · XHR · sendBeacon\n' +
        '  MutationObserver · ResizeObserver · IntersectionObserver · PerformanceObserver\n' +
        '  Object静态方法 (含入参打印) · Function.prototype.toString · Error.stack\n' +
        '  window.self/top/parent/frames/opener/frameElement (WindowProxy拦截)\n' +
        '  navigator.webkitTemporaryStorage/webkitPersistentStorage\n' +
        '  iframe 自动注入 (同源) · 鼠标轨迹采集注册溯源 · 原型链访问检测\n\n' +
        '  __envHookFP()               → 所有指纹操作\n' +
        '  __envHookFPByCategory()     → 按类别汇总\n' +
        '  __envHookStackReads()       → Error.stack 读取\n' +
        '  __envHookMouseCapture()     → 鼠标采集注册\n' +
        '  __envHookGetIframeRecords() → iframe 注入状态\n' +
        '  __envHookQuery(kw)          → 关键词检索\n' +
        '  __envHookStats()            → 热度排行\n' +
        '  __envHookExport()           → 导出全量 JSON',
        'color:#0f6e56;font-size:11px'
    );
})();