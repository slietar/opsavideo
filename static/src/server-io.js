import * as util from './util.js';

/*
 * ServerIO
 *
 * Message format
 *  - message type
 *     0: request,
 *     1: response,
 *     2: subscription request,
 *     3: subscription end,
 *     4: subscription message
 *  - index
 *  - method (if request or subscription request)
 *  - data (except subscription end)
 *
 */
export default class ServerIO {
  constructor() {
    this._socket = null;

    this.index = 0;

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
    let index = ++this.index;

    let callback = (data) => {
      deferred.resolve(data);
      delete this.requests[index];
    };

    this.requests[index] = {
      callback,
      data,
      method
    };

    this._socket.send(JSON.stringify([0, index, method, data]));

    return deferred.promise;
  }

  subscribe(method, data = {}, callback) {
    let index = ++this.index;

    this.subscriptions[index] = {
      callback,
      data,
      method
    };

    this._socket.send(JSON.stringify([2, index, method, data]));

    return () => {
      this._socket.send(JSON.stringify([3, index]));
      delete this.subscriptions[index];
    };
  }

  updateSocket(socket) {
    this._socket = socket;

    this._socket.addEventListener('message', (event) => {
      let [kind, ...payload] = JSON.parse(event.data);

      if (kind === 1) { // response
        let [index, data] = payload;
        this.requests[index].callback(data);

        delete this.requests[index];
      } else if (kind === 4) { // sub message
        let [index, data] = payload;
        this.subscriptions[index].callback(data);
      }
    });

    this._socket.addEventListener('close', (event) => {
      if (this.onDisconnected) {
        this.onDisconnected();
      }
    });

    for (let index in this.requests) {
      let req = this.requests[index];
      this._socket.send(JSON.stringify([0, index, req.method, req.data]));
    }

    for (let index in this.subscriptions) {
      let sub = this.subscriptions[index];
      this._socket.send(JSON.stringify([2, index, sub.method, sub.data]));
    }
  }
}

