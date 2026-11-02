// ─────────────────────────────────────────────────────────────
// BlueBeakend Flutter / Dart SDK (lib/bluebeakend.dart)
// Drop-in client for Flutter mobile, web & desktop apps.
// ─────────────────────────────────────────────────────────────
library bluebeakend;

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

class BluebeakendException implements Exception {
  final String message;
  final int status;
  final String code;
  BluebeakendException(this.message, {this.status = 0, this.code = 'ERROR'});
  @override
  String toString() => 'BluebeakendException($code/$status): $message';
}

class Bluebeakend {
  final String apiKey;
  final String projectId;
  late final String baseUrl;
  late final String realtimeUrl;

  String? accessToken;
  String? refreshToken;
  Map<String, dynamic>? currentUser;

  late final BluebeakendAuth auth;
  late final BluebeakendDb db;
  late final BluebeakendStorage storage;

  Bluebeakend({
    required this.apiKey,
    required String authDomain,
    this.projectId = 'default',
    String? baseUrlOverride,
    String? realtimeUrlOverride,
  }) {
    final clean = authDomain.replaceAll(RegExp(r'/+$'), '');
    if (baseUrlOverride != null) {
      baseUrl = baseUrlOverride.replaceAll(RegExp(r'/+$'), '');
    } else if (clean.startsWith('http://') || clean.startsWith('https://')) {
      baseUrl = clean;
    } else {
      final isLocal = clean.startsWith('localhost') || clean.startsWith('127.0.0.1');
      baseUrl = '${isLocal ? 'http' : 'https'}://$clean';
    }
    final uri = Uri.parse(baseUrl);
    realtimeUrl = realtimeUrlOverride ?? '${uri.scheme == 'https' ? 'wss' : 'ws'}://${uri.authority}/realtime';
    auth = BluebeakendAuth._(this);
    db = BluebeakendDb._(this);
    storage = BluebeakendStorage._(this);
  }

