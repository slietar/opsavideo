import asyncio
import glob
import json
import os
import pychromecast
import time
import uuid
import websockets


CONNECTIONS = set()
chromecasts = []

async def handler(websocket, path):
    conn_addr = websocket.remote_address[0] + ":" + str(websocket.remote_address[1])
    print("OPEN " + conn_addr)

    try:
        while True:
            msg = await websocket.recv()
            data = json.loads(msg)

            print(data)

            if data[0] == "device.list":
                chromecasts = pychromecast.get_chromecasts(timeout=1)
                await websocket.send(json.dumps(["device.list", [[str(cc.device.uuid), cc.device.friendly_name, cc.device.model_name] for cc in chromecasts]]))

            elif data[0] == "device.status":
                device_uuid = uuid.UUID(data[1])

                chromecast = next(cc for cc in chromecasts if cc.device.uuid == device_uuid)
                chromecast.wait()
                # print(chromecast.status)
                await websocket.send(json.dumps(["device.status", [chromecast.status.display_name, chromecast.status.icon_url]]))

            elif data[0] == "listfiles":
                filenames = glob.glob("tmp/**/*.mkv") + glob.glob("tmp/**/*.mp4")
                response = []

                for filename in filenames:
                    basename = os.path.basename(filename)
                    size = os.path.getsize(filename)
                    response.append([filename, basename, size])

                time.sleep(4)

                await websocket.send(json.dumps(["listfiles", response]))

            else:
                await websocket.send(json.dumps(["error"]))
    except websockets.exceptions.ConnectionClosedOK:
        pass
    finally:
        print("CLOSE " + conn_addr)

"""
async def send_devices(d):
    for c in CONNECTIONS:
        await c.send(d)

def add_device(..):
    DEVICES = ...
    asyncio.get_event_loop().call_soon_threadsafe(send_devices, DEVICES[:])
"""

start_server = websockets.serve(handler, "localhost", 8765)

print("READY");

asyncio.get_event_loop().run_until_complete(start_server)
asyncio.get_event_loop().run_forever()

