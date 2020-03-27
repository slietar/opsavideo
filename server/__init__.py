import asyncio
import glob
import json
import os
import pychromecast
import pychromecast.discovery
import sys
import time
import uuid
import websockets

class Noticeboard:
    def __init__(self, value):
        self._value = value
        self._subscriptions = dict()

    async def publish(self, value):
        self._value = value
        print("Publish " + repr(value))
        for (client, index) in self._subscriptions.values():
            await client.send(json.dumps([4, index, value]))

    async def __call__(self, value):
        self.publish(value)

    def publish_threadsafe(self, value, *, loop):
        asyncio.run_coroutine_threadsafe(self.publish(value), loop)

    async def subscribe(self, sub_index, client, index):
        self._subscriptions[sub_index] = (client, index)
        await client.send(json.dumps([4, index, self._value]))

    def unsubscribe(self, sub_index):
        del self._subscriptions[sub_index]

class Server:
    def __init__(self):
        self._methods = dict()
        self._noticeboards = dict()
        self._next_sub_index = 0

    def add_noticeboard(self, name, value):
        n = Noticeboard(value)
        self._noticeboards[name] = n
        return n

    def add_method(self, name, f):
        self._methods[name] = f

    async def __call__(self, websocket, path):
        subs = dict()
        try:
            while True:
                msg = await websocket.recv()
                payload = json.loads(msg)
                kind = payload[0]
                index = payload[1]

                if kind == 0: # request
                    method = payload[2]
                    data = payload[3]

                    result = await self._methods[method](data)
                    response = [1, index, result]
                    await websocket.send(json.dumps(response))

                elif kind == 2: # subscribe
                    method = payload[2]
                    print("Subscribe {} index={}".format(method, index))

                    sub_index = self._next_sub_index
                    self._next_sub_index += 1
                    await self._noticeboards[method].subscribe(sub_index, websocket, index)
                    subs[index] = (method, sub_index)

                elif kind == 3: # unsubscribe
                    print("Unsubscribe index={}".format(index))
                    (method, sub_index) = subs[index]
                    del subs[index]
                    self._noticeboards[method].unsubscribe(sub_index)

        except websockets.exceptions.ConnectionClosedOK:
            pass

        finally:
            for (method, sub_index) in subs.values():
                self._noticeboards[method].unsubscribe(sub_index)

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
    
        chromecasts[name] = cc
        publish_chromecast()
    
    def remove_chromecast(name):
        del chromecasts[name]
        publish_chromecast()
    
    listener, browser = pychromecast.discovery.start_discovery(add_chromecast, remove_chromecast)

async def listfiles(data):
    filenames = glob.glob("tmp/**/*.mkv") + glob.glob("tmp/**/*.mp4")
    response = []

    for filename in filenames:
        basename = os.path.basename(filename)
        size = os.path.getsize(filename)
        response.append([filename, basename, size])

    time.sleep(1)

    return response

#    if method == "device.list":
#        chromecasts = pychromecast.get_chromecasts(timeout=1)
#        return [[str(cc.device.uuid), cc.device.friendly_name, cc.device.model_name] for cc in chromecasts]
#
#    elif method == "device.status":
#        device_uuid = uuid.UUID(data)
#
#        chromecast = next(cc for cc in chromecasts.values() if cc.device.uuid == device_uuid)
#        chromecast.wait()
#        # print(chromecast.status)
#        return [chromecast.status.display_name, chromecast.status.icon_url]

def main():
  s = Server()
  s.add_method("listfiles", listfiles)
  ccdiscovery = s.add_noticeboard('ccdiscovery', [])
  
  event_loop = asyncio.get_event_loop()
  discover_chromecasts(lambda data: ccdiscovery.publish_threadsafe(data, loop=event_loop))
  start_server = websockets.serve(s, "localhost", 8765)
  
  print("READY");
  
  try:
      asyncio.get_event_loop().run_until_complete(start_server)
      asyncio.get_event_loop().run_forever()
  except KeyboardInterrupt:
      sys.exit(0)
