import argparse
import logging
import asyncio
import os
import pychromecast
import pychromecast.discovery
import sys
import time
import uuid
import websockets

from .conversion import ConversionServer
from .media import MediaManager
from .rpc import Noticeboard, Server
from . import http

chromecasts_obj = dict()

def discover_chromecasts(noticeboard, loop):
    chromecasts = {}
    def export_chromecast(cc):
        return [str(cc.device.uuid), cc.device.friendly_name, cc.device.model_name]

    def publish_chromecast():
        noticeboard.publish_threadsafe(
            [export_chromecast(cc) for cc in chromecasts.values()],
            loop=loop)

    def add_chromecast(name):
        cc = pychromecast._get_chromecast_from_host(
            listener.services[name],
            tries=5,
            blocking=False,
        )

        chromecasts_obj[cc.device.uuid] = cc;
        chromecasts[name] = cc
        publish_chromecast()

    def remove_chromecast(name, service):
        del chromecasts[name]
        publish_chromecast()

    listener, browser = pychromecast.discovery.start_discovery(add_chromecast, remove_chromecast)


#    elif method == "device.status":
#        device_uuid = uuid.UUID(data)
#
#        chromecast = next(cc for cc in chromecasts.values() if cc.device.uuid == device_uuid)
#        chromecast.wait()
#        # print(chromecast.status)
#        return [chromecast.status.display_name, chromecast.status.icon_url]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hostname", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--static", type=str, default=None)
    parser.add_argument("--no-static", action='store_const', const=None, dest="static")
    parser.add_argument("--media", type=str, default="tmp")
    parser.add_argument("--media-port", type=int, default=8060)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)

    async def playfile(data):
        chromecast = chromecasts_obj[uuid.UUID(data['chromecast_uuid'])]

        chromecast.wait()
        mc = chromecast.media_controller

        url = manager.host_file(data['file_id'])

        print("File -->", url)

        if url is None:
            return {}

        mc.play_media(url, "video/mp4", stream_type="LIVE")
        mc.block_until_active()

        print(mc.status)

        mc.pause()
        time.sleep(5)
        mc.play()

        return {}

    async def playlocal(data):
        url = manager.host_file(data['file_id'], data['audio_stream_index'])

        return { 'url': url }


    server = Server()

    ccdiscovery = server.add_noticeboard('ccdiscovery', list())
    listfiles = server.add_noticeboard('listfiles', dict())

    server.add_method('playfile', playfile)
    server.add_method('playlocal', playlocal)

    loop = asyncio.get_event_loop()

    media_server = ConversionServer(hostname=args.hostname, port=args.media_port)
    manager = MediaManager(args.media, listfiles, loop, server=media_server)
    manager.start()

    discover_chromecasts(ccdiscovery, loop)

    try:
        task1 = http.run(server, hostname=args.hostname, port=args.port, static=args.static)
        task2 = media_server.start()

        loop.run_until_complete(task1)
        loop.run_until_complete(task2)
        loop.run_forever()

    except KeyboardInterrupt:
        sys.exit(0)

