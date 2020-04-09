{ python37Packages }:
python37Packages.buildPythonApplication {
  pname = "opsavideo";
  version = "0.0.1";
  src = ./.;
  propagatedBuildInputs = with python37Packages; [
    (python37Packages.callPackage ./parse-torrent-name.nix {})
    PyChromecast
    aiohttp
    lxml
    watchdog
    websockets
  ];
  doCheck = false;
}
