import PTN
import asyncio
import fnmatch
import glob
import hashlib
import json
import logging
import os
import subprocess
import threading
import watchdog.events
import watchdog.observers

from . import iso639
from .imdb import IMDBDatabase


LOG = logging.getLogger('opsavideo.media')
class MediaManager:
    def __init__(self, path, noticeboard, loop, server, *, state_dir):
        self.obsever = None
        self.noticeboard = noticeboard
        self.loop = loop
        self.path = path
        self.server = server

        self.imdb = IMDBDatabase(state_dir, version="0")

        self.files = dict()
        self.medias = dict()

        self.watcher = Watcher(self, origin=os.path.abspath(path), patterns=["*.avi", "*.mkv", "*.mp4"])

    def start(self):
        def handler():
            self.imdb.load_cache()

            LOG.info("Starting discovery")
            self.watcher.discover()
            LOG.info("Done discovering, starting watcher")
            self.watcher.start()

            # print(self.host_file(list(self.files.keys())[0]))

        thread = threading.Thread(target=handler)
        thread.start()

    def stop(self):
        self.watcher.stop()

    def publish(self):
        out_medias = dict()

        for media_id, media in self.medias.items():
            out_media = {
                'id': media_id,
                'files': dict(),

                'description': None,
                'poster_url': None,
                'seasons': None,
                'storyline': None,
                'title': media.get('title'),
                'year': media.get('year')
            }

            if 'imdb_id' in media:
                imdb_media = self.imdb.request_media(media['imdb_id'])
                out_media.update({
                    'description': imdb_media['description'],
                    'poster_url': imdb_media['poster_url'],
                    'seasons': {season_num: {episode_num: {
                        **episode, 'files': list()
                    } for (episode_num, episode) in season.items()} for (season_num, season) in imdb_media['seasons'].items()} if imdb_media['seasons'] else None,
                    'storyline': imdb_media['storyline'],
                    'title': imdb_media['title'],
                    'wallpaper_url': imdb_media['wallpaper_url']
                })

            for file_id in media['files']:
                file = self.files[file_id]
                out_media['files'][file_id] = {
                    'audio_streams': {str(stream['index']): stream['language'] for stream in file['audio_streams']},
                    'quality': file['quality'],
                    'resolution': file['resolution'],
                    'size': file['size']
                }

                season_num = file['season_number']
                episode_num = file['episode_number']

                if season_num and episode_num:
                    if not out_media['seasons']:
                        out_media['seasons'] = dict()

                    seasons = out_media['seasons']
                    if not season_num in seasons:
                        seasons[season_num] = dict()

                    season = seasons[season_num]
                    if not episode_num in season:
                        season[episode_num] = {
                            'description': None,
                            'files': list(),
                            'title': f"S{season_num}E{episode_num}",
                            'thumbnail_url': None
                        }

                    season[episode_num]['files'].append(file_id)

            # out_medias.append(out_media)
            out_medias[media_id] = out_media

        self.noticeboard.publish_threadsafe(out_medias, loop=self.loop)

    def add_file(self, filepath):
        name = os.path.splitext(os.path.basename(filepath))[0]
        torrent = PTN.parse(name)

        file_id = hash_str(filepath)
        imdb_id = self.imdb.query(torrent['title'], year=torrent.get('year'))

        if imdb_id:
            media_id = hash_str(imdb_id)
            self.imdb.request_media(imdb_id) # prepare request

            if not media_id in self.medias:
                self.medias[media_id] = {
                    'files': set(),

                    'imdb_id': imdb_id
                }

            if ('season' in torrent) and ('episode' in torrent):
                self.imdb.request_media_season(imdb_id, str(torrent['season']))

        else:
            media_id = hash_str(torrent['title'])

            if not media_id in self.medias:
                self.medias[media_id] = {
                    'files': set(),

                    'seasons': dict() if 'season' in torrent else None,
                    'title': torrent['title'],
                    'year': torrent.get('year')
                }

        self.files[file_id] = {
            **self.get_file_metadata(filepath),
            'episode_number': str(torrent['episode']) if 'episode' in torrent else None,
            'filepath': filepath,
            'media_id': media_id,
            'quality': torrent.get('quality'),
            'resolution': torrent.get('resolution'),
            'season_number': str(torrent['season']) if 'season' in torrent else None,
            'size': os.path.getsize(filepath)
        }

        media = self.medias[media_id]
        media['files'].add(file_id)

        LOG.info("Adding file '%s' (%s)", filepath, file_id)

        self.imdb.save_cache()
        self.publish()

    def remove_file(self, filepath):
        file_id = hash_str(filepath)
        LOG.info("Removing file '%s' (%s)", filepath, file_id)

        media_id = self.files[file_id]['media_id']
        media = self.medias[media_id]

        media['files'].remove(file_id)

        if not media['files']:
            del self.medias[media_id]

        del self.files[file_id]

        self.publish()


    def get_file_metadata(self, filepath):
        result = subprocess.run(["ffprobe", filepath, "-show_entries", "stream=codec_name,codec_type,index:stream_tags=language,title:format=duration", "-print_format", "json"], capture_output=True, text=True)

        if result.returncode != 0:
            raise Exception("ffprobe returned non-zero exit code")

        data = json.loads(result.stdout)

        audio_streams = list()
        video_codec = None

        for stream in data['streams']:
            if stream['codec_type'] == 'audio':
                tags = stream.get('tags')

                title = tags.get('title') if tags else None
                language = (tags.get('language') if tags else None) or "und"

                if language == "und" and title:
                    language = iso639.from_title(title)

                audio_streams.append({
                    'codec': stream['codec_name'],
                    'index': stream['index'],
                    'language': language,
                    'title': title
                })
            elif stream['codec_type'] == 'video' and video_codec is None:
                video_codec = stream['codec_name']

        return {
            'audio_streams': audio_streams,
            'duration': float(data['format']['duration']),
            'video_codec': video_codec
        }

    def host_file(self, file_id, audio_stream_index = None):
        if self.server is None:
            return None

        if not file_id in self.files:
            return None

        file = self.files[file_id]

        if audio_stream_index is None:
            audio_stream_index = file['audio_streams'][0]['index']

        return self.server.add_item(file_id, filepath=file['filepath'], duration=file['duration'], audio_channel=audio_stream_index)



