#!/usr/bin/env python3
import json
import os
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "chatbot.db"
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              system_prompt TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              conversation_id INTEGER NOT NULL,
              role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            """
        )


def create_conversation(title: str = "New conversation", system_prompt: str = "") -> int:
    timestamp = now_iso()
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO conversations (title, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (title, system_prompt, timestamp, timestamp),
        )
        return int(cursor.lastrowid)


def list_conversations():
    with get_db() as db:
        rows = db.execute(
            """
            SELECT c.id, c.title, c.system_prompt, c.created_at, c.updated_at,
                   COUNT(m.id) AS message_count
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]


def get_conversation(conversation_id: int):
    with get_db() as db:
        row = db.execute(
            "SELECT id, title, system_prompt, created_at, updated_at FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
        return dict(row) if row else None


def list_messages(conversation_id: int):
    with get_db() as db:
        rows = db.execute(
            "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC",
            (conversation_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def update_conversation(conversation_id: int, title: str | None, system_prompt: str | None):
    updates = []
    params = []

    if title is not None:
        updates.append("title = ?")
        params.append(title)

    if system_prompt is not None:
        updates.append("system_prompt = ?")
        params.append(system_prompt)

    updates.append("updated_at = ?")
    params.append(now_iso())
    params.append(conversation_id)

    with get_db() as db:
        db.execute(f"UPDATE conversations SET {', '.join(updates)} WHERE id = ?", params)


def append_message(conversation_id: int, role: str, content: str):
    with get_db() as db:
        db.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (conversation_id, role, content, now_iso()),
        )
        db.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now_iso(), conversation_id))


def replace_messages(conversation_id: int, messages):
    with get_db() as db:
        db.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
        for message in messages:
            db.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (conversation_id, message["role"], message["content"], now_iso()),
            )
        db.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now_iso(), conversation_id))


def llm_chat(messages):
    api_key = os.environ.get("LLM_API_KEY")
    api_url = os.environ.get("LLM_API_URL", "https://api.openai.com/v1/chat/completions")
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    if not api_key:
        last_user = ""
        for message in reversed(messages):
            if message.get("role") == "user":
                last_user = message.get("content", "")
                break
        return f"[mock backend reply] Set LLM_API_KEY to call a real model. Last user message: {last_user}"

    payload = {"model": model, "messages": messages}
    request = urllib.request.Request(
        api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"LLM request failed ({err.code}): {detail}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"LLM connection failed: {err.reason}") from err

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("LLM response did not include choices")

    content = choices[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError("LLM response did not include assistant content")

    return content


class Handler(BaseHTTPRequestHandler):
    def _json_response(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _serve_static(self, route_path: str):
        relative = "index.html" if route_path in ("", "/") else route_path.lstrip("/")
        file_path = (ROOT / relative).resolve()

        if ROOT not in file_path.parents and file_path != ROOT:
            self.send_error(403, "Forbidden")
            return

        if not file_path.exists() or file_path.is_dir():
            self.send_error(404, "Not found")
            return

        mime = "text/plain; charset=utf-8"
        if file_path.suffix == ".html":
            mime = "text/html; charset=utf-8"
        elif file_path.suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif file_path.suffix == ".js":
            mime = "application/javascript; charset=utf-8"

        content = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/conversations":
            return self._json_response({"conversations": list_conversations()})

        if path.startswith("/api/conversations/") and path.endswith("/messages"):
            try:
                conversation_id = int(path.split("/")[3])
            except (ValueError, IndexError):
                return self._json_response({"error": "invalid conversation id"}, status=400)

            if not get_conversation(conversation_id):
                return self._json_response({"error": "conversation not found"}, status=404)

            return self._json_response({"messages": list_messages(conversation_id)})

        return self._serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/conversations":
            body = self._read_json()
            title = body.get("title") or "New conversation"
            system_prompt = body.get("systemPrompt") or ""
            conversation_id = create_conversation(title=title, system_prompt=system_prompt)
            return self._json_response({"conversation": get_conversation(conversation_id)}, status=201)

        if path.startswith("/api/conversations/") and path.endswith("/messages"):
            try:
                conversation_id = int(path.split("/")[3])
            except (ValueError, IndexError):
                return self._json_response({"error": "invalid conversation id"}, status=400)

            if not get_conversation(conversation_id):
                return self._json_response({"error": "conversation not found"}, status=404)

            body = self._read_json()
            role = body.get("role")
            content = body.get("content", "")
            if role not in {"user", "assistant", "system"}:
                return self._json_response({"error": "invalid role"}, status=400)

            append_message(conversation_id, role, content)
            return self._json_response({"ok": True}, status=201)

        if path == "/api/chat":
            body = self._read_json()
            messages = body.get("messages", [])
            if not isinstance(messages, list):
                return self._json_response({"error": "messages must be an array"}, status=400)

            try:
                reply = llm_chat(messages)
            except RuntimeError as err:
                return self._json_response({"error": str(err)}, status=500)

            return self._json_response({"reply": reply})

        self.send_error(404, "Not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/conversations/") and not path.endswith("/messages"):
            try:
                conversation_id = int(path.split("/")[3])
            except (ValueError, IndexError):
                return self._json_response({"error": "invalid conversation id"}, status=400)

            if not get_conversation(conversation_id):
                return self._json_response({"error": "conversation not found"}, status=404)

            body = self._read_json()
            update_conversation(conversation_id, body.get("title"), body.get("systemPrompt"))
            return self._json_response({"conversation": get_conversation(conversation_id)})

        if path.startswith("/api/conversations/") and path.endswith("/messages"):
            try:
                conversation_id = int(path.split("/")[3])
            except (ValueError, IndexError):
                return self._json_response({"error": "invalid conversation id"}, status=400)

            if not get_conversation(conversation_id):
                return self._json_response({"error": "conversation not found"}, status=404)

            body = self._read_json()
            messages = body.get("messages", [])
            if not isinstance(messages, list):
                return self._json_response({"error": "messages must be an array"}, status=400)

            cleaned = []
            for message in messages:
                role = message.get("role")
                content = message.get("content", "")
                if role not in {"user", "assistant", "system"}:
                    return self._json_response({"error": "invalid role in messages"}, status=400)
                cleaned.append({"role": role, "content": content})

            replace_messages(conversation_id, cleaned)
            return self._json_response({"ok": True})

        self.send_error(404, "Not found")


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Server running on http://{HOST}:{PORT}")
    server.serve_forever()
