from aiohttp import web
import asyncio
import os
import logging
from .rpc import Server

LOG = logging.getLogger('opsavideo.http')
def index_handler(static_files):
    async def f(request):
        return web.FileResponse(os.path.join(static_files, 'index.html'))
    return f

def ws_handler(server):
    async def f(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        async def incoming():
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    yield msg.data
                elif msg.type == web.WSMsgType.ERROR:
                    LOG.warn('ws connection closed with exception %s', ws.exception())

        await server(request.remote, incoming(), ws.send_str)

        return ws
    return f

async def run(server, *, hostname, port, static):
    app = web.Application()
    app.router.add_get("/ws", ws_handler(server))
    if static:
        app.router.add_get("/", index_handler(static))
        app.router.add_static("/", static)

    runner = web.AppRunner(app, access_log_format='%a %t "%r" %s %b')
    await runner.setup()
    site = web.TCPSite(runner, hostname, port)

    LOG.info("Listening on http://%s:%d", hostname, port)
    await site.start()