class Watcher:
    def __init__(self, manager, origin, patterns):
        self.manager = manager
        self.origin = origin
        self.patterns = patterns

        self.filepaths = set()

    def matches_patterns(self, filepath):
        for pattern in self.patterns:
            if fnmatch.fnmatch(filepath, pattern):
                return True

        return False

    def discover(self):
        for pattern in self.patterns:
            for filepath in glob.glob(os.path.join(self.origin, "**", pattern), recursive=True):
                self.add_file(filepath)

    def start(self):
        event_handler = EventHandler(self)
        self.observer = watchdog.observers.Observer()
        self.observer.schedule(event_handler, self.origin, recursive=True)
        self.observer.start()

    def stop(self):
        self.observer.stop()
        self.observer.join()

    def add_file(self, filepath):
        if self.matches_patterns(filepath):
            if not filepath in self.filepaths:
                self.filepaths.add(filepath)
                self.manager.add_file(filepath)
            else:
                LOG.warn("Adding existing file at '%s'", filepath)

    def remove_file(self, filepath):
        if filepath in self.filepaths:
            self.filepaths.remove(filepath)
            self.manager.remove_file(filepath)
        elif self.matches_patterns(filepath):
            LOG.warn("Removing missing file at '%s'", filepath)

    def remove_directory_children(self, dirpath):
        for filepath in {filepath for filepath in self.filepaths if not os.path.relpath(filepath, dirpath).startswith("..")}:
            self.remove_file(filepath)


class EventHandler(watchdog.events.FileSystemEventHandler):
    def __init__(self, watcher):
        super().__init__()
        self.watcher = watcher

    def on_created(self, event):
        if not event.is_directory:
            self.watcher.add_file(event.src_path)

    def on_deleted(self, event):
        if event.is_directory:
            self.watcher.remove_directory_children(event.src_path)
        else:
            self.watcher.remove_file(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self.watcher.remove_file(event.src_path)
            self.watcher.add_file(event.dest_path)


def hash_str(value):
    return hashlib.sha256(bytes(value, 'utf-8')).hexdigest()

