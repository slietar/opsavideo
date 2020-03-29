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
  }

  async connect(attemptsLeft = 5) {
    let deferred = defer();
    let socket = new WebSocket("ws://localhost:8765");

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
        });

        return this.server.request('device.list');
      })
      .then((devices) => {
        this.devices = devices.map(([uuid, name, model]) => ({ uuid, name, model })); */

        // this.updateWindow('devices');
        this.updateWindow('application', {
          name: 'SalonTV 4K',
          model: 'Chromecast Ultra'
        });
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
  constructor(app, element) {
    this.app = app;
    this.element = element;
  }

  render() {
    this.element.querySelector('ul').innerHTML = '';

    this.stopDiscovery = this.app.server.subscribe('ccdiscovery', {}, (chromecasts) => {
      this.renderDevices(chromecasts.map(([uuid, name, model]) => ({
        uuid, name, model
      })));
    });
  }

  renderDevices(devices) {
    let ul = this.element.querySelector('ul');
    ul.innerHTML = '';

    for (let device of devices) {
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
    this.stopDiscovery();
  }
}

class WindowApplication {
  constructor(app, element, device) {
    this.app = app;
    this.element = element;

    this.device = device;
  }

  render() {
    let appMedia = this.element.querySelector('.app-media');
    let appMediaList = this.element.querySelector('.app-container');


    let deviceData = this.element.querySelector('header .device-data');
    let deviceInfo = deviceData.querySelector('.device-current');

    deviceInfo.querySelector('.device-name').innerHTML = this.device.name;
    deviceInfo.querySelector('.device-model').innerHTML = this.device.model;

    deviceInfo.addEventListener('click', (event) => {
      event.preventDefault();

      deviceData.classList.toggle('dropdown-active');
    });

    deviceData.addEventListener('blur', (event) => {
      deviceData.classList.remove('dropdown-active');
    }, true /* inherit listener */);


    let ul = this.element.querySelector('.media-list');

    this.app.server.subscribe('listfiles', {}, ({ files, medias }) => {
      let objects = [];
      let referencedMedias = {};

      for (let [filepath, file] of Object.entries(files)) {
        if (file.media) {
          if (referencedMedias[file.media]) {
            let object = objects[referencedMedias[file.media]];
            object.files.push(filepath);
          } else {
            referencedMedias[file.media] = objects.length;

            objects.push({
              type: 'media',
              files: [filepath],
              mediaId: file.media
            });
          }
        } else {
          objects.push({
            type: 'file',
            filepath
          });
        }
      }


      ul.innerHTML = '';

      for (let object of objects) {
        let media = object.type === 'media' ? medias[object.mediaId] : null;
        let file = object.type === 'file' ? files[object.filepath] : null;

        let title = media && media.title || file.title;
        let imageUrl = media && media.image || null;
        let description = media && media.description || null;

        /* if (object.type === 'media') {
          let media = medias[object.mediaId];

          imageUrl = media.image;
          title = media.title;
        } else {
          let file = files[object.filepath];
          title = file.title;
        } */

        let button = document.createElement('button');
        button.classList.add('media-item');
        button.innerHTML = `<div class="media-image" ${imageUrl ? ` style="background-image: url(${imageUrl})"` : ''}></div><div class="media-name">${title}</div>`;

        let li = document.createElement('li');
        li.appendChild(button);
        ul.appendChild(li);

        button.addEventListener('click', () => {
          appMedia.classList.add('active');
          appMediaList.classList.add('hidden');

          appMedia.querySelector('h1').innerHTML = title;

          if (imageUrl) {
            appMedia.querySelector('.app-media-image').style['background-image'] = `url(${imageUrl})`;
          }

          let p = appMedia.querySelector('p');
          if (description) {
            p.innerHTML = description;
          } else {
            p.style.display = 'none';
          }

          if (media && media.wallpaper) {
            let wallpaperUrl = media.wallpaper.substring(0, media.wallpaper.search('@._V1_')) + '@._V1_.jpg'; // TODO: move to server
            appMedia.querySelector('.app-media-background').style['background-image'] = `url(${wallpaperUrl})`;
          }
        });

        // ul.innerHTML += `<li><button class="media-item"><div class="media-image" ${imageUrl ? ` style="background-image: url(${imageUrl})"` : ''}></div><div class="media-name">${title}</div></button></li>`;
      }

      return;

      for (let element of ul.querySelectorAll('.media-item')) {
        element.addEventListener('click', (event) => {
          event.preventDefault();

          let appMedialist = this.element.querySelector('.app-container');
          appMedialist.classList.add('hidden');

          let appMedia = this.element.querySelector('.app-media');
          let image = element.querySelector('.media-image');
          let imageRect = image.getBoundingClientRect();
          let bodyRect = document.body.getBoundingClientRect();

          // let ratio = imageRect.width / 300;

          image.classList.add('moving');
          image.style.setProperty('--position-x', (imageRect.left - bodyRect.left) + 'px');
          image.style.setProperty('--position-y', (imageRect.top - bodyRect.top) + 'px');

          setTimeout(() => {
            appMedia.classList.add('active');
            // image.classList.add('moved');
          }, 10);
        });
      }
    });
  }

  unrender() {

  }
}


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
class ServerIO {
  constructor() {
    this._socket = null;

    this.index = 0;

    this.requests = {};
    this.subscriptions = {};
  }

  request(method, data = {}) {
    console.info('REQUEST', method);

    let deferred = defer();
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

