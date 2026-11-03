"""
BlueBeakend Python SDK — zero external dependencies (stdlib urllib).
Usage:
    from bluebeakend import Bluebeakend
    bb = Bluebeakend(api_key="bb_live_...", auth_domain="api.myapp.com", project_id="my-app")
    bb.auth.signup("user@x.com", "pass123")
    doc = bb.db.collection("todos").add({"title": "Buy milk", "done": False})
    todos = bb.db.collection("todos").where("done", "==", False).get()
    bb.db.collection("todos").doc(doc["id"]).update({"done": True})
"""
from __future__ import annotations

import json
import mimetypes
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, List, Optional


class BluebeakendError(Exception):
    def __init__(self, message: str, status: int = 0, code: str = "ERROR"):
        super().__init__(message)
        self.status = status
        self.code = code


class _DocRef:
    def __init__(self, client: "Bluebeakend", collection: str, doc_id: str):
        self._c = client
        self._col = collection
        self.id = doc_id

    def get(self) -> Dict[str, Any]:
        res = self._c._req(f"/api/v1/db/{self._col}/{self.id}")
        doc = res["doc"]
        return {"id": doc["_id"], **doc}

    def update(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        res = self._c._req(f"/api/v1/db/{self._col}/{self.id}", method="PATCH", body=patch)
        doc = res["doc"]
        return {"id": doc["_id"], **doc}

    def set(self, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self._c._req(f"/api/v1/db/{self._col}/{self.id}", method="PUT", body=data)
        doc = res["doc"]
        return {"id": doc["_id"], **doc}

    def delete(self) -> Dict[str, Any]:
        return self._c._req(f"/api/v1/db/{self._col}/{self.id}", method="DELETE")


class _CollectionRef:
    def __init__(self, client: "Bluebeakend", name: str, where=None, order_by=None, limit=None, offset=None):
        self._c = client
        self._name = name
        self._where = list(where or [])
        self._order_by = list(order_by or [])
        self._limit = limit
        self._offset = offset

    def where(self, field: str, op: str, value: Any) -> "_CollectionRef":
        return _CollectionRef(self._c, self._name, [*self._where, [field, op, value]], self._order_by, self._limit, self._offset)

    def order_by(self, field: str, direction: str = "asc") -> "_CollectionRef":
        return _CollectionRef(self._c, self._name, self._where, [*self._order_by, [field, direction]], self._limit, self._offset)

    def limit(self, n: int) -> "_CollectionRef":
        return _CollectionRef(self._c, self._name, self._where, self._order_by, n, self._offset)

    def offset(self, n: int) -> "_CollectionRef":
        return _CollectionRef(self._c, self._name, self._where, self._order_by, self._limit, n)

    def add(self, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self._c._req(f"/api/v1/db/{self._name}", method="POST", body=data)
        doc = res["doc"]
        return {"id": doc["_id"], **doc}

    def get(self) -> List[Dict[str, Any]]:
        payload: Dict[str, Any] = {}
        if self._where:
            payload["where"] = self._where
        if self._order_by:
            payload["orderBy"] = self._order_by
        if self._limit is not None:
            payload["limit"] = self._limit
        if self._offset is not None:
            payload["offset"] = self._offset
        res = self._c._req(f"/api/v1/db/{self._name}/query", method="POST", body=payload)
        return [{"id": d["_id"], **d} for d in res.get("docs", [])]

    def count(self) -> int:
        qs = f"?where={urllib.parse.quote(json.dumps(self._where))}" if self._where else ""
        return self._c._req(f"/api/v1/db/{self._name}/count{qs}")["count"]

    def doc(self, doc_id: str) -> _DocRef:
        return _DocRef(self._c, self._name, doc_id)


class _Auth:
    def __init__(self, client: "Bluebeakend"):
        self._c = client
        self.current_user: Optional[Dict[str, Any]] = None

    def signup(self, email: str, password: str, name: str = "") -> Dict[str, Any]:
        res = self._c._req("/api/v1/auth/register", method="POST", body={"email": email, "password": password, "name": name})
        self._save(res)
        return res

    def login(self, email: str, password: str) -> Dict[str, Any]:
        res = self._c._req("/api/v1/auth/login", method="POST", body={"email": email, "password": password})
        self._save(res)
        return res

    def logout(self) -> Dict[str, Any]:
        rt = self._c.refresh_token
        self.current_user = None
        self._c.access_token = None
        self._c.refresh_token = None
        if rt:
            self._c._req("/api/v1/auth/logout", method="POST", body={"refreshToken": rt})
        return {"ok": True}

    def me(self) -> Dict[str, Any]:
        res = self._c._req("/api/v1/auth/me")
        self.current_user = res["user"]
        return res["user"]

    def _save(self, res: Dict[str, Any]) -> None:
        self.current_user = res.get("user")
        self._c.access_token = res.get("accessToken")
        self._c.refresh_token = res.get("refreshToken")


class _Db:
    def __init__(self, client: "Bluebeakend"):
        self._c = client

    def collection(self, name: str) -> _CollectionRef:
        return _CollectionRef(self._c, name)


class _Storage:
    def __init__(self, client: "Bluebeakend"):
        self._c = client

    def upload(self, file_path_or_bytes: Any, filename: Optional[str] = None, folder: str = "") -> Dict[str, Any]:
        if isinstance(file_path_or_bytes, (bytes, bytearray)):
            data = bytes(file_path_or_bytes)
            name = filename or "upload.bin"
        else:
            name = filename or os.path.basename(str(file_path_or_bytes))
            with open(file_path_or_bytes, "rb") as fh:
                data = fh.read()
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        boundary = f"----BlueBeakend{uuid.uuid4().hex}"
        parts = []
        if folder:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n{folder}\r\n'.encode())
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
            + data
            + f"\r\n--{boundary}--\r\n".encode()
        )
        body = b"".join(parts)
        res = self._c._req(
            "/api/v1/storage/upload",
            method="POST",
            raw_body=body,
            extra_headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        return {"id": res["fileId"], **res}

    def get_url(self, file_id: str) -> str:
        return self._c._req(f"/api/v1/storage/{file_id}/download")["url"]

    def delete(self, file_id: str) -> Dict[str, Any]:
        return self._c._req(f"/api/v1/storage/{file_id}", method="DELETE")


class Bluebeakend:
    def __init__(self, api_key: str, auth_domain: str = "localhost:8080", project_id: str = "default", base_url: Optional[str] = None):
        self.api_key = api_key
        self.project_id = project_id
        if base_url:
            self.base_url = base_url.rstrip("/")
        elif auth_domain.startswith(("http://", "https://")):
            self.base_url = auth_domain.rstrip("/")
        else:
            proto = "http" if auth_domain.startswith(("localhost", "127.0.0.1")) else "https"
            self.base_url = f"{proto}://{auth_domain.rstrip('/')}"
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.auth = _Auth(self)
        self.db = _Db(self)
        self.storage = _Storage(self)

    def _req(self, path: str, method: str = "GET", body: Any = None, raw_body: Optional[bytes] = None, extra_headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        headers = {"X-API-Key": self.api_key, **(extra_headers or {})}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        payload = raw_body
        if body is not None and raw_body is None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(f"{self.base_url}{path}", data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                err = json.loads(raw).get("error", {})
            except Exception:
                err = {}
            raise BluebeakendError(err.get("message", f"HTTP {exc.code}"), status=exc.code, code=err.get("code", "HTTP_ERROR")) from exc
