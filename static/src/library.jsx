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

    this.medias = null;
    this.currentMediaId = null;
    this.currentSeasonNumber = null;

    this.onFirstMessageCallback = null;
    this.stopSubscription = this.app.server.subscribe('listfiles', {}, (medias) => {
      let isFirstMessage = this.medias === null;
      this.medias = medias;

      if (isFirstMessage && this.onFirstMessageCallback) {
        this.onFirstMessageCallback();
      } else if (this.currentMediaId) {
        this.displayMedia();
      } else {
        this.displayMediaList();
      }
    });
  }

  playFile(fileId) {
    let chromecast = this.app.currentChromecast;

    if (!chromecast) {
      return;
    }

    this.app.server.request('playfile', {
      chromecast_uuid: chromecast.uuid,
      file_id: fileId
    });
  }

  selectSeason(seasonNumber /* string */) {
    this.currentSeasonNumber = seasonNumber;

    this.app.setState({ seasonNumber });
    this.refs.contents.episodeList = this.renderMediaEpisodeList(this.medias[this.currentMediaId], seasonNumber);
    this.refs.contents.seasonSelector.self.value = seasonNumber;
  }


  displayMedia(mediaId, seasonNumber) {
    if (mediaId) {
      this.currentMediaId = mediaId;
    }

    let media = this.medias[this.currentMediaId];

    if (!media) {
      this.context.open('/');
      return;
    }

    this.refs.contents = this.renderMedia(media);

    if (media.seasons) {
      this.selectSeason(seasonNumber || this.currentSeasonNumber || Object.keys(media.seasons)[0]);
    }
  }

  displayMediaList() {
    this.currentMediaId = null;
    this.currentSeasonNumber = null;

    this.refs.contents = this.renderMediaList();
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

  renderMedia(media) {
    let contents;

    if (media.seasons) {
      contents = (
        <div class="episode-selector">
          <select class="episode-seasonselector" ref=".seasonSelector" onchange={(event) => { this.selectSeason(event.target.value); }}>
            {Object.keys(media.seasons).map((seasonNumber) =>
              <option value={seasonNumber}>Season {seasonNumber}</option>
            )}
          </select>
          <ul class="episode-list" ref=".episodeList"></ul>
        </div>
      );
    } else {
      contents = (
        <button onclick={() => { this.playFile(Object.keys(media.files)[0]); }}>Play</button>
      );
    }

    return (
      <div class="app-media">
        <div class="app-media-background" style={media.wallpaper_url ? `background-image: url(${util.setImdbImageWidth(media.wallpaper_url, Math.round(window.innerWidth / 4))})` : ''}></div>
        <div class="app-media-image" style={media.poster_url ? `background-image: url(${media.poster_url});` : ''}></div>
        <div class="app-media-contents">
          <h1>{media.title}</h1>
          {media.description && <p>{media.description}</p>}
          {contents}
        </div>
      </div>
    );
  }

  renderMediaList() {
    return (
      <div class="app-container">
        <div class="media-list-container">
          <ul class="media-list">
            {Object.values(this.medias).map((media) => {
              return (
                <li>
                  <button class="media-item" onclick={() => {
                    this.context.open('/' + media.id);
                  }}>
                    <div class="media-image" style={media.poster_url ? `background-image: url(${media.poster_url});` : ''}></div>
                    <div class="media-name">{media.title}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  renderMediaEpisodeList(media, seasonNumber /* string */) {
    return Object.entries(media.seasons[seasonNumber]).map(([episodeNumber, episode]) => {
      let available = episode.files.length > 0;
      let episodeThumbnailStyle = episode.thumbnail_url ? `background-image: url(${util.setImdbImageWidth(episode.thumbnail_url, 300)});` : '';

      return (
        <li class={available ? '' : 'episode_unavailable'}>
          {available
            ? <a href="#" class="episode-thumbnail" style={episodeThumbnailStyle} onclick={(event) => {
              event.preventDefault();

              this.playFile(episode.files[0]);
            }}>

              {playIcon.cloneNode(true)}
            </a>
            : <div class="episode-thumbnail" style={episodeThumbnailStyle}></div>
          }
          <div class="episode-title">{episodeNumber}. {episode.title}</div>
          {episode.description && <p class="episode-description">{episode.description}</p>}
        </li>
      );
    });
  }

  route(path, state) {
    if (this.medias === null) {
      this.onFirstMessageCallback = () => {
        this.route(path, state);
      };

      return;
    }

    this.context.log('Route ' + path);

    if (path === '/') {
      this.displayMediaList();
    } else {
      this.displayMedia(path.substring(1), state.seasonNumber);
    }
  }

  unmount() {
    this.stopSubscription();
    this.context.log('Unmount');
  }
}

