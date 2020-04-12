/**
 * opsavideo
 * WindowLibrary
 */


import { Fragment, createElement, getReferences } from '@slietar/jsx-dom';

import playIcon from '../assets/play.svg';
import * as util from './util.js';


export class WindowLibrary {
  constructor(app, context) {
    this.app = app;
    this.context = context;
    this.context.log('Instantiate');

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
    this.refs.contents.episodeList = this.renderMediaObjectEpisodeList(this.currentMediaObject, season);
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
    let tree = (
      <div id="window-library">
        <div ref="contents"></div>
      </div>
    );

    this.refs = getReferences(tree);
    return tree.local.self;
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
          <ul class="episode-list" ref=".episodeList"></ul>
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

              {playIcon.cloneNode(true)}
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

    this.context.log('Route ' + path);

    if (path === '/') {
      this.displayMediaObjectList();
    } else {
      this.displayMediaObject(path.substring(1));
    }
  }

  unmount() {
    this.stopSubscription();
    this.context.log('Unmount');
  }
}

