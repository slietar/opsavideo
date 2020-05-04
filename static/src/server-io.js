import * as util from './util.js';


export default class ServerIO {
  constructor() {
    this._socket = null;

    this.next_index = 0;

    this.requests = {};
    this.subscriptions = {};
  }

  connect() {
    console.log('%c SERVER ' + '%c Attempting connection', 'background-color: #0074d9; color: #fff', '');

    let deferred = util.defer();
    let socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

    let errorListener = (event) => {
      deferred.reject(new Error('Failed connection'));
    };

    socket.addEventListener('error', errorListener);

    socket.addEventListener('open', (event) => {
      socket.removeEventListener('error', errorListener);

      socket.addEventListener('close', () => {
        this.connect();
      });

      console.log('%c SERVER ' + '%c Connected', 'background-color: #0074d9; color: #fff', '');
      this.updateSocket(socket);
      deferred.resolve();
    });

    return deferred.promise;
  }

  async connectRepeated(attemptsLeft = 5) {
    if (attemptsLeft === 1) {
      return await this.connect();
    }

    try {
      let x = await this.connect();
    } catch (err) {
      await util.wait(1000);
      return await this.connectRepeated(attemptsLeft - 1);
    }
  }

  request(method, data = {}) {
    let deferred = util.defer();
    let index = this.next_index++;
    let req = { data, deferred, method };

    this.requests[index] = req;

    console.log('Sending', {
      kind: 'request',
      index,
      method,
      data
    });

    this._socket.send(JSON.stringify({
      kind: 'request',
      index,
      method,
      data
    }));

    let result = {
      cancel() {
        result.cancel = async () => {
          throw new Error('Already canceled');
        };

        if (!req.deferred) {
          throw new Error('Already completed');
        }

        req.deferred.reject(new Error('Canceled'));
        req.deferred = null;
      },
      promise: req.deferred.promise
    };

    return result;
  }

  subscribe(data, handlers) {
    if (typeof data === 'string') {
      data = { name: data };
    }

    if (typeof handlers === 'function') {
      handlers = {
        update: handlers,
        remove() {
          console.warn('A subscription removal was ignored.');
        }
      };
    }


    let { cancel, promise } = this.request('subscribe', data);

    let result = {
      cancel: async () => {
        await cancel();
      },

      promise: (async () => {
        let { index } = await promise;

        let deferred = util.defer();
        let sub = { data, deferred, handlers };

        this.subscriptions[index] = sub;

        result.cancel = async () => {
          if (sub.deferred) {
            sub.deferred.reject(new Error('Canceled'));
            sub.deferred = null;
          }

          this.subscriptions[index] = null;

          await this.request('unsubscribe', { index });
          delete this.subscriptions[index];
        };

        return await sub.deferred.promise;
      })()
    };

    return result;
  }

  updateSocket(socket) {
    this._socket = socket;

    this._socket.addEventListener('message', (event) => {
      let payload = JSON.parse(event.data);
      console.log('Received', payload);
      let { kind, index } = payload;

      switch (kind) {
        case 'notification': {
          let { data, type } = payload.data;
          let sub = this.subscriptions[index];

          if (sub !== null) {
            switch (payload.data.type) {
              case 'update':
                sub.handlers.update(payload.data.data);
                break;

              case 'remove':
                delete this.subscriptions[index];
                sub.handlers.remove();
                break;
            }

            if (sub.deferred) {
              sub.deferred.resolve(payload.data.data);
              sub.deferred = null;
            }
          }

          break;
        }

        case 'response': {
          let req = this.requests[index];

          if (req.deferred) {
            req.deferred.resolve(payload.data);
            req.deferred = null;
          }

          delete this.requests[index];
          break;
        }

        default:
          console.warn(`Unknown message kind '${kind}'`);
      }
    });

    this._socket.addEventListener('close', (event) => {
      if (this.onDisconnected) {
        this.onDisconnected();
      }
    });

    for (let [index, req] of Object.entries(this.requests)) {
      this.request(req.method, req.data)
        .then(req.deferred.resolve)
        .catch(req.deferred.reject);

      delete this.requests[index];
    }

    for (let [subIndex, { data, sub }] of Object.entries(this.subscriptions)) {
      this.subscribe(data, sub);
      delete this.subscriptions[subIndex];
    }
  }
}

