import asyncio
import json

event_loop = asyncio.get_event_loop()

class Noticeboard:
    def __init__(self, value):
        self._value = value
        self._subscriptions = dict()

    async def publish(self, value):
        self._value = value
        # print("Publish " + repr(value))
        for (client, index) in self._subscriptions.values():
            await client.send(json.dumps([4, index, value]))

    async def __call__(self, value):
        self.publish(value)

    def publish_threadsafe(self, value, *, loop=event_loop):
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

