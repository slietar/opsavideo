from aiohttp import web
import asyncio
import logging
import math
import os
import subprocess
import tempfile
import time
import threading
import uuid


LOG = logging.getLogger('opsavideo.conversion')
class FileConversionController:
    def __init__(self, filepath, duration, audio_channel):
        self.audio_channel = audio_channel
        self.filepath = filepath
        self.duration = duration

        self.options = {
            # duration of a chunk (in seconds)
            'chunk_duration': 5,

            # delay to open the playlist after it was last modified (in seconds)
            #   0: the playlist will be opened as soon as it is modified (with at most 1s delay), with usually only one chunk
            'mtime_delay': 10,

            # maximum delay for a client to wait the arrival of an existing converter to the chunk of interest (in chunks)
            #   -1: a new converter will always be started
            #   math.inf: no extra converted will ever be started
            'proximity_limit': 30,

            # maximum number of converts
            #   math.inf: not limit
            'converter_limit': 2
        }

        number_chunks = math.ceil(self.duration / self.options['chunk_duration'])

        self.chunks = [None for index in range(number_chunks)]
        self.out_files = list()

        self.conversions = list()
        self.next_conversion_number = 0

        self.clients = dict()
        self.chunk_requests = dict()

    def add_client_chunk(self, client_id, chunk_index):
        if self.chunks[chunk_index] is not None:
            return

        LOG.info("[cl. %s] Adding chunk %d", client_id, chunk_index)

        if not client_id in self.clients:
            self.clients[client_id] = set()

        self.clients[client_id].add(chunk_index)
        self.manage_conversions()

    def remove_client_chunk(self, client_id, chunk_index):
        LOG.info("[cl. %s] Removing chunk %d", client_id, chunk_index)
        self.clients[client_id].discard(chunk_index)

        self.manage_conversions()

    def remove_clients_chunk(self, chunk_index):
        for client_id, client_chunks in self.clients.items():
            if chunk_index in client_chunks:
                LOG.info("[cl. %s] Removing chunk %d", client_id, chunk_index)
                client_chunks.remove(chunk_index)

        self.manage_conversions()


    def manage_conversions(self):
        target_chunk_indices = set()

        for client_id, client_chunks in self.clients.items():
            for client_chunk_index in sorted(client_chunks):
                for target_chunk_index in target_chunk_indices:
                    distance = target_chunk_index - client_chunk_index

                    if distance >= 0 and distance < 10:
                        break
                else:
                    target_chunk_indices.add(client_chunk_index)


        current_time = time.time()
        new_conv_chunk_indices = target_chunk_indices.copy()

        for conv in self.conversions:
            for target_chunk_index in target_chunk_indices:
                distance = target_chunk_index - conv['time']

                if distance >= 0 and distance < 10:
                    conv['last_active_time'] = None
                    new_conv_chunk_indices.discard(target_chunk_index)
                    break
            else:
                if conv['last_active_time'] is None:
                    LOG.info("[#%d] Putting in standby due to inactivity", conv['number'])
                    conv['last_active_time'] = time.time()
                elif current_time - conv['last_active_time'] > 5:
                    LOG.info("[#%d] Terminating due to inactivity", conv['number'])
                    self.stop_conv(conv)

        for chunk_index in new_conv_chunk_indices:
            self.start_conversion(chunk_index)


    def start_conversion(self, start_chunk_index):
        """
        frame=75959 fps=125 q=26.0 size=N/A time=00:00:30.46 bitrate=N/A speed=5.02x
        fps=125.16
        stream_0_0_q=26.0
        bitrate=N/A
        total_size=N/A
        out_time_us=30464578
        out_time_ms=30464578
        out_time=00:00:30.464578
        dup_frames=0
        drop_frames=0
        speed=5.02x
        progress=continue
        """
        start_time = start_chunk_index * self.options['chunk_duration']

        out_id = uuid.uuid4()
        out_filepath_path = os.path.join(tempfile.gettempdir(), str(out_id))
        out_filepath_playlist = out_filepath_path + ".m3u8"
        out_filepath_media = out_filepath_path + ".ts"

        thread_ready = threading.Event()

        def handler():
            conv_number = self.next_conversion_number
            LOG.info("[#%d] Starting conversion from chunk %d to '%s'", conv_number, start_chunk_index, out_filepath_media)

            # -ss <t>
            #   set start time
            # -map 0:v0 -map 0:<x>
            #   select audio and video streams
            # -c:v libx264 -crf 21 -preset veryfast -g 25 -sc_threshold 0
            #   set video codec
            # -c:a aac -b:a 128k -ac 2
            #   set audio codec (keep -ac ?)
            # -copyts -timecode <t>
            #   set offset output timecodes
            # -f hls -hls_time <t> -hls_playlist_type event -hls_flags single_file
            #   set output format
            # -progress - -y
            #   set output information format
            process = subprocess.Popen(f"ffmpeg -ss {start_time} -i '{self.filepath}' -map 0:v:0 -map 0:{self.audio_channel} -c:v libx264 -crf 21 -preset veryfast -g 25 -sc_threshold 0 -c:a aac -b:a 128k -ac 2 -copyts -timecode {start_time} -f hls -hls_time {self.options['chunk_duration']} -hls_playlist_type event -hls_flags single_file -progress - -y {out_filepath_playlist}", shell=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            conv = {
                'number': conv_number,
                'last_active_time': None,
                'process': process,
                'time': start_chunk_index
            }

            self.next_conversion_number += 1

            self.conversions.append(conv)
            self.out_files.append(out_filepath_media)

            thread_ready.set()

            last_chunks_length = 0
            last_mtime = None

            data = dict()
            for line in iter(process.stdout.readline, b''):
                [key, value] = line.decode("utf-8").strip().split("=", 2)
                data[key] = value

                if key != "progress" or int(data['out_time_us']) < self.options['chunk_duration'] * 1e6 * 1.5:
                    continue

                if not os.path.isfile(out_filepath_playlist):
                    LOG.info("[#%d] Playlist does not exist, will try again later", conv_number)
                    continue

                mtime = os.path.getmtime(out_filepath_playlist)

                if last_mtime is None or mtime - last_mtime > self.options['mtime_delay']:


                    last_mtime = mtime
                    added_chunks = list()

                    with open(out_filepath_playlist) as file:
                        key = "#EXT-X-BYTERANGE:"
                        chunks_lines = [line for line in file.readlines() if line.startswith(key)]

                        for line in chunks_lines[last_chunks_length:]:
                            [chunk_size, chunk_offset] = line[len(key):].rstrip("\n").split("@")
                            added_chunks.append((int(chunk_offset), int(chunk_size)))

                        last_chunks_length = len(chunks_lines)

                    LOG.info("[#%d] Adding %d chunks", conv_number, len(added_chunks))
                    cont_conversion = self.conv_add_chunks(conv, added_chunks)

                    if not cont_conversion:
                        break

            process.wait()
            LOG.info("[#%d] Process exited with code %d", conv_number, process.returncode)

            if conv in self.conversions:
                self.conversions.remove(conv)



        thread = threading.Thread(target=handler)
        thread.start()

        thread_ready.wait()

    def conv_add_chunks(self, conv, chunks):
        last_chunk_index = conv['time']

        for chunk_rel_index, (chunk_offset, chunk_size) in enumerate(chunks):
            chunk_index = last_chunk_index + chunk_rel_index

            if self.chunks[chunk_index] is not None:
                LOG.info("[#%d] Dropping conversion after encountering a converted chunk", conv['number'])
                self.stop_conv(conv)

                return False

            self.chunks[chunk_index] = (conv['number'], chunk_offset, chunk_size)
            self.remove_clients_chunk(chunk_index)

            if chunk_index in self.chunk_requests:
                """
                try:
                    loop = asyncio.get_running_loop()
                except Exception:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                """

                self.chunk_requests[chunk_index].set()
                # loop.call_soon_threadsafe(self.chunk_requests[chunk_index].set)

        conv['time'] += len(chunks)

        """
        if self.should_drop_conversion(conv):
            LOG.info("[#%d] Dropping conversion due to lack of clients")
            self.stop_conv(conv)
            return False
        """

        return True

    def stop_conv(self, conv):
        conv['process'].kill()
        conv['process'].wait() # ?
        self.conversions.remove(conv)

    def log_chunks(self):
        out_str = ""

        for chunk in self.chunks:
            out_str += "-" if chunk is None else "="

        return out_str

    async def wait_chunk(self, client_id, chunk_index):
        if self.chunks[chunk_index] is not None:
            return

        if not chunk_index in self.chunk_requests:
            self.chunk_requests[chunk_index] = threading.Event()

        LOG.info("[cl. %s] Waiting for chunk %d", client_id, chunk_index)

        loop = asyncio.get_running_loop()
        chunk_buffer = await loop.run_in_executor(None, lambda: self.chunk_requests[chunk_index].wait())


    async def get_chunk(self, client_id, chunk_index):
        self.add_client_chunk(client_id, chunk_index)

        try:
            await self.wait_chunk(client_id, chunk_index)
        except asyncio.CancelledError:
            LOG.info("[cl. %s] Cancelling request of chunk %d", client_id, chunk_index)
            self.remove_client_chunk(client_id, chunk_index)
            return None

        chunk = self.chunks[chunk_index]

        if chunk is None:
            return None

        (file_index, chunk_offset, chunk_size) = chunk
        filepath = self.out_files[file_index]

        with open(filepath, 'rb') as file:
            file.seek(chunk_offset)
            return file.read(chunk_size)

    def generate_playlist(self, *, path_prefix):
        playlist = f"#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:{self.options['chunk_duration']}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n"

        for chunk_index, chunk in enumerate(self.chunks):
            playlist += f"#EXTINF:{self.options['chunk_duration']},\n{path_prefix}{chunk_index}.ts\n#EXT-X-DISCONTINUITY\n"

        playlist += "#EXT-X-ENDLIST\n"

        return playlist



class ConversionServer:
    def __init__(self, *, hostname, port):
        self.hostname = hostname
        self.port = port

        self.files = dict()

    async def start(self):
        async def route_playlist(request):
            file_id = request.match_info.get('file_id')
            audio_channel = int(request.match_info.get('audio_channel'))

            if (not file_id in self.files) or (not audio_channel in self.files[file_id]):
                raise web.HTTPNotFound()

            playlist = self.files[file_id][audio_channel].generate_playlist(path_prefix=f"/{file_id}/{audio_channel}/chunk/")

            return web.Response(text=playlist, headers={
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "vnd.apple.mpegURL"
            })

        async def route_chunk(request):
            file_id = request.match_info.get('file_id')
            audio_channel = int(request.match_info.get('audio_channel'))

            if (not file_id in self.files) or (not audio_channel in self.files[file_id]):
                raise web.HTTPNotFound()

            chunk_index = int(request.match_info.get('chunk_index'))
            client_id = hex(abs(hash(request.remote)))

            chunk_buffer = await self.files[file_id][audio_channel].get_chunk(client_id, chunk_index)

            if chunk_buffer is None:
                raise web.HTTPBadRequest()

            return web.Response(body=chunk_buffer, headers={
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "video/MP2T"
            })


        app = web.Application()

        app.add_routes([
            web.get('/{file_id}/{audio_channel}/playlist.m3u8', route_playlist),
            web.get('/{file_id}/{audio_channel}/chunk/{chunk_index}.ts', route_chunk)
        ])

        runner = web.AppRunner(app, access_log_format='%a %t "%r" %s %b')
        await runner.setup()

        LOG.info("Listening on http://%s:%d", self.hostname, self.port)

        site = web.TCPSite(runner, self.hostname, self.port)
        await site.start()

    def add_item(self, file_id, filepath, duration, audio_channel):
        LOG.info("Requesting conversion setup for file %s and audio channel %d", file_id, audio_channel)

        if not file_id in self.files:
            self.files[file_id] = dict()

        if not audio_channel in self.files[file_id]:
            self.files[file_id][audio_channel] = FileConversionController(filepath, duration, audio_channel)

        return f"http://{self.hostname}:{self.port}/{file_id}/{audio_channel}/playlist.m3u8"

    def discard_file(self, file_id):
        if file_id in self.files:
            for controller in self.files[file_id].values():
                # controller.stop()
                pass

            del self.files[file_id]

