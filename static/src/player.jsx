/**
 * opsavideo
 * WindowPlayer
 */


import { Fragment, createElement, getReferences } from '@slietar/jsx-dom';

import { Controller } from './components/controller.jsx';
import * as util from './util.js';


export class WindowPlayer {
  constructor(app, context) {
    this.app = app;
    this.context = context;
    this.context.log('Instantiate');
  }

  setCtrlBarPosition(value) {
    this.refs.ctrlBarPlayed.self.style.width = value * 100 + '%';
    this.refs.ctrlBarCursor.self.style.left = value * 100 + '%';
    this.refs.ctrlCurrentTime = toTime(value * this.video.duration);
  }

  displayMain() {
    this.refs.video = (
      <video ref="video" onloadeddata={() => {
        this.player.classList.add('_controllable');
        this.player.classList.remove('_loading');
      }} onloadedmetadata={() => {
        this.controller.duration = this.video.duration;
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
        this.player.classList.remove('_loading');
      }} onwaiting={() => {
        this.player.classList.add('_loading');
      }} onended={() => {
        this.controller.paused = true;
      }} onplay={() => {
        this.controller.paused = false;
      }} onpause={() => {
        this.controller.paused = true;
      }}>
        <source src="http://localhost:8080/output.webm" type="video/mp4" />
      </video>
    );

    this.player = this.refs.player.self;
    this.video = this.refs.video.self;

    this.player.classList.add('_loading');

    /* TODO: improve */
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

    document.addEventListener('fullscreenchange', () => {
      this.controller.fullscreen = document.fullscreenElement !== null;
    });

    this.controller.installVisibilityWatcher({
      delayOutside: 500,
      elementOutside: this.player
    });
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

          <div ref="video"></div>

          <div class="player-controlscontainer">
            {this.controller.render()}
          </div>
        </div>
      </div>
    );

    this.refs = getReferences(tree);
    return tree.local.self;
  }

  route(path, state) {
    this.context.log('Route ' + path);

    this.displayMain();
  }

  unmount() {
    this.context.log('Unmount');
  }
}


function toTime(secs) {
  return Math.floor(secs / 60).toString().padStart(2, '0') + ':'
    + (Math.round(secs) % 60).toString().padStart(2, '0');
}

