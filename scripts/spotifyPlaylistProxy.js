var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
// Vite middleware exposing GET /api/spotify/playlist?id=<playlistId> for the
// playlist-import feature (src/data/spotifyImport.ts). Runs server-side so the
// Spotify client secret never reaches the browser; uses the same credentials as
// the enrichment script (env SPOTIFY_CLIENT_ID/SECRET or data/raw/spotify.json).
//
// Response: { name, tracks: [{ id, title, artist }] } — episodes/local files are
// dropped. Errors come back as { error } with a matching HTTP status. Note that
// client-credentials can only read playlists visible to everyone: private and
// Spotify-editorial playlists 404.
import { existsSync, readFileSync } from 'node:fs';
var CREDS_FILE = 'data/raw/spotify.json';
var MAX_TRACKS = 2000;
function creds() {
    var id = process.env.SPOTIFY_CLIENT_ID;
    var secret = process.env.SPOTIFY_CLIENT_SECRET;
    if ((!id || !secret) && existsSync(CREDS_FILE)) {
        var j = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
        id = id || j.clientId || j.client_id;
        secret = secret || j.clientSecret || j.client_secret;
    }
    return id && secret ? { id: id, secret: secret } : null;
}
var token = '';
var tokenExp = 0;
function getToken(c) {
    return __awaiter(this, void 0, void 0, function () {
        var auth, resp, j;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (token && Date.now() < tokenExp - 60000)
                        return [2 /*return*/, token];
                    auth = Buffer.from("".concat(c.id, ":").concat(c.secret)).toString('base64');
                    return [4 /*yield*/, fetch('https://accounts.spotify.com/api/token', {
                            method: 'POST',
                            headers: { Authorization: "Basic ".concat(auth), 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({ grant_type: 'client_credentials' }),
                        })];
                case 1:
                    resp = _b.sent();
                    if (!resp.ok)
                        throw new HttpError(502, "Spotify token request failed (".concat(resp.status, ") \u2014 check the credentials in ").concat(CREDS_FILE, "."));
                    return [4 /*yield*/, resp.json()];
                case 2:
                    j = _b.sent();
                    token = j.access_token;
                    tokenExp = Date.now() + ((_a = j.expires_in) !== null && _a !== void 0 ? _a : 3600) * 1000;
                    return [2 /*return*/, token];
            }
        });
    });
}
var HttpError = /** @class */ (function (_super) {
    __extends(HttpError, _super);
    function HttpError(status, message) {
        var _this = _super.call(this, message) || this;
        _this.status = status;
        return _this;
    }
    return HttpError;
}(Error));
function api(path, c) {
    return __awaiter(this, void 0, void 0, function () {
        var _loop_1, attempt, state_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _loop_1 = function (attempt) {
                        var resp, _c, _d, _e, wait_1;
                        var _f, _g;
                        return __generator(this, function (_h) {
                            switch (_h.label) {
                                case 0:
                                    _c = fetch;
                                    _d = ["https://api.spotify.com/v1".concat(path)];
                                    _f = {};
                                    _g = {};
                                    _e = "Bearer ".concat;
                                    return [4 /*yield*/, getToken(c)];
                                case 1: return [4 /*yield*/, _c.apply(void 0, _d.concat([(_f.headers = (_g.Authorization = _e.apply("Bearer ", [_h.sent()]), _g),
                                            _f)]))];
                                case 2:
                                    resp = _h.sent();
                                    if (resp.status === 401) {
                                        token = '';
                                        return [2 /*return*/, "continue"];
                                    } // stale token → refresh
                                    if (!(resp.status === 429)) return [3 /*break*/, 4];
                                    wait_1 = Math.min(Number((_a = resp.headers.get('retry-after')) !== null && _a !== void 0 ? _a : '2') + 1, 10);
                                    return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, wait_1 * 1000); })];
                                case 3:
                                    _h.sent();
                                    return [2 /*return*/, "continue"];
                                case 4:
                                    if (resp.status === 404) {
                                        throw new HttpError(404, 'Playlist not found. It may be private or a Spotify-made editorial playlist — those aren\'t readable by apps.');
                                    }
                                    if (!resp.ok)
                                        throw new HttpError(502, "Spotify request failed (".concat(resp.status, ")."));
                                    return [2 /*return*/, { value: resp.json() }];
                            }
                        });
                    };
                    attempt = 0;
                    _b.label = 1;
                case 1:
                    if (!(attempt < 4)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(attempt)];
                case 2:
                    state_1 = _b.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _b.label = 3;
                case 3:
                    attempt++;
                    return [3 /*break*/, 1];
                case 4: throw new HttpError(502, 'Spotify kept rate-limiting the request — try again in a minute.');
            }
        });
    });
}
function fetchPlaylist(id) {
    return __awaiter(this, void 0, void 0, function () {
        var c, meta, tracks, offset, page, _i, _a, it, t;
        var _b, _c, _d, _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    c = creds();
                    if (!c) {
                        throw new HttpError(500, "No Spotify credentials. Set SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET or create ".concat(CREDS_FILE, "."));
                    }
                    return [4 /*yield*/, api("/playlists/".concat(id, "?fields=name"), c)];
                case 1:
                    meta = _j.sent();
                    tracks = [];
                    offset = 0;
                    _j.label = 2;
                case 2:
                    if (!(offset < MAX_TRACKS)) return [3 /*break*/, 5];
                    return [4 /*yield*/, api("/playlists/".concat(id, "/tracks?limit=100&offset=").concat(offset, "&fields=total,items(track(id,name,type,artists(name)))"), c)];
                case 3:
                    page = _j.sent();
                    for (_i = 0, _a = (_b = page.items) !== null && _b !== void 0 ? _b : []; _i < _a.length; _i++) {
                        it = _a[_i];
                        t = it === null || it === void 0 ? void 0 : it.track;
                        if (t && t.type === 'track' && t.id) {
                            tracks.push({ id: t.id, title: (_c = t.name) !== null && _c !== void 0 ? _c : '', artist: (_f = (_e = (_d = t.artists) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : '' });
                        }
                    }
                    if (offset + 100 >= ((_g = page.total) !== null && _g !== void 0 ? _g : 0))
                        return [3 /*break*/, 5];
                    _j.label = 4;
                case 4:
                    offset += 100;
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, { name: (_h = meta.name) !== null && _h !== void 0 ? _h : '', tracks: tracks }];
            }
        });
    });
}
function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}
function handle(req, res, next) {
    return __awaiter(this, void 0, void 0, function () {
        var id, _a, _b, err_1, status_1;
        var _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (!((_c = req.url) === null || _c === void 0 ? void 0 : _c.startsWith('/api/spotify/playlist')))
                        return [2 /*return*/, next()];
                    id = (_d = new URL(req.url, 'http://localhost').searchParams.get('id')) !== null && _d !== void 0 ? _d : '';
                    if (!/^[A-Za-z0-9]{10,40}$/.test(id))
                        return [2 /*return*/, send(res, 400, { error: 'Invalid playlist id.' })];
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 3, , 4]);
                    _a = send;
                    _b = [res, 200];
                    return [4 /*yield*/, fetchPlaylist(id)];
                case 2:
                    _a.apply(void 0, _b.concat([_e.sent()]));
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _e.sent();
                    status_1 = err_1 instanceof HttpError ? err_1.status : 500;
                    send(res, status_1, { error: err_1 instanceof Error ? err_1.message : String(err_1) });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
export function spotifyPlaylistProxy() {
    return {
        name: 'spotify-playlist-proxy',
        configureServer: function (server) { server.middlewares.use(handle); },
        configurePreviewServer: function (server) { server.middlewares.use(handle); },
    };
}
