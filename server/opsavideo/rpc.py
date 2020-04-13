import asyncio
import json
import logging

LOG = logging.getLogger('opsavideo.rpc')
class Noticeboard:
    def __init__(self, value):
        self._value = value
        self._subscriptions = dict()

    async def publish(self, value):
        self._value = value
        for (client, index) in self._subscriptions.values():
            await client(json.dumps([4, index, value]))

    async def __call__(self, value):
        self.publish(value)

    def publish_threadsafe(self, value, *, loop):
        asyncio.run_coroutine_threadsafe(self.publish(value), loop)

    async def subscribe(self, sub_index, client, index):
        self._subscriptions[sub_index] = (client, index)
        await client(json.dumps([4, index, self._value]))

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

    async def __call__(self, remote, incoming, outgoing):
        """
        remote is the IP address of the remote, used for logging
        incoming is an asynchrounous generator, yielding every incoming message
        outgoing is an asynchrounous function, used to send messages
        """

        subs = dict()
        try:
            async for msg in incoming:
                payload = json.loads(msg)
                kind = payload[0]
                index = payload[1]

                if kind == 0: # request
                    method = payload[2]
                    data = payload[3]

                    result = await self._methods[method](data)
                    response = [1, index, result]

                    LOG.info('%s "REQ %s(%s)"', remote, method, data)

                    await outgoing(json.dumps(response))

                elif kind == 2: # subscribe
                    method = payload[2]
                    data = payload[3]

                    sub_index = self._next_sub_index
                    self._next_sub_index += 1

                    LOG.info('%s "SUB %s(%s)" => %d', remote, method, data, sub_index)

                    nb = self._noticeboards[method]
                    await nb.subscribe(sub_index, outgoing, index)
                    subs[index] = (nb, sub_index)

                elif kind == 3: # unsubscribe
                    (nb, sub_index) = subs[index]
                    LOG.info('%s "UNSUB %d"', remote, sub_index)
                    del subs[index]
                    nb.unsubscribe(sub_index)

        finally:
            for (nb, sub_index) in subs.values():
                nb.unsubscribe(sub_index)

