import asyncio
import pychromecast
import pychromecast.discovery
import sys
import time
import uuid
import websockets

from opsavideo.media import MediaManager
from opsavideo.server import Noticeboard, Server


def discover_chromecasts(cb):
    chromecasts = {}
    def export_chromecast(cc):
        return [str(cc.device.uuid), cc.device.friendly_name, cc.device.model_name]

    def publish_chromecast():
        data = [export_chromecast(cc) for cc in chromecasts.values()]
        cb(data)

    def add_chromecast(name):
        cc = pychromecast._get_chromecast_from_host(
            listener.services[name],
            tries=5,
            blocking=False,
        )

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


s = Server()

ccdiscovery = s.add_noticeboard('ccdiscovery', [])
listfiles = s.add_noticeboard('listfiles', {})

m = MediaManager("tmp", listfiles)
m.start()


discover_chromecasts(ccdiscovery.publish_threadsafe)
start_server = websockets.serve(s, "localhost", 8765)

print("READY");

try:
    asyncio.get_event_loop().run_until_complete(start_server)
    asyncio.get_event_loop().run_forever()
except KeyboardInterrupt:
    sys.exit(0)

