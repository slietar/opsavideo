import asyncio
import json
import logging

LOG = logging.getLogger('opsavideo.rpc')
class Noticeboard:
    def __init__(self, value):
        self._value = value
        self._subscriptions = dict()

    async def publish(self, value = None):
        if value is not None:
            self._value = value

        for (update, remove) in self._subscriptions.values():
            await update(value)

    def publish_threadsafe(self, value, *, loop):
        asyncio.run_coroutine_threadsafe(self.publish(value), loop)

    async def subscribe(self, sub_index, client):
        (update, remove) = client

        self._subscriptions[sub_index] = client
        await update(self._value)

    def unsubscribe(self, sub_index):
        del self._subscriptions[sub_index]

    async def clear(self):
        for (update, remove) in self._subscriptions.values():
            await remove()

        self._subscriptions = dict()

class Server:
    def __init__(self):
        self._methods = dict()
        self._sub_index_next = 0

    def add_method(self, name, handler):
        self._methods[name] = handler

    async def __call__(self, remote, incoming, outgoing):
        """
        remote is the IP address of the remote, used for logging
        incoming is an asynchrounous generator, yielding every incoming message
        outgoing is an asynchrounous function, used to send messages
        """

        LOG.debug("Added client")

        subs = dict()

        try:
            async for msg in incoming:
                payload = json.loads(msg)
                kind = payload['kind']
                index = payload['index']

                if kind == 'request':
                    method = payload['method']
                    data = payload['data']

                    result = await self._methods[method](data)

                    if isinstance(result, Noticeboard):
                        noticeboard = result

                        sub_index = self._sub_index_next
                        self._sub_index_next += 1

                        subs[sub_index] = noticeboard

                        async def notify(data):
                            await outgoing(json.dumps({
                                'kind': 'notification',
                                'index': sub_index,
                                'data': data
                            }))

                        async def update(data):
                            await notify({ 'type': 'update', 'data': data })

                        async def remove():
                            del subs[sub_index]
                            await notify({ 'type': 'remove' })

                        LOG.debug("Subscribing client to noticeboard %s with subscription index %d, request index %d", result, sub_index, index)

                        await outgoing(json.dumps({
                            'kind': 'response',
                            'index': index,
                            'data': { 'index': sub_index }
                        }))

                        await noticeboard.subscribe(sub_index, (update, remove))

                    elif isinstance(result, int):
                        sub_index = result
                        noticeboard = subs[sub_index]

                        noticeboard.unsubscribe(sub_index)
                        del subs[sub_index]

                        LOG.debug("Unsubscribing client from noticeboard %s with subscription index %d, request index %d", noticeboard, sub_index, index)

                        await outgoing(json.dumps({
                            'kind': 'response',
                            'index': index,
                            'data': {}
                        }))

                    else:
                        LOG.debug("Answering request of method %s, index %d", method, index)

                        await outgoing(json.dumps({
                            'kind': 'response',
                            'index': index,
                            'data': result
                        }))

                elif kind == 'response':
                    LOG.warn("Ignoring response message")

                else:
                    raise Exception("Unknown message kind")

        except Exception as err:
            LOG.warn(f"Client disconnected with error '{err}'")

            import traceback
            traceback.print_exc()
        finally:
            # self._call_method('close', client)

            for sub_index, noticeboard in subs.items():
                noticeboard.unsubscribe(sub_index)

