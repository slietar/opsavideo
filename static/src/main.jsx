/**
 * opsavideo
 *
 */


'use strict';

import { Fragment, createElement, getReferences } from '@slietar/jsx-dom';

import ServerIO from './server-io.js';
import { WindowDevice } from './device.jsx';
import { WindowLibrary } from './library.jsx';
import { WindowPlayer } from './player.jsx';
import * as util from './util.js';

import iconsElement from '../assets/icons.svg';
import '../styles/main.scss';
import 'typeface-helvetica-now';


class Overlay {
  setLoading() {
    this.refs.root = <><div class="overlay-spinner"><div></div><div></div><div></div><div></div></div></>;
  }

  setMessage(message, retryCallback) {
    this.refs.root = <>
      <p class="overlay-message">{message}{retryCallback ? [' ', <a href="#" onclick={(event) => {
        event.preventDefault();
        retryCallback();
      }}>Retry</a>] : []}</p>
    </>;
  }

  render() {
    let tree = (
      <div class="overlay" ref="root"></div>
    );

    this.refs = getReferences(tree);
    return tree.local.self;
  }
}


class Application {
  constructor() {
    this.chromecasts = {};
    this.currentChromecast = null;
    this.currentWindowIndex = null;

    this.server = new ServerIO();

    this.windows = [
      { Class: WindowLibrary, mount: '/library', name: 'Library', visible: true },
      { Class: WindowDevice, mount: '/device', name: 'Device', visible: true },
      { Class: WindowPlayer, mount: '/player', name: 'Player', visible: false }
    ].map((win) => ({ ...win, context: null, instance: null }));

    this.overlay = new Overlay();

    document.body.appendChild(this.overlay.render());
    document.body.appendChild(iconsElement);
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

    document.body.appendChild(this.render());

    this.server.subscribe('ccdiscovery', {}, (chromecasts) => {
      // chromecasts = [['0', 'foo', 'bar'], ['1', 'baz', 'qux']];

      this.chromecasts = {};

      for (let [uuid, name, model] of chromecasts) {
        this.chromecasts[uuid] = { model, name, uuid };
      }

      this.renderDeviceList();
    });


    // TODO: move to HTML
    this.refs.deviceData.self.addEventListener('blur', (event) => {
      this.refs.deviceData.self.classList.remove('dropdown-active');
    }, true /* inherit listener */);


    window.addEventListener('popstate', () => {
      this.route();
    });

    this.route();
  }

  open(path, state = {}) {
    history.pushState(state, '', '#' + path);
    return this.route(path);
  }

  redirect(path, state = {}) {
    history.replaceState(state, '', '#' + path);
    return this.route(path);
  }

  setState(state) {
    history.replaceState(state, '');
  }

  route(path = location.hash.slice(1), state = history.state || {}) {
    if (path.length < 1) {
      return this.redirect('/');
    }

    for (let index = 0; index < this.windows.length; index++) {
      let { mount } = this.windows[index];

      if (path.startsWith(mount)) {
        this.updateWindow(index).route(path.slice(mount.length) || '/', state);
        return;
      }
    }

    return this.redirect(this.windows[0].mount);
  }

  selectDevice(uuid) {
    this.currentChromecast = this.chromecasts[uuid];

    this.refs.deviceCurrentInfo = (
      <div class="device-info">
        <div class="device-name">{this.currentChromecast.name}</div>
        <div class="device-model">{this.currentChromecast.model}</div>
      </div>
    );

    this.refs.deviceData.self.classList.remove('dropdown-active');
    this.renderDeviceList();
  }

  render() {
    let tree = (
      <div id="app">
        <header>
          <div class="title">
            <span class="title-main">Opsa</span>
            <span class="title-sub">Video</span>
          </div>
          <nav>
            <ul ref="windowList"></ul>
          </nav>
          <div class="device-data" ref="deviceData">
            <a href="#" class="device-current" onclick={(event) => {
              event.preventDefault();
              this.refs.deviceData.self.classList.toggle('dropdown-active');
            }}>
              <div class="device-info-blank" ref="deviceCurrentInfo">Select a device</div>
              <div class="device-dropdown-arrow"></div>
            </a>

            <ul class="device-select" ref="deviceList"></ul>
          </div>
        </header>

        <div id="app-contents" ref="appContents"></div>
      </div>
    );

    this.refs = getReferences(tree);
    return tree.local.self;
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

  renderWindowList() {
    return this.windows
      .map((win, index) => {
        let isCurrent = this.currentWindowIndex === index;
        return (win.visible || isCurrent) && (<li><a href={'#' + win.mount} class={isCurrent ? 'active ' : ''}>{win.name}</a></li>) || void 0;
      })
      .filter((el) => el);
  }


  updateWindow(index) {
    let win = this.windows[index];

    if (this.currentWindowIndex === index) {
      return win.instance;
    }

    if (!win.instance) {
      win.context = {
        log(message) {
          const Colors = ['#85144b', '#39cccc', '#2ecc40', '#ff851b'];

          console.log(`%c ${win.name.toUpperCase()} ` + `%c ${message}`, `background-color: ${Colors[index] || '#000'}; color: #fff`, '');
        },
        open: (path) => {
          this.open(win.mount + path);
        }
      };

      win.instance = new win.Class(this, win.context);
    }

    this.currentWindowIndex = index;
    this.refs.appContents = <>{win.instance.render()}</>;
    this.refs.windowList = this.renderWindowList();

    return win.instance;
  }
}



window.app = new Application();

app.initialize();

