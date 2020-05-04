/**
 * opsavideo
 * WindowPlayer
 */


import { Fragment, createElement, getReferences } from '@slietar/jsx-dom';
import Hls from 'hls.js';

import { Controller } from './components/controller.jsx';
import { LanguageNames } from './iso639';
import * as util from './util.js';


export class WindowPlayer {
  constructor(app, context) {
    this.app = app;
    this.context = context;
    this.context.log('Instantiate');

    this.currentMedia = null;
    this.currentFileId = null;
    this.currentMediaId = null;
    this.medias = null;
    this.hls = null;
    this.settings = null;

    this.playRequest = null;
    this.removeFullscreenChangeListener = null;
    this.subscription = this.app.server.subscribe('listfiles', (medias) => {
      this.medias = medias;
    });
  }

  set loading(value) {
    this.player.classList.toggle('_loading', value);
  }

  set paused(value) {
    if (value) {
      this.visibilityWatcher.increaseVisibilityLevel();
    } else {
      this.visibilityWatcher.decreaseVisibilityLevel();
    }

    this.controller.paused = value;
  }

  displayMain() {
    let media = this.medias[this.currentMediaId];

    if (!media) {
      this.app.redirectNotFound();
      return;
    }

    let fileOptions = {};

    for (let [fileId, file] of Object.entries(media.files)) {
      let items = [`${Math.round(file.size / 1e6)} MB`];

      if (file.quality) items.push(file.quality);
      if (file.resolution) items.push(file.resolution);

      fileOptions[fileId] = items.join(', ');
    }


    this.settings.file = {
      options: fileOptions,
      title: 'File',

      onChange: (fileId) => {
        this.selectFileId(fileId);
      }
    };

    this.settings.language = {
      options: {},
      title: 'Language',

      onChange: (audioStreamIndex) => {
        this.selectAudioStreamIndex(audioStreamIndex);
      }
    };

    this.settings.file.value = Object.keys(fileOptions)[0] || null;


    this.visibilityWatcher.install();
  }

  /* _displayMain() {
    window.addEventListener('keydown', (event) => {
      if (!this.video || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      switch (event.key) {
        case ' ': this.togglePause(); break;
        case 'ArrowLeft': this.video.currentTime -= 5; break;
        case 'ArrowRight': this.video.currentTime += 5; break;
        default: return;
      }

      event.preventDefault();
    });
  } */

