import glob
import json
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

        self.files = dict()
        self.movies = dict()

    def start(self):
        self.run_discovery()

        event_handler = EventHandler(self, self.patterns)
        self.observer = watchdog.observers.Observer()
        self.observer.schedule(event_handler, self.path, recursive=True)
        self.observer.start()

    def stop(self):
        self.observer.stop()

    def publish(self):
        self.noticeboard.publish_threadsafe(self.files)

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

        self.files[filepath] = {
            'movie': self.find_movie(title),
            'size': os.path.getsize(filepath),
            'title': title,

            'series': {
                'episode': torrent['episode'],
                'season': torrent['season']
            } if ('episode' in torrent) and ('season' in torrent) else None
        }

        self.publish()

    def remove_file(self, filepath):
        del self.files[filepath]
        self.publish()

    def find_movie(self, title):
        if title in self.movies:
            return self.movies[title]

        try:
            res = urllib.request.urlopen(f"http://sg.media-imdb.com/suggests/{urllib.parse.quote(title[0].lower())}/{urllib.parse.quote(title)}.json")
            raw_data = res.read().decode("utf-8")
            data = json.loads(raw_data[raw_data.index('(') + 1:-1])
        except urllib.error.HTTPError as e:
            return None

        if 'd' in data:
            result = data['d'][0]

            self.movies[title] = {
                'id': result['id'],
                'image': result.get('i'),
                'kind': result.get('q'),
                'main_actors': result['s'],
                'title': result['l'],
                'year': result.get('y')
            }

            return self.movies[title]
        else:
            return None


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

