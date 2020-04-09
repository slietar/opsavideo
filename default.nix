{ nixpkgs ? import <nixpkgs> {}, pythonPkgs ? nixpkgs.pkgs.python37Packages }:
let pkgs = nixpkgs.pkgs; in
pythonPkgs.buildPythonApplication {
  pname = "opsavideo";
  version = "0.0.1";
  src = ./.;
  nativeBuildInputs = with pkgs; [ sass ];
  propagatedBuildInputs = with pythonPkgs; [ PyChromecast websockets ];
  postInstall = ''
    mkdir -p $out/static
    cp $src/static/index.html $out/static
    cp $src/static/main.js $out/static
    scss $src/static/styles/main.scss $out/static/main.css
  '';
}
