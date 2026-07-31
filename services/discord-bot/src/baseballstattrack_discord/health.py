from __future__ import annotations

import asyncio
from collections.abc import Callable


async def start_health_server(
    host: str, port: int, ready: Callable[[], bool]
) -> asyncio.Server:
    async def handle(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            request = await asyncio.wait_for(reader.read(4096), timeout=2)
            first_line = request.split(b"\r\n", 1)[0]
            path = (
                first_line.split(b" ")[1] if len(first_line.split(b" ")) >= 2 else b""
            )
            if path == b"/healthz":
                status, body = "200 OK", b'{"status":"alive"}'
            elif path == b"/readyz" and ready():
                status, body = "200 OK", b'{"status":"ready"}'
            elif path == b"/readyz":
                status, body = "503 Service Unavailable", b'{"status":"not_ready"}'
            else:
                status, body = "404 Not Found", b'{"status":"not_found"}'
            writer.write(
                f"HTTP/1.1 {status}\r\nContent-Type: application/json\r\n"
                f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
                + body
            )
            await writer.drain()
        except (TimeoutError, ConnectionError):
            pass
        finally:
            writer.close()
            await writer.wait_closed()

    return await asyncio.start_server(handle, host, port)
