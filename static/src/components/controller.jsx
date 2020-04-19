/**
 * opsavideo
 * Components/Controller
 */


import { Fragment, createElement, getReferences } from '@slietar/jsx-dom';


export class Controller {
  constructor(options) {
    this.listeners = {};
    this.options = options;

    this._duration = null;
    this._oldVolume = null;
    this._timeout = null;

    this.mouseInside = false;
    this.seeking = false;
  }

  set buffered(value) {
    this.refs.ctrlBarBufferedItems = value.map(({ length, position }) => (
      <span class="controller-bar-buffered" style={`left: ${position * 100}%; width: ${length * 100}%`}></span>
    ));
  }

  set duration(value) {
    this._duration = value;
    this.refs.ctrlDuration = renderTime(value);
  }

  set fullscreen(value) {
    this.element.classList.toggle('_fullscreen', value);
  }

  set hidden(value) {
    this.element.classList.toggle('_hidden', value);
  }

  set paused(value) {
    this.element.classList.toggle('_paused', value);
  }

  set position(value) {
    this.refs.ctrlBarPlayed.self.style.width = value * 100 + '%';
    this.refs.ctrlBarCursor.self.style.left = value * 100 + '%';

    if (this._duration !== null) {
      this.refs.ctrlCurrentTime = renderTime(value * this._duration);
    }
  }

  get volume() {
    return parseInt(this.refs.ctrlVolumeRange.self.value) / 100;
  }

  set volume(value) {
    this._setVolumeIcon(value);
    this._setVolumeRange(value);
  }


  _setVolumeIcon(value) {
    let classList = this.element.classList;

    classList.remove('_volume-high', '_volume-medium', '_volume-low', '_volume-mute');

    if (value === 0) {
      classList.add('_volume-mute');
    } else if (value <= 0.33) {
      classList.add('_volume-low');
    } else if (value <= 0.67) {
      classList.add('_volume-medium');
    } else {
      classList.add('_volume-high');
    }
  }

  _setVolumeRange(value) {
    this.refs.ctrlVolumeRange.self.value = value * 100;
  }

  _updateTimeout() {
    let options = this.options.visibilityWatcher;

    if (this._timeout !== null) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }

    let delay = this.mouseInside
      ? options.delayInside || Infinity
      : options.delayOutside;

    if (delay !== Infinity) {
      this._timeout = setTimeout(() => {
        options.elementOutside.classList.add('_nocursor');
        this.hidden = true;
      }, delay);
    }
  }


  installVisibilityWatcher(opts) {
    if (opts) {
      this.options.visibilityWatcher = opts;
    }

    this._updateTimeout();

    let element = this.options.visibilityWatcher.elementOutside;
    let listener = () => {
      element.classList.remove('_nocursor');
      this.hidden = false;
      this._updateTimeout();
    };

    element.addEventListener('mousemove', listener);

    return () => {
      element.removeEventListener('mousemove', listener);
    };
  }

  render() {
    let tree = (
      <div id="controller" class={'controller' + (this.options.dark ? ' _dark' : '')} onmouseenter={() => {
        this.mouseInside = true;

        if (this.options.visibilityWatcher) {
          this._updateTimeout();
        }
      }} onmouseleave={() => {
        this.mouseInside = false;

        if (this.options.visibilityWatcher) {
          this._updateTimeout();
        }
      }}>

        <div class="controller-settings">
          <div class="controller-secvolume">
            <button type="button" class="controller-volume" onclick={() => {
              if (this.volume > 0) {
                this._oldVolume = this.volume;
                this.volume = 0;
                this.options.setVolume(0);
              } else {
                let value = this._oldVolume !== null ? this._oldVolume : 0.2;
                this._oldVolume = null;

                this.volume = value;
                this.options.setVolume(value);
              }
            }}>
              <svg><use href="#icon-volume-high"></use></svg>
              <svg><use href="#icon-volume-medium"></use></svg>
              <svg><use href="#icon-volume-low"></use></svg>
              <svg><use href="#icon-volume-mute"></use></svg>
            </button>
            <input type="range" ref="ctrlVolumeRange" oninput={(event) => {
              let value = this.volume;

              this._setVolumeIcon(value);
              this.options.setVolume(value);
            }} />
          </div>

          <div class="controller-secdirection">
            <button type="button" onclick={() => { this.options.fastRewind(); }}>
              <svg><use href="#icon-fastrewind"></use></svg>
            </button>

            <button type="button" class="controller-playpause" onclick={() => { this.options.playPause(); }}>
              <svg><use href="#icon-pause"></use></svg>
              <svg><use href="#icon-play"></use></svg>
            </button>

            <button type="button" onclick={() => { this.options.fastForward(); }}>
              <svg><use href="#icon-fastforward"></use></svg>
            </button>
          </div>

          <div class="controller-secoptions">
            <button type="button" style="display: none;">
              <svg><use href="#icon-list"></use></svg>
            </button>
            { this.options.fullscreen && (<button type="button" class="controller-fullscreen" onclick={() => { this.options.fullscreen(); }}>
              <svg><use href="#icon-fullscreen"></use></svg>
              <svg><use href="#icon-fullscreen-exit"></use></svg>
            </button>) }
            { this.options.pictureInPicture && (<button type="button" onclick={() => { this.options.pictureInPicture(); }}>
              <svg><use href="#icon-picture-in-picture"></use></svg>
            </button>) }
            { this.options.cast && (<button type="button" onclick={() => { this.options.cast(); }}>
              <svg><use href="#icon-cast"></use></svg>
            </button>) }
          </div>
        </div>

        <div class="controller-sectime">
          <div class="controller-currenttime" ref="ctrlCurrentTime">{renderTime(0)}</div>

          <div class="controller-bar" ref="ctrlBar" onmousedown={(mouseDownEvent) => {
            mouseDownEvent.preventDefault();

            let rect = this.refs.ctrlBar.self.getBoundingClientRect();

            let lastPosition;
            let updatePosition = (x) => {
              let position = (x - rect.left) / rect.width;
              position = Math.min(1, Math.max(0, position));
              lastPosition = position;

              this.position = position;

              if (this.options.seeking) {
                this.options.seeking(position);
              }
            };

            this.seeking = true;
            updatePosition(mouseDownEvent.clientX);

            let mouseMoveListener = (mouseMoveEvent) => {
              updatePosition(mouseMoveEvent.clientX);
            };

            let mouseUpListener = () => {
              document.removeEventListener('mousemove', mouseMoveListener);
              document.removeEventListener('mouseup', mouseUpListener);

              this.seeking = false;
              this.options.seek(lastPosition);
            };

            document.addEventListener('mousemove', mouseMoveListener);
            document.addEventListener('mouseup', mouseUpListener);

          }} >
            <span class="controller-bar-all"></span>
            <span class="controller-bar-buffered"></span>
            <span class="controller-bar-played" ref="ctrlBarPlayed"></span>
            <div class="controller-bar-cursor" ref="ctrlBarCursor"></div>
            <div ref="ctrlBarBufferedItems"></div>
          </div>

          <div class="controller-duration" ref="ctrlDuration">{renderTime(0)}</div>
        </div>
      </div>
    );

    this.element = tree.local.self;
    this.refs = getReferences(tree);

    this.paused = true;
    this.volume = 0.5;

    return this.element;
  }
}


function renderTime(secs) {
  return (
    <>
      {Math.floor(secs / 60).toString().padStart(2, '0')}
      <span>:</span>
      {(Math.floor(secs) % 60).toString().padStart(2, '0')}
    </>
  );
}

