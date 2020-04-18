/**
 * opsavideo
 * WindowPlayer
 */


import { Fragment, createElement, getReferences } from '@slietar/jsx-dom';

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
        this.refs.ctrlDuration = toTime(this.video.duration);
      }} ontimeupdate={() => {
        this.setCtrlBarPosition(this.video.currentTime / this.video.duration);
      }} onprogress={() => {
        let items = [];

        for (let index = 0; index < this.video.buffered.length; index++) {
          let startPos = this.video.buffered.start(index) / this.video.duration;
          let endPos = this.video.buffered.end(index) / this.video.duration;
          let length = endPos - startPos;

          if (length > 0.01) {
            items.push(
              <span class="player-ctrlbar-buffered" style={`left: ${startPos * 100}%; width: ${length * 100}%`}></span>
            );
          }
        }

        this.refs.ctrlBarBufferedItems = items;
      }} onplaying={() => {
        this.player.classList.remove('_loading');
      }} onwaiting={() => {
        this.player.classList.add('_loading');
      }} onended={() => {
        this.player.classList.add('_paused');
      }} onplay={() => {
        this.player.classList.remove('_paused');
      }} onpause={() => {
        this.player.classList.add('_paused');
      }}>
        <source src="http://localhost:8080/output2.mp4" type="video/mp4" />
      </video>
    );

    this.player = this.refs.player.self;
    this.video = this.refs.video.self;

    this.player.classList.add('_loading', '_paused');

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
  }

  togglePause() {
    if (this.video.paused || this.video.ended) {
      this.video.play();
    } else {
      this.video.pause();
    }
  }

  render() {
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
            <div class="player-controls">
      {[]/*<div class="player-ctrlvol">
                <button type="button" class="player-ctrlmute">
                  <svg><use href="#icon-volume-mute"></use></svg>
                  <svg><use href="#icon-volume-low"></use></svg>
                  <svg><use href="#icon-volume-medium"></use></svg>
                  <svg><use href="#icon-volume-high"></use></svg>
                </button>
                <input type="range" />
              </div> */}

              <button type="button" onclick={() => {
                this.video.playbackRate = Math.max(0.25, Math.min(this.video.playbackRate / 2, 1));
              }}>
                <svg><use href="#icon-fastrewind"></use></svg>
              </button>

              <button type="button" class="player-ctrlpause" onclick={() => { this.togglePause(); }}>
                <svg><use href="#icon-play"></use></svg>
                <svg><use href="#icon-pause"></use></svg>
              </button>

              <button type="button" onclick={() => {
                this.video.playbackRate = Math.min(4, Math.max(this.video.playbackRate * 2, 1));
              }}>
                <svg><use href="#icon-fastforward"></use></svg>
              </button>

              <div class="player-ctrltime">
                <div class="player-ctrlcurrenttime" ref="ctrlCurrentTime">00:00</div>

                <div class="player-ctrlbar" ref="ctrlBar" onclick={(event) => {
                  let rect = this.refs.ctrlBar.self.getBoundingClientRect();
                  let position = (event.clientX - rect.left) / rect.width;

                  this.setCtrlBarPosition(position);
                  this.video.currentTime = position * this.video.duration;
                }}>
                  <span class="player-ctrlbar-all"></span>
                  <span class="player-ctrlbar-buffered"></span>
                  <span class="player-ctrlbar-played" ref="ctrlBarPlayed"></span>
                  <div class="player-ctrlbar-cursor" ref="ctrlBarCursor"></div>
                  <div ref="ctrlBarBufferedItems"></div>
                </div>

                <div class="player-ctrlduration" ref="ctrlDuration">00:00</div>
              </div>
            </div>
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

