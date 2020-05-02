from aiohttp import WSCloseCode, web
import asyncio
import os
import logging
import urllib
import weakref

from .rpc import Server


LOG = logging.getLogger('opsavideo.http')
class HTTPServer:
    def __init__(self, server, media_server, *, hostname, port, media_prefix, static_dir):
        self.server = server
        self.media_server = media_server

        self.hostname = hostname
        self.port = port
        self.media_prefix = media_prefix
        self.static_dir = static_dir

        self._connections = weakref.WeakSet()
        self._site = None

    async def _index_handler(self, request):
        return web.FileResponse(os.path.join(self.static_dir, 'index.html'))

    async def _ws_handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        self._connections.add(ws)

        async def incoming():
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    yield msg.data
                elif msg.type == web.WSMsgType.ERROR:
                    LOG.warn('ws connection closed with exception %s', ws.exception())

        await self.server(request.remote, incoming(), ws.send_str)
        self._connections.discard(ws)

        return ws

    async def _on_app_shutdown(self, app):
        for ws in set(self._connections):
            LOG.info("Closing WebSocket connection")
            await ws.close(code=WSCloseCode.GOING_AWAY, message="Server shutdown")

    async def start(self):
        app = web.Application()

        app.add_subapp(self.media_prefix, self.media_server.create_app())
        app.router.add_get("/ws", self._ws_handler)

        if self.static_dir:
            app.router.add_get("/", self._index_handler)
            app.router.add_static("/", self.static_dir)

        app.on_shutdown.append(self._on_app_shutdown)

        runner = web.AppRunner(app, access_log_format='%a %t "%r" %s %b')
        await runner.setup()

        self._site = web.TCPSite(runner, self.hostname, self.port)
        await self._site.start()

        LOG.info("HTTP server listening on http://%s:%d", self.hostname, self.port)

    async def stop(self):
        LOG.info("Stopping HTTP server")
        await self._site.stop()
        LOG.info("Stopped HTTP server")


def request(url):
    return urllib.request.urlopen(url).read().decode("utf-8")

