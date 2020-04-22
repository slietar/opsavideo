{ ffmpeg_4, python37Packages }:
python37Packages.buildPythonApplication {
  pname = "opsavideo";
  version = "0.0.1";
  src = ./.;
  propagatedBuildInputs = (with python37Packages; [
    (python37Packages.callPackage ./parse-torrent-name.nix {})
    PyChromecast
    aiohttp
    lxml
    watchdog
    websockets
  ]);
  buildInputs = [ ffmpeg_4 ];
  nativeBuildInputs = [ ffmpeg_4 ];
  doCheck = false;
}
