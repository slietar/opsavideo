'use strict';


class Application {
  constructor() {
    this.devices = null;

    this.server = new ServerIO();
    this.socket = null;

    this.windows = {
      application: { Class: WindowApplication, element: document.querySelector('#window-app') },
      devices: { Class: WindowDevices, element: document.querySelector('#window-devices') },
      loading: { Class: WindowLoading, element: document.querySelector('#window-loading') }
    };

    this.currentWindow = null;
    this.updateWindow('loading');

    /* this.devices = [['Current device', 'Default']];
    this.updateWindow('devices', this.devices); */
  }

  async connect(attemptsLeft = 5) {
    let deferred = defer();
    let socket = new WebSocket("ws://localhost:8765", "protocolOne");

    let closeListener = (event) => {
      if (attemptsLeft > 0) {
        setTimeout(() => {
          deferred.resolve(this.connect(attemptsLeft - 1));
        }, 1000);
      }
    };

    let errorListener = (event) => {
      if (attemptsLeft === 0) {
        deferred.reject(new Error('Failed connection'));
      }
    };

    socket.addEventListener('open', (event) => {
      socket.removeEventListener('close', closeListener);
      socket.removeEventListener('error', errorListener);

      socket.addEventListener('close', () => {
        this.connect();
      });

      this.server.updateSocket(socket);
      deferred.resolve(socket);
    });

    socket.addEventListener('close', closeListener);
    socket.addEventListener('error', errorListener);

    return await deferred.promise;
  }

  initialize() {
    this.connect()
      .then(() => {
        console.info('CONNECTED');

        // this.server.request('device.list');

        /* this.updateWindow('application', {
          model: "Chromecast Ultra",
          name: "SalonTV 4K",
          uuid: "59ffe8e8-8014-5688-20e0-800703789c9f"
        }); */

        return this.server.request('device.list');
      })
      .then((devices) => {
        this.devices = devices.map(([uuid, name, model]) => ({ uuid, name, model }));
        this.updateWindow('devices', this.devices);
      })
      .catch((err) => {
        console.error(err.message);
      });
  }


  updateWindow(name, ...args) {
    if (this.currentWindow !== null) {
      let { instance, name } = this.currentWindow;
      let element = this.windows[name].element;

      this.currentWindow.instance.unrender(element);

      let newElement = element.cloneNode(true);
      element.parentNode.replaceChild(newElement, element);
      this.windows[name].element = newElement;
    }

    for (let { Class, element } of Object.values(this.windows)) {
      element.classList.remove('active');
    }

    let { Class, element } = this.windows[name];
    this.currentWindow = { instance: new Class(this, element, ...args), name };
    this.currentWindow.instance.render(element);

    element.classList.add('active');
  }
}

class WindowLoading {
  constructor(app, element) {

  }

  render() {

  }

  unrender() {

  }
}

class WindowDevices {
  constructor(app, element, devices) {
    this.app = app;
    this.element = element;

    this.devices = devices;
  }

  render() {
    let ul = this.element.querySelector('ul');
    ul.innerHTML = '';
    
    for (let device of this.devices) {
      let li = document.createElement('li');
      li.innerHTML = `<button type="button"><div class="device-name">${device.name}</div><div class="device-model">${device.model}</div></button>`;

      li.querySelector('button').addEventListener('click', (event) => {
        event.preventDefault();
        this.app.updateWindow('application', device);
      });

      ul.appendChild(li);
    }
  }

  unrender() {

  }
}

class WindowApplication {
  constructor(app, element, device) {
    this.app = app;
    this.element = element;

    this.device = device;
  }

  render() {
    let deviceInfo = this.element.querySelector('header .device-info');

    deviceInfo.querySelector('.device-name').innerHTML = this.device.name;
    deviceInfo.querySelector('.device-model').innerHTML = this.device.model;

    deviceInfo.addEventListener('click', (event) => {
      event.preventDefault();

      this.app.updateWindow('devices', this.app.devices);
    });


    this.app.server.request('listfiles')
      .then((files) => {
        let ul = this.element.querySelector('.file-list');
        
        ul.innerHTML = files.map(([filename, basename, size]) => `<li><button class="file-item"><img src="https://via.placeholder.com/40" class="file-thumbnail" /><div class="file-info"><div class="file-name">${basename}</div><div class="file-details">${humanSize(size)}</div></div></button></li>`).join('');

        ul.classList.remove('loading');
      });


    this.app.server.request('device.status', this.device.uuid)
      .then(([ctrlName, ctrlIcon]) => {
        this.element.querySelector('.play-name').innerHTML = ctrlName;

        if (ctrlIcon !== null) {
          this.element.querySelector('.play-thumbnail').setAttribute('src', ctrlIcon);
        }
      });
  }

  unrender() {

  }
}


class ServerIO {
  constructor() {
    this._socket = null;

    this.requests = [];
  }

  listen() {
    // TODO
  }

  request(type, payload = {}) {
    this._socket.send(JSON.stringify([type, payload]));

    return new Promise((resolve, reject) => {
      let listener = (event) => {
        let [receivedType, receivedPayload] = JSON.parse(event.data);

        if (receivedType === type) {
          this._socket.removeEventListener('message', listener);
          this.requests.splice(this.requests.indexOf(request), 1);

          resolve(receivedPayload);
        }
      };

      let request = [type, payload, listener];

      this._socket.addEventListener('message', listener);
      this.requests.push(request);
    });
  }

  updateSocket(socket) {
    this._socket = socket;

    let requests = this.requests;
    this.requests = [];

    for (let [type, payload, listener] of requests) {
      this._socket.send(JSON.stringify([type, payload]));
      this._socket.addEventListener('message', listener);
    }
  }
}

class _ServerIO {
  constructor() {
    this.listeners = {};
    this._socket = null;
  }

  updateSocket(socket) {
    this._socket = socket;

    this._socket.addEventListener('message', (event) => {
      let [type, payload] = JSON.parse(event.data);
      this._emit(type, payload);
    });
  }

  on(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }

    this.listeners[type].push(listener);
  }

  off(type, listener) {
    if (this.listeners[type]) {
      let index = this.listeners[type].indexOf(listener);

      if (index >= 0) {
        this.listeners[type].splice(index, 1);
      }
    }
  }

  once(type, listener) {
    let _listener = (event) => {
      listener(event);
      this.off(type, _listener);
    };

    this.on(type, _listener);
  }

  _emit(type, event) {
    if (this.listeners[type]) {
      for (let listener of this.listeners[type]) {
        listener(event);
      }
    }
  }

  receive(type) {
    return new Promise((resolve, reject) => {
      this.once(type, resolve);
    });
  }

  send(type, payload = null) {
    this._socket.send(JSON.stringify([type, payload]));
  }
}

function defer() {
  let resolve, reject;

  let promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  return { promise, resolve, reject };
}


function humanSize(bytes, precision) {
  let mags = ' kMGTPEZY';

  let magnitude = Math.min(Math.log(bytes) / Math.log(1024) | 0, mags.length - 1);
  let result = bytes / Math.pow(1024, magnitude);
  let suffix = mags[magnitude].trim() + 'B';

  return result.toFixed(precision) + ' ' + suffix;
}



window.app = new Application();

app.initialize();

