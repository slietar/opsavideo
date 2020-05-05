import json
import logging
import lxml.html
import os
import time
import urllib

from . import iso639
from .http import request


LOG = logging.getLogger("opsavideo.imdb")
class IMDBDatabase:
    def __init__(self, dir_path, version):
        self.cache_path = dir_path and os.path.join(dir_path, "imdb_cache.json")
        self.medias = dict()
        self.queries = dict()
        self.version = version

    def load_cache(self):
        try:
            if self.cache_path is None:
                raise Exception("No cache path")

            with open(self.cache_path, 'r') as file:
                data = json.load(file)

                if data.get('version') != self.version:
                    raise Exception("Upgrade required")

                self.medias = data['data']['medias']
                self.queries = data['data']['queries']
                LOG.info("Loaded cache")

                return True

        except Exception as err:
            LOG.info("Cound not load cache: %s", err)
            return False

    def save_cache(self):
        if self.cache_path is None:
            return

        with open(self.cache_path, 'w') as file:
            json.dump({
                'data': {
                    'medias': self.medias,
                    'queries': self.queries
                },
                'version': self.version
            }, file)

    def query(self, query, *, year = None):
        result = self.query_title(query)

        for item in result['results']:
            if (year is not None) and (item['year'] is not None) and (abs(year - item['year']) > 1):
                continue

            return item['id']

        return None

    def query_title(self, query):
        LOG.info("Querying media '%s'", query)

        cached_result = self.queries.get(query)
        if cached_result is not None and cached_result['expiration_time'] > time.time():
            return cached_result

        def run_query():
            raw_data = request(f"http://sg.media-imdb.com/suggests/{urllib.parse.quote(query[0].lower())}/{urllib.parse.quote(query)}.json")
            data = json.loads(raw_data[raw_data.index('(') + 1:-1])

            results = list()

            if 'd' in data:
                for item in data['d']:
                    if 'q' in item:
                        results.append({
                            'id': item['id'],
                            'year': item.get('y')
                        })

            return {
                'results': results,
                'expiration_time': int(time.time()) + 600000
            }

        result = run_query()
        self.queries[query] = result
        return result

    def request_media(self, id):
        LOG.info("Requesting media '%s'", id)

        cached_result = self.medias.get(id)
        if cached_result is not None and cached_result['expiration_time'] > time.time():
            return cached_result

        def run_request():
            tree = lxml.html.fromstring(request(f"https://www.imdb.com/title/{id}/"))

            description = run_chain(get_first(tree.find_class("summary_text")), get_text_content)
            duration = run_chain(get_first(tree.xpath("//*[@id='titleDetails']//h4[text()='Runtime:']/../time")), lambda element: int(get_text_content(element)[0:-4]) * 60)
            languages = [iso639.from_title(get_text_content(element)) for element in tree.xpath("//*[@id='titleDetails']//h4[text()='Language:']/../a")]
            poster_url = run_chain(get_first(tree.find_class("poster")), lambda element: get_first(element.xpath(".//img")), lambda element: element.get("src"), transform_img_url)
            title = run_chain(get_first(tree.find_class("originalTitle")) or get_first(tree.xpath("//h1")), get_text_content)
            storyline = run_chain(get_first(tree.xpath("//*[@id='titleStoryLine']//p/span")), get_full_text_content)

            is_series = len(tree.find_class("np_episode_guide")) > 0

            try:
                wallpaper_tree = lxml.html.fromstring(request(f"https://www.imdb.com/title/{id}/mediaindex?refine=still_frame"))
                wallpaper_url = run_chain(get_first(wallpaper_tree.xpath("//img[@width='100']")), lambda element: element.get("src"), transform_img_url)
            except Exception:
                wallpaper_url = None


            return {
                'description': description,
                'duration': duration,
                'id': id,
                'languages': languages,
                'poster_url': poster_url,
                'seasons': dict() if is_series else None,
                'storyline': storyline,
                'title': title,
                'wallpaper_url': wallpaper_url,

                'expiration_time': int(time.time()) + 600000
            }

        result = run_request()
        self.medias[id] = result
        return result

    # 'season_number' is a string
    def request_media_season(self, id, season_number):
        media = self.medias[id]

        if media['seasons'] is None:
            return False

        if season_number in media['seasons']:
            return True

        try:
            tree = lxml.html.fromstring(request(f"https://www.imdb.com/title/{id}/episodes?season={season_number}"))
        except Exception:
            return False

        episodes = dict()

        for episode_number, element in enumerate(tree.find_class("list_item"), start=1):
            description = run_chain(get_first(element.find_class("item_description")), get_text_content)
            title = run_chain(get_first(element.xpath(".//a[@itemprop='name']")), get_text_content)
            thumbnail_url = run_chain(get_first(element.xpath(".//img")), lambda element: element.get("src"), transform_img_url)

            episodes[str(episode_number)] = {
                'description': description,
                'thumbnail_url': thumbnail_url,
                'title': title
            }

        media['seasons'][season_number] = episodes
        return True


def transform_img_url(url):
    return url[0:url.find("._V1_")] + "._V1_.jpg"

def run_chain(value, *args):
    for handler in args:
        if value is None:
            return None

        value = handler(value)

    return value

def get_full_text_content(element):
    return element.text_content().strip() or None

def get_text_content(element):
    return element.text and element.text.strip() or None

def get_first(target):
    return target[0] if target else None

