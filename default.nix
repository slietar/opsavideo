{ pkgs ? import <nixpkgs> {}, pythonPkgs ? pkgs.python37Packages }:
pkgs.symlinkJoin {
  name = "opsavideo";
  paths = [
    (pkgs.callPackage ./server {})
    (pkgs.callPackage ./static {})
  ];
}
