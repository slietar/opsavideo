'use strict';

/** @jsx createElement */


import ServerIO from './server-io.js';
import { Component, createElement } from './dom.js';
import * as util from './util.js';


class Overlay extends Component {
  setLoading() {
    this.refs.self = [
      <div class="overlay-spinner"><div></div><div></div><div></div><div></div></div>
    ];
  }

  setMessage(message, retryCallback) {
    this.refs.self = [
      <p class="overlay-message">{message} <a href="#" onclick={(event) => {
        event.preventDefault();

        if (retryCallback) {
          retryCallback();
        }
      }}>Retry</a></p>
    ];
  }

  render() {
    return (
      <div class="overlay"></div>
    );
  }
}


class WindowMovies extends Component {
  constructor(app) {
    super();

    this.app = app;
    this.mediaObjects = null;
    this.currentMediaObjectId = null;

    this.onFirstMessageCallback = null;
    this.stopSubscription = this.app.server.subscribe('listfiles', {}, ({ files, medias }) => {
      let objects = [];
      let referencedMedias = {};

      for (let [fileId, file] of Object.entries(files)) {
        if (file.media) {
          if (referencedMedias[file.media]) {
            let object = objects[referencedMedias[file.media]];
            object.files.push({ ...file, id: fileId });
          } else {
            referencedMedias[file.media] = objects.length;

            objects.push({
              type: 'media',
              id: util.hash16(file.media),

              files: [{ ...file, id: fileId }],
              media: medias[file.media]
            });
          }
        } else {
          objects.push({
            type: 'file',
            id: util.hash16(file.filepath),

            files: [{ ...file, id: fileId }]
          });
        }
      }

      let isFirstMessage = this.mediaObjects === null;

      this.mediaObjects = objects;

      if (isFirstMessage && this.onFirstMessageCallback) {
        this.onFirstMessageCallback();
      } else if (!this.currentMediaObjectId) {
        this.refs.contents = this.renderMediaObjectList();
      }
    });
  }

  playFile(file) {
    let chromecast = this.app.currentChromecast;

    if (!chromecast) {
      return;
    }

    this.app.server.request('playfile', {
      chromecast_uuid: chromecast.uuid,
      file_id: file.id
    });
  }

  render() {
    return (
      <div id="window-movies" ref="contents"></div>
    );
  }

