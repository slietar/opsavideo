{ pkgs ? import <nixpkgs> {} }:
let
  static = pkgs.callPackage ./static {};
  server = pkgs.callPackage ./server {};
in pkgs.symlinkJoin {
  name = "opsavideo";
  paths = [ server ];
  buildInputs = [ pkgs.makeWrapper ];
  postBuild = ''
    ln -s ${static} $out/static
    wrapProgram $out/bin/opsavideo --add-flags "--static $out/static"
  '';
  passthru = { inherit static server; };
}
