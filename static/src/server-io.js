import * as util from './util.js';


export default class ServerIO {
  constructor() {
    this._socket = null;

    this._requests = {};
    this._requestIndexNext = 0;

    this._subscriptions = new Set();
    this._subscriptionsMap = new Map();
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

  async connectRepeated(attemptsLeft) {
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

  /*
   * Statuses:
   *  - WAITING for socket (cancel -> CANCELED, updateSocket -> SENT)
   *  - SENT (cancel -> CANCELING, removeSocket -> WAITING, response -> RETURNED)
   *  - CANCELING (removeSocket -> CANCELED, response -> CANCELED)
   *  - CANCELED
   *  - RETURNED
   */
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

  /*
   * Statuses:
   *  - WAITING for socket (cancel -> UNSUBSCRIBED, updateSocket -> SUBSCRIBING)
   *  - SUBSCRIBING (cancel -> UNSUBSCRIBING SUBSCRIBING, removeSocket -> SUBSCRIBING, response -> SUBSCRIBED)
   *  - SUBSCRIBED (cancel -> UNSUBSCRIBING, remooveSocket -> SUBSCRIBING)
   *  - UNSUBSCRIBING (removeSocket -> UNSUBSCRIBED, response -> UNSUBSCRIBED)
   *  - UNSUBSCRIBING SUBSCRIBING (removeSocket -> UNSUBSCRIBED, response -> UNSUBSCRIBING)
   *  - UNSUBSCRIBED
   */
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


    let readyDeferred = util.defer();
    let readyPromise = readyDeferred.promise;

    let sub = {
      status: 'none',

      data: JSON.parse(JSON.stringify(data)),
      index: null,
      subscribeRequest: null,
      unsubscribeRequest: null,
      value: null,

      subscribe: async () => {
        let request = this.request('subscribe', data);

        sub.status = 'subscribing';
        sub.subscribeRequest  = request;

        let index;

        try {
          index = (await request.getResponse()).index;
        } catch (err) {
          return;
        }

        this._subscriptionsMap.set(index, sub);

        sub.index = index;
        sub.status = 'subscribed';
        sub.subscribeRequest = null;
      },
      unsubscribe: async () => {
        let request = this.request('unsubscribe', { index: sub.index });

        sub.status = 'unsubscribing';
        sub.unsubscribeRequest = request;

        try {
          await request.getResponse();
        } catch (err) {}

        sub.status = 'unsubscribed';
      },
      unsubscribed: () => {
        sub.status = 'unsubscribed';
        handlers.remove();

        this._subscriptions.delete(sub);
      },
      update: (value) => {
        sub.value = value;
        handlers.update(value);

        if (readyDeferred) {
          readyDeferred.resolve(value);
        }
      }
    };

    this._subscriptions.add(sub);
    sub.subscribe();

    return {
      cancel: async () => {
        if (readyDeferred) {
          readyDeferred.reject(new Error('Canceled'));
          readyDeferred = null;
        }

        if (sub.status === 'subscribing') {
          let response = await sub.subscribeRequest.cancel();

          if (response) {
            sub.index = response.index;
            await sub.unsubscribe();
          } else {
            sub.status = 'unsubscribed';
          }
        } else if (sub.status === 'subscribed') {
          await sub.unsubscribe();
        } else if (sub.status === 'waiting') {
          sub.status = 'unsubscribed';
        } else {
          console.warn('The subscription was already canceled.');
          return;
        }

        this._subscriptions.delete(sub);
      },

      get value() {
        if (sub.value === null) {
          throw new Error('Invalid data');
        }

        return sub.value;
      },

      async wait() {
        await readyPromise;
        return sub.value;
      }
    };
  }


  removeSocket() {
    this._socket = null;

    for (let sub of this._subscriptions) {
      if (sub.status === 'unsubscribing') {
        sub.unsubscribeRequest.cancel();
      }
    }

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
      let { kind, index } = payload;

      switch (kind) {
        case 'notification': {
          let { data, type } = payload.data;
          let sub = this._subscriptionsMap.get(index);

          if (sub && sub.status === 'subscribed') {
            switch (type) {
              case 'update':
                sub.update(data);
                break;

              case 'remove':
                sub.unsubscribed();
                break;
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
      this._socket.send(req.raw);
    }


    this._subscriptionsMap.clear();

    for (let sub of this._subscriptions) {
      if (sub.status === 'subscribed') {
        sub.subscribe();
      }
    }
  }
}

