'use strict';

import '../styles/main.scss';

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
          if (referencedMedias[file.media] !== void 0) {
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
      } else if (this.currentMediaObjectId) {
        this.displayMediaObject();
      } else {
        this.displayMediaObjectList();
      }

      /* else if (this.currentMediaObjectId && this.currentMediaObject) {
        this.refs.contents = this.renderMediaObject(this.currentMediaObject);
      } else {
        this.route('/movies');
      } */
    });
  }

  get currentMediaObject() {
    return this.currentMediaObjectId && this.mediaObjects.find((object) => object.id === this.currentMediaObjectId);
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

  selectSeason(season) {
    let ul = this.refs.self.querySelector('.episode-list');

    // TODO: improve
    ul.innerHTML = '';

    for (let child of this.renderMediaObjectEpisodeList(this.currentMediaObject, season)) {
      ul.appendChild(child.self);
    }
  }


  displayMediaObject(objectId /* optional */) {
    if (objectId) {
      this.currentMediaObjectId = objectId;
    }

    let object = this.currentMediaObject;

    if (!object) {
      this.app.open('/movies');
      return;
    }

    this.refs.contents = this.renderMediaObject(object);

    if (object.media && object.media.seasons) {
      this.selectSeason(parseInt(Object.keys(object.media.seasons)[0]));
    }
  }

  displayMediaObjectList() {
    this.currentMediaObjectId = null;

    this.refs.contents = this.renderMediaObjectList();
  }


  render() {
    return (
      <div id="window-movies">
        <div ref="contents"></div>
      </div>
    );
  }

  renderMediaObject(object) {
    let media = object.media;
    let file = object.files[0];

    let description = media && media.description;
    let imageUrl = media && media.image;
    let title = media && media.title || file.title;
    let wallpaperUrl = media && media.wallpaper ? (media.wallpaper.substring(0, media.wallpaper.search('@._V1_')) + `@._V1_SX${Math.round(window.innerWidth / 4)}_AL_.jpg`) : '';


    let contents;

    if (media && media.seasons) {
      let maxSeasonNumber = Math.max(...Object.keys(media.seasons));

      contents = (
        <div class="episode-selector">
          <select class="episode-seasonselector" onchange={(event) => { this.selectSeason(parseInt(event.target.value)); }}>
            {new Array(maxSeasonNumber).fill(0).map((_, index) => media.seasons[index + 1]
              ? <option value={index + 1}>Season {index + 1}</option>
              : <option value={index + 1} disabled>Season {index + 1}</option>
            )}
          </select>
          <ul class="episode-list"></ul>
        </div>
      );
    } else {
      contents = (
        <button onclick={() => { this.playFile(object.files[0]); }}>Play</button>
      );
    }

    return (
      <div class="app-media">
        <div class="app-media-background" style={wallpaperUrl ? `background-image: url(${wallpaperUrl})` : ''}></div>
        <div class="app-media-image" style={imageUrl ? `background-image: url(${imageUrl});` : ''}></div>
        <div class="app-media-contents">
          <h1>{title}</h1>
          { description && <p>{description}</p> }
          {contents}
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
                    <div class="media-image" style={imageUrl ? `background-image: url(${imageUrl[0]});` : ''}></div>
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

  renderMediaObjectEpisodeList(object, season) {
    return object.media.seasons[season].map((episode, episodeIndex) => {
      let files = object.files.filter((file) => file.season === season && file.episode === episodeIndex + 1);
      let available = files.length > 0;
      let episodeThumbnailStyle = episode.thumbnail ? `background-image: url(${util.setImdbImageWidth(episode.thumbnail, 300)});` : ''; /* To be replaced with attr() magic once supported. */

      return (
        <li class={available ? '' : 'episode_unavailable'}>
          {available
            ? <a href="#" class="episode-thumbnail" style={episodeThumbnailStyle} onclick={(event) => {
              event.preventDefault();

              if (files.length > 0) {
                this.playFile(files[0]);
              }
            }}>

              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
              <path fill="red" d="M16 0c-8.837 0-16 7.163-16 16s7.163 16 16 16 16-7.163 16-16-7.163-16-16-16zM16 29c-7.18 0-13-5.82-13-13s5.82-13 13-13 13 5.82 13 13-5.82 13-13 13zM12 9l12 7-12 7z"></path>
              </svg>
            </a>
            : <div class="episode-thumbnail" style={episodeThumbnailStyle}></div>
          }
          <div class="episode-title">{episodeIndex + 1}. {episode.title}</div>
          <p class="episode-description">{episode.description}</p>
        </li>
      );
    });
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
      this.displayMediaObjectList();
    } else {
      this.displayMediaObject(path.substring(1));
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
    let preventDefaultListener = (event) => {
      event.preventDefault();
    };

    return (
      <div id="app">
        <header>
          <div class="title">Opsa Video</div>
          <nav>
            <ul>
              <li><a href="#" onclick={preventDefaultListener}>Device</a></li>
              <li><a href="#" class="active" onclick={preventDefaultListener}>Movies</a></li>
              <li><a href="#" onclick={preventDefaultListener}>Music</a></li>
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

