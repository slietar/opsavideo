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


event_loop = asyncio.get_event_loop()

chromecasts = {}
subs = {}
next_sub_index = 0

subs_discovery = set()

async def handler(websocket, path):
    global next_sub_index

    conn_addr = websocket.remote_address[0] + ":" + str(websocket.remote_address[1])
    client_subs = {}

    print("OPEN " + conn_addr)

    try:
        while True:
            msg = await websocket.recv()
            payload = json.loads(msg)

            req_kind = payload[0]
            index = payload[1]

            if req_kind == 0: # request
                method = payload[2]
                req_data = payload[3]

                print("-> Received request '" + method + "'")

                res_data = await handle_request(method, req_data)
                res = [1, index, res_data]

                await websocket.send(json.dumps(res))

                print("<- Answered request '" + method + "'")

            elif req_kind == 2: # subscription request
                method = payload[2]
                req_data = payload[3]

                sub_index = next_sub_index
                next_sub_index += 1

                subs[sub_index] = (websocket, index)
                client_subs[index] = sub_index

                print("-> Received subscription '" + method + "' (#" + str(sub_index) + ")")

                await handle_subreq(sub_index, method, req_data)

            elif req_kind == 3: # subscription stop
                sub_index = client_subs[index]

                print("-> Canceled subscription (#" + str(sub_index) + ")")

                del client_subs[index]
                del subs[sub_index]

                await handle_substop(sub_index)

    except websockets.exceptions.ConnectionClosedOK:
        pass
    finally:
        for index, sub_index in client_subs.items():
            print("-- Canceled subscription (#" + str(sub_index) + ")")

            await handle_substop(sub_index)
            del subs[sub_index]

        print("CLOSE " + conn_addr)


async def handle_request(method, data):
    if method == "device.list":
        chromecasts = pychromecast.get_chromecasts(timeout=1)
        return [[str(cc.device.uuid), cc.device.friendly_name, cc.device.model_name] for cc in chromecasts]

    elif method == "device.status":
        device_uuid = uuid.UUID(data)

        chromecast = next(cc for cc in chromecasts.values() if cc.device.uuid == device_uuid)
        chromecast.wait()
        # print(chromecast.status)
        return [chromecast.status.display_name, chromecast.status.icon_url]

    elif method == "listfiles":
        filenames = glob.glob("tmp/**/*.mkv") + glob.glob("tmp/**/*.mp4")
        response = []

        for filename in filenames:
            basename = os.path.basename(filename)
            size = os.path.getsize(filename)
            response.append([filename, basename, size])

        time.sleep(4)

        return response

async def handle_subreq(sub_index, method, data):
    if method == "ccdiscovery":
        subs_discovery.add(sub_index)
        await send_chromecasts()

async def handle_substop(sub_index):
    if sub_index in subs_discovery:
        subs_discovery.discard(sub_index)

async def send_sub(sub_index, data):
    print("<- Sent subscription message (#" + str(sub_index) + ")")

    (client, index) = subs[sub_index]
    await client.send(json.dumps([4, index, data]))




def add_chromecast(name):
    cc = pychromecast._get_chromecast_from_host(
        listener.services[name],
        tries=5,
        blocking=False,
    )

    chromecasts[name] = cc
    asyncio.run_coroutine_threadsafe(send_chromecasts(), event_loop)

def remove_chromecast(name):
    del chromecasts[name]
    asyncio.run_coroutine_threadsafe(send_chromecasts(), event_loop)

async def send_chromecasts():
    for sub_index in subs_discovery:
        await send_sub(sub_index, list(export_chromecast(cc) for cc in chromecasts.values()))

def export_chromecast(cc):
    return [str(cc.device.uuid), cc.device.friendly_name, cc.device.model_name]




listener, browser = pychromecast.discovery.start_discovery(add_chromecast, remove_chromecast)
start_server = websockets.serve(handler, "localhost", 8765)

print("READY");

try:
    asyncio.get_event_loop().run_until_complete(start_server)
    asyncio.get_event_loop().run_forever()
except KeyboardInterrupt:
    sys.exit(0)