  launchVideo() {
    if (this.hls) {
      this.hls.detachMedia();
    }

    this.controller.position = 0;
    this.controller.hidden = true;

    this.loading = true;
    this.paused = true;

    let request = this.app.server.request('playlocal', {
      audio_stream_index: parseInt(this.currentAudioStreamIndex),
      file_id: this.currentFileId
    });

    this.playRequest = request;

    request.promise.then(({ url }) => {
      this.playRequest = null;

      // Safari
      // this.refs.video = <><source src={url} type="video/mp4" /></>;

      if (Hls.isSupported()) {
        this.hls = new Hls({
          fragLoadingRetryDelay: 40e3
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);
      }
    });
  }

  selectFileId(fileId) {
    this.currentFileId = fileId;

    let files = this.medias[this.currentMediaId].files;
    let file = files[fileId];

    let languageOptions = {};

    for (let [audioStreamIndex, language] of Object.entries(file.audio_streams)) {
      languageOptions[audioStreamIndex] = LanguageNames[language];
    }

    this.settings.language.options = languageOptions;
    this.settings.language.value = Object.keys(languageOptions)[0] || null;
  }

  selectAudioStreamIndex(audioStreamIndex) {
    this.currentAudioStreamIndex = audioStreamIndex;
    this.launchVideo();
  }

  togglePause(pause = !(this.video.paused || this.video.ended)) {
    if (pause) {
      this.video.pause();
    } else {
      this.video.play();
    }
  }

  render() {
    this.controller = new Controller({
      fastRewind: () => {
        this.video.playbackRate = Math.max(0.25, Math.min(this.video.playbackRate / 2, 1));
      },
      fastForward: () => {
        this.video.playbackRate = Math.min(4, Math.max(this.video.playbackRate * 2, 1));
      },
      fullscreen: () => {
        if (document.fullscreenElement === null) {
          this.player.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      },
      playPause: () => {
        this.togglePause();
      },
      seek: (position) => {
        this.video.currentTime = position * this.video.duration;
      },
      setVolume: (value) => {
        this.video.volume = value;
      }
    });

    let tree = (
      <div id="window-player">
        <div class="player" ref="player">
          <div class="player-spinnercontainer">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="player-spinner">
              <circle cx="50" cy="50" r="30" fill="none" stroke="black"></circle>
            </svg>
          </div>

          <div class="player-pauseoverlay">
            <ul class="player-settings" ref="settings"></ul>

            <div class="player-controlscontainer">
              <div ref="controller"></div>
            </div>
          </div>

          <video ref="video" onloadeddata={() => {
            this.loading = false;
          }} onloadedmetadata={() => {
            this.controller.duration = this.video.duration;
            this.controller.position = this.video.currentTime / this.video.duration;
            this.controller.hidden = false;

            this.togglePause(true);
          }} ontimeupdate={() => {
            if (!this.controller.seeking) {
              this.controller.position = this.video.currentTime / this.video.duration;
            }
          }} onprogress={() => {
            let items = [];

            for (let index = 0; index < this.video.buffered.length; index++) {
              let startPos = this.video.buffered.start(index) / this.video.duration;
              let endPos = this.video.buffered.end(index) / this.video.duration;
              let length = endPos - startPos;

              if (length > 0.01) {
                items.push({ length, position: startPos });
              }
            }

            this.controller.buffered = items;
          }} onplaying={() => {
            this.loading = false;
          }} onwaiting={() => {
            this.loading = true;
          }} onended={() => {
            this.paused = true;
          }} onplay={() => {
            this.paused = false;
          }} onpause={() => {
            this.paused = true;
          }}></video>
        </div>
      </div>
    );

    this.refs = getReferences(tree);

    this.player = this.refs.player.self;
    this.video = this.refs.video.self;

    this.settings = createSettings({
      onOpen: () => { this.visibilityWatcher.increaseVisibilityLevel(); },
      onClose: () => { this.visibilityWatcher.decreaseVisibilityLevel(); },
      target: this.refs.settings.self
    });

    this.refs.controller = this.controller.render();

    this.visibilityWatcher = new VisibilityWatcher({
      hiddenClassName: '_overlayhidden',

      insideDelay: 8000,
      insideElements: [this.refs.settings.self, this.refs.controller.self],

      outsideDelay: 1500,
      outsideElement: this.refs.player.self
    });

    this.removeFullscreenChangeListener = util.listen(document, 'fullscreenchange', () => {
      this.controller.fullscreen = document.fullscreenElement !== null;
    });

    return tree.local.self;
  }

  route(path, state) {
    this.context.log('Route ' + path);

    if (path !== '/' || !state.mediaId) {
      return this.app.redirectNotFound();
    }

    this.currentMediaId = state.mediaId;

    this.controller.hidden = true;
    this.loading = true;

    this.subscription.promise.then(() => {
      this.displayMain();
    });
  }

  unmount() {
    this.context.log('Unmount');

    this.removeFullscreenChangeListener();
    this.subscription.cancel();

    if (this.playRequest) {
      this.playRequest.cancel();
    }
  }
}


function createSettings(options) {
  let settingsProxy = new Proxy({}, {
    get(settings, name) {
      let setting = settings[name];

      if (!setting) {
        return void 0;
      }

      return {
        set options(options) {
          setting.options = {};

          setting.refs.options = Object.entries(options).map(([value, text]) => {
            let element = (
              <li>
                <button type="button" onclick={() => {
                  document.activeElement.blur();
                  settingsProxy[name].value = value;
                }}><span>{text}</span><svg><use href="#icon-checkmark"></use></svg></button>
              </li>
            );

            setting.options[value] = element.local.self;

            return element;
          });
        },
        get value() {
          return setting.value;
        },
        set value(value) {
          if (value !== setting.value) {
            if (setting.value !== null) {
              setting.options[setting.value].classList.remove('_selected');
            }

            if (value !== null) {
              setting.options[value].classList.add('_selected');
            }

            setting.value = value;
            setting.callback(value);
          }
        }
      };
    },
    set(settings, name, value) {
      let tree = (
        <li ref="origin">
          <button onmousedown={(event) => {
            event.preventDefault();
          }} onclick={() => {
            let element = refs.options.self;

            if (refs.origin.self.classList.toggle('_opened')) {
              element.focus();
              options.onOpen();
            } else {
              element.blur();
              options.onClose();
            }
          }}>{value.title}</button>
          <ul class="player-settings-options" tabindex="-1" ref="options" onfocusout={(event) => {
            if (event.relatedTarget === null || !event.currentTarget.contains(event.relatedTarget)) {
              refs.origin.self.classList.remove('_opened');
              options.onClose();
            }
          }}></ul>
        </li>
      );

      let refs = getReferences(tree);

      settings[name] = {
        callback: value.onChange,
        refs,
        value: null
      };

      options.target.appendChild(tree.local.self);

      settingsProxy[name].options = value.options;

      return true;
    }
  });

  return settingsProxy;
}


class VisibilityWatcher {
  constructor(options) {
    this.options = options;

    this._inside = false;
    this._listeners = null;
    this._timeout = null;
    this._visibilityLevel = 0;
  }

  increaseVisibilityLevel() {
    this._visibilityLevel += 1;
    this._resetTimeout();

    if (this._visibilityLevel === 1) {
      this._insideElementsHidden = false;
    }
  }

  decreaseVisibilityLevel() {
    this._visibilityLevel -= 1;
    this._resetTimeout();
  }

  set _insideElementsHidden(value) {
    this.options.outsideElement.classList.toggle(this.options.hiddenClassName, value);
  }

  install() {
    this._listeners = {
      outsideMove: this.options.outsideElement.addEventListener('mousemove', () => {
        this._resetTimeout();
      }),

      insideEnter: this.options.insideElements.map((element) =>
        element.addEventListener('mouseenter', () => {
          this._inside = true;
          this._resetTimeout();
        })
      ),

      insideLeave: this.options.insideElements.map((element) =>
        element.addEventListener('mouseleave', () => {
          this._inside = false;
          this._resetTimeout();
        })
      )
    };
  }

  uninstall() {
    this.options.outsideElement.removeEventListener('mousemove', this._listeners.outsideMove);

    this.options.insideElements.forEach((element, index) => {
      element.removeEventListener('mouseenter', this._listeners.insideEnter[index]);
      element.removeEventListener('mouseleave', this._listeners.insideLeave[index]);
    });
  }

  _resetTimeout() {
    if (this._timeout !== null) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }

    if (this._visibilityLevel < 1) {
      this._insideElementsHidden = false;

      let delay = this._inside
        ? this.options.insideDelay || Infinity
        : this.options.outsideDelay;

      if (delay !== Infinity) {
        this._timeout = setTimeout(() => {
          this._insideElementsHidden = true;
        }, delay);
      }
    }
  }
}

