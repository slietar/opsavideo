import glob
import json
import lxml.html
import os
import PTN
import urllib.parse
import urllib.request
import watchdog.observers
import watchdog.events


class MediaManager:
    def __init__(self, path, noticeboard):
        self.obsever = None
        self.path = path
        self.patterns = ["*.mkv", "*.mp4"]
        self.noticeboard = noticeboard;

        self.files = dict() # episode, movie, etc.
        self.medias = dict() # TV series, movie, etc.

    def start(self):
        self.run_discovery()

        event_handler = EventHandler(self, self.patterns)
        self.observer = watchdog.observers.Observer()
        self.observer.schedule(event_handler, self.path, recursive=True)
        self.observer.start()

    def stop(self):
        self.observer.stop()

    def publish(self):
        self.noticeboard.publish_threadsafe({
            'files': self.files,
            'medias': self.medias
        })

    def run_discovery(self):
        filepaths = []

        for pattern in self.patterns:
            filepaths += glob.glob(self.path + "/**/" + pattern, recursive=True)

        for filepath in filepaths:
            self.add_file(filepath)

    def add_file(self, filepath):
        name = os.path.splitext(os.path.basename(filepath))[0]
        torrent = PTN.parse(name)

        title = torrent['title']
        media = self.find_media(title)

        if (media is not None) and ('season' in torrent):
            self.find_media_season(media, torrent['season'])

        self.files[filepath] = {
            'episode': torrent.get('episode'),
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
        del self.files[filepath]
        self.publish()

    def find_media(self, title):
        try:
            res = urllib.request.urlopen(f"http://sg.media-imdb.com/suggests/{urllib.parse.quote(title[0].lower())}/{urllib.parse.quote(title)}.json")
            raw_data = res.read().decode("utf-8")
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

            res = urllib.request.urlopen(f"https://www.imdb.com/title/{imdb_id}/")
            raw_data = res.read().decode("utf-8")

            tree = lxml.html.fromstring(raw_data)
            elements = tree.find_class("summary_text")

            description = tree.find_class("summary_text")[0].text_content().strip()
            duration = tree.xpath("//time")[0].text_content().strip()

            self.medias[imdb_id] = {
                'description': description,
                'duration': duration,
                'seasons': (dict() if result.get('q') == 'TV series' else None),
                'imdb_id': imdb_id,
                'image': result.get('i'),
                'main_actors': result['s'],
                'title': result['l'],
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
                episode_title = episode_element.xpath("//a[@itemprop='name']")[0].text_content()
                episode_description = episode_element.find_class("item_description")[0].text_content().strip()

                episodes.append({
                    'description': episode_description,
                    'imdb_id': None,
                    'title': episode_title,
                })

            media['seasons'][season] = episodes

        except urllib.error.HTTPError as e:
            return


class EventHandler(watchdog.events.PatternMatchingEventHandler):
    def __init__(self, manager, patterns):
        super().__init__(patterns=patterns, ignore_directories=True)
        self.manager = manager

    def on_created(self, event):
        self.manager.add_file(event.src_path)

    def on_deleted(self, event):
        self.manager.remove_file(event.src_path)

    def on_moved(self, event):
        self.manager.remove_file(event.src_path)
        self.manager.add_file(event.dest_path)


def request(url):
    return urllib.request.urlopen(url).read().decode("utf-8")

