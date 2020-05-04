import * as util from './util.js';


export default class ServerIO {
  constructor() {
    this._socket = null;

    this._requests = {};
    this._requestIndexNext = 0;

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
        this.removeSocket();
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
    let index = this._requestIndexNext++;

    let raw = JSON.stringify({
      kind: 'request',
      index,
      method,
      data
    });

    let req = { canceled: false, deferred, raw };

    this._requests[index] = req;

    if (this._socket !== null) {
      console.log('Sending 1', JSON.parse(raw));
      this._socket.send(raw);
    }

    return {
      cancel: async () => {
        if (req.canceled) {
          throw new Error('Already canceled');
        }

        req.canceled = true;
        req.deferred.reject(new Error('Canceled'));

        if (this._socket !== null) {
          req.deferred = util.defer();

          return await req.deferred.promise;
        } else {
          delete this._requests[index];
        }
      },
      async getResponse() {
        if (req.canceled) {
          throw new Error('Canceled');
        }

        return await req.deferred.promise;
      }
    };
  }

  subscribe(data, handlers = () => {}) {
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


    let { cancel, getResponse } = this.request('subscribe', data);

    let sub = null;
    let readyPromise = (async () => {
      let { index } = await getResponse();

      sub = {
        deferred: util.defer(),
        handlers,
        value: null
      };

      this.subscriptions[index] = sub;

      result.cancel = async () => {
        if (sub.deferred) {
          sub.deferred.reject(new Error('Canceled'));
          sub.deferred = null;
        }

        this.subscriptions[index] = null;
        await this.request('unsubscribe', { index }).getResponse();
        delete this.subscriptions[index];
      };

      await sub.deferred.promise;
    })();

    let result = {
      cancel: async () => {
        let response = await cancel();

        if (response) {
          let index = response.index;

          this.subscriptions[index] = null;
          await this.request('unsubscribe', { index }).getResponse();
          delete this.subscriptions[index];
        }
      },

      get value() {
        if (!sub || sub.value === null) {
          throw new Error('Invalid data');
        }

        return sub.value;
      },

      async wait() {
        await readyPromise;
        return result.value;
      }
    };

    return result;
  }


  removeSocket() {
    this._socket = null;

    for (let [reqIndex, req] of Object.entries(this._requests)) {
      if (req.canceled) {
        req.deferred.resolve();
        delete this._requests[reqIndex];
      }
    }
  }

  updateSocket(socket) {
    if (this._socket !== null) {
      this.removeSocket();
    }

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
                sub.value = payload.data.data;
                sub.handlers.update(sub.value);
                break;

              case 'remove':
                delete this.subscriptions[index];
                sub.handlers.remove();
                break;
            }

            if (sub.deferred) {
              sub.deferred.resolve();
              sub.deferred = null;
            }
          }

          break;
        }

        case 'response': {
          let req = this._requests[index];
          req.deferred.resolve(payload.data);
          delete this._requests[index];

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

    for (let [reqIndex, req] of Object.entries(this._requests)) {
      console.log('Sending 2', JSON.parse(raw));
      this._socket.send(req.raw);
    }
  }
}