  renderMediaObject(object) {
    let media = object.media;
    let file = object.files[0];

    let description = media && media.description;
    let imageUrl = media && media.image;
    let title = media && media.title || file.title;
    let wallpaperUrl = media && media.wallpaper ? (media.wallpaper.substring(0, media.wallpaper.search('@._V1_')) + `@._V1_SX${Math.round(window.innerWidth / 4)}_AL_.jpg`) : '';

    return (
      <div class="app-media">
        <div class="app-media-background" style={wallpaperUrl ? `background-image: url(${wallpaperUrl})` : ''}></div>,
        <div class="app-media-image" style={imageUrl ? `background-image: url(${imageUrl});` : ''}></div>,
        <div class="app-media-contents">
          <h1>{title}</h1>
          { description && <p>{description}</p> }
          <button onclick={() => { this.playFile(object.files[0]); }}>Play</button>

          <div class="episode-selector">
            <select class="episode-seasonselector">
              <option>Season 1</option>
              <option>Season 2</option>
            </select>
            <ul class="episode-list">
              <li>
                <a href="#" class="episode-thumbnail"></a>
                <div class="episode-title">The Old Man and the Seat</div>
                <p class="episode-description"> Rick goes to his private bathroom to find that someone else has used it. Jerry creates an app with an unlikely alien and Morty pays the price.</p>
              </li>
              <li class="episode_unavailable">
                <a href="#" class="episode-thumbnail"></a>
                <div class="episode-title">The Old Man and the Seat</div>
                <p class="episode-description"> Rick goes to his private bathroom to find that someone else has used it. Jerry creates an app with an unlikely alien and Morty pays the price.</p>
              </li>
              <li>
                <a href="#" class="episode-thumbnail"></a>
                <div class="episode-title">The Old Man and the Seat</div>
                <p class="episode-description"> Rick goes to his private bathroom to find that someone else has used it. Jerry creates an app with an unlikely alien and Morty pays the price.</p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  renderMediaObjectList() {
    return (
      <div class="app-container">
        <div class="media-list-container">
          <ul class="media-list" ref="mediaObjectList">
            {this.mediaObjects.map((object) => {
              let media = object.media;
              let file = object.files[0];

              let title = media && media.title || file.title;
              let imageUrl = media && media.image;
              // let description = media && media.description;

              return (
                <li>
                  <button class="media-item" onclick={() => { this.app.open('/movies/' + object.id); }}>
                    <div class="media-image" style={imageUrl ? `background-image: url(${imageUrl});` : ''}></div>
                    <div class="media-name">{title}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  route(path) {
    if (this.mediaObjects === null) {
      this.onFirstMessageCallback = () => {
        this.route(path);
      };

      return;
    }

    console.log('%c MOVIES ' + '%c Route ' + path, 'background-color: #85144b; color: #fff', '');

    if (path === '/') {
      this.refs.contents = this.renderMediaObjectList();
    } else {
      let id = path.substring(1);
      let object = this.mediaObjects.find((object) => object.id === id);

      if (object) {
        this.refs.contents = this.renderMediaObject(object);
      } else {
        this.app.redirect('/movies');
      }
    }
  }

  unmount() {
    this.stopSubscription();
  }
}


class Application extends Component {
  constructor() {
    super();

    this.chromecasts = {};
    this.currentChromecast = null;
    this.currentWindow = null;

    this.server = new ServerIO();

    this.windows = [
      { Class: WindowMovies, mount: '/movies' }
    ];

    this.overlay = new Overlay();
    document.body.appendChild(this.overlay.renderComponent());
  }

  connect() {
    document.body.classList.add('loading');
    this.overlay.setLoading();

    let deferred = util.defer();
    let time = Date.now();

    this.server.connectRepeated(2)
      .then(async () => {
        let waitTime = Date.now() - time;

        if (waitTime < 500) {
          await util.wait(500 - waitTime);
        }

        document.body.classList.remove('loading');
        deferred.resolve();
      })
      .catch((err) => {
        this.overlay.setMessage(err.message, () => {
          this.connect().then(() => {
            deferred.resolve();
          });
        });
      });

    return deferred.promise;
  }

  async initialize() {
    this.server.onDisconnected = () => {
      this.connect();
    };

    await this.connect();

    document.body.appendChild(this.renderComponent());

    this.server.subscribe('ccdiscovery', {}, (chromecasts) => {
      // chromecasts = [['0', 'foo', 'bar'], ['1', 'baz', 'qux']];

      this.chromecasts = {};

      for (let [uuid, name, model] of chromecasts) {
        this.chromecasts[uuid] = { model, name, uuid };
      }

      this.renderDeviceList();
    });


    // TODO: move to HTML
    this.refs.deviceData.addEventListener('blur', (event) => {
      this.refs.deviceData.classList.remove('dropdown-active');
    }, true /* inherit listener */);


    window.addEventListener('popstate', () => {
      this.route();
    });

    this.route();
  }

  open(path) {
    history.pushState({}, '', '#' + path);
    return this.route(path);
  }

  redirect(path) {
    history.replaceState({}, '', '#' + path);
    return this.route(path);
  }

  route(path = location.hash.slice(1)) {
    if (path.length < 1) {
      return this.redirect('/');
    }

    if (this.currentWindow) {
      let originMount = this.windows[this.currentWindow.index].mount;

      if (path.startsWith(originMount)) {
        this.currentWindow.instance.route(path.slice(originMount.length) || '/');
        return;
      }
    }


    for (let index = 0; index < this.windows.length; index++) {
      let { mount } = this.windows[index];

      if (path.startsWith(mount)) {
        this.updateWindow(index).route(path.slice(mount.length) || '/');
        return;
      }
    }

    return this.redirect('/movies');
  }

  selectDevice(uuid) {
    this.currentChromecast = this.chromecasts[uuid];

    this.refs.deviceCurrentInfo = (
      <div class="device-info">
        <div class="device-name">{this.currentChromecast.name}</div>
        <div class="device-model">{this.currentChromecast.model}</div>
      </div>
    );

    this.refs.deviceData.classList.remove('dropdown-active');
    this.renderDeviceList();
  }

  render() {
    return (
      <div id="app">
        <header>
          <div class="title">Opsa Video</div>
          <nav>
            <ul>
              <li><a href="#">Device</a></li>
              <li><a href="#" class="active">Movies</a></li>
              <li><a href="#">Music</a></li>
            </ul>
          </nav>
          <div class="device-data" ref="deviceData">
            <a href="#" class="device-current" onclick={(event) => { event.preventDefault(); this.refs.deviceData.classList.toggle('dropdown-active'); }}>
              <div class="device-info-blank" ref="deviceCurrentInfo">Select a device</div>
              <div class="device-dropdown-arrow"></div>
            </a>

            <ul class="device-select" ref="deviceList"></ul>
          </div>
        </header>

        <div id="app-contents" ref="appContents"></div>
      </div>
    );
  }

  renderDeviceList() {
    let visibleChromecasts = Object.values(this.chromecasts)
      .filter((cc) => cc !== this.currentChromecast);

    this.refs.deviceList = visibleChromecasts.length > 0
      ? visibleChromecasts.map(({ model, name, uuid }) => {
        return (
          <li>
            <a href="#" onmousedown={(event) => { event.preventDefault(); this.selectDevice(uuid); }}>
              <div class="device-info">
                <div class="device-name">{name}</div>
                <div class="device-model">{model}</div>
              </div>
            </a>
          </li>
        );
      })
      : [(
        <li class="device-item-blank">
          <div class="device-info-blank">{this.currentChromecast !== null ? 'No other devices' : 'No devices'}</div>
        </li>
      )]
  }


  updateWindow(index) {
    let { Class } = this.windows[index];

    if (this.currentWindow) {
      this.currentWindow.instance.unmount();
    }

    let instance = new Class(this);

    this.currentWindow = { index, instance };
    this.refs.appContents = [
      instance.renderComponent()
    ];

    return instance;
  }
}



window.app = new Application();

app.initialize();