  Future<Map<String, dynamic>> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final headers = <String, String>{
      'X-API-Key': apiKey,
      if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      if (body != null) 'Content-Type': 'application/json',
    };
    final uri = Uri.parse('$baseUrl$path');
    late http.Response res;
    switch (method) {
      case 'POST':
        res = await http.post(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
        break;
      case 'PATCH':
        res = await http.patch(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
        break;
      case 'PUT':
        res = await http.put(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
        break;
      case 'DELETE':
        res = await http.delete(uri, headers: headers);
        break;
      default:
        res = await http.get(uri, headers: headers);
    }
    final decoded = res.body.isNotEmpty ? jsonDecode(res.body) as Map<String, dynamic> : <String, dynamic>{};
    if (res.statusCode >= 400) {
      final err = (decoded['error'] as Map<String, dynamic>?) ?? {};
      throw BluebeakendException(
        (err['message'] ?? 'HTTP ${res.statusCode}').toString(),
        status: res.statusCode,
        code: (err['code'] ?? 'HTTP_ERROR').toString(),
      );
    }
    return decoded;
  }
}

class BluebeakendAuth {
  final Bluebeakend _c;
  BluebeakendAuth._(this._c);

  Future<Map<String, dynamic>> signup(String email, String password, {String? name}) async {
    final res = await _c.request('/api/v1/auth/register', method: 'POST', body: {
      'email': email,
      'password': password,
      if (name != null) 'name': name,
    });
    _save(res);
    return res;
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await _c.request('/api/v1/auth/login', method: 'POST', body: {
      'email': email,
      'password': password,
    });
    _save(res);
    return res;
  }

  Future<void> logout() async {
    final rt = _c.refreshToken;
    _c.accessToken = null;
    _c.refreshToken = null;
    _c.currentUser = null;
    if (rt != null) {
      await _c.request('/api/v1/auth/logout', method: 'POST', body: {'refreshToken': rt});
    }
  }

  void _save(Map<String, dynamic> res) {
    _c.accessToken = res['accessToken'] as String?;
    _c.refreshToken = res['refreshToken'] as String?;
    _c.currentUser = res['user'] as Map<String, dynamic>?;
  }
}

class BluebeakendDb {
  final Bluebeakend _c;
  BluebeakendDb._(this._c);
  CollectionRef collection(String name) => CollectionRef._(_c, name);
}

class CollectionRef {
  final Bluebeakend _c;
  final String _name;
  final List<List<dynamic>> _where;
  final List<List<String>> _orderBy;
  final int? _limit;

  CollectionRef._(this._c, this._name, [this._where = const [], this._orderBy = const [], this._limit]);

  CollectionRef where(String field, String op, dynamic value) =>
      CollectionRef._(_c, _name, [..._where, [field, op, value]], _orderBy, _limit);

  CollectionRef orderBy(String field, {String direction = 'asc'}) =>
      CollectionRef._(_c, _name, _where, [..._orderBy, [field, direction]], _limit);

  CollectionRef limit(int n) => CollectionRef._(_c, _name, _where, _orderBy, n);

  Future<Map<String, dynamic>> add(Map<String, dynamic> data) async {
    final res = await _c.request('/api/v1/db/$_name', method: 'POST', body: data);
    final doc = Map<String, dynamic>.from(res['doc'] as Map);
    doc['id'] = doc['_id'];
    return doc;
  }

  Future<List<Map<String, dynamic>>> get() async {
    final res = await _c.request('/api/v1/db/$_name/query', method: 'POST', body: {
      if (_where.isNotEmpty) 'where': _where,
      if (_orderBy.isNotEmpty) 'orderBy': _orderBy,
      if (_limit != null) 'limit': _limit,
    });
    return (res['docs'] as List).map((e) {
      final m = Map<String, dynamic>.from(e as Map);
      m['id'] = m['_id'];
      return m;
    }).toList();
  }

  DocumentRef doc(String id) => DocumentRef._(_c, _name, id);

  Stream<Map<String, dynamic>> snapshots() {
    final uri = Uri.parse('${_c.realtimeUrl}?apiKey=${_c.apiKey}${_c.accessToken != null ? '&token=${_c.accessToken}' : ''}');
    final channel = WebSocketChannel.connect(uri);
    channel.sink.add(jsonEncode({'action': 'subscribe', 'channel': 'db:$_name'}));
    return channel.stream.map((raw) => jsonDecode(raw.toString()) as Map<String, dynamic>);
  }
}

class DocumentRef {
  final Bluebeakend _c;
  final String _col;
  final String id;
  DocumentRef._(this._c, this._col, this.id);

  Future<Map<String, dynamic>> update(Map<String, dynamic> patch) async {
    final res = await _c.request('/api/v1/db/$_col/$id', method: 'PATCH', body: patch);
    final doc = Map<String, dynamic>.from(res['doc'] as Map);
    doc['id'] = doc['_id'];
    return doc;
  }

  Future<void> delete() async {
    await _c.request('/api/v1/db/$_col/$id', method: 'DELETE');
  }
}

class BluebeakendStorage {
  final Bluebeakend _c;
  BluebeakendStorage._(this._c);

  Future<Map<String, dynamic>> uploadBytes(List<int> bytes, {required String filename, String? folder}) async {
    final req = http.MultipartRequest('POST', Uri.parse('${_c.baseUrl}/api/v1/storage/upload'));
    req.headers['X-API-Key'] = _c.apiKey;
    if (_c.accessToken != null) req.headers['Authorization'] = 'Bearer ${_c.accessToken}';
    if (folder != null && folder.isNotEmpty) req.fields['folder'] = folder;
    req.files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
    final streamed = await req.send();
    final body = await streamed.stream.bytesToString();
    final decoded = jsonDecode(body) as Map<String, dynamic>;
    if (streamed.statusCode >= 400) {
      throw BluebeakendException((decoded['error']?['message'] ?? 'Upload failed').toString(), status: streamed.statusCode);
    }
    return {'id': decoded['fileId'], ...decoded};
  }

  Future<String> getUrl(String fileId) async {
    final res = await _c.request('/api/v1/storage/$fileId/download');
    return res['url'] as String;
  }
}
