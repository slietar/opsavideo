import argparse
import logging
import asyncio
import pychromecast
import pychromecast.discovery
import sys
import time
import uuid
import websockets

from .media import MediaManager
from .rpc import Noticeboard, Server
from . import http

chromecasts_obj = dict()

def discover_chromecasts(cb):
    chromecasts = {}
    def export_chromecast(cc):
        return [str(cc.device.uuid), cc.device.friendly_name, cc.device.model_name]

    def publish_chromecast():
        cb([export_chromecast(cc) for cc in chromecasts.values()])

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

async def playfile(data):
    chromecast = chromecasts_obj[uuid.UUID(data['chromecast_uuid'])]
    filepath = manager.files[data['file_id']]['filepath']

    print(chromecast, filepath)

    chromecast.wait()
    mc = chromecast.media_controller
    mc.play_media('http://192.168.1.50:8080/' + filepath, 'video/mp4')
    mc.block_until_active()

    mc.pause()
    time.sleep(5)
    mc.play()

    return {}

def mainX():
    s = Server()

    ccdiscovery = s.add_noticeboard('ccdiscovery', [])
    listfiles = s.add_noticeboard('listfiles', { 'files': dict(), 'medias': dict() })
    s.add_method('playfile', playfile)

    manager = MediaManager("tmp", listfiles)
    manager.start()

    discover_chromecasts(ccdiscovery.publish_threadsafe)
    start_server = websockets.serve(s, "localhost", 8765)

    print("READY");

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hostname", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--static", type=str, default=None)
    parser.add_argument("--no-static", action='store_const', const=None, dest="static")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)

    server = Server()

    ccdiscovery = server.add_noticeboard('ccdiscovery', [])
    listfiles = server.add_noticeboard('listfiles', { 'files': dict(), 'medias': dict() })
    server.add_method('playfile', playfile)

    manager = MediaManager("tmp", listfiles)
    manager.start()

    loop = asyncio.get_event_loop()
    discover_chromecasts(lambda data: ccdiscovery.publish_threadsafe(data, loop=loop))

    try:
        task = http.run(server, hostname=args.hostname, port=args.port, static=args.static)
        loop.run_until_complete(task)
        loop.run_forever()
    except KeyboardInterrupt:
        sys.exit(0)

