import PTN
import fnmatch
import glob
import hashlib
import json
import logging
import lxml.html
import os
import urllib.parse
import urllib.request
import watchdog.events
import watchdog.observers

import asyncio

LOG = logging.getLogger('opsavideo.media')
class MediaManager:
    def __init__(self, path, noticeboard, loop):
        self.obsever = None
        self.noticeboard = noticeboard
        self.loop = loop

        self.files = dict() # id -> episode, movie, etc.
        self.medias = dict() # IMDB id -> TV series, movie, etc.

        self.watcher = Watcher(self, origin=path, patterns=["*.avi", "*.mkv", "*.mp4"])

    def start(self):
        self.watcher.discover()
        self.watcher.start()

    def stop(self):
        self.watcher.stop()

    def publish(self):
        self.noticeboard.publish_threadsafe({
            'files': self.files,
            'medias': self.medias
        }, loop=self.loop)

    def add_file(self, filepath):
        name = os.path.splitext(os.path.basename(filepath))[0]
        torrent = PTN.parse(name)

        title = torrent['title']
        media = self.find_media(title)

        if (media is not None) and ('season' in torrent):
            self.find_media_season(media, torrent['season'])

        file_id = self.get_file_id(filepath)
        LOG.info("Add '%s' (%s)", filepath, file_id)

        self.files[file_id] = {
            'episode': torrent.get('episode'),
            'filepath': filepath,
            'media': media['imdb_id'] if (media is not None) else None,
            'quality': torrent.get('quality'),
            'resolution': torrent.get('resolution'),
            'season': torrent.get('season'),
            'size': os.path.getsize(filepath),
            'title': title,
            'year': torrent.get('year')
        }

        self.publish()

    def remove_file(self, filepath):
        file_id = self.get_file_id(filepath)
        LOG.info("Remove '%s' (%s)", filepath, file_id)

        del self.files[file_id]

        self.publish()

    def find_media(self, title):
        try:
            raw_data = request(f"http://sg.media-imdb.com/suggests/{urllib.parse.quote(title[0].lower())}/{urllib.parse.quote(title)}.json")
            data = json.loads(raw_data[raw_data.index('(') + 1:-1])

            if not 'd' in data:
                return None

            # find first media of interest
            result = None
            for item in data['d']:
                if 'q' in item: # not a media
                    result = item
                    break

            if not result:
                return None

            imdb_id = result['id']

            if imdb_id in self.medias:
                return self.medias[imdb_id]


            tree = lxml.html.fromstring(request(f"https://www.imdb.com/title/{imdb_id}/"))

            description = tree.find_class("summary_text")[0].text_content().strip()
            duration = tree.xpath("//time")[0].text_content().strip()


            tree = lxml.html.fromstring(request(f"https://www.imdb.com/title/{imdb_id}/mediaindex?refine=still_frame"))

            wallpaper = None
            wallpaperElement = tree.xpath("""//img[@width="100"]""")

            if wallpaperElement:
                wallpaper = wallpaperElement[0].get("src")


            self.medias[imdb_id] = {
                'description': description,
                'duration': duration,
                'seasons': (dict() if result.get('q') == 'TV series' else None),
                'imdb_id': imdb_id,
                'image': result.get('i'),
                'main_actors': result['s'],
                'title': result['l'],
                'wallpaper': wallpaper,
                'year': result.get('y')
            }

            return self.medias[imdb_id]

        except urllib.error.HTTPError as e:
            return None

    def find_media_season(self, media, season):
        if season in media['seasons']:
            return

        try:
            tree = lxml.html.fromstring(request(f"https://www.imdb.com/title/{media['imdb_id']}/episodes?season={season}"))

            episodes = list()

            for episode_element in tree.find_class("list_item"):
                episode_title = episode_element.xpath(".//a[@itemprop='name']")[0].text_content()
                episode_description = episode_element.find_class("item_description")[0].text_content().strip()
                episode_thumbnail = None
                episode_thumbnail_element = episode_element.xpath(".//img")

                if episode_thumbnail_element:
                    episode_thumbnail = episode_thumbnail_element[0].get("src")

                episodes.append({
                    'description': episode_description,
                    'imdb_id': None,
                    'thumbnail': episode_thumbnail,
                    'title': episode_title,
                })

            media['seasons'][season] = episodes

        except urllib.error.HTTPError as e:
            return

    def get_file_id(self, filepath):
        return hashlib.sha256(bytes(filepath, 'utf-8')).hexdigest()



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


def request(url):
    return urllib.request.urlopen(url).read().decode("utf-8")

